import { isRouteErrorResponse, useRouteError } from "@remix-run/react";

export function RouteError({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error)) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>
          {error.status} {error.statusText}
        </h1>
        <p>{error.data}</p>
      </div>
    );
  }

  if (error instanceof Error) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Application Error</h1>
        <p>{error.message}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Unknown Error</h1>
    </div>
  );
}

export default function ErrorBoundaryShared() {
  const error = useRouteError();
  return <RouteError error={error} />;
}
