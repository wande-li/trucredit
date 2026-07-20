import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { RouteError } from "./services/error-boundary.shared";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "preconnect", href: "https://cdn.shopify.com/" },
  {
    rel: "stylesheet",
    href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css",
  },
];

/**
 * Shopify loads the embedded app at the application_url (/), not /app.
 * Redirect root → /app preserving all query params (hmac, shop, host, id_token, etc.)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    const appUrl = new URL("/app", url.origin);
    url.searchParams.forEach((value, key) => {
      appUrl.searchParams.set(key, value);
    });
    return redirect(appUrl.toString());
  }
  return null;
};

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Error — TruCredit</title>
        <Meta />
        <Links />
      </head>
      <body>
        <RouteError error={error} />
        <Scripts />
      </body>
    </html>
  );
}
