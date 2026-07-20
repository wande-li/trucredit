import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { createInvoice, getNextInvoiceSequence } from "~/services/invoice.server";
import { syncCreditMetafield } from "~/services/metafield.server";
import { generateInvoiceNumber } from "~/types/invoice";
import { COLLECTION } from "~/lib/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, currency: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const [customers, nextSeq] = await Promise.all([
      prisma.customer.findMany({
        where: { shopId: shop.id, status: { not: "BLACKLISTED" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: true },
      }),
      getNextInvoiceSequence(shop.id),
    ]);

    const nextNumber = generateInvoiceNumber(nextSeq);

    return json({
      customers,
      nextNumber,
      currency: shop.currency,
      netTermsOptions: [
        { label: "Net 7", value: "7" },
        { label: "Net 15", value: "15" },
        { label: "Net 30", value: "30" },
        { label: "Net 45", value: "45" },
        { label: "Net 60", value: "60" },
        { label: "Net 90", value: "90" },
      ],
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new Response(`Failed to load data: ${msg}`, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();
    if (intent !== "create") return json({ error: "Invalid action" }, { status: 400 });

    const customerId = formData.get("customerId")?.toString();
    const amountStr = formData.get("amount")?.toString();
    const netTermsDaysStr = formData.get("netTermsDays")?.toString();
    const currency = formData.get("currency")?.toString() ?? "USD";
    const invoiceNumber = formData.get("invoiceNumber")?.toString();
    const shopifyOrderName = formData.get("shopifyOrderName")?.toString() || undefined;

    if (!customerId) return json({ error: "Please select a customer." }, { status: 400 });
    if (!amountStr || isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
      return json({ error: "Please enter a valid amount." }, { status: 400 });
    }
    if (!invoiceNumber) {
      return json({ error: "Invoice number is required." }, { status: 400 });
    }

    const amount = parseFloat(amountStr);
    const netTermsDays = parseInt(netTermsDaysStr ?? String(COLLECTION.DEFAULT_NET_TERMS), 10);

    const invoice = await createInvoice({
      shopId: shop.id,
      customerId,
      amount,
      currency,
      netTermsDays,
      invoiceNumber,
      shopifyOrderName,
    });

    // Sync metafield for Shopify Function checkout validation
    syncCreditMetafield(admin, shopDomain, customerId).catch(() => {});

    return redirect(`/app/invoices/${invoice.id}`);
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, { status: 500 });
  }
};

export default function NewInvoice() {
  const { customers, nextNumber, currency, netTermsOptions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string }>();
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [netTermsDays, setNetTermsDays] = useState(String(COLLECTION.DEFAULT_NET_TERMS));
  const [shopifyOrderName, setShopifyOrderName] = useState("");

  const isSubmitting = fetcher.state === "submitting";
  const canSubmit = customerId && amount && parseFloat(amount) > 0;

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        label: c.company ? `${c.name} (${c.company})` : c.name,
        value: c.id,
      })),
    [customers],
  );

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("customerId", customerId);
    formData.set("amount", amount);
    formData.set("netTermsDays", netTermsDays);
    formData.set("currency", currency);
    formData.set("invoiceNumber", nextNumber);
    if (shopifyOrderName) formData.set("shopifyOrderName", shopifyOrderName);
    fetcher.submit(formData, { method: "POST" });
  }, [customerId, amount, netTermsDays, currency, nextNumber, shopifyOrderName, fetcher]);

  return (
    <Page
      title="Create Invoice"
      backAction={{ content: "Invoices", url: "/app/invoices" }}
    >
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner tone="critical" onDismiss={() => {}}>
            <Text as="p" variant="bodyMd">{fetcher.data.error}</Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Invoice Details</Text>

            <FormLayout>
              <Select
                label="Customer"
                options={customerOptions}
                value={customerId}
                onChange={(v) => setCustomerId(v)}
                placeholder="Select a customer..."
                disabled={isSubmitting}
              />

              <TextField
                label="Invoice Number"
                value={nextNumber}
                onChange={() => {}}
                autoComplete="off"
                disabled
                helpText="Auto-generated invoice number"
              />

              <TextField
                label="Amount"
                type="number"
                value={amount}
                onChange={(v) => setAmount(v)}
                autoComplete="off"
                prefix={currency}
                placeholder="0.00"
                disabled={isSubmitting}
                min={0.01}
                step={0.01}
              />

              <Select
                label="Net Terms"
                options={netTermsOptions}
                value={netTermsDays}
                onChange={(v) => setNetTermsDays(v)}
                disabled={isSubmitting}
              />

              <TextField
                label="Shopify Order (optional)"
                value={shopifyOrderName}
                onChange={(v) => setShopifyOrderName(v)}
                autoComplete="off"
                placeholder="e.g. #1001"
                disabled={isSubmitting}
                helpText="Link this invoice to an existing Shopify order"
              />
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">Summary</Text>
            <InlineStack gap="200" align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Amount</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">
                  {currency} {amount ? Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Net Terms</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">
                  Net {netTermsDays}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Due Date</Text>
                <Text as="p" variant="headingMd" fontWeight="bold">
                  {(() => {
                    const d = new Date();
                    d.setDate(d.getDate() + parseInt(netTermsDays, 10));
                    return d.toLocaleDateString();
                  })()}
                </Text>
              </BlockStack>
            </InlineStack>

            <InlineStack gap="200" align="end">
              <Button onClick={() => navigate("/app/invoices")} variant="plain" disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                variant="primary"
                disabled={!canSubmit || isSubmitting}
                loading={isSubmitting}
              >
                Create Invoice
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
