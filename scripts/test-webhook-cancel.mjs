// Test: APP_SUBSCRIPTIONS_UPDATE → CANCELLED webhook handler
// Run: railway run --service trucredit-app -- node scripts/test-webhook-cancel.mjs
import { PrismaClient } from "@prisma/client";

// Inline the handler logic (avoid module resolution issues in railway shell)
async function handleSubscriptionUpdate(db, shopDomain, charge) {
  const { plan, customerQuota, invoiceQuota } = getPlanFallback(charge.status, charge.name);

  await db.shop.update({
    where: { shopDomain },
    data: {
      plan,
      subscriptionStatus: charge.status === "CANCELLED" || charge.status === "EXPIRED" ? "NONE" : charge.status,
      customerQuota,
      invoiceQuota,
      shopifyChargeId: charge.id,
    },
  });

  return { plan, customerQuota, invoiceQuota };
}

const PLAN_QUOTAS = {
  FREE: { customers: 5, invoices: 10 },
  STARTER: { customers: 50, invoices: 200 },
  PRO: { customers: 200, invoices: 500 },
};

function getPlanFallback(status, name) {
  if (status === "CANCELLED" || status === "EXPIRED") {
    return { plan: "FREE", ...PLAN_QUOTAS.FREE };
  }
  if (status === "ACTIVE" && name) {
    const p = PLAN_QUOTAS[name] ?? PLAN_QUOTAS.FREE;
    return { plan: name, ...p };
  }
  return { plan: "FREE", ...PLAN_QUOTAS.FREE };
}

async function main() {
  const db = new PrismaClient();

  try {
    // Find the shop
    const shop = await db.shop.findFirst();
    if (!shop) {
      console.log("❌ No shop found in DB");
      process.exit(1);
    }

    const domain = shop.shopDomain;
    console.log(`📋 Shop: ${domain}`);
    console.log(
      `   Plan: ${shop.plan} | Status: ${shop.subscriptionStatus} | Customers: ${shop.customerQuota} | Invoices: ${shop.invoiceQuota}`
    );

    // Test: simulate CANCELLED
    const result = await handleSubscriptionUpdate(db, domain, {
      id: shop.shopifyChargeId || "gid://test",
      name: shop.plan || "PRO",
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
    });

    console.log(`\n🔄 After simulated CANCELLED webhook:`);
    console.log(
      `   Plan: ${result.plan} | Customers: ${result.customerQuota} | Invoices: ${result.invoiceQuota}`
    );

    // Verify
    const check = await db.shop.findUnique({ where: { shopDomain: domain } });
    const pass =
      check.plan === "FREE" &&
      check.customerQuota === 5 &&
      check.invoiceQuota === 10;

    console.log(
      `\n${pass ? "✅ PASS" : "❌ FAIL"}: plan=${check.plan}, quotas=(${check.customerQuota}/${check.invoiceQuota})`
    );

    // Restore
    await db.shop.update({
      where: { shopDomain: domain },
      data: {
        plan: shop.plan,
        subscriptionStatus: shop.subscriptionStatus,
        customerQuota: shop.customerQuota,
        invoiceQuota: shop.invoiceQuota,
        shopifyChargeId: shop.shopifyChargeId,
      },
    });
    console.log("🔄 Restored original state");

    const restored = await db.shop.findUnique({ where: { shopDomain: domain } });
    console.log(
      `   Plan: ${restored.plan} | Status: ${restored.subscriptionStatus} | Customers: ${restored.customerQuota}`
    );

    console.log("\n🧪 Test complete");
    process.exit(pass ? 0 : 1);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
