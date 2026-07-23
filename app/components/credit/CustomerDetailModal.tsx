import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Modal,
  Text,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Divider,
  Box,
  Banner,
  DataTable,
} from "@shopify/polaris";
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
  const [showLimitEditor, setShowLimitEditor] = useState(false);
  const [editorLimit, setEditorLimit] = useState("");
  const [editorReason, setEditorReason] = useState("");
  const [busyIntent, setBusyIntent] = useState<string | null>(null);
  const successHandledRef = useRef(false);
  const lastDataRef = useRef<DetailLoaderData | null>(null);

  // Load detail when modal opens
  useEffect(() => {
    if (open && customerId) {
      detailFetcher.load(`/app/customers/${customerId}`);
    }
    if (!open) {
      setShowLimitEditor(false);
      setEditorLimit("");
      setEditorReason("");
      lastDataRef.current = null;
    }
  }, [open, customerId]);

  // Stale-while-revalidate: preserve last good data during refetch to prevent content flash
  const data = useMemo(() => {
    if (detailFetcher.data) {
      lastDataRef.current = detailFetcher.data;
      return detailFetcher.data;
    }
    // During refetch, keep showing stale data instead of blank
    return lastDataRef.current;
  }, [detailFetcher.data]);

  const isInitialLoad = !lastDataRef.current && detailFetcher.state === "loading";
  const customer = data?.customer;
  const assessment = data?.assessment;
  const creditEvents = data?.creditEvents;
  const aging = data?.aging;
  const hasError = detailFetcher.state === "idle" && !data?.customer;

  const actionBusy = actionFetcher.state !== "idle";
  const actionError = actionFetcher.data?.error;
  const showSuccess = actionFetcher.data?.success && !actionError;
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-dismiss success banner after 3s
  useEffect(() => {
    if (showSuccess) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        // Force re-render by submitting an empty no-op — actually, just let the ref guard handle it
        // Instead, we rely on the next user action to clear it naturally
      }, 3000);
    }
    return () => clearTimeout(successTimerRef.current);
  }, [showSuccess]);

  // Track success and auto-clear
  const [visibleSuccess, setVisibleSuccess] = useState(false);
  useEffect(() => {
    if (showSuccess) {
      setVisibleSuccess(true);
      const t = setTimeout(() => setVisibleSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [showSuccess]);

  // Refresh detail after successful action (ref-guarded, fires once per submission)
  useEffect(() => {
    if (actionFetcher.state === "submitting") {
      successHandledRef.current = false;
      return;
    }
    if (
      actionFetcher.state === "idle" &&
      actionFetcher.data?.success &&
      !successHandledRef.current &&
      customerId
    ) {
      successHandledRef.current = true;
      setBusyIntent(null);
      detailFetcher.load(`/app/customers/${customerId}`);
    }
    if (actionFetcher.state === "idle" && !actionFetcher.data?.success) {
      setBusyIntent(null);
    }
  }, [actionFetcher.state, actionFetcher.data?.success, actionFetcher.data?.error, customerId]);

  const isBusy = (intent: string) => busyIntent === intent && actionBusy;

  // Init editor limit when assessment loads
  useEffect(() => {
    if (assessment) {
      setEditorLimit(String(assessment.recommendedLimit));
    }
  }, [assessment?.recommendedLimit]);

  const utilizationPct =
    customer && Number(customer.creditLimit) > 0
      ? Math.round(
          (Number(customer.creditUsed) / Number(customer.creditLimit)) * 100
        )
      : 0;

  const freezeLabel = customer?.isFrozen ? "Unfreeze" : "Freeze";
  const freezeTone = customer?.isFrozen ? "success" : "critical";

  const doAction = (intent: string, extra?: Record<string, string>) => {
    if (!customerId) return;
    setVisibleSuccess(false);
    setBusyIntent(intent);
    const fd = new FormData();
    fd.append("intent", intent);
    if (extra) {
      Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    }
    actionFetcher.submit(fd, {
      method: "post",
      action: `/app/customers/${customerId}`,
    });
  };

  const handleFreeze = () => {
    if (!customer) return;
    const intent = customer.isFrozen ? "unfreeze" : "freeze";
    doAction(
      intent,
      customer.isFrozen ? {} : { reason: "Manual freeze from dashboard" }
    );
  };

  const handleRecalculate = () => doAction("recalculate-score");

  const handleSaveLimit = () => {
    if (!customer || !assessment) return;
    const n = parseFloat(editorLimit);
    if (!editorLimit || isNaN(n) || n <= 0) return;
    doAction("set-credit-limit", {
      customerId: customer.id,
      newLimit: editorLimit,
      reason: editorReason || `Manual adjustment from ${customer.creditLimit} to ${editorLimit}`,
    });
    setShowLimitEditor(false);
  };

  // Editor validation
  const numericEditorLimit = parseFloat(editorLimit);
  const isOver2x = assessment && numericEditorLimit > assessment.recommendedLimit * 2;
  const isOver50pct =
    assessment &&
    assessment.score < 70 &&
    customer &&
    numericEditorLimit > Number(customer.creditLimit) * 1.5;

  if (!customerId || !open) return null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={customer?.name ?? "Loading..."}
        size="large"
        secondaryActions={[
          {
            content: "Close",
            onAction: onClose,
          },
        ]}
      >
        {isInitialLoad && (
          <Modal.Section>
            <Box padding="400">
              <BlockStack gap="400" align="center">
                <Text as="p" tone="subdued">
                  Loading customer details...
                </Text>
              </BlockStack>
            </Box>
          </Modal.Section>
        )}
        {hasError && !customer && (
          <Modal.Section>
            <Banner tone="critical">
              Could not load customer data. Please try again.
            </Banner>
          </Modal.Section>
        )}
        {!isInitialLoad && !(hasError && !customer) && customer && assessment && creditEvents && aging && (
          <Modal.Section>
            <BlockStack gap="400">
              {actionError && (
                <Banner tone="critical">{actionError}</Banner>
              )}
              {visibleSuccess && (
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
                    onClick={() => setShowLimitEditor(!showLimitEditor)}
                    disabled={actionBusy}
                  >
                    {showLimitEditor ? "Cancel Adjust" : "Adjust Limit"}
                  </Button>
                  <Button
                    onClick={handleFreeze}
                    tone={freezeTone}
                    disabled={actionBusy}
                    loading={isBusy("freeze") || isBusy("unfreeze")}
                  >
                    {freezeLabel}
                  </Button>
                  <Button
                    onClick={handleRecalculate}
                    disabled={actionBusy}
                    loading={isBusy("recalculate-score")}
                  >
                    Recalculate Score
                  </Button>
                </InlineStack>

                {/* ── Inline Limit Editor ── */}
                {showLimitEditor && (
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm">
                        Adjust Credit Limit
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Current: ${Number(customer.creditLimit).toLocaleString()}
                        {" | "}Used: ${Number(customer.creditUsed).toLocaleString()}
                        {" | "}AI Rec: ${assessment.recommendedLimit.toLocaleString()}
                      </Text>
                      <TextField
                        label="New Credit Limit (USD)"
                        type="number"
                        value={editorLimit}
                        onChange={setEditorLimit}
                        autoComplete="off"
                        min={0}
                        step={100}
                        helpText={`AI recommends $${assessment.recommendedLimit.toLocaleString()}`}
                        error={
                          isOver2x
                            ? `Exceeds 2x recommended limit ($${assessment.recommendedLimit.toLocaleString()})`
                            : isOver50pct
                              ? `Score ${assessment.score} — increases over 50% need review`
                              : undefined
                        }
                      />
                      <TextField
                        label="Reason for change"
                        value={editorReason}
                        onChange={setEditorReason}
                        autoComplete="off"
                        placeholder="e.g., customer requested higher limit, seasonal adjustment"
                        multiline={2}
                      />
                      <Select
                        label="Quick Preset"
                        options={[
                          { label: "Custom", value: "" },
                          {
                            label: `AI Recommended: $${assessment.recommendedLimit.toLocaleString()}`,
                            value: String(assessment.recommendedLimit),
                          },
                          {
                            label: "Double current",
                            value: String(Number(customer.creditLimit) * 2),
                          },
                          { label: "Set to $5,000", value: "5000" },
                          { label: "Set to $10,000", value: "10000" },
                        ]}
                        onChange={(val) => {
                          if (val) setEditorLimit(val);
                        }}
                        value=""
                      />
                      <InlineStack gap="200">
                        <Button
                          variant="primary"
                          onClick={handleSaveLimit}
                          disabled={
                            !editorLimit ||
                            isNaN(numericEditorLimit) ||
                            numericEditorLimit <= 0
                          }
                          loading={isBusy("set-credit-limit")}
                        >
                          Save
                        </Button>
                        <Button
                          onClick={() => setShowLimitEditor(false)}
                          disabled={actionBusy}
                        >
                          Cancel
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                )}

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

    </>
  );
}
