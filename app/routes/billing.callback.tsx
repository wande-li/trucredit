// Billing callback — Shopify redirects here after merchant confirms/declines charge.
// This route runs in the top-level window (outside Shopify Admin iframe),
// so it cannot use authenticate.admin(). Verifies charge via Shopify REST API
// before updating the plan in DB to prevent free-plan-abuse via URL crafting.
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { logger } from '~/services/logger.server';
import prisma from '~/db.server';
import { PLAN_QUOTAS } from '~/lib/constants';
import type { PlanKey } from '~/lib/constants';
import { decryptToken } from '~/lib/crypto.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const chargeId = url.searchParams.get('charge_id');
  const planParam = url.searchParams.get('plan');

  logger.app('INFO', 'Billing callback hit', {
    shop,
    chargeId,
    plan: planParam,
  });

  if (!shop || !chargeId || !planParam || planParam === 'FREE') {
    logger.app('WARN', 'Billing callback missing required params', {
      hasShop: !!shop,
      hasChargeId: !!chargeId,
      hasPlan: !!planParam,
      plan: planParam,
    });
    return redirect('/app');
  }

  // Verify the charge via Shopify REST API before trusting the params.
  // This prevents free-plan-abuse: anyone crafting a URL with arbitrary
  // shop + plan params cannot upgrade without a real active charge.
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
    select: { accessToken: true },
  });

  if (!shopRecord) {
    logger.app('WARN', 'Billing callback: shop not in DB', { shop });
    return redirect('/app');
  }

  const token = decryptToken(shopRecord.accessToken);
  const apiUrl = `https://${shop}/admin/api/2025-10/recurring_application_charges/${chargeId}.json`;

  let chargeValid = false;
  try {
    // AbortController: prevent hanging if Shopify API is slow (10s timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const body = (await res.json()) as {
        recurring_application_charge?: { status: string; name: string };
      };
      const charge = body?.recurring_application_charge;
      if (charge?.status === 'active') {
        chargeValid = true;
        logger.app('INFO', 'Billing callback: charge verified', {
          shop,
          chargeId,
          chargeName: charge.name,
        });
      } else {
        logger.app('WARN', 'Billing callback: charge not active', {
          shop,
          chargeId,
          chargeStatus: charge?.status,
        });
      }
    } else {
      logger.app('WARN', 'Billing callback: charge verification HTTP error', {
        shop,
        chargeId,
        httpStatus: res.status,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app('ERROR', 'Billing callback: charge verification request failed', {
      shop,
      chargeId,
      error: msg,
    });
  }

  if (!chargeValid) {
    logger.app('WARN', 'Billing callback: charge verification failed, refusing update', {
      shop,
      chargeId,
      plan: planParam,
    });
    return redirect('/app');
  }

  // Charge verified — update plan in DB as optimistic fast path.
  // The authoritative source is the app_subscriptions/update webhook.
  try {
    const quotas = PLAN_QUOTAS[planParam as PlanKey] ?? PLAN_QUOTAS.FREE;
    await prisma.shop.update({
      where: { shopDomain: shop },
      data: {
        plan: planParam as 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE',
        subscriptionStatus: 'ACTIVE',
        customerQuota: quotas.customers,
        invoiceQuota: quotas.invoices,
        shopifyChargeId: chargeId,
      },
    });
    logger.app('INFO', 'Plan updated from callback', { shop, plan: planParam, chargeId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('P2025')) {
      logger.app('WARN', 'Callback: shop not yet in DB, webhook will handle', { shop });
    } else {
      logger.app('ERROR', 'Callback: failed to update plan', { shop, error: msg });
    }
  }

  const adminUrl = `https://admin.shopify.com/store/${shop}/apps/trucredit`;
  logger.app('INFO', `Redirecting to Shopify Admin: ${adminUrl}`);
  return redirect(adminUrl);
};
