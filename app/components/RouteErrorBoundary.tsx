// ================================================================
// Shared Route ErrorBoundary
// P2-9: Consistent error boundaries for all routes
// Usage: export function ErrorBoundary() { return <RouteErrorBoundary />; }
// ================================================================

import { useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Banner, Link } from "@shopify/polaris";

export default function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <Page title="Error">
        <BlockStack gap="400">
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">
              {error.status === 404
                ? "The requested page was not found."
                : error.status === 500
                  ? "Server error - please try again."
                  : 'Error ' + error.status + ': ' + error.statusText}
            </Text>
          </Banner>
          <Card padding="500">
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" tone="subdued">
                Return to the <Link url="/app">Dashboard</Link> and try again.
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  return (
    <Page title="Something went wrong">
      <BlockStack gap="400">
        <Banner tone="critical">
          <Text as="p" variant="bodyMd">
            An unexpected error occurred. Please refresh the page or return to the Dashboard.
          </Text>
        </Banner>
        <Card padding="500">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {message}
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
