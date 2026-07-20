import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const devShop = process.env.DEV_SHOP || "ai-pilot-dev.myshopify.com";

const existing = await p.session.findFirst();
if (existing) {
  console.log("DB already has data, skipping seed.");
} else {
  await p.session.create({
    data: {
      id: "dev-session",
      shop: devShop,
      state: "dev",
      isOnline: false,
      accessToken: "dev-token",
      scope: "read_orders,write_orders,read_customers,write_customers",
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  await p.shop.create({
    data: {
      shopDomain: devShop,
      accessToken: "dev-token",
      plan: "FREE",
    },
  });
  console.log(`Seeded: session + shop for ${devShop}`);
}

await p.$disconnect();
