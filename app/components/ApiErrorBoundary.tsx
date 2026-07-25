// ================================================================
// Shared API ErrorBoundary — Prevents raw error/stack leak on API routes
// Usage: export { ApiErrorBoundary as ErrorBoundary }
// ================================================================

import { useRouteError, isRouteErrorResponse } from "@remix-run/react";

export function ApiErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Error {status}</title>
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              error:
                status === 500 ? "Internal server error" : "Request error",
              status,
            }),
          }}
        />
      </body>
    </html>
  );
}
