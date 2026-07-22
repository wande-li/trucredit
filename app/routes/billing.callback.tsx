// Billing callback — Shopify redirects here after merchant confirms/declines charge.
// This route runs in the top-level window (outside Shopify Admin iframe),
// so it cannot use authenticate.admin(). Just redirect into Shopify Admin.
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { logger } from '~/services/logger.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const chargeId = url.searchParams.get('charge_id');

  logger.app('INFO', 'Billing callback hit', {
    shop,
    chargeId,
    allParams: Array.from(url.searchParams.entries()).map(([k, v]) => `${k}=${v}`).join('; '),
  });

  if (shop) {
    const adminUrl = `https://admin.shopify.com/store/${shop}/apps/trucredit`;
    logger.app('INFO', 'Redirecting to Shopify Admin', { adminUrl });
    return redirect(adminUrl);
  }

  logger.app('WARN', 'Billing callback missing shop param, redirecting to /app');
  return redirect('/app');
};
