import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const shop = await p.shop.findFirst({
    select: { id: true, shopDomain: true, plan: true, subscriptionStatus: true, createdAt: true }
  });
  console.log(JSON.stringify(shop, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await p.$disconnect();
}
