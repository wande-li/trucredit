// TruCredit — app routes layout
// This layout wraps all /app/* pages with Polaris AppProvider + Nav
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { Navigation } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY! });
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <Navigation location={location.pathname}>
        <Navigation.Section
          items={[
            {
              url: "/app",
              label: "Dashboard",
              exactMatch: true,
            },
            {
              url: "/app/customers",
              label: "Customers",
              matchPaths: ["/app/customers"],
            },
            {
              url: "/app/invoices",
              label: "Invoices",
              matchPaths: ["/app/invoices"],
            },
            {
              url: "/app/rules",
              label: "Rules",
              matchPaths: ["/app/rules"],
            },
            {
              url: "/app/collections",
              label: "Collections",
              matchPaths: ["/app/collections"],
            },
            {
              url: "/app/tasks",
              label: "Tasks",
              matchPaths: ["/app/tasks"],
            },
            {
              url: "/app/emails",
              label: "Emails",
              matchPaths: ["/app/emails"],
            },
            {
              url: "/app/replies",
              label: "Replies",
              matchPaths: ["/app/replies"],
            },
            {
              url: "/app/billing",
              label: "Billing",
              matchPaths: ["/app/billing"],
            },
          ]}
        />
      </Navigation>
      <Outlet />
    </AppProvider>
  );
}
