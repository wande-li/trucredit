import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
import { authenticate } from "~/shopify.server";
import { getInvoice, markInvoicePaid } from "~/services/invoice.server";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import { INVOICE_TRANSITIONS } from "~/types/invoice";
import type { InvoiceStatus } from "@prisma/client";
import prisma from "~/db.server";
import { useState, useCallback } from "react";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    if (!params.id) {
      throw new Response("Invoice ID required", { status: 400 });
    }

    const shopDomain = session.shop.trim();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const invoice = await getInvoice({
      shopId: shop.id,
      invoiceId: params.id,
    });

    if (!invoice) {
      throw new Response("Invoice not found", { status: 404 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: invoice.customerId },
      select: { name: true, company: true, email: true, creditGrade: true },
    });

    const collectionTasks = await prisma.collectionTask.findMany({
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
    });

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
      allowedTransitions: INVOICE_TRANSITIONS[invoice.status] as InvoiceStatus[],
    });
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
      throw new Response("Invoice ID required", { status: 400 });
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
      case "mark-paid": {
        const paymentMethod = formData.get("paymentMethod")?.toString();
        const invoice = await markInvoicePaid({
          shopId: shop.id,
          invoiceId: params.id,
          paymentMethod,
        });

        // Sync metafield for Shopify Function checkout validation
        syncCreditMetafield(admin, shopDomain, invoice.customerId).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Metafield sync failed after invoice status change", msg);
        });

        return json({ success: true });
      }

      case "update-status": {
        const newStatus = formData.get("newStatus")?.toString() as InvoiceStatus | undefined;

        if (!newStatus) return json({ error: "New status is required" }, { status: 400 });

        const currentInvoice = await prisma.invoice.findFirst({
          where: { id: params.id, shopId: shop.id },
          select: { status: true, paidDate: true },
        });

        if (!currentInvoice) {
          return json({ error: "Invoice not found" }, { status: 404 });
        }

        const allowed = INVOICE_TRANSITIONS[currentInvoice.status] as InvoiceStatus[];
        if (!allowed.includes(newStatus)) {
          return json(
            { error: `Cannot transition from ${currentInvoice.status} to ${newStatus}` },
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
        }

        await prisma.invoice.update({
          where: { id: params.id },
          data: updateData,
        });

        return json({ success: true });
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Response(`Invoice action failed: ${msg}`, { status: 500 });
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
  const { invoice, customer, collectionTasks, allowedTransitions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [showPaymentMethod, setShowPaymentMethod] = useState(false);

  const isPaid = invoice.status === "PAID";
  const isVoid = invoice.status === "VOID";
  const isEditable = !isPaid && !isVoid;

  const handleMarkPaid = useCallback(() => {
    setShowPaymentMethod(true);
  }, []);

  const confirmMarkPaid = useCallback(
    (paymentMethod?: string) => {
      const formData = new FormData();
      formData.set("intent", "mark-paid");
      if (paymentMethod) formData.set("paymentMethod", paymentMethod);
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
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher],
  );

  return (
    <Page
      title={`Invoice ${invoice.invoiceNumber}`}
      backAction={{ content: "Invoices", url: "/app/invoices" }}
    >
      <BlockStack gap="400">
        {/* Feedback */}
        {fetcher.data?.error && (
          <Banner tone="critical" onDismiss={() => fetcher.load("/app/invoices")}>
            <Text as="p" variant="bodyMd">
              {fetcher.data.error}
            </Text>
          </Banner>
        )}
        {fetcher.data?.success && (
          <Banner
            tone="success"
            onDismiss={() => window.location.reload()}
          >
            <Text as="p" variant="bodyMd">
              Invoice updated successfully.
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
                  <Badge tone={statusTone[invoice.status] ?? "info"} size="large">
                    {statusLabel[invoice.status] ?? invoice.status}
                  </Badge>
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
                        {invoice.currency} {Number(invoice.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box minWidth="140px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Issue Date
                      </Text>
                      <Text as="p" variant="headingMd" fontWeight="semibold">
                        {new Date(invoice.issueDate).toLocaleDateString()}
                      </Text>
                    </BlockStack>
                  </Box>

                  <Box minWidth="140px">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Due Date
                      </Text>
                      <Text as="p" variant="headingMd" fontWeight="semibold">
                        {new Date(invoice.dueDate).toLocaleDateString()}
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
                          {new Date(invoice.paidDate).toLocaleDateString()}
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
                        invoice.shopifyOrderName
                          ? `https://admin.shopify.com/store/orders/${invoice.shopifyOrderId ?? ""}`
                          : "—",
                      ],
                      ["Created", new Date(invoice.createdAt).toLocaleDateString()],
                      ["Last Updated", new Date(invoice.updatedAt).toLocaleDateString()],
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
                          Started: {new Date(task.startedAt).toLocaleDateString()}
                          {task.completedAt &&
                            ` · Completed: ${new Date(task.completedAt).toLocaleDateString()}`}
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
                      .map((targetStatus) => (
                        <Button
                          key={targetStatus}
                          onClick={() => handleStatusChange(targetStatus)}
                          variant={targetStatus === "VOID" ? "plain" : "secondary"}
                          tone={targetStatus === "DISPUTED" ? "critical" : undefined}
                          fullWidth
                          loading={fetcher.state === "submitting"}
                        >
                          Mark as {statusLabel[targetStatus] ?? targetStatus}
                        </Button>
                      ))}
                  </BlockStack>
                </Card>
              )}

              {/* Paid Info */}
              {isPaid && (
                <Card>
                  <BlockStack gap="200">
                    <Banner tone="success">
                      <Text as="p" variant="bodyMd" fontWeight="bold">
                        Paid
                      </Text>
                      {invoice.paidDate && (
                        <Text as="p" variant="bodySm">
                          {new Date(invoice.paidDate).toLocaleDateString()}
                        </Text>
                      )}
                      {invoice.paymentMethod && (
                        <Text as="p" variant="bodySm">
                          via {invoice.paymentMethod}
                        </Text>
                      )}
                    </Banner>
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
