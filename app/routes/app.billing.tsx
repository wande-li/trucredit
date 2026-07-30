// TruCredit — Pricing Page
// Managed Pricing: Click upgrade → window.top.location.href = Shopify pricing URL
// Shopify hosts the payment flow; callback returns to /app/billing/callback?shop=...&charge_id=...
// Reference: Wandex (ai-commerce-pilot) production pattern

import type { LoaderFunctionArgs, LinksFunction, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

import { useLoaderData, useRouteError } from "@remix-run/react";
import {
  Page,
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
import { resolveShop } from "~/services/shop-resolver.server";
import prisma from "~/db.server";
import { PLANS as PLANS_V2, type PlanDefinition, getShopBilling } from "~/services/billing.server";
import { pricingPageUrl } from "~/lib/constants";
import { RouteError, errorLinks } from "~/services/error-boundary.shared";
import PageSkeleton from "~/components/PageSkeleton";
import { logger } from "~/services/logger.server";

export const links: LinksFunction = () => errorLinks();

export const meta: MetaFunction = () => [{ title: "TruCredit — Billing & Plan" }];

// ─── Loader ─────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.billing START");
  try {
    const { shopId, shopDomain, plan: currentPlan, subscriptionStatus } = await resolveShop(request);

    const [shop, billing] = await Promise.all([
      prisma.shop.findUnique({
        where: { id: shopId },
        select: { currentPeriodEnd: true },
      }),
      getShopBilling(shopId),
    ]);

    const isTrialActive = subscriptionStatus === "ACTIVE" && currentPlan === "FREE";
    const planDef = PLANS_V2.find((p) => p.key === currentPlan);
    const planName = planDef?.name ?? "Free";

    logger.app("INFO", "loader:app.billing OK", null, {
      durationMs: Date.now() - t0,
      currentPlan,
      subscriptionStatus,
    });
    return json(
      {
        shopDomain,
        currentPlan,
        planName,
        subscriptionStatus,
        currentPeriodEnd: shop?.currentPeriodEnd?.toISOString() ?? null,
        isTrialActive,
        plans: PLANS_V2,
        annualDiscountPercent: 17,
        usage: {
          customerCount: billing.customerCount,
          customerQuota: billing.customerQuota,
          customerQuotaPercent: billing.customerQuotaPercent,
          invoiceCount: billing.invoiceCount,
          invoiceQuota: billing.invoiceQuota,
          invoiceQuotaPercent: billing.invoiceQuotaPercent,
        },
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.billing ERROR", msg, { durationMs: Date.now() - t0 });
    return json(
      {
        currentPlan: "FREE",
        planName: "Free",
        subscriptionStatus: null,
        currentPeriodEnd: null,
        isTrialActive: false,
        plans: PLANS_V2,
        annualDiscountPercent: 17,
        usage: {
          customerCount: 0,
          customerQuota: 0,
          customerQuotaPercent: 0,
          invoiceCount: 0,
          invoiceQuota: 0,
          invoiceQuotaPercent: 0,
        },
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  }
};

// No action — Managed Pricing redirects to Shopify-hosted pricing page via window.top.location.href

// ─── Component ──────────────────────────────────────────────

export default function BillingPage() {
  const { shopDomain, currentPlan, planName, subscriptionStatus, currentPeriodEnd, isTrialActive, plans, usage } =
    useLoaderData<typeof loader>();

  const isActive = subscriptionStatus === "ACTIVE";
  const isCancelling = subscriptionStatus === "CANCELLED";
  const renewDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <Page title="Pricing Plans" backAction={{ url: "/app" }} fullWidth>
      <BlockStack gap="600">
        {/* ── Status Banner ── */}
        <Box>
          {isActive && !isCancelling ? (
            <Banner tone="success">
              <Text as="p" variant="bodyMd">
                You&apos;re on <strong>{planName}</strong>
                {renewDate ? ` — renews ${renewDate}` : ""}
                {isTrialActive ? " (14-day free trial)" : ""}
              </Text>
            </Banner>
          ) : isCancelling ? (
            <Banner tone="warning">
              <Text as="p" variant="bodyMd">
                Subscription ends {renewDate || "soon"}. Please upgrade to restore paid features.
              </Text>
            </Banner>
          ) : (
            <Banner tone="info">
              <Text as="p" variant="bodyMd">
                You are on the <strong>{planName}</strong> plan. Upgrade for more capacity and features.
              </Text>
            </Banner>
          )}
        </Box>

        {/* ── Plan Usage ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Plan Usage</Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 24,
              }}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd" fontWeight="medium">Customers</Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {usage.customerCount.toLocaleString("en-US")} / {usage.customerQuota === -1 ? "Unlimited" : usage.customerQuota.toLocaleString("en-US")}
                  </Text>
                </InlineStack>
                {usage.customerQuota > 0 && (
                  <div style={{ width: "100%", height: 8, background: "var(--p-color-bg-fill-tertiary)", borderRadius: 4 }}>
                    <div
                      style={{
                        width: `${Math.min(usage.customerQuotaPercent, 100)}%`,
                        height: "100%",
                        background: usage.customerQuotaPercent >= 90
                          ? "var(--p-color-bg-fill-critical)"
                          : usage.customerQuotaPercent >= 70
                            ? "var(--p-color-bg-fill-caution)"
                            : "var(--p-color-bg-fill-success)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                )}
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd" fontWeight="medium">Invoices</Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {usage.invoiceCount.toLocaleString("en-US")} / {usage.invoiceQuota === -1 ? "Unlimited" : usage.invoiceQuota.toLocaleString("en-US")}
                  </Text>
                </InlineStack>
                {usage.invoiceQuota > 0 && (
                  <div style={{ width: "100%", height: 8, background: "var(--p-color-bg-fill-tertiary)", borderRadius: 4 }}>
                    <div
                      style={{
                        width: `${Math.min(usage.invoiceQuotaPercent, 100)}%`,
                        height: "100%",
                        background: usage.invoiceQuotaPercent >= 90
                          ? "var(--p-color-bg-fill-critical)"
                          : usage.invoiceQuotaPercent >= 70
                            ? "var(--p-color-bg-fill-caution)"
                            : "var(--p-color-bg-fill-success)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                )}
              </BlockStack>
            </div>
          </BlockStack>
        </Card>

        {/* ── Plan Cards ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {plans.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              currentPlan={currentPlan}
              isActive={isActive}
              shopDomain={shopDomain}
            />
          ))}
        </div>

        {/* ── Feature Comparison Table ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Plan Comparison
            </Text>
            <FeatureTable plans={plans} currentPlan={currentPlan} />
          </BlockStack>
        </Card>

        {/* ── FAQ ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Frequently Asked Questions
            </Text>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd" fontWeight="semibold">
                  How does the 14-day free trial work?
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  All paid plans start with a 14-day free trial. No credit card required upfront. You can cancel anytime during the trial and won&apos;t be charged.
                </Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd" fontWeight="semibold">
                  Can I switch plans later?
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Yes, you can upgrade or downgrade at any time. When upgrading, you&apos;ll be charged the prorated difference. When downgrading, changes apply at the end of your current billing period.
                </Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd" fontWeight="semibold">
                  What happens if I exceed my plan quotas?
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  You&apos;ll see an upgrade prompt when approaching your limits. New customers and invoices will be blocked until you upgrade or free up capacity.
                </Text>
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ─── Plan Card Component ─────────────────────────────────────
// Managed Pricing: redirects to Shopify-hosted pricing page via window.top.location.href.
// Shopify handles the payment flow and redirects back to /app/billing/callback after confirmation.
// No Billing API (appSubscriptionCreate) calls — Managed Pricing apps are forbidden from using it.

function PlanCard({
  plan,
  currentPlan,
  isActive,
  shopDomain,
}: {
  plan: PlanDefinition;
  currentPlan: string;
  isActive: boolean;
  shopDomain: string;
}) {
  const isCurrent = plan.key === currentPlan;
  const isFree = plan.key === "FREE";
  const canUpgrade =
    !isFree &&
    !isCurrent &&
    plan.billingPlanName != null;

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <BlockStack gap="100">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg" fontWeight="bold">
              {plan.name}
            </Text>
            {isCurrent && isActive && (
              <Badge tone="success">Current Plan</Badge>
            )}
            {isCurrent && !isActive && plan.key !== "FREE" && (
              <Badge tone="attention">Inactive</Badge>
            )}
          </InlineStack>
          {plan.highlight && (
            <Badge tone="info" size="small">
              Most Popular
            </Badge>
          )}
        </BlockStack>

        {/* Price */}
        <BlockStack gap="050">
          {isFree ? (
            <Text as="p" variant="heading2xl" fontWeight="bold">
              Free
            </Text>
          ) : (
            <>
              <InlineStack gap="100" blockAlign="baseline">
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  ${plan.price}
                </Text>
                <Text as="span" variant="bodyMd" tone="subdued">
                  /month
                </Text>
              </InlineStack>
              {/* Annual pricing hidden — will re-enable post-launch */}
            </>
          )}
        </BlockStack>

        <Divider />

        {/* Quota info */}
        <BlockStack gap="050">
          <Text as="p" variant="bodySm">
            <strong>
              {plan.customerQuota} customers
            </strong>
          </Text>
          <Text as="p" variant="bodySm">
            <strong>
              {plan.invoiceQuota} invoices
            </strong>
          </Text>
        </BlockStack>

        <Divider />

        {/* Features */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" fontWeight="medium">
            Features:
          </Text>
          <List>
            {plan.features
              .filter((f) => f.included)
              .map((f) => (
                <List.Item key={f.key}>{f.label}</List.Item>
              ))}
          </List>
        </BlockStack>

        {/* CTA */}
        {canUpgrade && (
          <BlockStack gap="200">
            <Button
              variant="primary"
              size="large"
              fullWidth
              onClick={() => {
                window.top!.location.href = pricingPageUrl(shopDomain);
              }}
            >
              {isCurrent ? "Current Plan" : `Start ${plan.name} Trial`}
            </Button>
          </BlockStack>
        )}

        {isCurrent && isActive && plan.key !== "FREE" && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            You&apos;re on this plan
          </Text>
        )}
        {isFree && !isActive && (
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Forever free — no credit card required
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Feature Comparison Table ───────────────────────────────

function FeatureTable({
  plans,
  currentPlan,
}: {
  plans: PlanDefinition[];
  currentPlan: string;
}) {
  const featureKeys = plans[0]?.features.map((f) => f.key) ?? [];

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "var(--p-font-size-75)",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid var(--p-color-border-secondary)" }}>
            <th style={{ textAlign: "left", padding: "12px 8px", minWidth: 200 }}>
              <Text as="span" variant="bodySm" fontWeight="semibold">Feature</Text>
            </th>
            {plans.map((plan) => (
              <th
                key={plan.key}
                style={{
                  textAlign: "center",
                  padding: "12px 8px",
                  minWidth: 100,
                  background: plan.key === currentPlan ? "var(--p-color-bg-surface-success)" : "transparent",
                  borderRadius: plan.key === currentPlan ? "var(--p-border-radius-200)" : undefined,
                }}
              >
                <BlockStack gap="050" align="center">
                  <Text as="span" variant="bodySm" fontWeight="bold">{plan.name}</Text>
                  {plan.key === currentPlan && <Badge size="small" tone="success">Current</Badge>}
                </BlockStack>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {featureKeys.map((key, idx) => {
            const label = plans[0]?.features.find((f) => f.key === key)?.label ?? key;
            const isDivider = ["credit", "collections", "ai", "replies"].includes(key);
            return (
              <tr
                key={key}
                style={{
                  borderBottom: "1px solid var(--p-color-border-secondary)",
                  background: idx % 2 === 0 ? "var(--p-color-bg-surface-secondary)" : "transparent",
                }}
              >
                <td style={{ padding: "10px 8px" }}>
                  <Text as="span" variant="bodySm" fontWeight={isDivider ? "semibold" : undefined}>
                    {isDivider ? label.toUpperCase() : label}
                  </Text>
                </td>
                {plans.map((plan) => {
                  const feat = plan.features.find((f) => f.key === key);
                  const included = feat?.included ?? false;
                  return (
                    <td key={`${plan.key}-${key}`} style={{ textAlign: "center", padding: "10px 8px" }}>
                      <Text as="span" variant="bodySm" tone={included ? "success" : "subdued"}>
                        {included ? "✓" : "—"}
                      </Text>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Error Boundary ─────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();
  return <RouteError error={error} />;
}

export function HydrateFallback() {
  return <PageSkeleton />;
}
