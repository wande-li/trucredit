// Billing callback — Shopify redirects here after merchant confirms/declines charge.
// This route runs in the top-level window (outside Shopify Admin iframe),
// so it cannot use authenticate.admin(). Just redirect into Shopify Admin.
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');

  if (shop) {
    // Redirect back into Shopify Admin iframe
    return redirect(`https://admin.shopify.com/store/${shop}/apps/trucredit`);
  }

  // Fallback: redirect to app home (will trigger OAuth)
  return redirect('/app');
};
