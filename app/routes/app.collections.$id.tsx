// TruCredit — Collection Sequence Detail (steps management)
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Banner,
  TextField,
  Select,
  FormLayout,
  Modal,
  Box,
  InlineStack,
  EmptyState,
  Divider,
  LegacyCard,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { resolveShop } from "~/services/shop-resolver.server";
import {
  getSequence,
  updateSequence,
  updateStep,
  deleteStep,
  addStep,
  reorderSteps,
} from "~/services/collection.server";
import { COLLECTION, TONE_LABELS } from "~/lib/constants";
import type { Channel } from "@prisma/client";
import { logger } from "~/services/logger.server";
import { requirePermission } from "~/services/rbac.server";
import RouteErrorBoundary from "~/components/RouteErrorBoundary";
import ActionToast from "~/components/ActionToast";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { shopId, role } = await resolveShop(request);
    requirePermission(role, "manage_collections");

    const sequenceId = params.id;
    if (!sequenceId) throw new Response("Not Found", { status: 404 });

    const sequence = await getSequence(sequenceId, shopId);
    if (!sequence) throw new Response("Not Found", { status: 404 });

    return json({ sequence });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Collection detail loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { shopId, role } = await resolveShop(request);
    requirePermission(role, "manage_collections");

    const sequenceId = params.id;
    if (!sequenceId) return json({ error: "Not Found" }, { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    switch (intent) {
      case "updateMeta": {
        const name = formData.get("name")?.toString()?.trim();
        const description = formData.get("description")?.toString()?.trim();
        const triggerDays = formData.get("triggerDays")?.toString();

        if (!name) return json({ error: "Name is required" }, { status: 400 });

        const result = await updateSequence({
          sequenceId,
          shopId: shopId,
          name,
          description: description || undefined,
          triggerDays: triggerDays !== undefined ? parseInt(triggerDays, 10) : undefined,
        });
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      case "addStep": {
        const order = parseInt(formData.get("order")?.toString() ?? "0", 10);
        const delayDays = parseInt(formData.get("delayDays")?.toString() ?? "0", 10);
        const channel = (formData.get("channel")?.toString() ?? "EMAIL") as Channel;
        const toneLevel = parseInt(formData.get("toneLevel")?.toString() ?? "3", 10);
        const subject = formData.get("subject")?.toString()?.trim() || undefined;

        if (order < 1) return json({ error: "Order must be >= 1" }, { status: 400 });

        const result = await addStep({
          sequenceId,
          shopId: shopId,
          order,
          delayDays,
          channel,
          toneLevel,
          subject,
        });
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      case "editStep": {
        const stepId = formData.get("stepId")?.toString();
        if (!stepId) return json({ error: "Step ID required" }, { status: 400 });

        const delayDays = formData.get("delayDays")?.toString();
        const channel = formData.get("channel")?.toString() as Channel | undefined;
        const toneLevel = formData.get("toneLevel")?.toString();
        const subject = formData.get("subject")?.toString()?.trim();

        const result = await updateStep({
          stepId,
          sequenceId,
          shopId: shopId,
          delayDays: delayDays !== undefined ? parseInt(delayDays, 10) : undefined,
          channel,
          toneLevel: toneLevel !== undefined ? parseInt(toneLevel, 10) : undefined,
          subject: subject ?? undefined,
        });
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      case "deleteStep": {
        const stepId = formData.get("stepId")?.toString();
        if (!stepId) return json({ error: "Step ID required" }, { status: 400 });

        const result = await deleteStep(stepId, sequenceId, shopId);
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      // P2: Reorder steps (button-based)
      case "reorderStep": {
        const stepId = formData.get("stepId")?.toString();
        const direction = formData.get("direction")?.toString();
        if (!stepId || !direction) return json({ error: "Missing parameters" }, { status: 400 });

        const seq = await getSequence(sequenceId, shopId);
        if (!seq) return json({ error: "Sequence not found" }, { status: 404 });

        const steps = [...seq.steps];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx === -1) return json({ error: "Step not found" }, { status: 400 });

        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= steps.length) return json({ error: "Cannot move" }, { status: 400 });

        [steps[idx], steps[swapIdx]] = [steps[swapIdx]!, steps[idx]!];
        const result = await reorderSteps(sequenceId, shopId, steps.map((s) => s.id));
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      // P2: Drag-and-drop reorder
      case "dragReorder": {
        const stepId = formData.get("stepId")?.toString();
        const toOrderStr = formData.get("toOrder")?.toString();
        if (!stepId || !toOrderStr) return json({ error: "Missing parameters" }, { status: 400 });
        const targetOrder = parseInt(toOrderStr, 10);

        const seq = await getSequence(sequenceId, shopId);
        if (!seq) return json({ error: "Sequence not found" }, { status: 404 });

        const steps = [...seq.steps];
        const fromIdx = steps.findIndex((s) => s.id === stepId);
        if (fromIdx === -1) return json({ error: "Step not found" }, { status: 400 });

        const [moved] = steps.splice(fromIdx, 1);
        const toIdx = steps.findIndex((s) => s.order >= targetOrder);
        const insertIdx = toIdx === -1 ? steps.length : toIdx;
        steps.splice(insertIdx, 0, moved!);

        const result = await reorderSteps(sequenceId, shopId, steps.map((s) => s.id));
        if (!result.success) return json({ error: result.error }, { status: 400 });
        return json({ success: true });
      }

      default:
        return json({ error: "Unknown intent" }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Collections detail action failed", msg);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};

const TONE_OPTIONS = COLLECTION.TONE_LEVELS.map((t) => ({
  label: `${t} - ${TONE_LABELS[t] ?? String(t)}`,
  value: String(t),
}));

const CHANNEL_OPTIONS = [
  { label: "Email", value: "EMAIL" },
];

export default function CollectionDetailPage() {
  const { sequence } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isSaving = fetcher.state === "submitting";

  const actionData = fetcher.data as { success?: boolean; error?: string } | undefined;

  // Meta form state
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description ?? "");
  const [triggerDays, setTriggerDays] = useState(String(sequence.triggerDays));

  // Step management
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [deleteStepId, setDeleteStepId] = useState<string | null>(null);

  const toggleAddStep = useCallback(() => setShowAddStep((v) => !v), []);
  const cancelEdit = useCallback(() => setEditingStepId(null), []);
  const cancelDelete = useCallback(() => setDeleteStepId(null), []);

  const handleSaveMeta = useCallback(() => {
    fetcher.submit(
      {
        intent: "updateMeta",
        name,
        description,
        triggerDays,
      },
      { method: "POST" },
    );
  }, [fetcher, name, description, triggerDays]);

  const handleDeleteStep = useCallback(
    (stepId: string) => {
      fetcher.submit({ intent: "deleteStep", stepId }, { method: "POST" });
      setDeleteStepId(null);
    },
    [fetcher],
  );

  // P2: Drag-and-drop state
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // P2: Move step up/down (button)
  const handleMoveStep = useCallback(
    (stepId: string, direction: "up" | "down") => {
      fetcher.submit(
        { intent: "reorderStep", stepId, direction, sequenceId: sequence.id },
        { method: "POST" },
      );
    },
    [sequence.id, fetcher],
  );

  // P2: Drag-and-drop reorder
  const handleDragReorder = useCallback(
    (stepId: string, toOrder: number) => {
      setDragOverIdx(null);
      fetcher.submit(
        { intent: "dragReorder", stepId, toOrder: String(toOrder) },
        { method: "POST" },
      );
    },
    [fetcher],
  );

  const hasChanges =
    name !== sequence.name ||
    description !== (sequence.description ?? "") ||
    triggerDays !== String(sequence.triggerDays);

  return (
    <Page
      title={sequence.name}
      subtitle={sequence.isDefault ? "Default Sequence" : "Custom Sequence"}
      backAction={{ content: "Sequences", url: "/app/collections" }}
    >
      <ActionToast fetcher={fetcher} successMessage="Changes saved successfully" />
      <Layout>
        {/* Main Column */}
        <Layout.Section>
          {actionData?.error && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical" onDismiss={() => {}}>
                {actionData.error}
              </Banner>
            </Box>
          )}

          {/* Sequence Settings */}
          <LegacyCard title="Sequence Settings" sectioned>
            <FormLayout>
              <TextField
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="off"
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                autoComplete="off"
                multiline={2}
              />
              <TextField
                label="Trigger Days"
                value={triggerDays}
                onChange={setTriggerDays}
                type="number"
                autoComplete="off"
                helpText="Days relative to due date (negative = before, 0 = on due, positive = after)"
              />

              <InlineStack align="end">
                <Button
                  onClick={handleSaveMeta}
                  disabled={!hasChanges}
                  loading={isSaving}
                >
                  Save Settings
                </Button>
              </InlineStack>
            </FormLayout>
          </LegacyCard>

          <Box paddingBlockStart="400" />

          {/* Steps */}
          <LegacyCard
            title="Collection Steps"
            actions={[
              {
                content: "Add Step",
                onAction: toggleAddStep,
                disabled: sequence.steps.length >= COLLECTION.MAX_STEPS_PER_SEQUENCE,
              },
            ]}
          >
            {sequence.steps.length === 0 ? (
              <Box padding="400">
                <EmptyState
                  heading="No steps defined"
                  image=""
                  action={{ content: "Add First Step", onAction: toggleAddStep }}
                >
                  <p>Each step defines when and how to contact the customer.</p>
                </EmptyState>
              </Box>
            ) : (
              <Box padding="400">
                {sequence.steps.map((step, idx) => (
                  <Box
                    key={step.id}
                    paddingBlockEnd={idx < sequence.steps.length - 1 ? "300" : undefined}
                    background={dragOverIdx === idx ? "bg-surface-selected" : undefined}
                    borderColor={dragOverIdx === idx ? "border-emphasis" : undefined}
                    borderRadius="200"
                  >
                    {editingStepId === step.id ? (
                      <StepEditForm
                        step={step}
                        sequenceId={sequence.id}
                        isSaving={isSaving}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <StepRow
                        step={step}
                        index={idx}
                        total={sequence.steps.length}
                        onEdit={() => setEditingStepId(step.id)}
                        onDelete={() => setDeleteStepId(step.id)}
                        onMoveUp={() => handleMoveStep(step.id, "up")}
                        onMoveDown={() => handleMoveStep(step.id, "down")}
                        isDragOver={dragOverIdx === idx}
                        onDragStart={(e, _di) => {
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e, di) => {
                          e.preventDefault();
                          setDragOverIdx(di);
                        }}
                        onDragEnd={() => {
                          setDragOverIdx(null);
                        }}
                        onDrop={(_e, order) => {
                          handleDragReorder(step.id, order);
                        }}
                      />
                    )}
                    {idx < sequence.steps.length - 1 && <Box paddingBlockStart="300"><Divider /></Box>}
                  </Box>
                ))}
              </Box>
            )}
          </LegacyCard>
        </Layout.Section>

        {/* Sidebar */}
        <Layout.Section variant="oneThird">
          <LegacyCard title="Status" sectioned>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={sequence.isActive ? "success" : "critical"}>
                {sequence.isActive ? "Active" : "Inactive"}
              </Badge>
              {sequence.isDefault && <Badge tone="info">Default</Badge>}
            </InlineStack>
          </LegacyCard>

          <Box paddingBlockStart="400" />
          <LegacyCard title="Step Timing" sectioned>
            {sequence.steps.map((step, idx) => (
              <Box key={step.id} paddingBlockEnd={idx < sequence.steps.length - 1 ? "200" : undefined}>
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">Step {step.order}</Text>
                  <Text as="span" tone="subdued">
                    {step.delayDays === 0 ? "Due date" : step.delayDays < 0 ? `${Math.abs(step.delayDays)}d before` : `+${step.delayDays}d`}
                  </Text>
                </InlineStack>
              </Box>
            ))}
            {sequence.steps.length === 0 && (
              <Text as="span" tone="subdued">No steps defined</Text>
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>

      {/* Add Step Modal */}
      {showAddStep && (
        <AddStepModal
          open={showAddStep}
          onClose={toggleAddStep}
          sequenceId={sequence.id}
          nextOrder={sequence.steps.length + 1}
        />
      )}

      {/* Delete Step Confirm */}
      {deleteStepId && (
        <Modal
          open
          onClose={cancelDelete}
          title="Delete Step"
          primaryAction={{
            content: "Delete",
            destructive: true,
            onAction: () => handleDeleteStep(deleteStepId),
          }}
          secondaryActions={[{ content: "Cancel", onAction: cancelDelete }]}
        >
          <Modal.Section>
            <Text as="p">
              Are you sure you want to delete this step? This action cannot be undone.
            </Text>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

// ═══════════════════ Sub-Components ═══════════════════

function StepRow({
  step,
  index,
  total,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  step: { id: string; order: number; delayDays: number; channel: Channel; toneLevel: number; skipIfPaid: boolean; useAI: boolean; subject: string | null };
  index: number;
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, order: number) => void;
}) {
  const delayLabel =
    step.delayDays === 0 ? "Due date" : step.delayDays < 0 ? `${Math.abs(step.delayDays)}d before` : `+${step.delayDays}d`;

  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        {/* Drag handle */}
        <span
          draggable
          style={{ cursor: "grab", paddingRight: "4px" }}
          onDragStart={(e: React.DragEvent) => onDragStart(e, index)}
          onDragOver={(e: React.DragEvent) => {
            e.preventDefault();
            onDragOver(e, index);
          }}
          onDragEnd={onDragEnd}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            onDrop(e, step.order);
          }}
        >
          <Text as="span" variant="bodyMd" tone="subdued">
            ⠿
          </Text>
        </span>
        <Box minWidth="28px">
          <Text as="span" fontWeight="bold" tone="subdued">{step.order}.</Text>
        </Box>
        <Badge tone="info">{step.channel === "EMAIL" ? "Email" : step.channel}</Badge>
        <Text as="span">{delayLabel}</Text>
        <Badge tone={step.toneLevel <= 2 ? "success" : step.toneLevel <= 4 ? "attention" : "critical"}>
          {`Tone ${step.toneLevel}`}
        </Badge>
        {step.skipIfPaid && <Badge tone="new">Auto-skip if paid</Badge>}
        {step.useAI && <Badge tone="new">AI Generated</Badge>}
        {step.subject && (
          <Text as="span" tone="subdued" truncate>
            {step.subject}
          </Text>
        )}
      </InlineStack>
      <ButtonGroup>
        {index > 0 && (
          <Button size="slim" onClick={onMoveUp} accessibilityLabel="Move up">
            ↑
          </Button>
        )}
        {index < total - 1 && (
          <Button size="slim" onClick={onMoveDown} accessibilityLabel="Move down">
            ↓
          </Button>
        )}
        <Button size="slim" onClick={onEdit}>Edit</Button>
        <Button size="slim" tone="critical" onClick={onDelete}>Delete</Button>
      </ButtonGroup>
    </InlineStack>
  );
}

function StepEditForm({
  step,
  sequenceId: _sequenceId,
  isSaving,
  onCancel,
}: {
  step: { id: string; delayDays: number; channel: Channel; toneLevel: number; skipIfPaid: boolean; useAI: boolean; subject: string | null };
  sequenceId: string;
  isSaving: boolean;
  onCancel: () => void;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  const [delayDays, setDelayDays] = useState(String(step.delayDays));
  const [channel, setChannel] = useState(step.channel);
  const [toneLevel, setToneLevel] = useState(String(step.toneLevel));
  const [subject, setSubject] = useState(step.subject ?? "");

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "editStep",
        stepId: step.id,
        delayDays,
        channel,
        toneLevel,
        subject,
      },
      { method: "POST" },
    );
  };

  const hasChanged =
    delayDays !== String(step.delayDays) ||
    channel !== step.channel ||
    toneLevel !== String(step.toneLevel) ||
    subject !== (step.subject ?? "");

  return (
    <>
      <ActionToast fetcher={fetcher} successMessage="Step updated successfully" />
      <Box padding="400" background="bg-surface-secondary" borderRadius="200">
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField
              label="Delay Days"
              value={delayDays}
              onChange={setDelayDays}
              type="number"
              autoComplete="off"
              helpText="Negative = before due, 0 = on due, positive = after due"
            />
            <Select
              label="Channel"
              value={channel}
              onChange={(value, _id) => setChannel(value as Channel)}
              options={CHANNEL_OPTIONS}
            />
            <Select
              label="Tone"
              value={toneLevel}
              onChange={setToneLevel}
              options={TONE_OPTIONS}
            />
          </FormLayout.Group>
          <TextField
            label="Subject (optional)"
            value={subject}
            onChange={setSubject}
            autoComplete="off"
            placeholder="Override email subject"
          />
          <InlineStack align="end" gap="200">
            <Button onClick={onCancel}>Cancel</Button>
            <Button onClick={handleSave} disabled={!hasChanged} loading={isSaving}>
              Save Step
            </Button>
          </InlineStack>
        </FormLayout>
      </Box>
    </>
  );
}

function AddStepModal({
  open,
  onClose,
  sequenceId: _sequenceId,
  nextOrder,
}: {
  open: boolean;
  onClose: () => void;
  sequenceId: string;
  nextOrder: number;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  const [delayDays, setDelayDays] = useState("0");
  const [channel, setChannel] = useState("EMAIL");
  const [toneLevel, setToneLevel] = useState("3");
  const [subject, setSubject] = useState("");

  // Auto-close on success after the fetcher returns
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      const t = setTimeout(onClose, 600);
      return () => clearTimeout(t);
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const handleAdd = () => {
    fetcher.submit(
      {
        intent: "addStep",
        order: String(nextOrder),
        delayDays,
        channel,
        toneLevel,
        subject,
      },
      { method: "POST" },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add Step ${nextOrder}`}
      primaryAction={{
        content: "Add Step",
        onAction: handleAdd,
        loading: fetcher.state === "submitting",
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <ActionToast fetcher={fetcher} successMessage="Step added successfully" />
      <Modal.Section>
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField
              label="Delay Days"
              value={delayDays}
              onChange={setDelayDays}
              type="number"
              autoComplete="off"
              helpText="Negative = before due, 0 = on due, positive = after due"
            />
            <Select
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={CHANNEL_OPTIONS}
            />
            <Select
              label="Tone"
              value={toneLevel}
              onChange={setToneLevel}
              options={TONE_OPTIONS}
            />
          </FormLayout.Group>
          <TextField
            label="Subject (optional)"
            value={subject}
            onChange={setSubject}
            autoComplete="off"
            placeholder="Override email subject"
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

