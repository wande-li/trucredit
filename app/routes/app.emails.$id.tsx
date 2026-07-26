// Email Template Detail — Edit, preview, and AI generation
import { useState, useRef, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

import { useLoaderData, useFetcher } from "@remix-run/react";
import { TONE_LABELS } from "~/lib/constants";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  Modal,
} from "@shopify/polaris";
import { resolveShop } from "~/services/shop-resolver.server";
import { checkPlanAccess } from "~/services/billing.server";
import { requirePermission } from "~/services/rbac.server";
import { getTemplateById, updateTemplate, deleteTemplate, sendTestEmail } from "~/services/email.server";
import { fillTemplate, TEMPLATE_TYPE_LABELS } from "~/lib/email-utils";
import { generateCollectionEmail } from "~/services/ai.server";
import type { CollectionStage, ToneLevel } from "~/types";
import { logger } from "~/services/logger.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import ActionToast from "~/components/ActionToast";

export const meta: MetaFunction = () => [{ title: "TruCredit — Email Template" }];

// ═══════════════════ Loader ═══════════════════

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:app.emails.$id START", null, { templateId: params.id });
  try {
    const { shopId } = await resolveShop(request);
    const template = await getTemplateById(params.id!, shopId);
    if (!template) throw new Response("Template not found", { status: 404 });
    logger.app("INFO", "loader:app.emails.$id OK", null, {
      durationMs: Date.now() - t0,
      templateId: params.id,
    });
    return json({ template });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:app.emails.$id ERROR", msg, { durationMs: Date.now() - t0, templateId: params.id });
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ═══════════════════ Actions ═══════════════════

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ta = Date.now();
  logger.app("INFO", "action:app.emails.$id START", null, { templateId: params.id });
  try {
    const { shopId, role } = await resolveShop(request);
    requirePermission(role, "edit");

    // Plan gate: email template editing requires paid plan
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) {
      logger.app("WARN", "action:app.emails.$id plan_gate blocked", null, { shopId });
      return json({ error: "Email management requires a paid plan. Please upgrade." }, { status: 402 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    // Update template
    if (intent === "update") {
      const name = formData.get("name") as string;
      const subject = formData.get("subject") as string;
      const body = formData.get("body") as string;
      const toneLevelStr = formData.get("toneLevel") as string;
      const toneLevel = toneLevelStr ? parseInt(toneLevelStr, 10) : undefined;

      if (!name?.trim() || !subject?.trim() || !body?.trim()) {
        return json({ success: false, error: "Name, subject, and body are required" });
      }

      const result = await updateTemplate({
        templateId: params.id!,
        shopId,
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
        toneLevel: toneLevel && !isNaN(toneLevel) ? toneLevel : undefined,
      });

      logger.app("INFO", "action:app.emails.$id update OK", null, {
        durationMs: Date.now() - ta,
        templateId: params.id,
      });
      return json(result);
    }

    // Delete template
    if (intent === "delete") {
      const result = await deleteTemplate(params.id!, shopId);
      logger.app("INFO", "action:app.emails.$id delete OK", null, {
        durationMs: Date.now() - ta,
        templateId: params.id,
      });
      return json(result);
    }

    // AI Preview — generate email from AI
    if (intent === "aiPreview") {
      const customerName = formData.get("customerName") as string;
      const companyName = formData.get("companyName") as string;
      const invoiceNumber = formData.get("invoiceNumber") as string;
      const amount = formData.get("amount") as string;
      const currency = formData.get("currency") as string;
      const dueDate = formData.get("dueDate") as string;
      const daysOverdue = parseInt(formData.get("daysOverdue") as string, 10);
      const stage = formData.get("stage") as string;

      if (!customerName || !invoiceNumber || !amount) {
        return json({ success: false, error: "Customer name, invoice number, and amount are required" });
      }

      const generated = await generateCollectionEmail({
        stage: (stage || "STAGE_PLUS_7") as CollectionStage,
        toneLevel: 3 as ToneLevel,
        customerName: customerName.trim(),
        companyName: companyName?.trim() || "Our Company",
        invoiceNumber: invoiceNumber.trim(),
        amount: amount.trim(),
        currency: currency?.trim() || "USD",
        dueDate: dueDate?.trim() || "N/A",
        daysOverdue: isNaN(daysOverdue) ? 7 : daysOverdue,
        paymentLink: "https://pay.example.com/invoice",
      });

      logger.app("INFO", "action:app.emails.$id aiPreview OK", null, { durationMs: Date.now() - ta });
      return json({ success: true, generatedEmail: generated });
    }

    // P3: Send test email
    if (intent === "sendTest") {
      const testEmail = formData.get("testEmail") as string;
      if (!testEmail?.trim()) {
        return json({ success: false, error: "Email address required" });
      }
      const result = await sendTestEmail({
        shopId,
        templateId: params.id!,
        testEmail: testEmail.trim(),
      });
      logger.app("INFO", "action:app.emails.$id sendTest OK", null, { durationMs: Date.now() - ta });
      return json(result);
    }

    logger.app("WARN", "action:app.emails.$id unknown_intent", null, { intent });
    return json({ success: false, error: "Unknown intent" });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:app.emails.$id ERROR", msg, { durationMs: Date.now() - ta, templateId: params.id });
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ═══════════════════ Component ═══════════════════



const STAGE_LABELS: Record<string, string> = {
  STAGE_MINUS_7: "7 Days Before Due",
  STAGE_PLUS_0: "On Due Date",
  STAGE_PLUS_7: "7 Days Overdue",
  STAGE_PLUS_14: "14 Days Overdue",
  STAGE_PLUS_30: "30 Days Overdue",
  STAGE_PLUS_60: "60 Days Overdue",
  STAGE_PLUS_90: "90 Days Overdue",
};

export default function EmailTemplateDetail() {
  const { template: initialTemplate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JsonifyObject union narrow, cast needed
  const fetcherData = fetcher.data as { success?: boolean; error?: string; generatedEmail?: { subject: string; body: string } } | undefined;

  // Edit state
  const [name, setName] = useState(initialTemplate.name);
  const [subject, setSubject] = useState(initialTemplate.subject);
  const [body, setBody] = useState(initialTemplate.body);
  const [toneLevel, setToneLevel] = useState(String(initialTemplate.toneLevel ?? 3));
  const [showDelete, setShowDelete] = useState(false);

  // AI Preview state
  const [aiCustomerName, setAiCustomerName] = useState("");
  const [aiCompanyName, setAiCompanyName] = useState("");
  const [aiInvoiceNumber, setAiInvoiceNumber] = useState("");
  const [aiAmount, setAiAmount] = useState("");
  const [aiCurrency, setAiCurrency] = useState("USD");
  const [aiDueDate, setAiDueDate] = useState("");
  const [aiDaysOverdue, setAiDaysOverdue] = useState("7");
  const [aiStage, setAiStage] = useState("STAGE_PLUS_7");
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string } | null>(null);

  // Watch fetcher for update/delete results
  const prevState = useRef(fetcher.state);
  if (prevState.current !== fetcher.state && fetcher.state === "idle" && fetcherData) {
    prevState.current = fetcher.state;
    if (fetcherData.success && fetcherData.generatedEmail) {
      setGeneratedEmail(fetcherData.generatedEmail);
    } else if (!fetcherData.success) {
      // Error shown via banner
    }
  } else {
    prevState.current = fetcher.state;
  }

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("name", name);
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("toneLevel", toneLevel);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, name, subject, body, toneLevel]);

  const handleDelete = useCallback(() => {
    fetcher.submit({ intent: "delete" }, { method: "POST" });
  }, [fetcher]);

  const handleAiPreview = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "aiPreview");
    formData.append("customerName", aiCustomerName);
    formData.append("companyName", aiCompanyName);
    formData.append("invoiceNumber", aiInvoiceNumber);
    formData.append("amount", aiAmount);
    formData.append("currency", aiCurrency);
    formData.append("dueDate", aiDueDate);
    formData.append("daysOverdue", aiDaysOverdue);
    formData.append("stage", aiStage);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, aiCustomerName, aiCompanyName, aiInvoiceNumber, aiAmount, aiCurrency, aiDueDate, aiDaysOverdue, aiStage]);

  const isSubmitting = fetcher.state !== "idle";

  // Template variable preview
  const previewVars = {
    customerName: "Acme Corp",
    companyName: "Your Company",
    invoiceNumber: "INV-001",
    amount: "$1,250.00",
    dueDate: new Date().toLocaleDateString('en-US'),
    daysOverdue: "7",
    paymentLink: "https://pay.example.com/invoice",
  };
  const previewEmail = fillTemplate({ subject, body }, previewVars);

  return (
    <Page
      title={initialTemplate.name}
      backAction={{ url: "/app/emails" }}
      primaryAction={
        <Button variant="primary" loading={isSubmitting} onClick={handleSave}>
          Save Changes
        </Button>
      }
      secondaryActions={[
        { content: "Delete", destructive: true, onAction: () => setShowDelete(true) },
      ]}
    >
      <ActionToast fetcher={fetcher} successMessage="Changes saved successfully" />
      {/* Error */}
      {fetcherData && !fetcherData.success && (
        <Banner tone="critical">
          {fetcherData.error ?? "An error occurred"}
        </Banner>
      )}

      <BlockStack gap="400">
        {/* Metadata */}
        <Card>
          <InlineStack gap="400" align="start">
            <Badge size="large">{TEMPLATE_TYPE_LABELS[initialTemplate.type] ?? initialTemplate.type}</Badge>
            {initialTemplate.isDefault && <Badge tone="info">Default</Badge>}
            {initialTemplate.toneLevel && (
              <Badge tone="warning">{`${TONE_LABELS[initialTemplate.toneLevel]} Tone`}</Badge>
            )}
          </InlineStack>
        </Card>

        {/* Edit Form */}
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Edit Template</Text>
              <FormLayout>
                <TextField
                  label="Template Name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                />
                <TextField
                  label="Subject"
                  value={subject}
                  onChange={setSubject}
                  autoComplete="off"
                  helpText="Use {{customerName}}, {{invoiceNumber}}, {{amount}}, etc."
                />
                <TextField
                  label="Body"
                  value={body}
                  onChange={setBody}
                  autoComplete="off"
                  multiline={12}
                  helpText="Use {{customerName}}, {{companyName}}, {{invoiceNumber}}, {{amount}}, {{dueDate}}, {{daysOverdue}}, {{paymentLink}} as placeholders"
                />
                <Select
                  label="Tone Level"
                  value={toneLevel}
                  onChange={setToneLevel}
                  options={[
                    { value: "1", label: "1 — Friendly" },
                    { value: "2", label: "2 — Helpful" },
                    { value: "3", label: "3 — Professional" },
                    { value: "4", label: "4 — Firm" },
                    { value: "5", label: "5 — Urgent" },
                    { value: "6", label: "6 — Serious" },
                    { value: "7", label: "7 — Final" },
                  ]}
                />
              </FormLayout>
            </BlockStack>
          </Box>
        </Card>

        {/* Template Preview */}
        <Card>
          <Box padding="400">
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Template Preview</Text>
              <Divider />
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text variant="bodyMd" fontWeight="bold" as="p">
                    Subject: {previewEmail.subject}
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    {previewEmail.body.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < previewEmail.body.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                  </Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Box>
        </Card>

        {/* AI Generation Preview */}
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">AI Email Generator</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Fill in customer and invoice details to generate an AI-powered collection email based on DeepSeek AI.
                </Text>
              </BlockStack>

              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Customer Name"
                    value={aiCustomerName}
                    onChange={setAiCustomerName}
                    autoComplete="off"
                    placeholder="John Smith"
                  />
                  <TextField
                    label="Company"
                    value={aiCompanyName}
                    onChange={setAiCompanyName}
                    autoComplete="off"
                    placeholder="Acme Corp"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Invoice Number"
                    value={aiInvoiceNumber}
                    onChange={setAiInvoiceNumber}
                    autoComplete="off"
                    placeholder="INV-001"
                  />
                  <TextField
                    label="Amount"
                    value={aiAmount}
                    onChange={setAiAmount}
                    autoComplete="off"
                    placeholder="1250.00"
                  />
                  <TextField
                    label="Currency"
                    value={aiCurrency}
                    onChange={setAiCurrency}
                    autoComplete="off"
                    placeholder="USD"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Due Date"
                    value={aiDueDate}
                    onChange={setAiDueDate}
                    type="date"
                    autoComplete="off"
                  />
                  <TextField
                    label="Days Overdue"
                    value={aiDaysOverdue}
                    onChange={setAiDaysOverdue}
                    type="number"
                    autoComplete="off"
                  />
                  <Select
                    label="Stage"
                    value={aiStage}
                    onChange={setAiStage}
                    options={Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                </FormLayout.Group>

                <Button variant="primary" loading={isSubmitting && fetcherData === undefined} disabled={!aiCustomerName || !aiInvoiceNumber || !aiAmount} onClick={handleAiPreview}>
                  Generate AI Email
                </Button>
              </FormLayout>

              {generatedEmail && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Generated Email</Text>
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <Text variant="bodyMd" fontWeight="bold" as="p">
                          Subject: {generatedEmail.subject}
                        </Text>
                        <Text variant="bodyMd" as="p">
                          {generatedEmail.body.split("\n").map((line, i) => (
                            <span key={i}>
                              {line}
                              {i < generatedEmail.body.split("\n").length - 1 && <br />}
                            </span>
                          ))}
                        </Text>
                      </BlockStack>
                    </Box>
                  </BlockStack>
                  {/* P3: Test send */}
                  <Divider />
                  <fetcher.Form method="post">
                    <FormLayout>
                      <Text variant="headingSm" as="h4">Send Test Email</Text>
                      <TextField
                        name="testEmail"
                        label="Recipient Email"
                        type="email"
                        placeholder="test@example.com"
                        autoComplete="email"
                      />
                      <input type="hidden" name="intent" value="sendTest" />
                      <Button submit variant="primary">
                        Send Test
                      </Button>
                    </FormLayout>
                  </fetcher.Form>
                </>
              )}
            </BlockStack>
          </Box>
        </Card>
      </BlockStack>

      {/* Delete Confirmation Modal */}
      <Modal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        title="Delete Template"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          loading: fetcher.state === "submitting",
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowDelete(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete "{initialTemplate.name}"? This cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

