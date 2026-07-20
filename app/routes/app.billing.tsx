// TruCredit — Pricing Page (Managed Pricing — Shopify hosts payment)
// No Billing API calls. Clicking "Upgrade" redirects to Shopify's hosted pricing page.
// Webhook APP_SUBSCRIPTIONS_UPDATE syncs plan changes to DB.
// Strictly matches Wandex billing page pattern (Shopify App Store reviewed + approved).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRouteError } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  List,
  Banner,
  Divider,
  Button,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { PLANS, pricingPageUrl } from "~/lib/constants";
import prisma from "~/db.server";
import { RouteError } from "~/services/error-boundary.shared";

// ── Loader ──
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true },
    });

    const currentPlan: string = shop?.plan ?? "FREE";
    const isPaid =
      currentPlan !== "FREE" && shop?.subscriptionStatus === "ACTIVE";

    return json(
      {
        shopDomain,
        currentPlan,
        isPaid,
        subscriptionStatus: shop?.subscriptionStatus ?? null,
        currentPeriodEnd: shop?.currentPeriodEnd?.toISOString() ?? null,
        starterFeatures: PLANS.FREE.displayFeatures,
        growthFeatures: PLANS.GROWTH.displayFeatures,
        proFeatures: PLANS.PRO.displayFeatures,
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    // Fallback: return empty state so component can show error UI or default
    return json(
      {
        shopDomain: "",
        currentPlan: "FREE",
        isPaid: false,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        starterFeatures: PLANS.FREE.displayFeatures,
        growthFeatures: PLANS.GROWTH.displayFeatures,
        proFeatures: PLANS.PRO.displayFeatures,
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  }
};

// ── Component ──
export default function BillingPage() {
  const {
    shopDomain,
    currentPlan,
    isPaid,
    subscriptionStatus,
    currentPeriodEnd,
    starterFeatures,
    growthFeatures,
    proFeatures,
  } = useLoaderData<typeof loader>();

  const isCancelling = isPaid && subscriptionStatus === "CANCELLED";
  const renewDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const handleUpgrade = () => {
    if (!shopDomain) return;
    // Navigate parent window (Shopify Admin) to Shopify Managed Pricing page.
    // Using window.top.location.href is the only reliable way for embedded apps
    // to escape the iframe; redirect() / open() / shopify:// are all unreliable.
    window.top!.location.href = pricingPageUrl(shopDomain);
  };

  const planLabel =
    currentPlan === "GROWTH"
      ? "Growth"
      : currentPlan === "PRO"
        ? "Pro"
        : "Starter";

  return (
    <Page title="Pricing Plans" backAction={{ url: "/app" }} fullWidth>
      {/* Current plan status */}
      <Box paddingBlockEnd="400">
        {isPaid && !isCancelling ? (
          <Banner tone="success">
            <Text as="p" variant="bodyMd">
              You&apos;re on {planLabel}
              {renewDate ? ` — renews ${renewDate}` : ""}
            </Text>
          </Banner>
        ) : isCancelling ? (
          <Banner tone="warning">
            <Text as="p" variant="bodyMd">
              Subscription ends {renewDate || "soon"}. Upgrade to restore Pro
              features.
            </Text>
          </Banner>
        ) : (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              You are on the <strong>{planLabel}</strong> plan. Upgrade for more
              capacity.
            </Text>
          </Banner>
        )}
      </Box>

      <Layout>
        {/* Starter Plan */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  Starter
                </Text>
                {currentPlan === "FREE" && (
                  <Badge tone="success">Current Plan</Badge>
                )}
              </InlineStack>
              <Text variant="heading2xl" as="p">
                $0
                <Text as="span" variant="bodyMd" tone="subdued">
                  {" "}
                  /month
                </Text>
              </Text>
              <Text as="span" variant="bodyMd" tone="subdued">
                Get started free
              </Text>
              <Divider />
              <Text variant="headingSm" as="h3">
                Includes:
              </Text>
              <List>
                {starterFeatures.map((f) => (
                  <List.Item key={f}>{f}</List.Item>
                ))}
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Growth Plan */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  Growth
                </Text>
                {currentPlan === "GROWTH" && (
                  <Badge tone="success">Current Plan</Badge>
                )}
              </InlineStack>
              <Text variant="heading2xl" as="p">
                $49
                <Text as="span" variant="bodyMd" tone="subdued">
                  {" "}
                  /month
                </Text>
              </Text>
              <Divider />
              <Text variant="headingSm" as="h3">
                Everything in Starter, plus:
              </Text>
              <List>
                {growthFeatures.map((f) => (
                  <List.Item key={f}>{f}</List.Item>
                ))}
              </List>
              {currentPlan !== "GROWTH" && currentPlan !== "PRO" && (
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  onClick={handleUpgrade}
                >
                  Upgrade to Growth
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pro Plan */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  Pro
                </Text>
                {currentPlan === "PRO" && (
                  <Badge tone="success">Current Plan</Badge>
                )}
              </InlineStack>
              <Text variant="heading2xl" as="p">
                $470.40
                <Text as="span" variant="bodyMd" tone="subdued">
                  {" "}
                  /year
                </Text>
              </Text>
              <Text as="span" variant="bodyMd" tone="subdued">
                Billed annually — save 20%
              </Text>
              <Divider />
              <Text variant="headingSm" as="h3">
                Everything in Growth, plus:
              </Text>
              <List>
                {proFeatures.map((f) => (
                  <List.Item key={f}>{f}</List.Item>
                ))}
              </List>
              {currentPlan !== "PRO" && (
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  onClick={handleUpgrade}
                >
                  Upgrade to Pro
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ── Error Boundary ──
export function ErrorBoundary() {
  const error = useRouteError();
  return <RouteError error={error} />;
}
