/**
 * CLI tool: Fix shop plan / subscription (migrated from api.fix-plan.tsx).
 *
 * Usage:
 *   npm run fix-plan -- --shop=ai-pilot-dev.myshopify.com --plan=STARTER --status=ACTIVE
 *
 * Requires DATABASE_URL in .env or environment.
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config();

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2).reduce((acc, arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, /** @type {Record<string,string>} */ ({}));

  if (!args.shop) {
    console.error("Usage: npm run fix-plan -- --shop=<domain> --plan=<PLAN> --status=<STATUS>");
    console.error("Example: npm run fix-plan -- --shop=ai-pilot-dev.myshopify.com --plan=STARTER --status=ACTIVE");
    process.exit(1);
  }

  console.log("Shops before fix:");
  const shops = await prisma.shop.findMany({
    select: { shopDomain: true, plan: true, subscriptionStatus: true },
  });
  console.table(shops);

  const result = await prisma.shop.updateMany({
    where: { shopDomain: args.shop },
    data: {
      plan: args.plan || undefined,
      subscriptionStatus: args.status || undefined,
    },
  });

  console.log(`\nFixed: ${result.count} shop(s)`);
  console.log("Done.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
