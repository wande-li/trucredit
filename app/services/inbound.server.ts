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
 * Searches ALL customers matching the email across ALL shops,
 * then finds the most recently active task (within each customer's own shop).
 * Prevents cross-shop leakage: customer from shop A cannot match tasks from shop B.
 */
async function findTaskByEmail(fromEmail: string): Promise<{
  taskId: string | null;
  customerName: string | null;
}> {
  const customers = await prisma.customer.findMany({
    where: { email: fromEmail },
    select: { id: true, name: true, shopId: true },
  });

  if (customers.length === 0) {
    return { taskId: null, customerName: null };
  }

  // Single customer: simple lookup within their shop
  if (customers.length === 1) {
    const c = customers[0]!;
    const task = await prisma.collectionTask.findFirst({
      where: {
        customerId: c.id,
        status: { in: ["ACTIVE", "PAUSED", "ESCALATED"] },
      },
      orderBy: { lastReplyAt: { sort: "desc", nulls: "last" } },
      select: { id: true },
    });
    return { taskId: task?.id ?? null, customerName: c.name };
  }

  // Multiple customers across shops: find the most recently active task
  // by querying tasks for all matching customers in parallel, then picking
  // the one with latest activity.
  const tasksList = await Promise.all(
    customers.map((c) =>
      prisma.collectionTask.findFirst({
        where: {
          customerId: c.id,
          status: { in: ["ACTIVE", "PAUSED", "ESCALATED"] },
        },
        orderBy: { lastReplyAt: { sort: "desc", nulls: "last" } },
        select: { id: true, customerId: true, lastReplyAt: true },
      }),
    ),
  );

  // Find task with most recent lastReplyAt
  let bestTask: typeof tasksList[number] = null;
  let bestCustomer: (typeof customers)[number] | null = null;

  for (let i = 0; i < tasksList.length; i++) {
    const t = tasksList[i];
    if (!t) continue;
    if (!bestTask || (t.lastReplyAt && (!bestTask.lastReplyAt || t.lastReplyAt > bestTask.lastReplyAt))) {
      bestTask = t;
      bestCustomer = customers[i]!;
    }
  }

  return {
    taskId: bestTask?.id ?? null,
    customerName: bestCustomer?.name ?? null,
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
      // Find all customers with this email to scope invoice lookup by customerId.
      // customerId acts as the shop-scoping bridge: invoice → shop → customer.
      const emailCustomerIds = (
        await prisma.customer.findMany({
          where: { email: cleanFrom },
          select: { id: true },
        })
      ).map((c) => c.id);

      if (emailCustomerIds.length > 0) {
        const matchingTasks = await prisma.collectionTask.findMany({
          where: {
            customerId: { in: emailCustomerIds },
            invoice: { invoiceNumber: invRef },
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
