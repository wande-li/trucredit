// ═══════════════════ Shared Page Loading Skeleton ═══════════════════
// P2-10: Skeleton UI for route data loading.
// Usage: export default function RouteLoading() { return <PageSkeleton />; }
// Routes can also use as export function Loading() { return <PageSkeleton />; }

import {
  Page,
  Card,
  BlockStack,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonThumbnail,
  Box,
  InlineStack,
} from "@shopify/polaris";

export default function PageSkeleton() {
  return (
    <Page title="">
      <BlockStack gap="500">
        {/* KPI Row */}
        <InlineStack gap="400" wrap>
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} padding="400">
              <BlockStack gap="200">
                <SkeletonBodyText lines={1} />
                <SkeletonDisplayText size="large" />
              </BlockStack>
            </Card>
          ))}
        </InlineStack>

        {/* Table */}
        <Card padding="500">
          <BlockStack gap="400">
            <SkeletonDisplayText size="small" />
            {[1, 2, 3, 4, 5].map((i) => (
              <InlineStack key={i} gap="300" blockAlign="center">
                <SkeletonThumbnail size="small" />
                <Box width="100%">
                  <SkeletonBodyText lines={1} />
                </Box>
              </InlineStack>
            ))}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
