// TruCredit — Pricing Page
// Upgrade flow: <Form method="POST"> → action → billing.request() → Shopify subscription confirmation
// Webhook APP_SUBSCRIPTIONS_UPDATE syncs plan changes to DB.

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
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
import { authenticate } from "~/shopify.server";
import type { BillingPlanName } from "~/shopify.server";
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

// ─── Action: catch billing.request() redirect → extract URL → HTML redirect ──
// billing.request() ALWAYS throws (Promise<never>).
// On success: throws Response(302 Redirect) → Location = /exitiframe?exitIframe=shopifyChargeUrl
//   → We catch it, extract the Shopify charge URL, return HTML with window.top redirect.
// On failure: throws Response(400) or Error → we return error HTML.
//
// We use a raw HTML <form> (not Remix <Form>) to ensure traditional browser form POST,
// which avoids Shopify App Bridge XHR interception.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planKey = formData.get("planKey")?.toString();
  const interval = formData.get("interval")?.toString() as "monthly" | "annual" | undefined;

  if (!planKey || planKey === "FREE") {
    return errHtml("Invalid plan selection");
  }

  const plan = PLANS_V2.find((p) => p.key === planKey);
  if (!plan) {
    return errHtml("Plan not found");
  }

  const billingName =
    interval === "annual" && plan.billingPlanNameAnnual
      ? plan.billingPlanNameAnnual
      : plan.billingPlanName;

  if (!billingName) {
    return errHtml("No billing plan configured for this selection");
  }

  logger.app("INFO", "Billing request initiated", {
    shop: session.shop,
    plan: billingName,
    interval,
  });

  try {
    // billing.request() always throws. The throw is intentional.
    return await billing.request({
      plan: billingName as BillingPlanName,
      isTest: process.env.NODE_ENV === "development",
    });
  } catch (thrown: unknown) {
    // billing.request() throws a Response (302 redirect) on success.
    // The redirect goes to {appUrl}/exitiframe?exitIframe={shopifyChargeUrl}
    if (thrown instanceof Response) {
      const location = thrown.headers.get("Location");
      if (location) {
        // Parse the redirect URL. In embedded mode, the SDK redirects to our
        // exitIframe page with the Shopify charge URL as a query param.
        const redirectUrl = new URL(location, process.env.SHOPIFY_APP_URL ?? "");
        const shopifyChargeUrl = redirectUrl.searchParams.get("exitIframe") ?? location;

        logger.app("INFO", "Billing redirect caught", {
          shop: session.shop,
          plan: billingName,
          chargeUrl: shopifyChargeUrl.substring(0, 80) + "...",
        });

        // Return HTML that breaks out of Shopify iframe to the charge page
        return redirectHtml(shopifyChargeUrl);
      }

      // Redirect with no Location — unlikely
      return errHtml("Redirect response missing target URL");
    }

    // billing.request() threw an actual error (not a Response)
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    logger.app("ERROR", "Billing request failed", {
      shop: session.shop,
      plan: billingName,
      error: msg,
    });
    return errHtml(msg);
  }
};

// ─── Helpers: HTML responses for raw form POST ──

function redirectHtml(url: string) {
  const escaped = url.replace(/</g, "\\u003c").replace(/"/g, "\\u0022");
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting to Shopify…</title></head><body><script>window.top.location.href="${escaped}"</script></body></html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function errHtml(message: string) {
  const escaped = message.replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TruCredit — Payment Error</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}main{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:480px;width:100%}h1{color:#d82c0d;margin-bottom:12px}p{color:#333;line-height:1.5}a{color:#0070f3}</style></head><body><main><h1>Payment Error</h1><p>${escaped}</p><p>Please try again or contact support.</p><a href="javascript:history.back()">Go back</a></main></body></html>`,
    {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

// ─── Component ──────────────────────────────────────────────

export default function BillingPage() {
  const { currentPlan, planName, subscriptionStatus, currentPeriodEnd, isTrialActive, plans, annualDiscountPercent } =
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

// ─── Plan Card Component (uses <Form reloadDocument> for full-page submit → no XHR → correct redirect) ───
// reloadDocument is critical: it makes the browser do a traditional form POST (not XHR),
// so the request won't have the Authorization header. Without that header,
// redirectOutOfApp detects isEmbeddedRequest → redirects to exitIframe page → Shopify charge page.

function PlanCard({
  plan,
  currentPlan,
  isActive,
  annualDiscountPercent,
}: {
  plan: PlanDefinition;
  currentPlan: string;
  isActive: boolean;
  annualDiscountPercent: number;
}) {
  const isCurrent = plan.key === currentPlan;
  const isFree = plan.key === "FREE";
  const canUpgrade =
    !isFree &&
    !isCurrent &&
    plan.billingPlanName != null;

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

        {/* CTA — raw HTML <form> for traditional browser form POST.
             Remix <Form> (even with reloadDocument) gets XHR-intercepted by Shopify App Bridge
             → sends Authorization header → SDK's redirectOutOfApp throws 401 instead of redirect.
             Raw <form> = pure browser submit → no extra headers → correct exitIframe redirect. */}
        {canUpgrade && (
          <BlockStack gap="200">
            <form method="POST" style={{ width: "100%" }}>
              <input type="hidden" name="planKey" value={plan.key} />
              <input type="hidden" name="interval" value="monthly" />
              <Button variant="primary" size="large" fullWidth submit>
                {isCurrent ? "Current Plan" : `Start ${plan.name} Trial`}
              </Button>
            </form>
            {plan.billingPlanNameAnnual && (
              <form method="POST" style={{ width: "100%" }}>
                <input type="hidden" name="planKey" value={plan.key} />
                <input type="hidden" name="interval" value="annual" />
                <Button variant="plain" size="medium" fullWidth submit>
                  Save {String(Math.round(annualSavings))}% with annual billing
                </Button>
              </form>
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
