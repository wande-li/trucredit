// Collection Engine — State machine, step progression, sweep orchestration
// Adapted from CollectFlow's collection-sweeper.server.ts, simplified for Shopify B2B

import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import redis from "~/lib/redis.server";
import { daysToStage, stageToTone, isValidTransition } from "~/types/collection";
import type {
  SweepResult,
  InvoiceEvalResult,
  CollectionStage,
  ToneLevel,
} from "~/types/collection";
import type { TaskStatus, Channel, ReplyIntent, TriggerType } from "@prisma/client";
import { COLLECTION, PAGINATION } from "~/lib/constants";

// ═══════════════════ Sequence CRUD ═══════════════════

/** List all collection sequences for a shop */
export async function listSequences(shopId: string, params?: { page?: number; pageSize?: number }) {
  const page = params?.page ?? 1;
  const pageSize = Math.min(params?.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE, PAGINATION.MAX_PAGE_SIZE);

  const [items, total] = await Promise.all([
    prisma.collectionSequence.findMany({
      where: { shopId },
      include: { steps: { orderBy: { order: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.collectionSequence.count({ where: { shopId } }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Get a single sequence with all steps */
export async function getSequence(sequenceId: string, shopId: string) {
  return prisma.collectionSequence.findFirst({
    where: { id: sequenceId, shopId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}

/** Create a new collection sequence */
export async function createSequence(params: {
  shopId: string;
  name: string;
  description?: string;
  triggerType: TriggerType;
  triggerDays: number;
  isActive?: boolean;
  steps?: Array<{
    order: number;
    delayDays: number;
    channel: Channel;
    toneLevel: number;
    skipIfPaid?: boolean;
    useAI?: boolean;
    subject?: string;
  }>;
}) {
  if (params.steps && params.steps.length > COLLECTION.MAX_STEPS_PER_SEQUENCE) {
    throw new Error(`Maximum ${COLLECTION.MAX_STEPS_PER_SEQUENCE} steps per sequence`);
  }

  const sequence = await prisma.collectionSequence.create({
    data: {
      shopId: params.shopId,
      name: params.name,
      description: params.description,
      triggerType: params.triggerType,
      triggerDays: params.triggerDays,
      isActive: params.isActive ?? true,
    },
  });

  if (params.steps?.length) {
    await prisma.collectionStep.createMany({
      data: params.steps.map((s) => ({
        sequenceId: sequence.id,
        order: s.order,
        delayDays: s.delayDays,
        channel: s.channel,
        toneLevel: s.toneLevel,
        skipIfPaid: s.skipIfPaid ?? true,
        useAI: s.useAI ?? true,
        subject: s.subject,
      })),
    });
  }

  return getSequence(sequence.id, params.shopId);
}

/** Update sequence metadata */
export async function updateSequence(params: {
  sequenceId: string;
  shopId: string;
  name?: string;
  description?: string;
  triggerType?: TriggerType;
  triggerDays?: number;
  isActive?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.collectionSequence.findFirst({
    where: { id: params.sequenceId, shopId: params.shopId },
  });
  if (!existing) return { success: false, error: "Sequence not found" };

  await prisma.collectionSequence.update({
    where: { id: params.sequenceId },
    data: {
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.triggerType !== undefined && { triggerType: params.triggerType }),
      ...(params.triggerDays !== undefined && { triggerDays: params.triggerDays }),
      ...(params.isActive !== undefined && { isActive: params.isActive }),
    },
  });

  return { success: true };
}

/** Delete a sequence (only if not default) */
export async function deleteSequence(
  sequenceId: string,
  shopId: string,
): Promise<{ success: boolean; error?: string }> {
  const seq = await prisma.collectionSequence.findFirst({
    where: { id: sequenceId, shopId },
  });
  if (!seq) return { success: false, error: "Sequence not found" };
  if (seq.isDefault) return { success: false, error: "Cannot delete default sequence" };

  // Cascade: steps + associated tasks will be deleted via Prisma cascade
  await prisma.collectionSequence.delete({ where: { id: sequenceId } });
  return { success: true };
}

/** Add a step to a sequence */
export async function addStep(params: {
  sequenceId: string;
  shopId: string;
  order: number;
  delayDays: number;
  channel: Channel;
  toneLevel: number;
  skipIfPaid?: boolean;
  useAI?: boolean;
  subject?: string;
}): Promise<{ success: boolean; error?: string }> {
  const seq = await prisma.collectionSequence.findFirst({
    where: { id: params.sequenceId, shopId: params.shopId },
    include: { steps: { select: { id: true } } },
  });
  if (!seq) return { success: false, error: "Sequence not found" };
  if (seq.steps.length >= COLLECTION.MAX_STEPS_PER_SEQUENCE) {
    return { success: false, error: `Maximum ${COLLECTION.MAX_STEPS_PER_SEQUENCE} steps per sequence` };
  }

  await prisma.collectionStep.create({
    data: {
      sequenceId: params.sequenceId,
      order: params.order,
      delayDays: params.delayDays,
      channel: params.channel,
      toneLevel: params.toneLevel,
      skipIfPaid: params.skipIfPaid ?? true,
      useAI: params.useAI ?? true,
      subject: params.subject,
    },
  });

  return { success: true };
}

/** Update a step */
export async function updateStep(params: {
  stepId: string;
  sequenceId: string;
  shopId: string;
  delayDays?: number;
  channel?: Channel;
  toneLevel?: number;
  skipIfPaid?: boolean;
  useAI?: boolean;
  subject?: string;
}): Promise<{ success: boolean; error?: string }> {
  const step = await prisma.collectionStep.findFirst({
    where: { id: params.stepId, sequenceId: params.sequenceId },
    include: { sequence: { select: { shopId: true } } },
  });
  if (!step) return { success: false, error: "Step not found" };
  if (step.sequence.shopId !== params.shopId) return { success: false, error: "Unauthorized" };

  await prisma.collectionStep.update({
    where: { id: params.stepId },
    data: {
      ...(params.delayDays !== undefined && { delayDays: params.delayDays }),
      ...(params.channel !== undefined && { channel: params.channel }),
      ...(params.toneLevel !== undefined && { toneLevel: params.toneLevel }),
      ...(params.skipIfPaid !== undefined && { skipIfPaid: params.skipIfPaid }),
      ...(params.useAI !== undefined && { useAI: params.useAI }),
      ...(params.subject !== undefined && { subject: params.subject }),
    },
  });

  return { success: true };
}

/** Delete a step from a sequence */
export async function deleteStep(
  stepId: string,
  sequenceId: string,
  shopId: string,
): Promise<{ success: boolean; error?: string }> {
  const step = await prisma.collectionStep.findFirst({
    where: { id: stepId, sequenceId },
    include: { sequence: { select: { shopId: true } } },
  });
  if (!step) return { success: false, error: "Step not found" };
  if (step.sequence.shopId !== shopId) return { success: false, error: "Unauthorized" };

  await prisma.collectionStep.delete({ where: { id: stepId } });
  return { success: true };
}

/** Reorder steps in a sequence */
export async function reorderSteps(
  sequenceId: string,
  shopId: string,
  stepIds: string[],
): Promise<{ success: boolean; error?: string }> {
  const seq = await prisma.collectionSequence.findFirst({
    where: { id: sequenceId, shopId },
  });
  if (!seq) return { success: false, error: "Sequence not found" };

  await prisma.$transaction(
    stepIds.map((id, index) =>
      prisma.collectionStep.update({
        where: { id },
        data: { order: index + 1 },
      }),
    ),
  );

  return { success: true };
}

// ═══════════════════ Collection Stage Mapping ═══════════════════
// Overdue days → stage (reused from CollectFlow's calculateStage pattern)

/**
 * Calculate the collection stage for an invoice based on days relative to due date
 * Negative = before due, positive = overdue
 */
export function calculateStage(dueDate: Date, reference: Date = new Date()): CollectionStage {
  const diffMs = reference.getTime() - dueDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return daysToStage(diffDays);
}

/**
 * Get recommended tone level for a given stage
 */
export function getToneForStage(stage: CollectionStage): ToneLevel {
  return stageToTone(stage);
}

// ═══════════════════ Sequence Building ═══════════════════

/**
 * Build default 7-step collection sequence for a shop
 * Copied from CollectFlow's DEFAULT_RULE_SEQUENCE pattern
 */
export const DEFAULT_SEQUENCE_STEPS = [
  { order: 1, delayDays: -7, channel: "EMAIL" as Channel, toneLevel: 1 as ToneLevel, skipIfPaid: true },
  { order: 2, delayDays: 0, channel: "EMAIL" as Channel, toneLevel: 2 as ToneLevel, skipIfPaid: true },
  { order: 3, delayDays: 7, channel: "EMAIL" as Channel, toneLevel: 3 as ToneLevel, skipIfPaid: true },
  { order: 4, delayDays: 14, channel: "EMAIL" as Channel, toneLevel: 4 as ToneLevel, skipIfPaid: true },
  { order: 5, delayDays: 30, channel: "EMAIL" as Channel, toneLevel: 5 as ToneLevel, skipIfPaid: true },
  { order: 6, delayDays: 60, channel: "EMAIL" as Channel, toneLevel: 6 as ToneLevel, skipIfPaid: true },
  { order: 7, delayDays: 90, channel: "EMAIL" as Channel, toneLevel: 7 as ToneLevel, skipIfPaid: true },
];

/**
 * Create default collection sequence for a new shop
 */
export async function createDefaultSequence(shopId: string): Promise<void> {
  const exists = await prisma.collectionSequence.findFirst({
    where: { shopId, isDefault: true },
  });
  if (exists) return;

  await prisma.collectionSequence.create({
    data: {
      shopId,
      name: "Standard 7-Stage Collection",
      description: "From friendly reminder before due to final notice at 90+ days",
      isDefault: true,
      isActive: true,
      triggerType: "OVERDUE",
      triggerDays: 0,
      steps: {
        create: DEFAULT_SEQUENCE_STEPS.map((step) => ({
          order: step.order,
          delayDays: step.delayDays,
          channel: step.channel,
          toneLevel: step.toneLevel,
          skipIfPaid: true,
          useAI: true,
        })),
      },
    },
  });
}

// ═══════════════════ Task State Machine ═══════════════════

/**
 * Advance a collection task to the next step
 * Validates state transition via isValidTransition
 */
export async function advanceTask(params: {
  taskId: string;
  toStatus?: TaskStatus;
  reason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const task = await prisma.collectionTask.findUnique({
    where: { id: params.taskId },
    include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } },
  });

  if (!task) return { success: false, error: "Task not found" };

  const targetStatus = params.toStatus ?? "ACTIVE";

  if (!isValidTransition(task.status, targetStatus)) {
    return {
      success: false,
      error: `Invalid transition: ${task.status} → ${targetStatus}`,
    };
  }

  const nextStep = task.currentStep + 1;
  const steps = task.sequence.steps;

  // Check if sequence is complete
  if (nextStep > steps.length) {
    await prisma.collectionTask.update({
      where: { id: params.taskId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedReason: "All steps completed",
      },
    });
    return { success: true };
  }

  const stepDef = steps[nextStep - 1];
  if (!stepDef) {
    return { success: false, error: `Step ${nextStep} not found` };
  }

  // Calculate next step date
  const nextStepAt = new Date();
  nextStepAt.setDate(nextStepAt.getDate() + stepDef.delayDays);

  await prisma.collectionTask.update({
    where: { id: params.taskId },
    data: {
      status: targetStatus,
      currentStep: nextStep,
      nextStepAt,
    },
  });

  return { success: true };
}

/**
 * Pause a collection task (e.g., when customer replies with dispute)
 */
export async function pauseTask(params: {
  taskId: string;
  reason: string;
}): Promise<void> {
  await prisma.collectionTask.update({
    where: { id: params.taskId },
    data: {
      status: "PAUSED",
      events: {
        create: {
          type: "MANUAL_NOTE",
          actionTaken: `PAUSED: ${params.reason}`,
        },
      },
    },
  });
}

/**
 * Stop a collection task (e.g., invoice paid, customer blacklisted)
 */
export async function stopTask(params: {
  taskId: string;
  reason: string;
}): Promise<void> {
  await prisma.collectionTask.update({
    where: { id: params.taskId },
    data: {
      status: "STOPPED",
      completedAt: new Date(),
      completedReason: params.reason,
    },
  });
}

/**
 * Escalate a task (from active → escalated, triggers escalation workflow)
 */
export async function escalateTask(params: {
  taskId: string;
  reason: string;
}): Promise<void> {
  await prisma.collectionTask.update({
    where: { id: params.taskId },
    data: {
      status: "ESCALATED",
      events: {
        create: {
          type: "ESCALATED",
          actionTaken: params.reason,
        },
      },
    },
  });
}

// ═══════════════════ Sweep Engine ═══════════════════
// Adapted from CollectFlow's runCollectionSweep()

/**
 * Run a full collection sweep — match overdue invoices to sequences, create/advance tasks
 * This is the core engine called by cron/queue
 */
export async function runCollectionSweep(): Promise<SweepResult> {
  const result: SweepResult = {
    shopsProcessed: 0,
    invoicesMatched: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    tasksCreated: 0,
    tasksAdvanced: 0,
    errors: 0,
    errorsList: [],
  };

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Find all shops with active sequences
  const activeSequences = await prisma.collectionSequence.findMany({
    where: { isActive: true },
    select: { shopId: true },
    distinct: ["shopId"],
  });

  for (const { shopId } of activeSequences) {
    try {
      const shopResult = await sweepShop(shopId, todayStr, today);
      result.shopsProcessed++;
      result.invoicesMatched += shopResult.invoicesMatched;
      result.emailsSent += shopResult.emailsSent;
      result.emailsSkipped += shopResult.emailsSkipped;
      result.tasksCreated += shopResult.tasksCreated;
      result.tasksAdvanced += shopResult.tasksAdvanced;
      result.errors += shopResult.errors;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", `Shop ${shopId} sweep failed`, msg);
      result.errors++;
      result.errorsList.push(msg);
    }
  }

  return result;
}

async function sweepShop(
  shopId: string,
  todayStr: string,
  today: Date,
): Promise<SweepResult> {
  const result: SweepResult = {
    shopsProcessed: 0,
    invoicesMatched: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    tasksCreated: 0,
    tasksAdvanced: 0,
    errors: 0,
    errorsList: [],
  };

  // Load sequences with steps
  const sequences = await prisma.collectionSequence.findMany({
    where: { shopId, isActive: true },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  if (sequences.length === 0) return result;

  // Load overdue invoices (PENDING or OVERDUE)
  const invoices = await prisma.invoice.findMany({
    where: {
      shopId,
      status: { in: ["PENDING", "OVERDUE"] },
    },
    include: {
      customer: true,
      collectionTasks: {
        where: { status: { in: ["PENDING", "ACTIVE", "PAUSED"] } },
        include: { sequence: true },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  for (const invoice of invoices) {
    try {
      const evalResult = evaluateInvoiceForSweep(invoice, sequences, todayStr, today);
      result.invoicesMatched++;

      switch (evalResult.action) {
        case "SEND_EMAIL":
          result.emailsSent++;
          break;
        case "CREATE_TASK":
          result.tasksCreated++;
          break;
        case "ADVANCE_TASK":
          result.tasksAdvanced++;
          break;
        case "SKIP":
          result.emailsSkipped++;
          break;
        default:
          result.errors++;
          result.errorsList.push(evalResult.reason);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors++;
      result.errorsList.push(msg);
    }
  }

  return result;
}

/**
 * Evaluate a single invoice against all sequences — pure logic, no side effects
 */
export function evaluateInvoiceForSweep(
  invoice: {
    id: string;
    customerId: string;
    dueDate: Date;
    status: string;
    customer: { name: string; isFrozen: boolean } | null;
    collectionTasks: Array<{
      id: string;
      status: TaskStatus;
      currentStep: number;
      sequence: { id: string };
    }>;
  },
  sequences: Array<{
    id: string;
    triggerType: string;
    triggerDays: number;
    steps: Array<{
      order: number;
      delayDays: number;
      channel: Channel;
      toneLevel: number;
      skipIfPaid: boolean;
    }>;
  }>,
  _todayStr: string,
  _today: Date,
): InvoiceEvalResult {
  // Missing customer — skip
  if (!invoice.customer) {
    return {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      matched: false,
      stage: daysToStage(0),
      action: "SKIP",
      reason: "Customer not found",
    };
  }

  // Frozen customers — skip everything
  if (invoice.customer.isFrozen) {
    return {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      matched: false,
      stage: daysToStage(0),
      action: "SKIP",
      reason: "Customer is frozen",
    };
  }

  // Already paid — skip
  if (invoice.status === "PAID" || invoice.status === "VOID") {
    return {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      matched: false,
      stage: daysToStage(0),
      action: "SKIP",
      reason: "Invoice already resolved",
    };
  }

  const stage = calculateStage(invoice.dueDate);
  const todayDays = Math.floor(
    (_today.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Match against sequences
  for (const sequence of sequences) {
    // Check if invoice hasn't met trigger condition yet
    if (todayDays < sequence.triggerDays) continue;

    // Find the step that matches current days overdue
    const matchingStep = sequence.steps.find(
      (step) => Math.abs(todayDays - step.delayDays) <= 1,
    );

    if (!matchingStep) {
      // No matching step → check if any step should have fired
      const nextStep = sequence.steps.find((s) => s.delayDays > todayDays);
      if (!nextStep) {
        return {
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          matched: true,
          stage,
          action: "ERROR",
          reason: `Invoice ${todayDays}d overdue, all steps exhausted`,
        };
      }
      continue; // Try next sequence
    }

    // Check for existing active task
    const activeTask = invoice.collectionTasks.find(
      (t) => t.sequence.id === sequence.id,
    );

    if (activeTask) {
      // Task exists — should we advance?
      if (activeTask.currentStep < matchingStep.order) {
        return {
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          matched: true,
          stage,
          action: "ADVANCE_TASK",
          reason: `Advancing task ${activeTask.id} to step ${matchingStep.order}`,
        };
      }
      // Already at or past this step — skip
      return {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        matched: true,
        stage,
        action: "SKIP",
        reason: "Task already at or past matching step",
      };
    }

    // No task exists — create new task and send email
    return {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      matched: true,
      stage,
      action: "SEND_EMAIL",
      reason: `New task needed at step ${matchingStep.order}`,
    };
  }

  return {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    matched: false,
    stage,
    action: "SKIP",
    reason: "No matching sequence or step",
  };
}

// ═══════════════════ Reply Processing ═══════════════════

/**
 * Record a customer reply on a collection task
 */
export async function recordReply(params: {
  taskId: string;
  replyContent: string;
  replyIntent: ReplyIntent;
  replyConfidence: number;
  isDispute: boolean;
}): Promise<void> {
  const task = await prisma.collectionTask.findUnique({
    where: { id: params.taskId },
  });
  if (!task) return;

  await prisma.collectionEvent.create({
    data: {
      taskId: params.taskId,
      type: "REPLY_RECEIVED",
      replyContent: params.replyContent,
      replyIntent: params.replyIntent,
      replyConfidence: params.replyConfidence,
      actionTaken: params.isDispute ? "DISPUTE_TRIGGERED" : "REPLY_RECORDED",
    },
  });

  // Update task reply tracking
  await prisma.collectionTask.update({
    where: { id: params.taskId },
    data: {
      lastReplyAt: new Date(),
      lastReplyIntent: params.replyIntent,
    },
  });

  // If dispute, auto-pause
  if (params.isDispute) {
    await pauseTask({ taskId: params.taskId, reason: "Customer dispute" });
  }
}

// ═══════════════════ Redis Dedup (reused from CollectFlow) ═══════════════════

/**
 * Check if a collection action was already performed today (dedup by invoice+stage+date)
 * Reused pattern from CollectFlow: Redis-first with graceful fallback
 */
export async function checkAndSetDedup(
  invoiceId: string,
  stage: CollectionStage,
  todayStr: string,
): Promise<boolean> {
  const dedupKey = `b2b:sweep:${invoiceId}:${stage}:${todayStr}`;
  try {
    const exists = await redis.get(dedupKey);
    if (exists) return true; // Already processed
    await redis.set(dedupKey, "1", "EX", 86400); // 24h TTL
    return false;
  } catch (e: unknown) {
    logger.app("WARN", "Redis dedup failed, proceeding without dedup", e instanceof Error ? e.message : String(e));
    return false; // Fail open — process anyway
  }
}
