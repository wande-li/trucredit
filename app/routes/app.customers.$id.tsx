import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import {
  Page,
  Card,
  Layout,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Divider,
  Banner,
  Box,
  DataTable,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import {
  getCustomer,
  setCreditLimit,
  freezeCustomer,
  unfreezeCustomer,
  recalculateCreditScore,
} from "~/services/customer.server";
import { assessCredit } from "~/services/credit.server";
import { getARAgingByCustomer } from "~/services/invoice.server";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import { CustomerStatusBadge } from "~/components/credit/CustomerStatusBadge";
import { CreditLimitModal } from "~/components/credit/CreditLimitModal";
import type { CustomerRecord, CreditRecommendation } from "~/types";
import prisma from "~/db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    if (!params.id) {
      throw new Response("Customer ID required", { status: 400 });
    }

    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const customer = await getCustomer({
      shopId: shop.id,
      customerId: params.id,
    });

    if (!customer) {
      throw new Response("Customer not found", { status: 404 });
    }

    const assessment = assessCredit({
      onTimePaymentRate: customer.onTimePaymentRate,
      creditUsed: Number(customer.creditUsed),
      creditLimit: Number(customer.creditLimit),
      totalOrders: customer.totalOrders,
      totalRevenue: Number(customer.totalRevenue),
    });

    const creditEvents = await prisma.creditEvent.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const aging = await getARAgingByCustomer({
      shopId: shop.id,
      customerId: customer.id,
    });

    return json({ customer, assessment, creditEvents, aging });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);

    if (!params.id) {
      throw new Response("Customer ID required", { status: 400 });
    }

    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    switch (intent) {
      case "set-credit-limit": {
        const newLimitStr = formData.get("newLimit")?.toString();
        const reason = formData.get("reason")?.toString() ?? "Manual adjustment";

        if (!newLimitStr) return json({ error: "New limit is required" }, { status: 400 });

        const newLimit = parseFloat(newLimitStr);
        if (isNaN(newLimit) || newLimit <= 0) {
          return json({ error: "Invalid limit amount" }, { status: 400 });
        }

        await setCreditLimit({
          shopId: shop.id,
          customerId: params.id,
          newLimit,
          reason,
          triggeredBy: "USER",
        });

        // Sync metafield for Shopify Function checkout validation
        syncCreditMetafield(admin, shopDomain, params.id).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after credit limit change", msg);
        });

        return json({ success: true });
      }

      case "freeze": {
        const reason = formData.get("reason")?.toString() ?? "Manual freeze";
        await freezeCustomer({
          shopId: shop.id,
          customerId: params.id,
          reason,
          triggeredBy: "USER",
        });

        syncCreditMetafield(admin, shopDomain, params.id).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after freeze", msg);
        });

        return json({ success: true });
      }

      case "unfreeze": {
        await unfreezeCustomer({
          shopId: shop.id,
          customerId: params.id,
          triggeredBy: "USER",
        });

        syncCreditMetafield(admin, shopDomain, params.id).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after unfreeze", msg);
        });

        return json({ success: true });
      }

      case "recalculate-score": {
        await recalculateCreditScore({
          customerId: params.id,
          shopId: shop.id,
          triggeredBy: "USER",
        });

        syncCreditMetafield(admin, shopDomain, params.id).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after score recalc", msg);
        });

        return json({ success: true });
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Response(`Customer action failed: ${msg}`, { status: 500 });
  }
};

export default function CustomerDetailPage() {
  const { customer, assessment, creditEvents, aging } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [showLimitModal, setShowLimitModal] = useState(false);

  const isBusy = fetcher.state === "submitting";
  const actionError = fetcher.data?.error;

  const utilizationPct =
    Number(customer.creditLimit) > 0
      ? Math.round((Number(customer.creditUsed) / Number(customer.creditLimit)) * 100)
      : 0;

  const handleFreezeToggle = useCallback(() => {
    fetcher.submit(
      {
        intent: customer.isFrozen ? "unfreeze" : "freeze",
        reason: customer.isFrozen ? "" : "Manual freeze from dashboard",
      },
      { method: "post" },
    );
  }, [fetcher, customer.isFrozen]);

  const handleRecalculate = useCallback(() => {
    fetcher.submit({ intent: "recalculate-score" }, { method: "post" });
  }, [fetcher]);

  return (
    <Page
      title={customer.name}
      subtitle={customer.company ?? customer.email}
      backAction={{ url: "/app/customers" }}
    >
      <BlockStack gap="400">
        {actionError && <Banner tone="critical">{actionError}</Banner>}
        {fetcher.data?.success && !actionError && (
          <Banner tone="success">Action completed successfully.</Banner>
        )}

        <Layout>
          {/* Credit Summary */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Credit Summary
                  </Text>
                  <CustomerStatusBadge
                    status={customer.status}
                    riskLevel={customer.riskLevel}
                    creditGrade={customer.creditGrade}
                    isFrozen={customer.isFrozen}
                  />
                </InlineStack>

                <Divider />

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Credit Score
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        {customer.creditScore ?? "N/A"}
                      </Text>
                      <Badge
                        tone={
                          (customer.creditScore ?? 0) >= 80
                            ? "success"
                            : (customer.creditScore ?? 0) >= 60
                              ? "warning"
                              : "critical"
                        }
                      >
                        {customer.creditGrade?.replace("_", "+") ?? "Unrated"}
                      </Badge>
                    </InlineStack>
                  </InlineStack>

                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="200"
                  >
                    {/* Simple progress bar for utilization */}
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          Utilization {utilizationPct}%
                        </Text>
                        <Text as="span" variant="bodySm">
                          ${Number(customer.creditUsed).toLocaleString()} / $
                          {Number(customer.creditLimit).toLocaleString()}
                        </Text>
                      </InlineStack>
                      <Box
                        background="bg-surface-tertiary"
                        borderRadius="100"
                        minHeight="8px"
                        overflowX="hidden"
                        overflowY="hidden"
                      >
                        <div
                          style={{
                            height: "8px",
                            width: `${Math.min(utilizationPct, 100)}%`,
                            backgroundColor:
                              utilizationPct >= 90
                                ? "#EF4444"
                                : utilizationPct >= 70
                                  ? "#F59E0B"
                                  : "#10B981",
                            borderRadius: "4px",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </Box>
                    </BlockStack>
                  </Box>
                </BlockStack>

                <InlineStack gap="200">
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Available:
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="bold">
                    ${Number(customer.creditAvailable).toLocaleString()}
                  </Text>
                </InlineStack>

                <InlineStack gap="200">
                  <Text as="span" variant="bodyMd" tone="subdued">
                    AI Recommended:
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="bold">
                    ${assessment.recommendedLimit.toLocaleString()}
                  </Text>
                </InlineStack>

                <InlineStack gap="200" wrap>
                  <Button
                    onClick={() => setShowLimitModal(true)}
                    disabled={isBusy}
                  >
                    Adjust Limit
                  </Button>
                  <Button
                    onClick={handleFreezeToggle}
                    tone={customer.isFrozen ? "success" : "critical"}
                    disabled={isBusy}
                    loading={isBusy && fetcher.formData?.get("intent")?.toString().includes("freeze")}
                  >
                    {customer.isFrozen ? "Unfreeze" : "Freeze"}
                  </Button>
                  <Button
                    onClick={handleRecalculate}
                    disabled={isBusy}
                    loading={isBusy && fetcher.formData?.get("intent") === "recalculate-score"}
                  >
                    Recalculate Score
                  </Button>
                </InlineStack>

                {assessment.warnings.length > 0 && (
                  <Banner tone="warning">
                    <BlockStack gap="100">
                      {assessment.warnings.map((w, i) => (
                        <Text as="p" variant="bodyMd" key={i}>
                          {w}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Customer Info + Payment Behavior */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Customer Info
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued" variant="bodyMd">
                        Email
                      </Text>
                      <Text as="span" variant="bodyMd">
                        {customer.email}
                      </Text>
                    </InlineStack>
                    {customer.phone && (
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued" variant="bodyMd">
                          Phone
                        </Text>
                        <Text as="span" variant="bodyMd">
                          {customer.phone}
                        </Text>
                      </InlineStack>
                    )}
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued" variant="bodyMd">
                        Total Orders
                      </Text>
                      <Text as="span" variant="bodyMd">
                        {customer.totalOrders}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued" variant="bodyMd">
                        Total Revenue
                      </Text>
                      <Text as="span" variant="bodyMd">
                        ${Number(customer.totalRevenue).toLocaleString()}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued" variant="bodyMd">
                        On-Time Payment
                      </Text>
                      <Text as="span" variant="bodyMd">
                        {customer.onTimePaymentRate != null
                          ? `${Math.round(customer.onTimePaymentRate * 100)}%`
                          : "N/A"}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued" variant="bodyMd">
                        Avg Payment Days
                      </Text>
                      <Text as="span" variant="bodyMd">
                        {customer.avgPaymentDays != null
                          ? `${customer.avgPaymentDays} days`
                          : "N/A"}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* AR Aging */}
              {aging.invoiceCount > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      AR Aging
                    </Text>
                    {aging.buckets.filter((b) => b.count > 0).map((bucket) => (
                      <InlineStack
                        key={bucket.label}
                        align="space-between"
                        blockAlign="center"
                      >
                        <Text as="span" variant="bodyMd" tone="subdued">
                          {bucket.label}
                        </Text>
                        <BlockStack gap="050" align="end">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="bold"
                            tone={
                              bucket.label === "90+ Days" ? "critical" : undefined
                            }
                          >
                            ${Number(bucket.totalAmount).toLocaleString()}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {bucket.count} invoice{bucket.count !== 1 ? "s" : ""}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                    <Box borderColor="border-secondary" borderWidth="025" />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Total Outstanding</Text>
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        ${Number(aging.totalOutstanding).toLocaleString()}
                      </Text>
                    </InlineStack>
                    {Number(aging.totalOverdue) > 0 && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd" tone="critical">Total Overdue</Text>
                        <Text as="span" variant="bodyMd" fontWeight="bold" tone="critical">
                          ${Number(aging.totalOverdue).toLocaleString()}
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Outstanding Invoices */}
              {aging.invoices.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        Outstanding Invoices
                      </Text>
                      <Link to={`/app/invoices/new?customerId=${customer.id}`}>
                        <Text as="span" variant="bodySm" tone="subdued">
                          + New
                        </Text>
                      </Link>
                    </InlineStack>
                    {aging.invoices.map((inv) => (
                      <Link key={inv.id} to={`/app/invoices/${inv.id}`}>
                        <Box
                          borderColor="border-secondary"
                          borderWidth="025"
                          borderRadius="200"
                          padding="200"
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="bold">
                                {inv.invoiceNumber}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                Due {new Date(inv.dueDate).toLocaleDateString()}
                              </Text>
                            </BlockStack>
                            <BlockStack gap="050" align="end">
                              <Text as="span" variant="bodyMd" fontWeight="bold">
                                ${Number(inv.amount).toLocaleString()}
                              </Text>
                              <Badge
                                tone={
                                  inv.status === "OVERDUE"
                                    ? "critical"
                                    : inv.status === "PARTIALLY_PAID"
                                      ? "warning"
                                      : "info"
                                }
                                size="small"
                              >
                                {inv.status === "PARTIALLY_PAID" ? "Partial" : inv.daysOverdue > 0 ? `${inv.daysOverdue}d` : inv.status}
                              </Badge>
                            </BlockStack>
                          </InlineStack>
                        </Box>
                      </Link>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {customer.isFrozen && customer.frozenReason && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd" tone="critical">
                      Frozen
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {customer.frozenReason}
                    </Text>
                    {customer.frozenAt && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Since {new Date(customer.frozenAt).toLocaleDateString()}
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              )}

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Score Breakdown
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Component", "Score", "Weight"]}
                    rows={[
                      [
                        "Payment History",
                        String(assessment.components.paymentHistory),
                        "0–40",
                      ],
                      [
                        "Credit Utilization",
                        String(assessment.components.creditUtilization),
                        "0–25",
                      ],
                      [
                        "Order Volume",
                        String(assessment.components.orderVolume),
                        "0–20",
                      ],
                      [
                        "Revenue History",
                        String(assessment.components.revenueHistory),
                        "0–15",
                      ],
                    ]}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* Credit Event Timeline */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Credit History
                </Text>
                {creditEvents.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No credit events recorded yet.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {creditEvents.map((event) => (
                      <Box
                        key={event.id}
                        borderColor="border-secondary"
                        borderWidth="025"
                        borderRadius="200"
                        padding="300"
                      >
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge
                                tone={
                                  event.type === "FROZEN"
                                    ? "critical"
                                    : event.type === "UNFROZEN"
                                      ? "success"
                                      : event.type === "SCORE_UPDATE"
                                        ? "new"
                                        : "warning"
                                }
                              >
                                {event.type.replace("_", " ")}
                              </Badge>
                              <Text as="span" variant="bodySm" tone="subdued">
                                by {event.triggeredBy}
                              </Text>
                            </InlineStack>
                            {event.reason && (
                              <Text as="p" variant="bodyMd">
                                {event.reason}
                              </Text>
                            )}
                            {event.previousValue &&
                              event.newValue &&
                              typeof event.previousValue === "object" &&
                              typeof event.newValue === "object" &&
                              !Array.isArray(event.previousValue) &&
                              !Array.isArray(event.newValue) && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {Object.keys(event.previousValue).join(", ")}{" "}
                                  →{" "}
                                  {Object.values(event.newValue as Record<string, unknown>)
                                    .map((v) =>
                                      typeof v === "number"
                                        ? v.toLocaleString()
                                        : String(v),
                                    )
                                    .join(", ")}
                                </Text>
                              )}
                          </BlockStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {new Date(event.createdAt).toLocaleDateString()}
                          </Text>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <CreditLimitModal
        open={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        customer={customer as unknown as CustomerRecord}
        assessment={assessment as unknown as CreditRecommendation}
      />
    </Page>
  );
}
