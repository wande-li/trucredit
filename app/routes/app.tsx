// TruCredit — app routes layout
// This layout wraps all /app/* pages with Polaris Frame + Nav
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLocation } from "@remix-run/react";
import { Navigation, Frame } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "~/shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AppLayout() {
  const location = useLocation();

  return (
    <Frame>
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
    </Frame>
  );
}
