// Billing callback — Shopify redirects here after merchant confirms/declines charge.
// This route runs in the top-level window (outside Shopify Admin iframe),
// so it cannot use authenticate.admin(). Update plan from query params.
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { logger } from '~/services/logger.server';
import prisma from '~/db.server';
import { PLAN_QUOTAS } from '~/lib/constants';
import type { PlanKey } from '~/lib/constants';

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

  if (!shop) {
    logger.app('WARN', 'Billing callback missing shop param, redirecting to /app');
    return redirect('/app');
  }

  // Immediately update the plan in the database so the billing page
  // shows the correct plan without waiting for the webhook.
  if (planParam && planParam !== 'FREE') {
    try {
      const quotas = PLAN_QUOTAS[planParam as PlanKey] ?? PLAN_QUOTAS.FREE;
      await prisma.shop.update({
        where: { shopDomain: shop },
        data: {
          plan: planParam as 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE',
          subscriptionStatus: 'TRIALING',
          customerQuota: quotas.customers,
          invoiceQuota: quotas.invoices,
          shopifyChargeId: chargeId ?? undefined,
        },
      });
      logger.app('INFO', 'Plan updated from callback', { shop, plan: planParam, chargeId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // P2025 = shop not found (edge case)
      if (msg.includes('P2025')) {
        logger.app('WARN', 'Callback: shop not yet in DB, webhook will handle', { shop });
      } else {
        logger.app('ERROR', 'Callback: failed to update plan', { shop, error: msg });
      }
    }
  }

  const adminUrl = `https://admin.shopify.com/store/${shop}/apps/trucredit`;
  logger.app('INFO', 'Redirecting to Shopify Admin', { adminUrl });
  return redirect(adminUrl);
};
