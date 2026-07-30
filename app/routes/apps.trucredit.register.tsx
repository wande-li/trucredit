import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import RegisterForm from "~/components/RegisterForm";
import type { RegisterFormData } from "~/components/RegisterForm";
import PortalErrorBoundary from "~/components/PortalErrorBoundary";
import { authenticate } from "~/shopify.server";
import { parseAndSubmitApplication } from "~/services/registration.server";

/**
 * App Proxy route: [store].myshopify.com/apps/trucredit/register
 *
 * Shopify forwards the request to /apps/trucredit/register with HMAC signature.
 * authenticate.public.appProxy() verifies the signature and extracts shop.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "";
  return { shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const formData = await request.formData();
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "";
  return await parseAndSubmitApplication(formData, shopDomain) satisfies RegisterFormData;
};

export default function AppProxyRegister() {
  const { shopDomain } = useLoaderData<typeof loader>();
  return <RegisterForm shopDomain={shopDomain} />;
}

export { PortalErrorBoundary as ErrorBoundary };
