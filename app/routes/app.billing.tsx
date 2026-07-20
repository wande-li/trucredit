// TruCredit — Billing Page (Managed Pricing — Shopify hosts payment)
// No action. Clicking "Upgrade" redirects to Shopify's hosted pricing page via window.top.location.href.
// Webhook APP_SUBSCRIPTIONS_UPDATE syncs plan changes to DB.
// Strictly follows Wandex's billing page pattern.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  ProgressBar,
  Divider,
  List,
  Button,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import {
  getShopBilling,
  PLANS,
} from "~/services/billing.server";
import { pricingPageUrl } from "~/lib/constants";
import prisma from "~/db.server";

// ── Loader ──
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const billing = await getShopBilling(shop.id);

    return json({
      shopDomain,
      billing,
      plans: PLANS,
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
  }
};

// ── Helper ──
function progressTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

// ── Component ──
export default function BillingPage() {
  const { shopDomain, billing, plans } = useLoaderData<typeof loader>();

  const handleUpgrade = () => {
    if (!shopDomain) return;
    // Navigate parent window (Shopify Admin) to Shopify Managed Pricing page.
    // Using window.top.location.href is the only reliable way for embedded apps
    // to escape the iframe; redirect() / open() / shopify:// are all unreliable.
    window.top!.location.href = pricingPageUrl(shopDomain);
  };

  return (
    <Page title="Billing & Plan" backAction={{ url: "/app" }} fullWidth>
      {/* Current usage status */}
      <Box paddingBlockEnd="400">
        {billing.subscriptionStatus === "ACTIVE" ? (
          <Banner tone="success">
            <Text as="p" variant="bodyMd">
              You&apos;re on <strong>{billing.planName}</strong>
              {billing.currentPeriodEnd
                ? ` — renews ${new Date(billing.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
                : ""}
            </Text>
          </Banner>
        ) : (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              You are on the <strong>{billing.planName}</strong> plan.
              {billing.needsUpgrade && " You've reached your limits — upgrade for more capacity."}
            </Text>
          </Banner>
        )}
      </Box>

      {/* Usage progress */}
      <Box paddingBlockEnd="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Usage</Text>
            <BlockStack gap="300">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">
                    Customers ({billing.customerCount} / {billing.customerQuota})
                  </Text>
                  <Text as="span" variant="bodyMd" tone={billing.customerQuotaPercent >= 90 ? "critical" : "subdued"}>
                    {billing.customerQuotaPercent}%
                  </Text>
                </InlineStack>
                <ProgressBar progress={billing.customerQuotaPercent} tone={progressTone(billing.customerQuotaPercent)} />
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">
                    Invoices ({billing.invoiceCount} / {billing.invoiceQuota})
                  </Text>
                  <Text as="span" variant="bodyMd" tone={billing.invoiceQuotaPercent >= 90 ? "critical" : "subdued"}>
                    {billing.invoiceQuotaPercent}%
                  </Text>
                </InlineStack>
                <ProgressBar progress={billing.invoiceQuotaPercent} tone={progressTone(billing.invoiceQuotaPercent)} />
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </Box>

      {/* Plan Cards */}
      <Layout>
        {plans.map((plan) => {
          const isCurrent = plan.key === billing.plan;
          const planPrice = plan.price ?? 0;
          const priceLabel = planPrice > 0 ? `$${planPrice}` : "$0";
          const periodLabel = plan.period === "year" ? "/year" : plan.period === "month" ? "/month" : "";

          // Feature list heading
          const featureHeading =
            plan.key === "FREE"
              ? "Includes:"
              : plan.key === "GROWTH"
                ? "Everything in Starter, plus:"
                : "Everything in Growth, plus:";

          // Only show included features (List.Item with no strikethrough/disabled)
          const includedFeatures = plan.features.filter((f) => f.included);

          return (
            <Layout.Section key={plan.key} variant="oneThird">
              <Card>
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingLg" as="h2">
                      {plan.name}
                    </Text>
                    {isCurrent && <Badge tone="success">Current Plan</Badge>}
                  </InlineStack>

                  <Text variant="heading2xl" as="p">
                    {priceLabel}
                    {periodLabel && (
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {" "}
                        {periodLabel}
                      </Text>
                    )}
                  </Text>

                  {plan.period === "year" && planPrice > 0 && (
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Billed annually — save 20%
                    </Text>
                  )}
                  {plan.key === "FREE" && (
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Get started free
                    </Text>
                  )}

                  <Divider />

                  <Text variant="headingSm" as="h3">
                    {featureHeading}
                  </Text>

                  <List>
                    {includedFeatures.map((f) => (
                      <List.Item key={f.key}>{f.label}</List.Item>
                    ))}
                  </List>

                  {!isCurrent && plan.key !== "FREE" && (
                    <Button
                      variant="primary"
                      size="large"
                      fullWidth
                      onClick={handleUpgrade}
                    >
                      Upgrade to {plan.name}
                    </Button>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          );
        })}
      </Layout>
    </Page>
  );
}
