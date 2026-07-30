// Shared error display components used by root.tsx, billing, and other routes.
// Uses CSS classes (error.css) instead of inline styles.
import { isRouteErrorResponse } from "@remix-run/react";
import type { LinksFunction } from "@remix-run/node";
import errorStyles from "~/styles/error.css?url";

export const errorLinks: LinksFunction = () => [
  { rel: "stylesheet", href: errorStyles },
];

interface ErrorDisplayProps {
  title?: string;
  message?: string;
  detail?: string;
}

/** Simple error display without Remix error-awareness */
export function ErrorDisplay({ title, message, detail }: ErrorDisplayProps) {
  return (
    <div className="error-boundary-container">
      <h1 className="error-boundary-title">
        {title || "Something went wrong"}
      </h1>
      <p className="error-boundary-message">
        {message || "We encountered an unexpected issue. Please try refreshing the page."}
      </p>
      <button
        className="error-boundary-button"
        onClick={() => window.location.reload()}
      >
        Refresh Page
      </button>
      {detail && process.env.NODE_ENV === "development" && (
        <pre className="error-boundary-detail">{detail}</pre>
      )}
    </div>
  );
}

interface RouteErrorProps {
  error: unknown;
}

/** Route-level error display — used by root.tsx and app.billing.tsx ErrorBoundary */
export function RouteError({ error }: RouteErrorProps) {
  if (isRouteErrorResponse(error)) {
    const title = `${error.status} ${error.statusText}`;
    return (
      <div className="error-boundary-container">
        <h1 className="error-boundary-title">{title}</h1>
        <p className="error-boundary-message">
          {typeof error.data === "string" ? error.data : "An error occurred while loading this page."}
        </p>
        <button
          className="error-boundary-button"
          onClick={() => window.location.reload()}
        >
          Refresh Page
        </button>
        {process.env.NODE_ENV === "development" && (
          <pre className="error-boundary-detail">
            Status: {error.status}{"\n"}
            Data: {typeof error.data === "string" ? error.data : JSON.stringify(error.data, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  // Generic unhandled error
  return (
    <div className="error-boundary-container">
      <h1 className="error-boundary-title">Something went wrong</h1>
      <p className="error-boundary-message">
        We encountered an unexpected error. Please refresh the page and try again.
      </p>
      <button
        className="error-boundary-button"
        onClick={() => window.location.reload()}
      >
        Refresh Page
      </button>
      {error instanceof Error && process.env.NODE_ENV === "development" && (
        <pre className="error-boundary-detail">
          {error.message}
          {"\n"}
          {error.stack}
        </pre>
      )}
    </div>
  );
}
