import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import RegisterForm from "~/components/RegisterForm";
import type { RegisterFormData } from "~/components/RegisterForm";
import PortalErrorBoundary from "~/components/PortalErrorBoundary";
import { parseAndSubmitApplication } from "~/services/registration.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "";
  return { shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "";
  return await parseAndSubmitApplication(formData, shopDomain) satisfies RegisterFormData;
};

export default function Register() {
  const { shopDomain } = useLoaderData<typeof loader>();
  return <RegisterForm shopDomain={shopDomain} />;
}

export { PortalErrorBoundary as ErrorBoundary };
