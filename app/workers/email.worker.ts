// BullMQ Worker — Email delivery consumer
// Reads from email queue, calls SES + records CollectionEvent

import { Worker } from "bullmq";
import { logger } from "~/services/logger.server";
import { sendCollectionEmail } from "~/services/email-delivery.server";
import prisma from "~/db.server";
import type { TemplateType } from "@prisma/client";
import { emailQueue, type EmailJobData } from "~/queues/email.queue";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export function createEmailWorker(): Worker<EmailJobData> {
  // Startup SES health check
  const sesConfigured = !!(
    (process.env.AWS_REGION || process.env.AWS_SES_REGION) &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
  if (!sesConfigured) {
    logger.app("WARN", "SES not configured — emails will be queued but not sent. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SES_REGION.");
  }

  const worker = new Worker<EmailJobData>(
    emailQueue.name,
    async (job) => {
      const data = job.data;
      const logCtx = { invoice: data.vars.invoiceNumber, to: data.toEmail };

      logger.app("INFO", "Email worker: processing", undefined, logCtx);

      const result = await sendCollectionEmail({
        shopId: data.shopId,
        templateType: data.templateType as TemplateType | undefined,
        stage: data.stage,
        useAI: data.useAI,
        toneLevel: data.toneLevel,
        vars: data.vars,
        toEmail: data.toEmail,
        taskId: data.taskId,
        stepOrder: data.stepOrder,
      });

      // Record CollectionEvent if taskId provided
      if (data.taskId) {
        try {
          await prisma.collectionEvent.create({
            data: {
              taskId: data.taskId,
              type: "EMAIL_SENT",
              channel: "EMAIL",
              stepOrder: data.stepOrder ?? 1,
              toneLevel: data.toneLevel ?? 3,
              aiGenerated: data.useAI ?? false,
              emailSubject: result.subject,
              emailMessageId: result.messageId,
              actionTaken: result.sent ? "EMAIL_DELIVERED" : `EMAIL_FAILED: ${result.error || "Unknown"}`,
            },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Email worker: failed to record CollectionEvent", msg, {
            taskId: data.taskId,
          });
        }
      }

      if (!result.sent) {
        logger.app("WARN", "Email worker: send failed", result.error, logCtx);
        throw new Error(result.error || "Email send failed");
      }

      logger.app("INFO", "Email worker: delivered", undefined, {
        ...logCtx,
        messageId: result.messageId,
      });

      return result;
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    logger.app("ERROR", "Email job failed", err?.message, {
      data: job?.data,
      attempts: job?.attemptsMade,
    });
  });

  worker.on("completed", (job) => {
    if (job) {
      logger.app("INFO", `Email job ${job.id} completed`, undefined, {
        invoice: job.data.vars.invoiceNumber,
      });
    }
  });

  return worker;
}
