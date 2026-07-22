// Temporary: test webhook cancel handler (no auth required)
import { json } from "@remix-run/node";
import prisma from "~/db.server";
import { handleSubscriptionUpdate, PLAN_QUOTAS } from "~/services/billing.server";

export const loader = async () => {
  try {
    const shop = await prisma.shop.findFirst({
      select: {
        shopDomain: true,
        plan: true,
        subscriptionStatus: true,
        customerQuota: true,
        invoiceQuota: true,
        shopifyChargeId: true,
      },
    });

    if (!shop) return json({ error: "No shop" }, 500);

    const before = {
      plan: shop.plan,
      status: shop.subscriptionStatus,
      customerQuota: shop.customerQuota,
      invoiceQuota: shop.invoiceQuota,
    };

    // Simulate Shopify webhook: CANCELLED
    await handleSubscriptionUpdate(shop.shopDomain, {
      id: shop.shopifyChargeId ?? "gid://test/1",
      name: shop.plan ?? "PRO",
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
    });

    const after = await prisma.shop.findUnique({
      where: { shopDomain: shop.shopDomain },
      select: { plan: true, subscriptionStatus: true, customerQuota: true, invoiceQuota: true },
    });

    const verdict =
      after?.plan === "FREE" &&
      after?.subscriptionStatus === "NONE" &&
      after?.customerQuota === PLAN_QUOTAS.FREE.customers &&
      after?.invoiceQuota === PLAN_QUOTAS.FREE.invoices;

    // Restore
    await prisma.shop.update({
      where: { shopDomain: shop.shopDomain },
      data: {
        plan: shop.plan,
        subscriptionStatus: shop.subscriptionStatus,
        customerQuota: shop.customerQuota,
        invoiceQuota: shop.invoiceQuota,
      },
    });

    return json({ before, after, verdict: verdict ? "PASS" : "FAIL" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
};
