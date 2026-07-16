// BullMQ queue — Email delivery
import { Queue } from "bullmq";
import { logger } from "~/services/logger.server";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const PREFIX = "b2b";

const defaultJobOptions = {
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
};

export const emailQueue = new Queue(`${PREFIX}-email`, {
  connection: { url: REDIS_URL },
  defaultJobOptions,
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
    await emailQueue.add("send-email", data, {
      jobId: `email:${data.vars.invoiceNumber}:${Date.now()}`,
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
