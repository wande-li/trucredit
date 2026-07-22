import { json } from '@remix-run/node';
import prisma from '~/db.server';

export const loader = async () => {
  const shop = await prisma.shop.findFirst();
  if (!shop) return json({ error: 'No shop found' }, { status: 404 });
  return json({
    plan: shop.plan,
    subscriptionStatus: shop.subscriptionStatus,
    customerQuota: shop.customerQuota,
    invoiceQuota: shop.invoiceQuota,
    shopifyChargeId: shop.shopifyChargeId,
  });
};
