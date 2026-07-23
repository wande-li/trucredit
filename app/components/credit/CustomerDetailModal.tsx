import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Modal,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Divider,
  Box,
  Banner,
  DataTable,
} from "@shopify/polaris";
import { CreditLimitModal } from "./CreditLimitModal";
import { CustomerStatusBadge } from "./CustomerStatusBadge";

// ── Types matching the detail page loader return ──
interface CreditEvent {
  id: string;
  type: string;
  reason?: string;
  triggeredBy: string;
  previousValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

interface AgingBucket {
  label: string;
  count: number;
  totalAmount: string;
}

interface OutstandingInvoice {
  id: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  status: string;
  daysOverdue: number;
}

interface AssessmentData {
  score: number;
  grade: string;
  recommendedLimit: number;
  warnings: string[];
  components: {
    paymentHistory: number;
    creditUtilization: number;
    orderVolume: number;
    revenueHistory: number;
  };
}

interface CustomerData {
  id: string;
  name: string;
  company?: string | null;
  email: string;
  phone?: string | null;
  status: string;
  riskLevel: string | null;
  creditGrade: string | null;
  creditScore: number | null;
  creditLimit: string;
  creditUsed: string;
  creditAvailable: string;
  isFrozen: boolean;
  frozenReason?: string | null;
  frozenAt?: string | null;
  totalOrders: number;
  totalRevenue: string;
  onTimePaymentRate: number | null;
  avgPaymentDays: number | null;
}

interface DetailLoaderData {
  customer?: CustomerData;
  assessment?: AssessmentData;
  creditEvents?: CreditEvent[];
  aging?: {
    invoiceCount: number;
    totalOutstanding: string;
    totalOverdue: string;
    buckets: AgingBucket[];
    invoices: OutstandingInvoice[];
  };
}

interface CustomerDetailModalProps {
  customerId: string | null;
  open: boolean;
  onClose: () => void;
}

export function CustomerDetailModal({
  customerId,
  open,
  onClose,
}: CustomerDetailModalProps) {
  const detailFetcher = useFetcher<DetailLoaderData>();
  const actionFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Load detail when modal opens
  useEffect(() => {
    if (open && customerId) {
      detailFetcher.load(`/app/customers/${customerId}`);
    }
    // Reset limit modal on close
    if (!open) {
      setShowLimitModal(false);
    }
  }, [open, customerId]);

  const isLoading = detailFetcher.state === "loading";
  const data = detailFetcher.data;
  const customer = data?.customer;
  const assessment = data?.assessment;
  const creditEvents = data?.creditEvents;
  const aging = data?.aging;
  const hasError = detailFetcher.state === "idle" && !customer;

  const actionBusy = actionFetcher.state === "submitting";
  const actionError = actionFetcher.data?.error;

  // Refresh detail after successful action
  useEffect(() => {
    if (
      actionFetcher.state === "idle" &&
      actionFetcher.data?.success &&
      customerId
    ) {
      detailFetcher.load(`/app/customers/${customerId}`);
    }
  }, [actionFetcher.state, actionFetcher.data?.success, customerId]);

  const utilizationPct =
    customer && Number(customer.creditLimit) > 0
      ? Math.round(
          (Number(customer.creditUsed) / Number(customer.creditLimit)) * 100
        )
      : 0;

  const freezeIntent = customer?.isFrozen ? "unfreeze" : "freeze";
  const freezeLabel = customer?.isFrozen ? "Unfreeze" : "Freeze";
  const freezeTone = customer?.isFrozen ? "success" : "critical";

  if (!customerId || !open) return null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={customer?.name ?? "Loading..."}
        loading={isLoading}
        size="large"
        secondaryActions={[
          {
            content: "Close",
            onAction: onClose,
          },
        ]}
      >
        {isLoading && (
          <Modal.Section>
            <Text as="p" tone="subdued">Loading customer details...</Text>
          </Modal.Section>
        )}
        {hasError && (
          <Modal.Section>
            <Banner tone="critical">
              Could not load customer data. Please try again.
            </Banner>
          </Modal.Section>
        )}
        {!isLoading && !hasError && customer && assessment && creditEvents && aging && (
          <Modal.Section>
            <BlockStack gap="400">
              {actionError && (
                <Banner tone="critical">{actionError}</Banner>
              )}
              {actionFetcher.data?.success && !actionError && (
                <Banner tone="success">Action completed successfully.</Banner>
              )}

              {/* ── Credit Summary ── */}
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Credit Summary
                  </Text>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum types from JSON serialized loader data */}
                  <CustomerStatusBadge
                    status={customer.status as any}
                    riskLevel={customer.riskLevel as any}
                    creditGrade={customer.creditGrade as any}
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
                            height: 8,
                            width: `${Math.min(utilizationPct, 100)}%`,
                            background:
                              utilizationPct >= 90
                                ? "var(--p-color-bg-fill-critical)"
                                : utilizationPct >= 70
                                  ? "var(--p-color-bg-fill-caution)"
                                  : "var(--p-color-bg-fill-success)",
                            borderRadius: "var(--p-border-radius-full)",
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
                    disabled={actionBusy}
                  >
                    Adjust Limit
                  </Button>
                  <Button
                    onClick={() => {
                      if (!customerId) return;
                      const fd = new FormData();
                      fd.append("intent", freezeIntent);
                      if (!customer.isFrozen)
                        fd.append("reason", "Manual freeze from dashboard");
                      actionFetcher.submit(fd, {
                        method: "post",
                        action: `/app/customers/${customerId}`,
                      });
                    }}
                    tone={freezeTone}
                    disabled={actionBusy}
                    loading={actionBusy}
                  >
                    {freezeLabel}
                  </Button>
                  <Button
                    onClick={() => {
                      if (!customerId) return;
                      const fd = new FormData();
                      fd.append("intent", "recalculate-score");
                      actionFetcher.submit(fd, {
                        method: "post",
                        action: `/app/customers/${customerId}`,
                      });
                    }}
                    disabled={actionBusy}
                    loading={actionBusy}
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

              <Divider />

              {/* ── Customer Info ── */}
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

              {/* ── AR Aging ── */}
              {aging.invoiceCount > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      AR Aging
                    </Text>
                    {aging.buckets
                      .filter((b) => b.count > 0)
                      .map((bucket) => (
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
                                bucket.label === "90+ Days"
                                  ? "critical"
                                  : undefined
                              }
                            >
                              ${Number(bucket.totalAmount).toLocaleString()}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {bucket.count} invoice
                              {bucket.count !== 1 ? "s" : ""}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      ))}
                    <Box borderColor="border-secondary" borderWidth="025" />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Total Outstanding
                      </Text>
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        ${Number(aging.totalOutstanding).toLocaleString()}
                      </Text>
                    </InlineStack>
                    {Number(aging.totalOverdue) > 0 && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd" tone="critical">
                          Total Overdue
                        </Text>
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight="bold"
                          tone="critical"
                        >
                          ${Number(aging.totalOverdue).toLocaleString()}
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </>
              )}

              {/* ── Outstanding Invoices ── */}
              {aging.invoices.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Outstanding Invoices
                    </Text>
                    {aging.invoices.map((inv) => (
                      <Box
                        key={inv.id}
                        borderColor="border-secondary"
                        borderWidth="025"
                        borderRadius="200"
                        padding="200"
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                        >
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {inv.invoiceNumber}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              Due{" "}
                              {new Date(inv.dueDate).toLocaleDateString(
                                "en-US"
                              )}
                            </Text>
                          </BlockStack>
                          <BlockStack gap="050" align="end">
                            <Text
                              as="span"
                              variant="bodyMd"
                              fontWeight="bold"
                            >
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
                              {inv.status === "PARTIALLY_PAID"
                                ? "Partial"
                                : inv.daysOverdue > 0
                                  ? `${inv.daysOverdue}d`
                                  : inv.status}
                            </Badge>
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                </>
              )}

              {/* ── Frozen Reason ── */}
              {customer.isFrozen && customer.frozenReason && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd" tone="critical">
                      Frozen
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {customer.frozenReason}
                    </Text>
                    {customer.frozenAt && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Since{" "}
                        {new Date(customer.frozenAt).toLocaleDateString(
                          "en-US"
                        )}
                      </Text>
                    )}
                  </BlockStack>
                </>
              )}

              {/* ── Score Breakdown ── */}
              <Divider />
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

              {/* ── Credit History ── */}
              <Divider />
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
                        <InlineStack
                          align="space-between"
                          blockAlign="start"
                        >
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
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                by {event.triggeredBy}
                              </Text>
                            </InlineStack>
                            {event.reason && (
                              <Text as="p" variant="bodyMd">
                                {event.reason}
                              </Text>
                            )}
                            {event.previousValue != null &&
                              event.newValue != null &&
                              typeof event.previousValue === "object" &&
                              typeof event.newValue === "object" &&
                              !Array.isArray(event.previousValue) &&
                              !Array.isArray(event.newValue) && (
                                <Text
                                  as="p"
                                  variant="bodySm"
                                  tone="subdued"
                                >
                                  {Object.keys(
                                    event.previousValue as Record<
                                      string,
                                      unknown
                                    >
                                  ).join(", ")}{" "}
                                  →{" "}
                                  {Object.values(
                                    event.newValue as Record<
                                      string,
                                      unknown
                                    >
                                  )
                                    .map((v) =>
                                      typeof v === "number"
                                        ? v.toLocaleString()
                                        : String(v)
                                    )
                                    .join(", ")}
                                </Text>
                              )}
                          </BlockStack>
                          <Text
                            as="span"
                            variant="bodySm"
                            tone="subdued"
                          >
                            {new Date(
                              event.createdAt
                            ).toLocaleDateString("en-US")}
                          </Text>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>

      {/* ── Credit Limit Sub-Modal ── */}
      {customer && assessment && (
        <CreditLimitModal
          open={showLimitModal}
          onClose={() => setShowLimitModal(false)}
          onSuccess={() => {
            if (customerId) detailFetcher.load(`/app/customers/${customerId}`);
          }}
          customerId={customer.id}
          creditLimit={customer.creditLimit}
          creditUsed={customer.creditUsed}
          recommendation={{
            recommendedLimit: assessment.recommendedLimit,
            score: assessment.score,
            grade: assessment.grade,
          }}
        />
      )}
    </>
  );
}
