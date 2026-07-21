// TruCredit — Collection Sequences list
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Banner,
  EmptyState,
  Modal,
  TextField,
  Select,
  FormLayout,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
  Tag,
} from "@shopify/polaris";
import { useState, useCallback, useRef } from "react";
import { authenticate } from "~/shopify.server";
import {
  listSequences,
  createSequence,
  deleteSequence,
  updateSequence,
} from "~/services/collection.server";
import type { TriggerType } from "@prisma/client";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import { checkPlanAccess } from "~/services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

    const result = await listSequences(shop.id, { page });

    return json({ shopId: shop.id, ...result });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Collections loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) return json({ error: "Shop not found" }, { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    switch (intent) {
      case "create": {
        // Auto sequences require GROWTH+ plan
        const { isPaid } = await checkPlanAccess(shop.id);
        if (!isPaid) {
          return json(
            {
              error: "Automated collection sequences require a Growth or Pro plan. Please upgrade.",
              needsUpgrade: true,
            },
            { status: 402 },
          );
        }

        const name = formData.get("name")?.toString()?.trim();
        const description = formData.get("description")?.toString()?.trim();
        const triggerType = (formData.get("triggerType")?.toString() ?? "OVERDUE") as TriggerType;
        const triggerDays = parseInt(formData.get("triggerDays")?.toString() ?? "0", 10);

        if (!name) return json({ error: "Name is required" }, { status: 400 });

        const seq = await createSequence({
          shopId: shop.id,
          name,
          description: description || undefined,
          triggerType,
          triggerDays,
        });
        return redirect(`/app/collections/${seq!.id}`);
      }

      case "delete": {
        const sequenceId = formData.get("sequenceId")?.toString();
        if (!sequenceId) return json({ error: "Sequence ID required" }, { status: 400 });

        const result = await deleteSequence(sequenceId, shop.id);
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      case "toggle": {
        const sequenceId = formData.get("sequenceId")?.toString();
        const isActive = formData.get("isActive") === "true";
        if (!sequenceId) return json({ error: "Sequence ID required" }, { status: 400 });

        const result = await updateSequence({
          sequenceId,
          shopId: shop.id,
          isActive: !isActive,
        });
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      default:
        return json({ error: "Unknown intent" }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, { status: 500 });
  }
};

const TRIGGER_LABELS: Record<string, string> = {
  BEFORE_DUE: "Before Due Date",
  ON_DUE: "On Due Date",
  OVERDUE: "Overdue",
};

const TONE_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Polite",
  3: "Neutral",
  4: "Firm",
  5: "Strong",
  6: "Urgent",
  7: "Final",
};

export default function CollectionsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { items, page, totalPages } = loaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const actionData = fetcher.data as { success?: boolean; error?: string } | undefined;
  const [errorDismissed, setErrorDismissed] = useState(false);

  const toggleCreate = useCallback(() => setShowCreate((v) => !v), []);
  const toggleDelete = useCallback(() => setDeleteId(null), []);

  const handleDelete = useCallback(
    (sequenceId: string) => {
      fetcher.submit({ intent: "delete", sequenceId }, { method: "POST" });
      setDeleteId(null);
    },
    [fetcher],
  );

  const handleToggle = useCallback(
    (sequenceId: string, isActive: boolean) => {
      fetcher.submit(
        { intent: "toggle", sequenceId, isActive: String(isActive) },
        { method: "POST" },
      );
    },
    [fetcher],
  );

  const prevPage = () => {
    const p = Math.max(1, page - 1);
    setSearchParams((sp) => { sp.set("page", String(p)); return sp; });
  };

  const nextPage = () => {
    const p = Math.min(totalPages, page + 1);
    setSearchParams((sp) => { sp.set("page", String(p)); return sp; });
  };

  return (
    <Page
      fullWidth
      title="Collection Sequences"
      subtitle="Manage automated collection workflows — configure timing, tone, and channels"
      primaryAction={items.length > 0 ? { content: "Create Sequence", onAction: toggleCreate } : undefined}
    >
      <BlockStack gap="400">
        {actionData?.error && !errorDismissed && (
          <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
            {actionData.error}
          </Banner>
        )}

        {items.length === 0 ? (
          <Card>
            <EmptyState
              heading="No collection sequences yet"
              image=""
              action={{ content: "Create First Sequence", onAction: toggleCreate }}
            >
              <p>Set up automated email reminders to collect payments on time.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "sequence", plural: "sequences" }}
              itemCount={items.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Trigger" },
                { title: "Steps" },
                { title: "Tone Range" },
                { title: "Status" },
                { title: "Actions" },
              ]}
            >
              {items.map((seq, idx) => {
                const stepOrders = seq.steps.map((s) => s.order).sort();
                const minTone = stepOrders.length > 0 ? seq.steps[0]!.toneLevel : null;
                const maxTone = stepOrders.length > 0 ? seq.steps[stepOrders.length - 1]!.toneLevel : null;

                return (
                  <IndexTable.Row key={seq.id} id={seq.id} position={idx}>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="bold">{seq.name}</Text>
                        {seq.isDefault && <Tag>Default</Tag>}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100">
                        <Badge tone="info">{TRIGGER_LABELS[seq.triggerType] ?? seq.triggerType}</Badge>
                        <Text as="span" tone="subdued">
                          {seq.triggerType === "BEFORE_DUE"
                            ? `${Math.abs(seq.triggerDays)}d before`
                            : seq.triggerDays === 0
                              ? "immediately"
                              : `${seq.triggerDays}d after`}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">{seq.steps.length} step{seq.steps.length !== 1 ? "s" : ""}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {minTone && maxTone ? (
                        <InlineStack gap="100">
                          <Badge tone={minTone <= 2 ? "success" : minTone <= 4 ? "attention" : "critical"}>
                            {TONE_LABELS[minTone]}
                          </Badge>
                          <Text as="span" tone="subdued">to</Text>
                          <Badge tone={maxTone <= 2 ? "success" : maxTone <= 4 ? "attention" : "critical"}>
                            {TONE_LABELS[maxTone]}
                          </Badge>
                        </InlineStack>
                      ) : (
                        <Text as="span" tone="subdued">—</Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={seq.isActive ? "success" : "critical"}>
                        {seq.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <ButtonGroup>
                        <Button
                          size="slim"
                          onClick={() => navigate(`/app/collections/${seq.id}`)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="slim"
                          tone={seq.isActive ? "critical" : "success"}
                          onClick={() => handleToggle(seq.id, seq.isActive)}
                        >
                          {seq.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        {!seq.isDefault && (
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => setDeleteId(seq.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </ButtonGroup>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>

            {totalPages > 1 && (
              <Box padding="400">
                <BlockStack align="center" inlineAlign="center">
                  <Pagination
                    label={`Page ${page} of ${totalPages}`}
                    hasPrevious={page > 1}
                    onPrevious={prevPage}
                    hasNext={page < totalPages}
                    onNext={nextPage}
                  />
                </BlockStack>
              </Box>
            )}
          </Card>
        )}
      </BlockStack>

      {/* Create Modal */}
      {showCreate && (
        <CreateSequenceModal
          open={showCreate}
          onClose={toggleCreate}
          intent="create"
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteId && (
        <Modal
          open
          onClose={toggleDelete}
          title="Delete Sequence"
          primaryAction={{
            content: "Delete",
            destructive: true,
            onAction: () => handleDelete(deleteId),
          }}
          secondaryActions={[{ content: "Cancel", onAction: toggleDelete }]}
        >
          <Modal.Section>
            <Text as="p">
              Are you sure you want to delete this collection sequence? This action cannot be undone.
            </Text>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

function CreateSequenceModal({
  open,
  onClose,
  intent,
}: {
  open: boolean;
  onClose: () => void;
  intent: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("OVERDUE");
  const [triggerDays, setTriggerDays] = useState("0");

  const handleSubmit = useCallback(() => {
    formRef.current?.requestSubmit();
    setTimeout(onClose, 100);
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Collection Sequence"
      primaryAction={{
        content: "Create",
        disabled: !name.trim(),
        onAction: handleSubmit,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <form ref={formRef} method="POST">
          <input type="hidden" name="intent" value={intent} />
          <FormLayout>
            <TextField
              label="Sequence Name"
              name="name"
              value={name}
              onChange={setName}
              autoComplete="off"
              placeholder="Standard 7-Stage Collection"
              helpText="A descriptive name for this collection workflow"
            />
            <TextField
              label="Description"
              name="description"
              value={description}
              onChange={setDescription}
              autoComplete="off"
              multiline={2}
              placeholder="Optional description of when this sequence applies"
            />
            <Select
              label="Trigger"
              name="triggerType"
              value={triggerType}
              onChange={setTriggerType}
              options={["BEFORE_DUE", "ON_DUE", "OVERDUE"].map((v) => ({
                label: TRIGGER_LABELS[v] ?? v,
                value: v,
              }))}
            />
            <TextField
              label={triggerType === "BEFORE_DUE" ? "Days Before Due" : "Days After Due"}
              name="triggerDays"
              value={triggerDays}
              onChange={setTriggerDays}
              type="number"
              autoComplete="off"
              helpText={triggerType === "BEFORE_DUE" ? "Start this many days before the due date" : "Start this many days after the due date"}
            />
          </FormLayout>
        </form>
      </Modal.Section>
    </Modal>
  );
}
