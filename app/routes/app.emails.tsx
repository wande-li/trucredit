// Email Templates — List, create, and manage templates
import { useState, useRef, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, Link, useRevalidator } from "@remix-run/react";
import {
  Page,
  IndexTable,
  Card,
  Badge,
  Button,
  Modal,
  TextField,
  Select,
  FormLayout,
  Pagination,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { listTemplates, createTemplate, deleteTemplate, ensureDefaultTemplates } from "~/services/email.server";
import { PAGINATION } from "~/lib/constants";
import { TEMPLATE_TYPE_LABELS } from "~/lib/email-utils";
import type { TemplateType } from "@prisma/client";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";
import { checkPlanAccess } from "~/services/billing.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";

// ═══════════════════ Loader ═══════════════════

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(parseInt(url.searchParams.get("pageSize") ?? String(PAGINATION.DEFAULT_PAGE_SIZE), 10), PAGINATION.MAX_PAGE_SIZE);

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const { isPaid } = await checkPlanAccess(shop.id);
    if (!isPaid) return redirect("/app/billing");

    // Auto-seed default templates
    await ensureDefaultTemplates(session.shop);

    const result = await listTemplates(session.shop, { page, pageSize });
    return json(result);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Emails loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ═══════════════════ Actions ═══════════════════

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "create") {
      const name = formData.get("name") as string;
      const type = formData.get("type") as TemplateType;
      const subject = formData.get("subject") as string;
      const body = formData.get("body") as string;
      const toneLevel = parseInt(formData.get("toneLevel") as string, 10);

      if (!name.trim() || !subject.trim() || !body.trim()) {
        return json({ success: false, error: "Name, subject, and body are required" });
      }

      await createTemplate({
        shopId: session.shop,
        name: name.trim(),
        type: type || "CUSTOM",
        subject: subject.trim(),
        body: body.trim(),
        toneLevel: isNaN(toneLevel) ? 3 : toneLevel,
      });

      return json({ success: true });
    }

    if (intent === "delete") {
      const templateId = formData.get("templateId") as string;
      const result = await deleteTemplate(templateId, session.shop);
      return json(result);
    }

    return json({ success: false, error: "Unknown intent" });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Email action failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

// ═══════════════════ Component ═══════════════════

const TONE_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Helpful",
  3: "Professional",
  4: "Firm",
  5: "Urgent",
  6: "Serious",
  7: "Final",
};

const TONE_COLORS: Record<number, "success" | "attention" | "warning" | "critical"> = {
  1: "success",
  2: "success",
  3: "attention",
  4: "attention",
  5: "warning",
  6: "critical",
  7: "critical",
};

const TYPE_OPTIONS = Object.entries(TEMPLATE_TYPE_LABELS)
  .filter(([key]) => key !== "OVERDUE_90") // not in template CRUD UI
  .map(([value, label]) => ({ value, label }));

export default function EmailsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const { items, page, total, totalPages } = loaderData;
  const [, setSearchParams] = useSearchParams();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setSearchParams((sp) => {
        sp.set("page", String(newPage));
        return sp;
      });
    },
    [setSearchParams],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    fetcher.submit(
      { intent: "delete", templateId: deleteTarget },
      { method: "POST" },
    );
    setDeleteTarget(null);
  }, [deleteTarget, fetcher]);

  const showSuccess = fetcher.data?.success && !dismissedSuccess;

  const rowMarkup = items.map((tpl, index) => (
    <IndexTable.Row
      id={tpl.id}
      key={tpl.id}
      position={index}
    >
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          <Link to={`/app/emails/${tpl.id}`}>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {tpl.name}
            </Text>
          </Link>
          {tpl.isDefault && (
            <Badge size="small" tone="info">Default</Badge>
          )}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge size="small">{TEMPLATE_TYPE_LABELS[tpl.type] ?? tpl.type}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodySm" as="span" truncate>
          {tpl.subject}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {tpl.toneLevel && (
          <Badge size="small" tone={TONE_COLORS[tpl.toneLevel] ?? "attention"}>
            {TONE_LABELS[tpl.toneLevel] ?? `Level ${tpl.toneLevel}`}
          </Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodySm" as="span" tone="subdued">
          {new Date(tpl.updatedAt).toLocaleDateString('en-US')}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      fullWidth
      title="Email Templates"
      subtitle={`${total} template${total !== 1 ? "s" : ""}`}
      primaryAction={
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          Create Template
        </Button>
      }
    >
      <BlockStack gap="400">
        {/* Error banner */}
        {fetcher.data && !fetcher.data.success && (fetcher.data as { error?: string }).error && (
          <Banner
            tone="critical"
            onDismiss={() => revalidator.revalidate()}
          >
            <Text as="p">{(fetcher.data as { error?: string }).error}</Text>
          </Banner>
        )}

        {showSuccess && (
          <Banner tone="success" onDismiss={() => setDismissedSuccess(true)}>
            <Text as="p">Template saved successfully</Text>
          </Banner>
        )}

        {items.length === 0 ? (
          <Card>
            <Box padding="800">
              <BlockStack gap="400" align="center">
                <BlockStack gap="200" align="center">
                  <Text as="h2" variant="headingMd">No email templates yet</Text>
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    Create your first email template to customize collection emails.
                  </Text>
                </BlockStack>
                <Button variant="primary" onClick={() => setShowCreate(true)}>
                  Create Template
                </Button>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "template", plural: "templates" }}
              itemCount={items.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Type" },
                { title: "Subject" },
                { title: "Tone" },
                { title: "Updated" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
            {totalPages > 1 && (
              <Box padding="400">
                <BlockStack align="center" inlineAlign="center">
                  <Pagination
                    hasPrevious={page > 1}
                    onPrevious={() => handlePageChange(page - 1)}
                    hasNext={page < totalPages}
                    onNext={() => handlePageChange(page + 1)}
                    label={`Page ${page} of ${totalPages}`}
                  />
                </BlockStack>
              </Box>
            )}
          </Card>
        )}

      {/* Create Modal */}
      <CreateTemplateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          setDismissedSuccess(false);
        }}
      />

      {/* Delete Confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Template"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <Text as="p">Are you sure you want to delete this template? This cannot be undone.</Text>
        </Modal.Section>
      </Modal>
      </BlockStack>
    </Page>
  );
}

// ═══════════════════ Create Template Modal ═══════════════════

function CreateTemplateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState("");
  const [type, setType] = useState("CUSTOM");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toneLevel, setToneLevel] = useState("3");

  const isSubmitting = fetcher.state !== "idle";

  // Handle success
  const prevState = useRef(fetcher.state);
  if (prevState.current === "submitting" && fetcher.state === "idle" && fetcher.data?.success) {
    prevState.current = fetcher.state;
    onCreated();
  } else {
    prevState.current = fetcher.state;
  }

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "create");
    formData.append("name", name);
    formData.append("type", type);
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("toneLevel", toneLevel);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, name, type, subject, body, toneLevel]);

  const valid = name.trim() && subject.trim() && body.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Email Template"
      loading={isSubmitting}
      primaryAction={{
        content: "Create",
        disabled: !valid || isSubmitting,
        onAction: handleSubmit,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <FormLayout>
          <TextField
            label="Template Name"
            value={name}
            onChange={setName}
            autoComplete="off"
            placeholder="Standard Gentle Reminder"
          />
          <Select
            label="Template Type"
            value={type}
            onChange={setType}
            options={TYPE_OPTIONS}
          />
          <TextField
            label="Subject"
            value={subject}
            onChange={setSubject}
            autoComplete="off"
            placeholder="Payment reminder: Invoice {{invoiceNumber}}"
            helpText="Use {{customerName}}, {{companyName}}, {{invoiceNumber}}, {{amount}}, {{dueDate}}, {{daysOverdue}}, {{paymentLink}} as placeholders"
          />
          <TextField
            label="Body"
            value={body}
            onChange={setBody}
            autoComplete="off"
            multiline={8}
            placeholder="Dear {{customerName}}..."
            helpText="Use placeholders like {{customerName}}, {{invoiceNumber}}, {{amount}}, {{paymentLink}}"
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
      </Modal.Section>
    </Modal>
  );
}

// Route-level ErrorBoundary
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

