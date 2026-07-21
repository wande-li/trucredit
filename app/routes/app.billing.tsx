// TruCredit — Pricing Page (Managed Pricing — Shopify hosts payment)
// 4-tier: Free / Starter / Pro / Enterprise — monthly & annual with 17% discount
// Webhook APP_SUBSCRIPTIONS_UPDATE syncs plan changes to DB.

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useRouteError, useFetcher } from "@remix-run/react";
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
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { PLAN_QUOTAS, type PlanKey } from "~/lib/constants";
import { PLANS as PLANS_V2, type PlanDefinition } from "~/services/billing.server";
import { RouteError } from "~/services/error-boundary.shared";

// ─── Loader ─────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, billing } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true },
    });

    const currentPlan = shop?.plan ?? "FREE";
    const subscriptionStatus = shop?.subscriptionStatus ?? null;

    // Check for active trial
    const isTrialActive = subscriptionStatus === "ACTIVE" && currentPlan === "FREE";
    const planDef = PLANS_V2.find((p) => p.key === currentPlan);
    const planName = planDef?.name ?? "Free";

    return json(
      {
        currentPlan,
        planName,
        subscriptionStatus,
        currentPeriodEnd: shop?.currentPeriodEnd?.toISOString() ?? null,
        isTrialActive,
        plans: PLANS_V2,
        annualDiscountPercent: 17,
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    return json(
      {
        currentPlan: "FREE",
        planName: "Free",
        subscriptionStatus: null,
        currentPeriodEnd: null,
        isTrialActive: false,
        plans: PLANS_V2,
        annualDiscountPercent: 17,
      },
      {
        headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
      },
    );
  }
};

// ─── Action: handle plan selection → Shopify checkout ───────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const planKey = formData.get("planKey")?.toString() as PlanKey | undefined;
  const interval = formData.get("interval")?.toString() as "monthly" | "annual" | undefined;

  if (intent !== "subscribe" || !planKey || planKey === "FREE") {
    return json({ error: "Invalid plan selection" }, { status: 400 });
  }

  const plan = PLANS_V2.find((p) => p.key === planKey);
  if (!plan) {
    return json({ error: "Plan not found" }, { status: 400 });
  }

  const billingName =
    interval === "annual" && plan.billingPlanNameAnnual
      ? plan.billingPlanNameAnnual
      : plan.billingPlanName;

  if (!billingName) {
    return json({ error: "No billing plan configured" }, { status: 400 });
  }

  // Redirect to Shopify's hosted pricing/checkout page
  return redirect(`https://admin.shopify.com/store/${session.shop}/settings/plans/${billingName}`);
};

// ─── Component ──────────────────────────────────────────────

export default function BillingPage() {
  const { currentPlan, planName, subscriptionStatus, currentPeriodEnd, isTrialActive, plans, annualDiscountPercent } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const isActive = subscriptionStatus === "ACTIVE";
  const isCancelling = subscriptionStatus === "CANCELLED";
  const renewDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const handleSubscribe = (planKey: string, interval: string) => {
    fetcher.submit(
      { intent: "subscribe", planKey, interval },
      { method: "POST" },
    );
  };

  // Quota for current plan display
  const quotas = PLAN_QUOTAS[currentPlan as PlanKey] ?? PLAN_QUOTAS.FREE;

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
              annualDiscountPercent={annualDiscountPercent}
              onSubscribe={handleSubscribe}
              loading={fetcher.state !== "idle"}
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

// ─── Plan Card Component ────────────────────────────────────

function PlanCard({
  plan,
  currentPlan,
  isActive,
  annualDiscountPercent,
  onSubscribe,
  loading,
}: {
  plan: PlanDefinition;
  currentPlan: string;
  isActive: boolean;
  annualDiscountPercent: number;
  onSubscribe: (planKey: string, interval: string) => void;
  loading: boolean;
}) {
  const isCurrent = plan.key === currentPlan;
  const isFree = plan.key === "FREE";
  const canUpgrade =
    !isFree &&
    !isCurrent &&
    plan.billingPlanName != null;

  // Annual price display
  const annualSavings =
    plan.price && plan.annualPrice
      ? Math.round((1 - plan.annualPrice / (plan.price * 12)) * 100)
      : annualDiscountPercent;

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
              {plan.annualPrice && plan.monthlyEquivalent ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  ${plan.annualPrice}/yr — ${plan.monthlyEquivalent.toFixed(2)}/mo (save {annualSavings}%)
                </Text>
              ) : null}
            </>
          )}
        </BlockStack>

        <Divider />

        {/* Quota info */}
        <BlockStack gap="050">
          <Text as="p" variant="bodySm">
            <strong>
              {plan.customerQuota === Infinity || plan.customerQuota === "Unlimited"
                ? "Unlimited"
                : plan.customerQuota}{" "}
              customers
            </strong>
          </Text>
          <Text as="p" variant="bodySm">
            <strong>
              {plan.invoiceQuota === Infinity || plan.invoiceQuota === "Unlimited"
                ? "Unlimited"
                : plan.invoiceQuota}{" "}
              invoices
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
              onClick={() => onSubscribe(plan.key, "monthly")}
              disabled={loading}
              loading={loading}
            >
              {isCurrent ? "Current Plan" : "Start Free Trial"}
            </Button>
            {plan.billingPlanNameAnnual && (
              <Button
                variant="plain"
                size="medium"
                fullWidth
                onClick={() => onSubscribe(plan.key, "annual")}
                disabled={loading}
              >
                Save {annualSavings}% with annual billing
              </Button>
            )}
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
  // Extract unique feature keys across all plans
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
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Feature
              </Text>
            </th>
            {plans.map((plan) => (
              <th
                key={plan.key}
                style={{
                  textAlign: "center",
                  padding: "12px 8px",
                  minWidth: 100,
                  background: plan.key === currentPlan
                    ? "var(--p-color-bg-surface-success)"
                    : "transparent",
                  borderRadius: plan.key === currentPlan ? "var(--p-border-radius-200)" : undefined,
                }}
              >
                <BlockStack gap="050" align="center">
                  <Text as="span" variant="bodySm" fontWeight="bold">
                    {plan.name}
                  </Text>
                  {plan.key === currentPlan && (
                    <Badge size="small" tone="success">
                      Current
                    </Badge>
                  )}
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
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={included ? "success" : "subdued"}
                      >
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
