// Billing callback — Shopify redirects here after merchant confirms/declines charge.
// This route runs in the top-level window (outside Shopify Admin iframe),
// so it cannot use authenticate.admin(). Verifies charge via Shopify REST API
// before updating the plan in DB to prevent free-plan-abuse via URL crafting.
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { isRouteErrorResponse, useRouteError } from '@remix-run/react';
import { Page, Card, Text, BlockStack, Banner, Link } from '@shopify/polaris';
import { logger } from '~/services/logger.server';
import prisma from '~/db.server';
import { PLAN_QUOTAS } from '~/lib/constants';
import type { PlanKey } from '~/lib/constants';
import { decryptToken } from '~/lib/crypto.server';
import PageSkeleton from '~/components/PageSkeleton';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const chargeId = url.searchParams.get('charge_id');
  const planParam = url.searchParams.get('plan');

  logger.app('INFO', 'loader:billing.callback START', null, {
    shop,
    chargeId,
    plan: planParam,
  });

  if (!shop || !chargeId || !planParam || planParam === 'FREE') {
    logger.app('WARN', 'loader:billing.callback ERROR: missing params', {
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
  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { accessToken: true },
    });

    if (!shopRecord) {
      logger.app('WARN', 'loader:billing.callback ERROR: shop not in DB', { shop });
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
          logger.app('INFO', 'loader:billing.callback charge_verified OK', {
            shop,
            chargeId,
            chargeName: charge.name,
          });
        } else {
          logger.app('WARN', 'loader:billing.callback charge_not_active WARN', {
            shop,
            chargeId,
            chargeStatus: charge?.status,
          });
        }
      } else {
        logger.app('WARN', 'loader:billing.callback charge_verification_http_error WARN', {
          shop,
          chargeId,
          httpStatus: res.status,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app('ERROR', 'loader:billing.callback charge_verification_request_failed ERROR', {
        shop,
        chargeId,
        error: msg,
      });
    }

    if (!chargeValid) {
      logger.app('WARN', 'loader:billing.callback charge_verification_failed WARN', {
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
      logger.app('INFO', 'loader:billing.callback plan_updated OK', { shop, plan: planParam, chargeId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('P2025')) {
        logger.app('WARN', 'loader:billing.callback shop_not_in_db WARN', { shop });
      } else {
        logger.app('ERROR', 'loader:billing.callback plan_update_failed ERROR', { shop, error: msg });
      }
    }

    const adminUrl = `https://admin.shopify.com/store/${shop}/apps/trucredit`;
    const durationMs = Date.now() - t0;
    logger.app('INFO', 'loader:billing.callback redirect OK', null, { shop, plan: planParam, chargeId, durationMs });
    return redirect(adminUrl);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app('ERROR', 'loader:billing.callback outer_catch ERROR', msg, {
      shop,
      chargeId,
      plan: planParam,
      durationMs: Date.now() - t0,
    });
    // User paid but DB lookup failed — still redirect to dashboard; webhook will sync later
    if (shop) {
      return redirect(`https://admin.shopify.com/store/${shop}/apps/trucredit`);
    }
    return redirect('/app');
  }
};

// ─── Error Boundary ───
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <Page title="Payment Verification">
        <BlockStack gap="400">
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">
              {error.status === 404
                ? "The payment verification page was not found."
                : error.status === 500
                  ? "Server error — please try again."
                  : 'Error ' + error.status + ': ' + error.statusText}
            </Text>
          </Banner>
          <Card padding="500">
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" tone="subdued">
                Return to the <Link url="/app">Dashboard</Link> to check your subscription status.
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  return (
    <Page title="Payment Processing">
      <BlockStack gap="400">
        <Banner tone="critical">
          <Text as="p" variant="bodyMd">
            Payment verification encountered an issue. Your payment may still be processing.
            Please check your subscription in the Dashboard.
          </Text>
        </Banner>
        <Card padding="500">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {message}
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ─── Loading Skeleton ───
export function HydrateFallback() {
  return <PageSkeleton />;
}
