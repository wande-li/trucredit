// BullMQ queue — Email delivery (lazy init to avoid crash when Redis unavailable)
import type { Queue as QueueType } from "bullmq";
import { logger } from "~/services/logger.server";
import { BULLMQ_PREFIX } from "~/lib/redis.server";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const defaultJobOptions = {
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
};

let _emailQueue: QueueType | null = null;
function getEmailQueue(): QueueType {
  if (!_emailQueue) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports
    const { Queue } = require("bullmq");
    _emailQueue = new Queue(`${BULLMQ_PREFIX}-email`, {
      connection: { url: REDIS_URL },
      defaultJobOptions,
    });
  }
  return _emailQueue!; // _emailQueue is always set above
}

// Lazy proxy: allows `emailQueue.name` and Worker usage without init crash
export const emailQueue = new Proxy({} as QueueType, {
  get(_, prop) {
    return Reflect.get(getEmailQueue(), prop);
  },
});

export interface EmailJobData {
  shopId: string;
  toEmail: string;
  templateType?: string;
  stage?: string;
  useAI?: boolean;
  toneLevel?: number;
  vars: {
    customerName: string;
    companyName?: string;
    invoiceNumber: string;
    amount: string;
    currency?: string;
    dueDate: string;
    daysOverdue: number;
    paymentLink?: string;
  };
  /** For CollectionEvent recording */
  taskId?: string;
  stepOrder?: number;
}

export async function enqueueEmail(data: EmailJobData) {
  try {
    const q = getEmailQueue();
    // P2-9: Deterministic jobId prevents duplicate emails on retry
    await q.add("send-email", data, {
      jobId: `email:${data.taskId ?? data.vars.invoiceNumber}:${data.stepOrder ?? 0}`,
    });
    logger.app("INFO", "Email job enqueued", {
      invoice: data.vars.invoiceNumber,
      to: data.toEmail,
      ai: data.useAI,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to enqueue email job", {
      invoice: data.vars.invoiceNumber,
      error: msg,
    });
  }
}
