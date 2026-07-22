import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

try {
  // Verify current state
  const shop = await p.shop.findFirst({
    select: { shopDomain: true, plan: true, subscriptionStatus: true }
  });
  console.log('BEFORE:', JSON.stringify(shop));

  // Fix
  const result = await p.shop.updateMany({
    where: { shopDomain: 'ai-pilot-dev.myshopify.com' },
    data: { plan: 'STARTER', subscriptionStatus: 'ACTIVE' }
  });
  console.log('Updated rows:', result.count);

  const after = await p.shop.findFirst({
    select: { shopDomain: true, plan: true, subscriptionStatus: true }
  });
  console.log('AFTER:', JSON.stringify(after));
} catch (e) {
  console.error(e);
} finally {
  await p.$disconnect();
}
