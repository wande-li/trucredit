// Billing Page — plan comparison, upgrade/downgrade, usage display
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Box,
  Banner,
  ProgressBar,
  Spinner,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "~/shopify.server";
import {
  getShopBilling,
  planToBillingName,
  PLANS,
} from "~/services/billing.server";
import type { Plan } from "@prisma/client";
import prisma from "~/db.server";

type BillingActionData = {
  error: string | null;
  billing: null;
  plans: null;
  success?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const billing = await getShopBilling(shop.id);

  return json({
    billing,
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const targetPlan = formData.get("plan") as Plan;

  if (intent !== "upgrade" || !targetPlan) {
    return json({ error: "Invalid request", billing: null, plans: null } satisfies BillingActionData);
  }

  if (targetPlan === "FREE") {
    return json({ error: null, billing: null, plans: null, success: "You are on the Free plan" } satisfies BillingActionData);
  }

  const billingPlanName = planToBillingName(targetPlan);
  if (!billingPlanName) {
    return json({ error: "Invalid plan selection", billing: null, plans: null } satisfies BillingActionData);
  }

  // Check if already on this plan and active
  const existingShop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { plan: true, subscriptionStatus: true },
  });

  if (
    existingShop?.plan === targetPlan &&
    existingShop?.subscriptionStatus === "ACTIVE"
  ) {
    return json({
      error: null,
      billing: null,
      plans: null,
      success: `Already on ${targetPlan} plan`,
    } satisfies BillingActionData);
  }

  // billing.request() returns Promise<never> — it always redirects to Shopify checkout
  const url = new URL(request.url);
  const returnUrl = `${url.origin}/app/billing`;

  // This will redirect the user to Shopify's billing confirmation page
  return billing.request({
    plan: billingPlanName,
    isTest: process.env.NODE_ENV !== "production",
    returnUrl,
  });
};

function progressTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

export default function BillingPage() {
  const { billing, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<BillingActionData>();
  const isSubmitting = fetcher.state === "submitting";

  return (
    <Page
      title="Billing & Plan"
      subtitle={
        billing.subscriptionStatus === "ACTIVE"
          ? `Current plan: ${billing.planName}`
          : "Choose a plan to unlock full features"
      }
    >
      <BlockStack gap="500">
        {/* Current Usage */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Current Plan: {billing.planName}
            </Text>

            {billing.subscriptionStatus === "ACTIVE" &&
              billing.currentPeriodEnd && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Next billing date:{" "}
                  {new Date(
                    billing.currentPeriodEnd,
                  ).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </Text>
              )}

            <BlockStack gap="300">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">
                    Customers ({billing.customerCount} /{" "}
                    {billing.customerQuota})
                  </Text>
                  <Text
                    as="span"
                    variant="bodyMd"
                    tone={
                      billing.customerQuotaPercent >= 90
                        ? "critical"
                        : "subdued"
                    }
                  >
                    {billing.customerQuotaPercent}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={billing.customerQuotaPercent}
                  tone={progressTone(billing.customerQuotaPercent)}
                />
              </BlockStack>

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">
                    Invoices ({billing.invoiceCount} /{" "}
                    {billing.invoiceQuota})
                  </Text>
                  <Text
                    as="span"
                    variant="bodyMd"
                    tone={
                      billing.invoiceQuotaPercent >= 90
                        ? "critical"
                        : "subdued"
                    }
                  >
                    {billing.invoiceQuotaPercent}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={billing.invoiceQuotaPercent}
                  tone={progressTone(billing.invoiceQuotaPercent)}
                />
              </BlockStack>
            </BlockStack>

            {billing.needsUpgrade && billing.plan === "FREE" && (
              <Banner tone="warning">
                <Text as="p" variant="bodyMd">
                  You&apos;ve reached your plan limits. Upgrade to Pro for more
                  customers and invoices.
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Plan Cards */}
        <Text as="h2" variant="headingLg">
          Available Plans
        </Text>

        <InlineStack gap="400" blockAlign="start" wrap>
          {plans.map((plan) => {
            const isCurrent = plan.key === billing.plan;
            const planPrice = plan.price ?? 0;
            const priceLabel = planPrice > 0
              ? `$${planPrice}${plan.period === "year" ? "/yr" : "/mo"}`
              : "Free";

            return (
              <Box key={plan.key} minWidth="280px" width="calc(33.333% - 1rem)" maxWidth="380px">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          {plan.name}
                        </Text>
                        {isCurrent && (
                          <Badge tone="success">Current</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {planPrice === 0
                          ? "Get started free"
                          : plan.period === "year"
                            ? "Billed annually — save 20%"
                            : "Billed monthly"}
                      </Text>
                    </BlockStack>

                    <Box>
                      <InlineStack blockAlign="baseline" gap="100">
                        <Text as="p" variant="heading2xl" fontWeight="bold">
                          {priceLabel}
                        </Text>
                        {plan.period === "year" && planPrice > 0 && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            ($39.20/mo)
                          </Text>
                        )}
                      </InlineStack>
                    </Box>

                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="upgrade" />
                      <input type="hidden" name="plan" value={plan.key} />
                      <Button
                        submit
                        variant={
                          plan.highlight ? "primary" : "secondary"
                        }
                        fullWidth
                        disabled={
                          isCurrent ||
                          isSubmitting ||
                          plan.key === "FREE"
                        }
                        tone={
                          plan.highlight && !isCurrent
                            ? "success"
                            : undefined
                        }
                      >
                        {isCurrent
                          ? "Current Plan"
                          : isSubmitting &&
                            fetcher.formData?.get("plan") === plan.key
                            ? "Redirecting..."
                            : plan.key === "FREE"
                              ? "Included"
                              : "Upgrade"}
                      </Button>
                    </fetcher.Form>

                    <BlockStack gap="200">
                      {plan.features.map((feature) => (
                        <InlineStack
                          key={feature.key}
                          gap="200"
                          blockAlign="center"
                        >
                          {feature.included ? (
                            <Icon
                              source={CheckCircleIcon}
                              tone="success"
                            />
                          ) : (
                            <Box width="20px" />
                          )}
                          <Text
                            as="span"
                            variant="bodySm"
                            tone={
                              feature.included
                                ? undefined
                                : "subdued"
                            }
                          >
                            {feature.label}
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Box>
            );
          })}
        </InlineStack>

        {/* Error / Success feedback */}
        {fetcher.data && fetcher.data.error && (
          <Banner
            tone="critical"
            onDismiss={() => {}}
          >
            <Text as="p" variant="bodyMd">
              {fetcher.data.error}
            </Text>
          </Banner>
        )}

        {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
          <Banner
            tone="success"
            onDismiss={() => {}}
          >
            <Text as="p" variant="bodyMd">
              {fetcher.data.success}
            </Text>
          </Banner>
        )}

        {isSubmitting && (
          <Box padding="400">
            <InlineStack align="center" gap="200">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd" tone="subdued">
                Redirecting to Shopify billing...
              </Text>
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}
