// Reply Processing Service — Orchestrates AI parsing + recording + auto-response
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import { parseCustomerReply } from "~/services/ai.server";
import type { ReplyIntent } from "@prisma/client";

// ═══════════════════ Types ═══════════════════

export interface ReplyProcessResult {
  success: boolean;
  taskId: string;
  intent: ReplyIntent;
  confidence: number;
  isDispute: boolean;
  summary: string;
  suggestedAction: string;
  canAutoResolve: boolean;
  autoResponse: string | null;
  eventId?: string;
  error?: string;
}

// ═══════════════════ Core Pipeline ═══════════════════

/**
 * Full reply processing pipeline:
 * 1. AI parse → intent + confidence + autoResponse
 * 2. Record reply as CollectionEvent
 * 3. If dispute → auto-pause task
 * 4. If canAutoResolve + high confidence → generate auto-response
 */
export async function processReply(params: {
  taskId: string;
  fromEmail: string;
  subject: string;
  body: string;
  emailMessageId?: string;
  invoiceContext?: {
    invoiceNumber: string;
    amount: string;
    dueDate: string;
    customerName: string;
  };
}): Promise<ReplyProcessResult> {
  const { taskId, fromEmail, subject, body, emailMessageId, invoiceContext } = params;

  // Step 1: Verify task exists and is active
  const task = await prisma.collectionTask.findUnique({
    where: { id: taskId },
    include: {
      invoice: {
        select: { invoiceNumber: true, amount: true, currency: true, dueDate: true, customerId: true },
      },
    },
  });

  if (!task) {
    return {
      success: false,
      taskId,
      intent: "UNRELATED",
      confidence: 0,
      isDispute: false,
      summary: "",
      suggestedAction: "",
      canAutoResolve: false,
      autoResponse: null,
      error: "Task not found",
    };
  }

  // Build invoice context from task if not provided
  const ctx = invoiceContext ?? (task.invoice
    ? {
        invoiceNumber: task.invoice.invoiceNumber,
        amount: `${task.invoice.amount} ${task.invoice.currency}`,
        dueDate: task.invoice.dueDate.toISOString().slice(0, 10),
        customerName: "Customer",
      }
    : undefined);

  // Step 2: AI parse the reply
  let parsed;
  try {
    parsed = await parseCustomerReply({
      fromEmail,
      subject,
      body,
      invoiceContext: ctx,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "AI reply parsing failed", { taskId, error: msg });
    // Still record as UNRELATED so nothing is lost
    parsed = {
      intent: "UNRELATED" as ReplyIntent,
      confidence: 0,
      isDispute: false,
      summary: "AI classification failed",
      suggestedAction: "Manual review required",
      canAutoResolve: false,
      autoResponse: null,
    };
  }

  // Step 3: Record reply as CollectionEvent
  let eventId: string | undefined;
  try {
    const event = await prisma.collectionEvent.create({
      data: {
        taskId,
        type: "REPLY_RECEIVED",
        emailSubject: subject,
        emailBody: body,
        emailMessageId,
        replyContent: body,
        replyIntent: parsed.intent,
        replyConfidence: parsed.confidence,
        aiAnalysis: {
          summary: parsed.summary,
          suggestedAction: parsed.suggestedAction,
          canAutoResolve: parsed.canAutoResolve,
          autoResponse: parsed.autoResponse,
          fromEmail,
        },
        actionTaken: parsed.isDispute ? "DISPUTE_TRIGGERED" : "REPLY_RECORDED",
      },
    });
    eventId = event.id;

    // Also record INTENT_DETECTED event for timeline clarity
    await prisma.collectionEvent.create({
      data: {
        taskId,
        type: "INTENT_DETECTED",
        replyIntent: parsed.intent,
        replyConfidence: parsed.confidence,
        aiAnalysis: { summary: parsed.summary },
        actionTaken: parsed.suggestedAction,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to record reply event", { taskId, error: msg });
    return {
      success: false,
      taskId,
      intent: parsed.intent,
      confidence: parsed.confidence,
      isDispute: parsed.isDispute,
      summary: parsed.summary,
      suggestedAction: parsed.suggestedAction,
      canAutoResolve: parsed.canAutoResolve,
      autoResponse: parsed.autoResponse,
      error: "Failed to record event",
    };
  }

  // Step 4: Update task reply tracking
  await prisma.collectionTask.update({
    where: { id: taskId },
    data: {
      lastReplyAt: new Date(),
      lastReplyIntent: parsed.intent,
    },
  });

  // Step 5: Handle dispute — auto-pause
  if (parsed.isDispute) {
    try {
      // P1-4: DB-level status guard — only pause active/pending tasks
      // Split into updateMany + event.create because updateMany doesn't support nested create
      await prisma.$transaction([
        prisma.collectionTask.updateMany({
          where: {
            id: taskId,
            status: { in: ["ACTIVE", "PENDING", "ESCALATED"] },
          },
          data: { status: "PAUSED" },
        }),
        prisma.collectionEvent.create({
          data: {
            taskId,
            type: "MANUAL_NOTE",
            actionTaken: `PAUSED: Customer dispute — ${parsed.summary}`,
          },
        }),
      ]);
      logger.app("INFO", "Task auto-paused due to dispute", { taskId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Failed to pause task on dispute", { taskId, error: msg });
    }

    // Update invoice status to DISPUTED if applicable
    if (task.invoiceId) {
      try {
        await prisma.invoice.update({
          where: { id: task.invoiceId },
          data: { status: "DISPUTED" },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "Failed to mark invoice as disputed", { invoiceId: task.invoiceId, error: msg });
      }
    }
  }

  // Step 6: Auto-resolve if applicable (high confidence, non-dispute)
  if (parsed.canAutoResolve && parsed.confidence >= 0.7 && !parsed.isDispute) {
    try {
      await prisma.collectionEvent.create({
        data: {
          taskId,
          type: "MANUAL_NOTE",
          actionTaken: `AUTO-RESOLVED: ${parsed.intent} — ${parsed.summary}`,
          aiGenerated: true,
        },
      });
      logger.app("INFO", "Task auto-resolved by AI", { taskId, intent: parsed.intent });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Failed to record auto-resolve", { taskId, error: msg });
    }
  }

  return {
    success: true,
    taskId,
    intent: parsed.intent,
    confidence: parsed.confidence,
    isDispute: parsed.isDispute,
    summary: parsed.summary,
    suggestedAction: parsed.suggestedAction,
    canAutoResolve: parsed.canAutoResolve,
    autoResponse: parsed.autoResponse,
    eventId,
  };
}

// ═══════════════════ Reply Queries ═══════════════════

/** List all reply events for a shop, paginated */
export async function listReplies(shopId: string, params?: {
  page?: number;
  pageSize?: number;
  intent?: ReplyIntent;
  status?: string; // "OPEN" | "RESOLVED" | "DISPUTED"
}) {
  const page = params?.page ?? 1;
  const pageSize = Math.min(params?.pageSize ?? 20, 100);

  const where: Record<string, unknown> = {
    task: { invoice: { shopId } },
    type: { in: ["REPLY_RECEIVED", "INTENT_DETECTED"] },
  };

  if (params?.intent) {
    where.replyIntent = params.intent;
  }

  const [items, total] = await Promise.all([
    prisma.collectionEvent.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma where composite
      where: where as any,
      include: {
        task: {
          include: {
            invoice: {
              select: { invoiceNumber: true, amount: true, currency: true, dueDate: true, customerId: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma where composite
    prisma.collectionEvent.count({ where: where as any }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Get full timeline events for a task */
export async function getTaskTimeline(taskId: string, shopId: string) {
  const task = await prisma.collectionTask.findFirst({
    where: { id: taskId, invoice: { shopId } },
    include: {
      sequence: { select: { id: true, name: true } },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          dueDate: true,
          status: true,
          customer: { select: { id: true, name: true, email: true } },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });

  return task;
}

/**
 * Manually resolve a reply (mark as handled by staff)
 */
export async function resolveReply(params: {
  eventId: string;
  taskId: string;
  shopId: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.collectionEvent.findFirst({
    where: { id: params.eventId, task: { id: params.taskId, invoice: { shopId: params.shopId } } },
  });

  if (!event) return { success: false, error: "Reply event not found" };

  await prisma.collectionEvent.create({
    data: {
      taskId: params.taskId,
      type: "MANUAL_NOTE",
      actionTaken: params.notes ? `MANUALLY_RESOLVED: ${params.notes}` : "MANUALLY_RESOLVED",
    },
  });

  return { success: true };
}
