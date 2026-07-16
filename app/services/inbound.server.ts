// Inbound Email Service — Parses SES emails, matches to CollectionTasks
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import { enqueueReplyJob } from "~/queues/collection.queue";

// ═══════════════════ Types ═══════════════════

export interface InboundEmail {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
}

export interface InboundResult {
  success: boolean;
  matched: boolean;
  taskId?: string;
  customerName?: string;
  error?: string;
}

// ═══════════════════ Email Matching ═══════════════════

/**
 * Find active collection tasks for a customer by email.
 * Returns the most relevant task (by most recent activity).
 */
async function findTaskByEmail(fromEmail: string): Promise<{
  taskId: string | null;
  customerName: string | null;
}> {
  const customer = await prisma.customer.findFirst({
    where: { email: fromEmail },
    select: { id: true, name: true },
  });

  if (!customer) {
    return { taskId: null, customerName: null };
  }

  // Find the most recently active task for this customer
  const task = await prisma.collectionTask.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["ACTIVE", "PAUSED", "ESCALATED"] },
    },
    orderBy: { lastReplyAt: { sort: "desc", nulls: "last" } },
    select: { id: true },
  });

  return {
    taskId: task?.id ?? null,
    customerName: customer.name,
  };
}

/**
 * Try to extract invoice number from email subject/body
 * for more precise matching when a customer has multiple tasks.
 */
function extractInvoiceRef(subject: string, body: string): string | null {
  const patterns = [
    /INV[#-](\d+)/i,
    /Invoice\s*[#:]?\s*([A-Z0-9-]+)/i,
    /Re:\s*.*?([A-Z0-9-]+)/i,
  ];

  const text = `${subject}\n${body.slice(0, 500)}`;
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ═══════════════════ Core Pipeline ═══════════════════

/**
 * Process an inbound email from SES:
 * 1. Clean the FROM address
 * 2. Match to customer → active task
 * 3. Enqueue to reply queue for AI processing
 */
export async function processInboundEmail(email: InboundEmail): Promise<InboundResult> {
  const cleanFrom = extractEmailAddress(email.from);

  if (!cleanFrom) {
    logger.app("WARN", "Inbound email has no valid FROM address", undefined, {
      rawFrom: email.from,
      messageId: email.messageId,
    });
    return { success: false, matched: false, error: "No valid FROM address" };
  }

  // Try exact match first, then fallback to invoice reference
  let { taskId, customerName } = await findTaskByEmail(cleanFrom);

  if (!taskId) {
    // Try matching by invoice reference in subject
    const invRef = extractInvoiceRef(email.subject, email.body);
    if (invRef) {
      const matchingTasks = await prisma.collectionTask.findMany({
        where: {
          invoice: {
            invoiceNumber: invRef,
            customer: { email: cleanFrom },
          },
          status: { in: ["ACTIVE", "PAUSED", "ESCALATED"] },
        },
        orderBy: { lastReplyAt: { sort: "desc", nulls: "last" } },
        take: 1,
        select: {
          id: true,
          customer: { select: { name: true } },
        },
      });

      if (matchingTasks[0]) {
        taskId = matchingTasks[0].id;
        customerName = matchingTasks[0].customer.name;
      }
    }
  }

  if (!taskId) {
    logger.app("INFO", "Inbound email no active task matched", undefined, {
      cleanFrom,
      messageId: email.messageId,
    });
    return { success: true, matched: false };
  }

  // Enqueue to reply queue for async AI processing
  try {
    await enqueueReplyJob({
      taskId,
      fromEmail: cleanFrom,
      subject: email.subject,
      body: email.body,
      emailMessageId: email.messageId,
    });

    logger.app("INFO", "Inbound email matched and queued", undefined, {
      taskId,
      customerName,
      fromEmail: cleanFrom,
      messageId: email.messageId,
    });

    return { success: true, matched: true, taskId, customerName: customerName ?? undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to enqueue inbound email", { error: msg, taskId });
    return { success: false, matched: true, taskId, error: "Queue enqueue failed" };
  }
}

// ═══════════════════ Helpers ═══════════════════

/** Extract bare email from formats like "Name <email>" or "email" */
function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return raw.trim().toLowerCase();
}
