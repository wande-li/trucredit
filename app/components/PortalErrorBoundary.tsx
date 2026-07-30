import { useRouteError, isRouteErrorResponse } from "@remix-run/react";

/**
 * Simple non-Polaris ErrorBoundary for standalone pages
 * (register, app proxy, payment — pages without Shopify Admin frame)
 */
export default function PortalErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <h1 style={styles.title}>{getTitle(error.status)}</h1>
          <p style={styles.message}>{error.data || "An error occurred while processing your request."}</p>
        </div>
      </div>
    );
  }

  // Log for debugging, don't leak to UI
  if (error instanceof Error) {
    console.error("[PortalErrorBoundary]", error.message);
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>Unexpected Error</h1>
        <p style={styles.message}>Please refresh the page and try again. If the problem persists, contact support.</p>
      </div>
    </div>
  );
}

function getTitle(status: number): string {
  switch (status) {
    case 401: return "Session Expired";
    case 404: return "Not Found";
    case 400: return "Invalid Request";
    default: return "Something went wrong";
  }
}

const styles = {
  wrapper: {
    maxWidth: 480,
    margin: "60px auto",
    padding: "0 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  } as const,
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 32,
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    textAlign: "center" as const,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: "#111827",
    marginBottom: 12,
    marginTop: 0,
  } as const,
  message: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.6,
    margin: 0,
  } as const,
};
