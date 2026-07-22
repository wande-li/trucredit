// TruCredit — Pricing Page
// Upgrade flow: <Form method="POST"> → action → billing.request() → Shopify subscription confirmation
// Webhook APP_SUBSCRIPTIONS_UPDATE syncs plan changes to DB.

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRouteError, Form, useNavigation } from "@remix-run/react";
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
import { PLANS as PLANS_V2, type PlanDefinition } from "~/services/billing.server";
import { RouteError } from "~/services/error-boundary.shared";
import { logger } from "~/services/logger.server";

// ─── Loader ─────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true },
    });

    const currentPlan = shop?.plan ?? "FREE";
    const subscriptionStatus = shop?.subscriptionStatus ?? null;
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

// ─── Action: billing.request() → Shopify subscription confirmation ──

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planKey = formData.get("planKey")?.toString();
  const interval = formData.get("interval")?.toString() as "monthly" | "annual" | undefined;

  if (!planKey || planKey === "FREE") {
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
    return json({ error: "No billing plan configured for this selection" }, { status: 400 });
  }

  // billing.request() calls appSubscriptionCreate GraphQL API under the hood.
  // Returns a redirect to Shopify's subscription confirmation page.
  // This works WITHOUT Managed Pricing configured in the Partner Dashboard.
  try {
    logger.app("INFO", "Billing request initiated", {
      shop: session.shop,
      plan: billingName,
      interval,
    });
    return await billing.request({
      plan: billingName,
      isTest: process.env.NODE_ENV === "development",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Billing request failed", {
      shop: session.shop,
      plan: billingName,
      error: msg,
    });
    return json({ error: msg }, { status: 500 });
  }
};

// ─── Component ──────────────────────────────────────────────

export default function BillingPage() {
  const { currentPlan, planName, subscriptionStatus, currentPeriodEnd, isTrialActive, plans, annualDiscountPercent } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const isActive = subscriptionStatus === "ACTIVE";
  const isCancelling = subscriptionStatus === "CANCELLED";
  const renewDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  // Track which specific card:interval is being submitted via <Form>
  const isSubmitting = navigation.state === "submitting";
  const submittingKey = isSubmitting && navigation.formData
    ? `${String(navigation.formData.get("planKey"))}:${String(navigation.formData.get("interval"))}`
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
              isSubmitting={isSubmitting}
              submittingKey={submittingKey}
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

// ─── Plan Card Component (uses <Form> for billing.request()) ───

function PlanCard({
  plan,
  currentPlan,
  isActive,
  annualDiscountPercent,
  isSubmitting,
  submittingKey,
}: {
  plan: PlanDefinition;
  currentPlan: string;
  isActive: boolean;
  annualDiscountPercent: number;
  isSubmitting: boolean;
  submittingKey: string | null;
}) {
  const isCurrent = plan.key === currentPlan;
  const isFree = plan.key === "FREE";
  const canUpgrade =
    !isFree &&
    !isCurrent &&
    plan.billingPlanName != null;

  const monthlyKey = `${plan.key}:monthly`;

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
                  ${plan.annualPrice}/yr — ${plan.monthlyEquivalent.toFixed(2)}/mo (save {String(annualSavings)}%)
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
            {/* Monthly button — uses <Form> to trigger billing.request() */}
            <Form method="POST" style={{ width: "100%" }}>
              <input type="hidden" name="planKey" value={plan.key} />
              <input type="hidden" name="interval" value="monthly" />
              <Button
                variant="primary"
                size="large"
                fullWidth
                submit
                disabled={isSubmitting && submittingKey !== monthlyKey}
                loading={isSubmitting && submittingKey === monthlyKey}
              >
                {isCurrent ? "Current Plan" : `Start ${plan.name} Trial`}
              </Button>
            </Form>
            {plan.billingPlanNameAnnual && (
              <Form method="POST" style={{ width: "100%" }}>
                <input type="hidden" name="planKey" value={plan.key} />
                <input type="hidden" name="interval" value="annual" />
                <Button
                  variant="plain"
                  size="medium"
                  fullWidth
                  submit
                  disabled={isSubmitting}
                >
                  Save {String(Math.round(annualSavings))}% with annual billing
                </Button>
              </Form>
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
