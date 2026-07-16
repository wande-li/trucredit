// Email Templates — List, create, and manage templates
import { useState, useRef, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  IndexTable,
  useIndexResourceState,
  Card,
  Badge,
  Button,
  Modal,
  TextField,
  Select,
  FormLayout,
  EmptyState,
  Pagination,
  Banner,
  Text,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { listTemplates, createTemplate, deleteTemplate, TEMPLATE_TYPE_LABELS, ensureDefaultTemplates } from "~/services/email.server";
import { PAGINATION } from "~/lib/constants";
import type { TemplateType } from "@prisma/client";

// ═══════════════════ Loader ═══════════════════

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(parseInt(url.searchParams.get("pageSize") ?? String(PAGINATION.DEFAULT_PAGE_SIZE), 10), PAGINATION.MAX_PAGE_SIZE);

  // Auto-seed default templates
  await ensureDefaultTemplates(session.shop);

  const result = await listTemplates(session.shop, { page, pageSize });
  return json(result);
};

// ═══════════════════ Actions ═══════════════════

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
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
    const msg = e instanceof Error ? e.message : String(e);
    return json({ success: false, error: msg });
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
  const { items, page, total, totalPages } = loaderData;

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(items, {
    resourceFilter: undefined,
    resourceIDResolver: (item) => item.id,
  });

  // Toast auto-dismiss
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Watch fetcher results
  const fetcherRef = useRef(fetcher.data);
  if (fetcher.data && fetcher.data !== fetcherRef.current) {
    fetcherRef.current = fetcher.data;
    if (fetcher.data.success) {
      showToast("Template saved successfully");
    }
  }

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    fetcher.submit(
      { intent: "delete", templateId: deleteTarget },
      { method: "POST" },
    );
    setDeleteTarget(null);
    showToast("Template deleted");
  }, [deleteTarget, fetcher, showToast]);

  const rowMarkup = items.map((tpl, index) => (
    <IndexTable.Row
      id={tpl.id}
      key={tpl.id}
      selected={selectedResources.includes(tpl.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {tpl.name}
        </Text>
        {tpl.isDefault && (
          <Badge size="small" tone="info">Default</Badge>
        )}
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
          {new Date(tpl.updatedAt).toLocaleDateString()}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Email Templates"
      subtitle={`${total} template${total !== 1 ? "s" : ""}`}
      primaryAction={
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          Create Template
        </Button>
      }
    >
      {/* Toast */}
      {toastMessage && (
        <Banner tone="success" onDismiss={() => setToastMessage(null)}>
          {toastMessage}
        </Banner>
      )}

      {/* Error banner */}
      {fetcher.data && !fetcher.data.success && (
        <Banner tone="critical">
          {(fetcher.data as { error?: string }).error ?? "An error occurred"}
        </Banner>
      )}

      {items.length === 0 ? (
        <EmptyState
          heading="No email templates yet"
          image=""
        >
          <Text as="p">Create your first email template to customize collection emails.</Text>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            Create Template
          </Button>
        </EmptyState>
      ) : (
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "template", plural: "templates" }}
            itemCount={items.length}
            selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
            onSelectionChange={handleSelectionChange}
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
          <div style={{ padding: "16px" }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("page", String(page - 1));
                window.location.href = url.toString();
              }}
              hasNext={page < totalPages}
              onNext={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("page", String(page + 1));
                window.location.href = url.toString();
              }}
              label={`Page ${page} of ${totalPages}`}
            />
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <CreateTemplateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          showToast("Template created");
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
