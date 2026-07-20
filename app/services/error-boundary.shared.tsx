import { isRouteErrorResponse, useRouteError } from "@remix-run/react";

export function RouteError({ error }: { error: unknown }) {
  const isDev = process.env.NODE_ENV === "development";
  const message =
    error instanceof Error
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : "An unexpected error occurred.";

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "80px auto",
        padding: 48,
        textAlign: "center",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "var(--p-color-text, #1a1a1a)",
          marginBottom: 12,
        }}
      >
        Something Went Wrong
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--p-color-text-subdued, #6d7175)",
          marginBottom: 24,
        }}
      >
        {isDev
          ? message
          : "We encountered an error loading this page. Please try again."}
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <a
          href="/app"
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            textDecoration: "none",
            background: "var(--p-color-bg-fill-brand, #008060)",
            color: "var(--p-color-text-on-color, #fff)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Back to Dashboard
        </a>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a
          href=""
          onClick={(e) => {
            e.preventDefault();
            window.location.reload();
          }}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            textDecoration: "none",
            border: "1px solid var(--p-color-border, #8c9196)",
            color: "var(--p-color-text, #1a1a1a)",
            fontSize: 14,
          }}
        >
          Retry
        </a>
      </div>
    </div>
  );
}

export default function ErrorBoundaryShared() {
  const error = useRouteError();
  return <RouteError error={error} />;
}
