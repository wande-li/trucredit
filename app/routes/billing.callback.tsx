// Redirect route — Shopify Managed Pricing may redirect here
// instead of /app/billing/callback if the Partner Dashboard "Welcome link"
// is configured as "/billing/callback" (missing /app prefix).
//
// Permanent fix: update Partner Dashboard → Distribution → Manage listing →
// Pricing content → Welcome link → "/app/billing/callback"
//
// This route is a safety net so merchants don't see 404 after paying.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/billing/callback${url.search}`);
};
