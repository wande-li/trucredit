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
import { billingPlanToEnum } from '~/services/billing.server';
import PageSkeleton from '~/components/PageSkeleton';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const chargeId = url.searchParams.get('charge_id');
  // Shopify Managed Pricing may send plan_handle (new) or plan (legacy)
  const planHandle = url.searchParams.get('plan_handle') || url.searchParams.get('plan');

  logger.app('INFO', 'loader:billing.callback START', null, {
    shop,
    chargeId,
    plan_handle: planHandle,
  });

  // Wandex pattern: only require shop + charge_id. Plan is determined from
  // verified charge.name (REST API), not from URL params. This handles both
  // legacy ?plan=xxx and new ?plan_handle=xxx query parameter formats.
  const adminBaseUrl = shop ? `https://admin.shopify.com/store/${shop}/apps/trucredit` : '/app';

  if (!shop || !chargeId) {
    logger.app('WARN', 'loader:billing.callback ERROR: missing params', {
      hasShop: !!shop,
      hasChargeId: !!chargeId,
    });
    return redirect(adminBaseUrl);
  }

  // Verify the charge via Shopify REST API before trusting the params.
  // This prevents free-plan-abuse: anyone crafting a URL with arbitrary
  // shop + charge_id params cannot upgrade without a real active charge.
  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { accessToken: true },
    });

    if (!shopRecord) {
      logger.app('WARN', 'loader:billing.callback ERROR: shop not in DB', { shop });
      return redirect(adminBaseUrl);
    }

    const token = decryptToken(shopRecord.accessToken);
    const apiUrl = `https://${shop}/admin/api/2025-10/recurring_application_charges/${chargeId}.json`;

    let chargeName: string | undefined;
    let chargePrice: number | undefined;
    let chargeTrialDays: number | undefined;

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
          recurring_application_charge?: {
            status: string;
            name: string;
            price?: string | number;
            trial_days?: number;
          };
        };
        const charge = body?.recurring_application_charge;
        if (charge?.status === 'active') {
          chargeName = charge.name;
          chargePrice =
            typeof charge?.price === 'string'
              ? parseFloat(charge.price)
              : typeof charge?.price === 'number'
                ? charge.price
                : undefined;
          chargeTrialDays = charge?.trial_days;
          logger.app('INFO', 'loader:billing.callback charge_verified OK', {
            shop,
            chargeId,
            chargeName,
            chargePrice,
            chargeTrialDays,
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

    if (!chargeName) {
      logger.app('WARN', 'loader:billing.callback charge_verification_failed WARN', {
        shop,
        chargeId,
        plan_handle: planHandle,
      });
      // Charge not verified — redirect to dashboard; webhook will sync later
      return redirect(adminBaseUrl);
    }

    // Wandex pattern: use charge.name from REST API (not URL param) to determine plan.
    // charge.name is authoritative (e.g. "TruCredit Business"), immune to URL format changes.
    const planEnum = billingPlanToEnum(chargeName);

    // Charge verified — update plan in DB as optimistic fast path.
    // The authoritative source is the app_subscriptions/update webhook.
    // Mirrors Wandex pattern: $transaction + sync chargePrice/trialDays.
    try {
      const quotas = PLAN_QUOTAS[planEnum as PlanKey] ?? PLAN_QUOTAS.FREE;
      const updateData: Record<string, unknown> = {
        plan: planEnum as 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE',
        subscriptionStatus: 'ACTIVE',
        customerQuota: quotas.customers,
        invoiceQuota: quotas.invoices,
        shopifyChargeId: chargeId,
      };
      if (chargePrice !== undefined && !Number.isNaN(chargePrice)) {
        updateData.priceAmount = chargePrice;
      }
      if (chargeTrialDays !== undefined) {
        updateData.trialDays = chargeTrialDays;
      }

      await prisma.$transaction([
        prisma.shop.update({
          where: { shopDomain: shop },
          data: updateData,
        }),
      ]);
      logger.app('INFO', 'loader:billing.callback plan_updated OK', {
        shop,
        chargeName,
        planEnum,
        chargeId,
        priceAmount: chargePrice,
        trialDays: chargeTrialDays,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('P2025')) {
        logger.app('WARN', 'loader:billing.callback shop_not_in_db WARN', { shop });
      } else {
        logger.app('ERROR', 'loader:billing.callback plan_update_failed ERROR', { shop, error: msg });
      }
      // Even if DB update fails, redirect to dashboard — webhook will sync
    }

    const durationMs = Date.now() - t0;
    logger.app('INFO', 'loader:billing.callback redirect OK', null, { shop, chargeName, chargeId, durationMs });
    return redirect(adminBaseUrl);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app('ERROR', 'loader:billing.callback outer_catch ERROR', msg, {
      shop,
      chargeId,
      durationMs: Date.now() - t0,
    });
    // User paid but something failed — still redirect to dashboard; webhook will sync later
    return redirect(adminBaseUrl);
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
