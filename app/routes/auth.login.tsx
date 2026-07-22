import type { LoaderFunctionArgs } from "@remix-run/node";
import { login } from "~/shopify.server";

/**
 * /auth/login — render the Shopify OAuth login page.
 * Must use shopify.login() here; calling authenticate.admin() from
 * this path triggers "Detected call to shopify.authenticate.admin()
 * from configured login path" error.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return login(request);
};
