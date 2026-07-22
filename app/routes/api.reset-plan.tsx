import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import prisma from '~/db.server';
import { PLAN_QUOTAS } from '~/lib/constants';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token !== 'trucredit-reset-2026') {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const before = await prisma.shop.findMany({
    select: { shopDomain: true, plan: true, subscriptionStatus: true },
  });

  const quota = PLAN_QUOTAS.FREE;
  const result = await prisma.shop.updateMany({
    data: {
      plan: 'FREE',
      subscriptionStatus: 'NONE',
      customerQuota: quota.customers,
      invoiceQuota: quota.invoices,
      shopifyChargeId: null,
    },
  });

  return json({ before, resetResult: result });
};
