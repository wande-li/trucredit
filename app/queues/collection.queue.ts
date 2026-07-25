// BullMQ queue definitions — Collection engine
import { Queue } from "bullmq";
import { logger } from "~/services/logger.server";
import { BULLMQ_PREFIX } from "~/lib/redis.server";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/** Default job options shared across all queues */
const defaultJobOptions = {
  removeOnComplete: { age: 86400 }, // Keep 24h
  removeOnFail: { age: 604800 },    // Keep 7d for debugging
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
};

// ═══════════════════ Queue Instances ═══════════════════

/** Daily sweep to check overdue invoices */
export const sweepQueue = new Queue(`${BULLMQ_PREFIX}-sweep`, {
  connection: { url: REDIS_URL },
  defaultJobOptions,
});

/** Process a single invoice — evaluate + create/advance task + send email */
export const invoiceQueue = new Queue(`${BULLMQ_PREFIX}-invoice`, {
  connection: { url: REDIS_URL },
  defaultJobOptions,
});

/** Process a customer email reply — AI parse + record + auto-respond */
export const replyQueue = new Queue(`${BULLMQ_PREFIX}-reply`, {
  connection: { url: REDIS_URL },
  defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
});

/** Score a customer's credit profile */
export const scoreQueue = new Queue(`${BULLMQ_PREFIX}-score`, {
  connection: { url: REDIS_URL },
  defaultJobOptions,
});

/** Check if any customers should be frozen based on rules */
export const freezeCheckQueue = new Queue(`${BULLMQ_PREFIX}-freeze`, {
  connection: { url: REDIS_URL },
  defaultJobOptions,
});

// ═══════════════════ Job Publish Helpers ═══════════════════

export async function enqueueReplyJob(params: {
  taskId: string;
  fromEmail: string;
  subject: string;
  body: string;
  emailMessageId?: string;
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  customerName?: string;
}) {
  try {
    // P2-9: Deterministic jobId prevents duplicate reply jobs
    await replyQueue.add("process-reply", params, {
      jobId: `reply:${params.taskId}`,
    });
    logger.app("INFO", "Reply job enqueued", { taskId: params.taskId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to enqueue reply job", { taskId: params.taskId, error: msg });
  }
}

export async function enqueueSweep() {
  try {
    await sweepQueue.add("daily-sweep", {}, { jobId: `sweep:${new Date().toISOString().slice(0, 10)}` });
    logger.app("INFO", "Daily sweep enqueued");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to enqueue sweep", msg);
  }
}

/**
 * Scan all active, non-frozen customers and enqueue freeze-check jobs.
 * This is the producer side — the worker (createFreezeCheckWorker) handles evaluation.
 */
export async function enqueueFreezeCheck() {
  try {
    const prisma = (await import("~/db.server")).default;
    const customers = await prisma.customer.findMany({
      where: { isFrozen: false, status: { not: "BLACKLISTED" } },
      select: { id: true, shopId: true },
    });

    let count = 0;
    for (const c of customers) {
      try {
        await freezeCheckQueue.add(
          "check-freeze",
          { customerId: c.id, shopId: c.shopId },
          { jobId: `freeze:${c.id}:${new Date().toISOString().slice(0, 10)}`, delay: 1000 * count },
        );
        count++;
      } catch (innerErr: unknown) {
        const imsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        logger.app("WARN", "Failed to enqueue freeze check for customer", { customerId: c.id, error: imsg });
      }
    }

    logger.app("INFO", "Freeze check sweep enqueued", { customerCount: count });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to enqueue freeze check sweep", msg);
  }
}
