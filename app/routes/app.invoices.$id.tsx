import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { useLoaderData, useFetcher } from "@remix-run/react";
import { downloadPDF } from "~/utils/export-csv";
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
  Link,
  FormLayout,
  Select,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { resolveShop } from "~/services/shop-resolver.server";
import { getInvoice, markInvoicePaid, recordPartialPayment, updateInvoice, getPaymentHistory } from "~/services/invoice.server";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import { requirePermission } from "~/services/rbac.server";
import { sendCollectionEmail } from "~/services/email-delivery.server";
import { generatePaymentToken, buildPaymentUrl } from "~/services/token.server";
import { INVOICE_TRANSITIONS } from "~/types/invoice";
import type { InvoiceStatus } from "@prisma/client";
import { checkPlanAccess } from "~/services/billing.server";
import prisma from "~/db.server";
import { useState, useCallback, useEffect } from "react";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import PageSkeleton from "~/components/PageSkeleton";
import ActionToast from "~/components/ActionToast";
import { DEFAULT_LOCALE } from "~/lib/constants";

export const meta: MetaFunction = () => [{ title: "TruCredit — Invoice Detail" }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.invoices.$id START", null, { invoiceId: params.id });
  try {
    const { shopId } = await resolveShop(request);

    // Plan gate
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) throw redirect("/app/billing");

    if (!params.id) {
      throw new Response("An invoice is required.", { status: 400 });
    }

    const invoice = await getInvoice({
      shopId,
      invoiceId: params.id,
    });

    if (!invoice) {
      throw new Response("Invoice not found", { status: 404 });
    }

    const [customer, collectionTasks] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: invoice.customerId },
        select: { name: true, company: true, email: true, creditGrade: true },
      }),
      prisma.collectionTask.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          currentStep: true,
          startedAt: true,
          completedAt: true,
          completedReason: true,
          lastReplyIntent: true,
        },
      }),
    ]);

    logger.app("INFO", "loader:app.invoices.$id OK", null, {
      durationMs: Date.now() - t0,
      invoiceId: params.id,
      status: invoice.status,
    });
    const payments = invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID"
      ? await getPaymentHistory(params.id!, shopId)
      : [];

    return json({
      invoice: {
        ...invoice,
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        paidDate: invoice.paidDate?.toISOString() ?? null,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      },
      customer,
      collectionTasks,
      payments,
      allowedTransitions: INVOICE_TRANSITIONS[invoice.status] as InvoiceStatus[],
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.invoices.$id ERROR", msg, { durationMs: Date.now() - t0, invoiceId: params.id });
    throw new Response("We encountered an issue. Please refresh the page and try again.", { status: 500 });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ta = Date.now();
  logger.app("INFO", "action:app.invoices.$id START", null, { invoiceId: params.id });
  try {
    const { admin } = await authenticate.admin(request);
    const { shopId, shopDomain, role } = await resolveShop(request);
    requirePermission(role, "edit");

    // Plan gate
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) {
      logger.app("WARN", "action:app.invoices.$id plan_gate blocked", null, { shopId });
      return json({ error: "Invoice management requires a paid plan. Please upgrade." }, { status: 402 });
    }

    if (!params.id) {
      throw new Response("An invoice is required.", { status: 400 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    switch (intent) {
      case "mark-paid": {
        const paymentMethod = formData.get("paymentMethod")?.toString();
        const invoice = await markInvoicePaid({
          shopId,
          invoiceId: params.id,
          paymentMethod,
        });

        // Sync metafield for Shopify Function checkout validation
        syncCreditMetafield(admin, shopDomain, invoice.customerId).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after invoice status change", msg);
        });

        logger.app("INFO", "action:app.invoices.$id mark-paid OK", null, {
          durationMs: Date.now() - ta,
          invoiceId: params.id,
        });
        return json({ success: true });
      }

      case "update-status": {
        const newStatus = formData.get("newStatus")?.toString() as InvoiceStatus | undefined;

        if (!newStatus) return json({ error: "Please select a new status." }, { status: 400 });

        const currentInvoice = await prisma.invoice.findFirst({
          where: { id: params.id, shopId },
          select: { id: true, status: true, paidDate: true, amount: true, customerId: true },
        });

        if (!currentInvoice) {
          return json({ error: "Invoice not found. It may have been deleted." }, { status: 404 });

        }

        const allowed = INVOICE_TRANSITIONS[currentInvoice.status] as InvoiceStatus[];
        if (!allowed.includes(newStatus)) {
          return json(
            { error: "This status change is not allowed. Please refresh the page and try again." },
            { status: 400 },
          );
        }

        const updateData: Record<string, unknown> = { status: newStatus };
        if (newStatus === "PAID" && !currentInvoice.paidDate) {
          updateData.paidDate = new Date();
          updateData.daysOverdue = 0;
        }
        if (newStatus === "VOID") {
          updateData.daysOverdue = 0;
          updateData.voidedAt = new Date();
        }

        const isReleasingCredit =
          (newStatus === "PAID" || newStatus === "VOID") &&
          currentInvoice.status !== "PAID";

        const invoiceAmount = Number(currentInvoice.amount);

        await prisma.$transaction(async (tx) => {
          await tx.invoice.update({
            where: { id: params.id, shopId },
            data: updateData,
          });

          // Release credit when transitioning to PAID or VOID
          if (isReleasingCredit) {
            await tx.customer.update({
              where: { id: currentInvoice.customerId },
              data: {
                creditUsed: { decrement: invoiceAmount },
                creditAvailable: { increment: invoiceAmount },
              },
            });

            // Complete active collection tasks
            await tx.collectionTask.updateMany({
              where: { invoiceId: currentInvoice.id, status: "ACTIVE" },
              data: {
                status: "COMPLETED",
                completedAt: new Date(),
                completedReason: newStatus === "PAID" ? "paid" : "voided",
              },
            });
          }
        });

        // Sync metafield after credit release
        if (isReleasingCredit) {
          syncCreditMetafield(admin, shopDomain, currentInvoice.customerId).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            logger.app("WARN", "Metafield sync failed after status change", msg);
          });
        }

        logger.app("INFO", "action:app.invoices.$id update-status OK", null, {
          durationMs: Date.now() - ta,
          invoiceId: params.id,
          newStatus,
        });
        return json({ success: true });
      }

      // P2: Record partial payment
      case "partial-payment": {
        const paymentAmount = parseFloat(formData.get("paymentAmount")?.toString() ?? "0");
        const paymentMethod = formData.get("paymentMethod")?.toString() ?? undefined;
        if (!paymentAmount || paymentAmount <= 0) {
          return json({ error: "Please enter a valid payment amount." }, { status: 400 });
        }
        await recordPartialPayment({
          shopId,
          invoiceId: params.id!,
          paymentAmount,
          paymentMethod,
        });
        logger.app("INFO", "action:app.invoices.$id partial-payment OK", null, {
          durationMs: Date.now() - ta,
          invoiceId: params.id,
          paymentAmount,
        });
        return json({ success: true });
      }

      // P2: Update invoice fields (amount, netTermsDays)
      case "update-invoice": {
        const newAmount = formData.get("amount")?.toString();
        const newNetTerms = formData.get("netTermsDays")?.toString();
        const updateData: { amount?: number; netTermsDays?: number } = {};
        if (newAmount) {
          const parsed = parseFloat(newAmount);
          if (isNaN(parsed) || parsed <= 0) {
            return json({ error: "Amount must be a positive number" }, { status: 400 });
          }
          updateData.amount = parsed;
        }
        if (newNetTerms) {
          const parsed = parseInt(newNetTerms, 10);
          if (isNaN(parsed) || parsed < 0) {
            return json({ error: "Net terms must be a non-negative number" }, { status: 400 });
          }
          updateData.netTermsDays = parsed;
        }
        if (Object.keys(updateData).length === 0) {
          return json({ error: "No changes detected. Please modify a field before saving." }, { status: 400 });
        }
        await updateInvoice({
          shopId,
          invoiceId: params.id!,
          ...updateData,
        });
        logger.app("INFO", "action:app.invoices.$id update-invoice OK", null, {
          durationMs: Date.now() - ta,
          invoiceId: params.id,
        });
        return json({ success: true });
      }

      // P2: Send invoice email manually
      case "send-invoice-email": {
        const currentInvoice = await getInvoice({ shopId, invoiceId: params.id! });
        if (!currentInvoice) {
          return json({ error: "Invoice not found. It may have been deleted." }, { status: 404 });

        }
        const invCustomer = await prisma.customer.findUnique({
          where: { id: currentInvoice.customerId },
          select: { email: true, name: true, company: true },
        });
        if (!invCustomer?.email) {
          return json({ error: "This customer does not have an email address on file. Please update the customer record first." }, { status: 400 });
        }
        const daysOverdue = Math.max(
          0,
          Math.floor((Date.now() - new Date(currentInvoice.dueDate).getTime()) / 86400000),
        );
        const result = await sendCollectionEmail({
          shopId,
          toEmail: invCustomer.email,
          stage: daysOverdue > 0 ? "STAGE_PLUS_7" : "STAGE_BEFORE_DUE",
          toneLevel: daysOverdue > 30 ? 4 : 2,
          useAI: true,
          vars: {
            customerName: invCustomer.name,
            companyName: invCustomer.company ?? "",
            invoiceNumber: currentInvoice.invoiceNumber,
            amount: Number(currentInvoice.amount).toFixed(2),
            currency: currentInvoice.currency,
            dueDate: new Date(currentInvoice.dueDate).toLocaleDateString("en-US"),
            daysOverdue,
            paymentLink: buildPaymentUrl(
              generatePaymentToken({
                shopId,
                customerId: currentInvoice.customerId,
                invoiceId: currentInvoice.id,
              }),
            ),
          },
        });
        if (!result.sent) {
          logger.app("WARN", "action:app.invoices.$id send-invoice-email failed", result.error);
          return json({ error: "Unable to send the email. Please check your email settings and try again." }, { status: 500 });
        }
        logger.app("INFO", "action:app.invoices.$id send-invoice-email OK", null, {
          durationMs: Date.now() - ta,
          invoiceId: params.id,
          messageId: result.messageId,
        });
        return json({ success: true, messageId: result.messageId });
      }

      default:
        logger.app("WARN", "action:app.invoices.$id unknown_intent", null, { intent });
        return json({ error: "We encountered an issue. Please refresh the page and try again." }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:app.invoices.$id ERROR", msg, { durationMs: Date.now() - ta, invoiceId: params.id });
    throw new Response("We encountered an issue. Please refresh the page and try again.", { status: 500 });
  }
};

const statusTone: Record<string, "success" | "critical" | "attention" | "warning" | "new" | "info"> = {
  PAID: "success",
  OVERDUE: "critical",
  DISPUTED: "attention",
  PARTIALLY_PAID: "warning",
  DRAFT: "new",
  PENDING: "info",
  VOID: "info",
};

const statusLabel: Record<string, string> = {
  PAID: "Paid",
  OVERDUE: "Overdue",
  DISPUTED: "Disputed",
  PARTIALLY_PAID: "Partial",
  DRAFT: "Draft",
  PENDING: "Pending",
  VOID: "Void",
};

export default function InvoiceDetail() {
  const { invoice, customer, collectionTasks, payments, allowedTransitions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [showPaymentMethod, setShowPaymentMethod] = useState(false);
  const [busyIntent, setBusyIntent] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialMethod, setPartialMethod] = useState("Bank Transfer");
  const [showEditForm, setShowEditForm] = useState(false);
  const [editAmount, setEditAmount] = useState(Number(invoice.amount).toFixed(2));
  const [editNetTerms, setEditNetTerms] = useState(invoice.netTermsDays?.toString() ?? "30");
  const [pendingStatusConfirm, setPendingStatusConfirm] = useState<string | null>(null);

  const isPaid = invoice.status === "PAID";
  const isVoid = invoice.status === "VOID";
  const isEditable = !isPaid && !isVoid;

  // Per-intent loading
  useEffect(() => {
    if (fetcher.state === "idle") {
      setBusyIntent(null);
    }
  }, [fetcher.state]);

  const handleMarkPaid = useCallback(() => {
    setShowPaymentMethod(true);
  }, []);

  const confirmMarkPaid = useCallback(
    (paymentMethod?: string) => {
      const formData = new FormData();
      formData.set("intent", "mark-paid");
      if (paymentMethod) formData.set("paymentMethod", paymentMethod);
      setBusyIntent("mark-paid");
      fetcher.submit(formData, { method: "POST" });
      setShowPaymentMethod(false);
    },
    [fetcher],
  );

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      const formData = new FormData();
      formData.set("intent", "update-status");
      formData.set("newStatus", newStatus);
      setBusyIntent("update-status");
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher],
  );

  const isBusy = (intent: string) => busyIntent === intent && fetcher.state !== "idle";

  // P2: Handle partial payment
  const handlePartialPayment = useCallback(() => {
    const amount = parseFloat(partialAmount);
    if (!amount || amount <= 0 || amount > Number(invoice.amount)) return;
    setBusyIntent("partial-payment");
    const fd = new FormData();
    fd.set("intent", "partial-payment");
    fd.set("paymentAmount", partialAmount);
    if (partialMethod) fd.set("paymentMethod", partialMethod);
    fetcher.submit(fd, { method: "post" });
  }, [partialAmount, partialMethod, invoice.amount, fetcher]);

  const handleEditSave = useCallback(() => {
    setBusyIntent("update-invoice");
    const fd = new FormData();
    fd.set("intent", "update-invoice");
    fd.set("amount", editAmount);
    fd.set("netTermsDays", editNetTerms);
    fetcher.submit(fd, { method: "post" });
    setShowEditForm(false);
  }, [editAmount, editNetTerms, fetcher]);

  const handleSendEmail = useCallback(() => {
    setBusyIntent("send-invoice-email");
    const fd = new FormData();
    fd.set("intent", "send-invoice-email");
    fetcher.submit(fd, { method: "post" });
  }, [fetcher]);

  const handleDownloadPDF = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadPDF(`/api/invoices/${invoice.id}/pdf`);
    } finally {
      setPdfLoading(false);
    }
  }, [invoice.id]);

  return (
    <Page
      title={`Invoice ${invoice.invoiceNumber}`}
      backAction={{ content: "Invoices", url: "/app/invoices" }}
    >
      <ActionToast fetcher={fetcher} successMessage="Invoice updated successfully" />
      <BlockStack gap="400">
        {/* Feedback */}
        {fetcher.data?.error && (
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">
              {fetcher.data.error}
            </Text>
          </Banner>
        )}

        <Layout>
          {/* Main Content */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {/* Header Row */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">
                      {invoice.invoiceNumber}
                    </Text>
                    {invoice.shopifyOrderName && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Order: {invoice.shopifyOrderName}
                      </Text>
                    )}
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Button
                      onClick={handleDownloadPDF}
                      variant="primary"
                      tone="success"
                      loading={pdfLoading}
                      disabled={pdfLoading}
                    >
                      Download PDF
                    </Button>
                    <Badge tone={statusTone[invoice.status] ?? "info"} size="large">
                      {statusLabel[invoice.status] ?? invoice.status}
                    </Badge>
                  </InlineStack>
                </InlineStack>

                <Divider />

                {/* Key Info */}
                <InlineStack gap="400" wrap>
                  <Box minWidth="140px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Amount
                      </Text>
                      <Text as="p" variant="headingXl" fontWeight="bold">
                        {invoice.currency} {Number(invoice.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box minWidth="140px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Issue Date
                      </Text>
                      <Text as="p" variant="headingMd" fontWeight="semibold">
                        {new Date(invoice.issueDate).toLocaleDateString(DEFAULT_LOCALE)}
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box minWidth="140px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Due Date
                      </Text>
                      <Text as="p" variant="headingMd" fontWeight="semibold">
                        {new Date(invoice.dueDate).toLocaleDateString(DEFAULT_LOCALE)}
                      </Text>
                    </BlockStack>
                  </Box>

                  {invoice.paidDate && (
                    <Box minWidth="140px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Paid Date
                        </Text>
                        <Text as="p" variant="headingMd" fontWeight="semibold" tone="success">
                          {new Date(invoice.paidDate).toLocaleDateString(DEFAULT_LOCALE)}
                        </Text>
                      </BlockStack>
                    </Box>
                  )}

                  {invoice.daysOverdue > 0 && (
                    <Box minWidth="140px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Days Overdue
                        </Text>
                        <Text as="p" variant="headingMd" fontWeight="bold" tone="critical">
                          {invoice.daysOverdue} days
                        </Text>
                      </BlockStack>
                    </Box>
                  )}
                </InlineStack>

                <Divider />

                {/* Details table */}
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">
                    Details
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={[
                      ["Net Terms", `${invoice.netTermsDays} days`],
                      ["Currency", invoice.currency],
                      [
                        "Payment Method",
                        invoice.paymentMethod ?? "—",
                      ],
                      [
                        "Shopify Order",
                        invoice.shopifyOrderName && invoice.shopifyOrderId
                          ? <Link url={`https://admin.shopify.com/store/orders/${invoice.shopifyOrderId}`} external target="_blank">{invoice.shopifyOrderName}</Link>
                          : "—",
                      ],
                      ["Created", new Date(invoice.createdAt).toLocaleDateString(DEFAULT_LOCALE)],
                      ["Last Updated", new Date(invoice.updatedAt).toLocaleDateString(DEFAULT_LOCALE)],
                    ]}
                  />
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Collection Tasks */}
            {collectionTasks.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Collection Activity
                  </Text>
                  {collectionTasks.map((task) => (
                    <Box
                      key={task.id}
                      borderColor="border-secondary"
                      borderWidth="025"
                      borderRadius="200"
                      padding="300"
                    >
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge
                            tone={
                              task.status === "COMPLETED"
                                ? "success"
                                : task.status === "ESCALATED"
                                  ? "critical"
                                  : "info"
                            }
                          >
                            {task.status}
                          </Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Step {task.currentStep}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Started: {new Date(task.startedAt).toLocaleDateString(DEFAULT_LOCALE)}
                          {task.completedAt &&
                            ` · Completed: ${new Date(task.completedAt).toLocaleDateString(DEFAULT_LOCALE)}`}
                        </Text>
                        {task.lastReplyIntent && (
                          <Text as="p" variant="bodySm">
                            Reply intent:{" "}
                            <Badge size="small">{task.lastReplyIntent.replace(/_/g, " ")}</Badge>
                          </Text>
                        )}
                        {task.completedReason && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Reason: {task.completedReason}
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </Card>
            )}
          </Layout.Section>

          {/* Sidebar — Customer + Actions */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Customer Info */}
              {customer && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Customer
                    </Text>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        {customer.name}
                      </Text>
                      {customer.company && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {customer.company}
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        {customer.email}
                      </Text>
                      {customer.creditGrade && (
                        <Badge>{customer.creditGrade.replace("_", "+")}</Badge>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}

              {/* Edit Invoice */}
              {isEditable && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Edit Invoice
                      </Text>
                      <Button
                        onClick={() => setShowEditForm((p) => !p)}
                        variant="plain"
                        tone="critical"
                        disabled={isBusy("update-invoice")}
                      >
                        {showEditForm ? "Cancel" : "Edit"}
                      </Button>
                    </InlineStack>
                    {showEditForm && (
                      <BlockStack gap="200">
                        <TextField
                          label="Amount"
                          type="number"
                          value={editAmount}
                          onChange={setEditAmount}
                          prefix={invoice.currency}
                          autoComplete="off"
                        />
                        <TextField
                          label="Net Terms (Days)"
                          type="number"
                          value={editNetTerms}
                          onChange={setEditNetTerms}
                          autoComplete="off"
                        />
                        <Button
                          onClick={handleEditSave}
                          variant="primary"
                          fullWidth
                          loading={isBusy("update-invoice")}
                          disabled={isBusy("update-invoice")}
                        >
                          Save Changes
                        </Button>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Actions */}
              {isEditable && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Actions
                    </Text>

                    {/* Mark as Paid */}
                    {allowedTransitions.includes("PAID") && !showPaymentMethod && (
                      <Button onClick={handleMarkPaid} variant="primary" fullWidth>
                        Mark as Paid
                      </Button>
                    )}

                    {showPaymentMethod && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm">
                          Confirm payment:
                        </Text>
                        <Button
                          onClick={() => confirmMarkPaid("Bank Transfer")}
                          fullWidth
                        >
                          Bank Transfer
                        </Button>
                        <Button
                          onClick={() => confirmMarkPaid("Credit Card")}
                          fullWidth
                        >
                          Credit Card
                        </Button>
                        <Button
                          onClick={() => confirmMarkPaid("Other")}
                          fullWidth
                        >
                          Other
                        </Button>
                        <Button
                          onClick={() => setShowPaymentMethod(false)}
                          variant="plain"
                          fullWidth
                        >
                          Cancel
                        </Button>
                      </BlockStack>
                    )}

                    {/* Other Status Transitions */}
                    {allowedTransitions
                      .filter((s) => s !== "PAID")
                      .map((targetStatus) => {
                        const isDestructive = targetStatus === "DISPUTED" || targetStatus === "VOID";
                        const needsConfirm = isDestructive && pendingStatusConfirm !== targetStatus;
                        return (
                          <Button
                            key={targetStatus}
                            onClick={() => {
                              if (isDestructive) {
                                if (pendingStatusConfirm === targetStatus) {
                                  setPendingStatusConfirm(null);
                                  handleStatusChange(targetStatus);
                                } else {
                                  setPendingStatusConfirm(targetStatus);
                                }
                              } else {
                                handleStatusChange(targetStatus);
                              }
                            }}
                            variant={targetStatus === "VOID" ? "primary" : "secondary"}
                            tone={targetStatus === "DISPUTED" ? "critical" : targetStatus === "VOID" ? "critical" : undefined}
                            fullWidth
                            loading={isBusy("update-status")}
                          >
                            {needsConfirm
                              ? `Confirm: Mark as ${statusLabel[targetStatus] ?? targetStatus}?`
                              : `Mark as ${statusLabel[targetStatus] ?? targetStatus}`}
                          </Button>
                        );
                      })}

                    <Divider />

                    {/* Send Email */}
                    <Button
                      onClick={handleSendEmail}
                      variant="secondary"
                      fullWidth
                      loading={isBusy("send-invoice-email")}
                      disabled={isBusy("send-invoice-email") || !customer?.email}
                      tone={customer?.email ? undefined : "success"}
                    >
                      {customer?.email ? "Send Invoice Email" : "No Customer Email"}
                    </Button>
                  </BlockStack>
                </Card>
              )}

              {/* P2: Partial Payment */}
              {isEditable && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Record Partial Payment</Text>
                    <FormLayout>
                      <TextField
                        label="Payment Amount"
                        type="number"
                        value={partialAmount}
                        onChange={setPartialAmount}
                        prefix={invoice.currency}
                        placeholder="0.00"
                        min={0.01}
                        max={Number(invoice.amount)}
                        step={0.01}
                        autoComplete="off"
                      />
                      <Select
                        label="Payment Method"
                        value={partialMethod}
                        onChange={setPartialMethod}
                        placeholder="Select method"
                        options={["Bank Transfer", "Credit Card", "Check", "Wire", "Other"].map((v) => ({
                          label: v,
                          value: v,
                        }))}
                      />
                      <Button
                        onClick={handlePartialPayment}
                        variant="primary"
                        fullWidth
                        loading={isBusy("partial-payment")}
                      >
                        Record Payment
                      </Button>
                    </FormLayout>
                  </BlockStack>
                </Card>
              )}

              {/* Paid Info */}
              {isPaid && (
                <Card>
                  <BlockStack gap="300">
                    <Banner tone="success">
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        Paid
                      </Text>
                      {invoice.paidDate && (
                        <Text as="p" variant="bodySm">
                          {new Date(invoice.paidDate).toLocaleDateString(DEFAULT_LOCALE)}
                        </Text>
                      )}
                      {invoice.paymentMethod && (
                        <Text as="p" variant="bodySm">
                          via {invoice.paymentMethod}
                        </Text>
                      )}
                    </Banner>
                    <InlineStack gap="200" wrap>
                      <Button
                        onClick={handleDownloadPDF}
                        variant="primary"
                        tone="success"
                        fullWidth
                        loading={pdfLoading}
                        disabled={pdfLoading}
                      >
                        Download PDF
                      </Button>
                      {allowedTransitions.includes("DISPUTED") && (
                        <Button
                          onClick={() => handleStatusChange("DISPUTED")}
                          variant="primary"
                          tone="critical"
                          fullWidth
                          loading={isBusy("update-status")}
                        >
                          Dispute Invoice
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              {/* Payment History */}
              {payments.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Payment History</Text>
                    <DataTable
                      columnContentTypes={["text", "numeric", "text", "text"]}
                      headings={["Date", "Amount", "Method", "Reference"]}
                      rows={payments.map((p) => [
                        new Date(p.paymentDate).toLocaleDateString(DEFAULT_LOCALE),
                        `${invoice.currency} ${Number(p.amount).toFixed(2)}`,
                        p.paymentMethod ?? "—",
                        p.reference ?? "—",
                      ])}
                    />
                  </BlockStack>
                </Card>
              )}

              {/* Voided Info */}
              {isVoid && (
                <Card>
                  <Banner tone="info">
                    <Text as="p" variant="bodyMd">
                      This invoice has been voided.
                    </Text>
                  </Banner>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <PageSkeleton />;
}

