import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

/**
 * OAuth callback — authenticate.admin() returns a Response with session cookies set.
 * We MUST return it directly; creating a new redirect("/app") drops the cookies.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return authenticate.admin(request);
};
