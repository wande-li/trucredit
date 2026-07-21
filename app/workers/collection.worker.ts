// BullMQ Workers — consume collection engine queues
// Registered in workers/index.ts, started alongside Remix server
import { Worker } from "bullmq";
import { logger } from "~/services/logger.server";
import { runCollectionSweep } from "~/services/collection.server";
import { processReply } from "~/services/reply.server";
import { recalculateCreditScore, freezeCustomer } from "~/services/customer.server";
import prisma from "~/db.server";
import {
  sweepQueue,
  invoiceQueue,
  replyQueue,
  scoreQueue,
  freezeCheckQueue,
} from "~/queues/collection.queue";
import { enqueueEmail } from "~/queues/email.queue";
import { createCollectionDraftOrder } from "~/services/invoice-ordering.server";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/** Map days overdue to collection stage string */
function daysToCollectionStage(daysOverdue: number): string {
  if (daysOverdue < 0) return "STAGE_MINUS_7";
  if (daysOverdue === 0) return "STAGE_PLUS_0";
  if (daysOverdue <= 7) return "STAGE_PLUS_7";
  if (daysOverdue <= 14) return "STAGE_PLUS_14";
  if (daysOverdue <= 30) return "STAGE_PLUS_30";
  if (daysOverdue <= 60) return "STAGE_PLUS_60";
  return "STAGE_PLUS_90";
}

interface InvoiceJob {
  invoiceId: string;
  sequenceId: string;
  stepOrder: number;
}

interface ReplyJob {
  taskId: string;
  fromEmail: string;
  subject: string;
  body: string;
  emailMessageId?: string;
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  customerName?: string;
}

interface ScoreJob {
  customerId: string;
  shopId: string;
}

interface FreezeJob {
  customerId: string;
  shopId: string;
}

// ═══════════════════ Sweep Worker ═══════════════════
export function createSweepWorker(): Worker {
  const worker = new Worker(
    sweepQueue.name,
    async (_job) => {
      logger.app("INFO", "Sweep worker starting");
      const result = await runCollectionSweep();
      logger.app("INFO", "Sweep worker complete", undefined, {
        shopsProcessed: result.shopsProcessed,
        invoicesMatched: result.invoicesMatched,
        emailsSent: result.emailsSent,
        tasksCreated: result.tasksCreated,
        tasksAdvanced: result.tasksAdvanced,
        errors: result.errors,
      });
      return result;
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.app("ERROR", "Sweep job failed", err?.message);
  });

  worker.on("completed", (job) => {
    if (job) logger.app("INFO", `Sweep job ${job.id} completed`);
  });

  return worker;
}

// ═══════════════════ Invoice Worker ═══════════════════
export function createInvoiceWorker(): Worker<InvoiceJob> {
  const worker = new Worker<InvoiceJob>(
    invoiceQueue.name,
    async (job) => {
      const { invoiceId, sequenceId, stepOrder } = job.data;
      const logCtx = { invoiceId, sequenceId, stepOrder };

      const [invoice, sequence] = await Promise.all([
        prisma.invoice.findUnique({
          where: { id: invoiceId },
          include: { customer: true, shop: { select: { id: true, shopDomain: true } } },
        }),
        prisma.collectionSequence.findUnique({
          where: { id: sequenceId },
          include: { steps: { orderBy: { order: "asc" } } },
        }),
      ]);

      if (!invoice) {
        logger.app("WARN", "Invoice worker: invoice not found", undefined, logCtx);
        return { skipped: true, reason: "Invoice not found" };
      }
      if (!sequence) {
        logger.app("WARN", "Invoice worker: sequence not found", undefined, logCtx);
        return { skipped: true, reason: "Sequence not found" };
      }
      if (!invoice.customer) {
        logger.app("WARN", "Invoice worker: customer not found", undefined, logCtx);
        return { skipped: true, reason: "Customer not found" };
      }
      if (invoice.customer.isFrozen) {
        return { skipped: true, reason: "Customer frozen" };
      }

      const step = sequence.steps[stepOrder - 1];
      if (!step) {
        logger.app("WARN", "Invoice worker: step not found", undefined, logCtx);
        return { skipped: true, reason: `Step ${stepOrder} not found` };
      }

      const existingTask = await prisma.collectionTask.findFirst({
        where: {
          invoiceId,
          sequenceId,
          status: { in: ["PENDING", "ACTIVE", "PAUSED"] },
        },
      });

      if (!existingTask) {
        const created = await prisma.collectionTask.create({
          data: {
            sequenceId,
            customerId: invoice.customerId,
            invoiceId,
            status: "ACTIVE",
            currentStep: stepOrder,
            nextStepAt: new Date(),
            startedAt: new Date(),
          },
        });

        // P1-2: Dedup — check if event for this task+step already exists (retry safety)
        const existingEvent = await prisma.collectionEvent.findFirst({
          where: { taskId: created.id, stepOrder, type: "EMAIL_SENT" },
        });
        if (!existingEvent) {
          await prisma.collectionEvent.create({
            data: {
              taskId: created.id,
              type: "EMAIL_SENT",
              channel: step.channel,
              stepOrder,
              toneLevel: step.toneLevel,
              aiGenerated: step.useAI,
            },
          });
        }

        // Enqueue actual email delivery
        const daysOverdue = Math.floor(
          (Date.now() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const shopId = invoice.shop?.id ?? "";
        const shopDomain = invoice.shop?.shopDomain ?? "";
        const paymentLink = (invoice as Record<string, unknown>).paymentUrl as string
          || (shopDomain
            ? `https://${shopDomain}/account/orders/${invoice.shopifyOrderName || invoice.invoiceNumber}`
            : undefined);
        await enqueueEmail({
          shopId,
          toEmail: invoice.customer.email,
          stage: daysToCollectionStage(daysOverdue),
          useAI: step.useAI,
          toneLevel: step.toneLevel,
          vars: {
            customerName: invoice.customer.name,
            companyName: invoice.customer.company ?? undefined,
            invoiceNumber: invoice.invoiceNumber,
            amount: String(invoice.amount),
            currency: invoice.currency,
            dueDate: invoice.dueDate.toISOString().slice(0, 10),
            daysOverdue,
            paymentLink,
          },
          taskId: created.id,
          stepOrder,
        });

        // P1: Create Shopify native draft order at later collection stages (30+ days)
        if (stepOrder >= 4 && invoice.shop?.id && invoice.customer.shopifyCustomerId) {
          void createCollectionDraftOrder({
            shopId: invoice.shop.id,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: Number(invoice.amount),
            currency: invoice.currency,
            customerEmail: invoice.customer.email,
            shopifyCustomerId: invoice.customer.shopifyCustomerId,
          }).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            logger.app("WARN", "Collection draft order failed (new task)", msg, logCtx);
          });
        }

        logger.app("INFO", "Invoice worker: task created + email queued", undefined, {
          ...logCtx,
          customerName: invoice.customer.name,
        });
        return { created: true, step: stepOrder };
      }

      if (existingTask.currentStep < stepOrder) {
        await prisma.collectionTask.update({
          where: { id: existingTask.id },
          data: {
            currentStep: stepOrder,
            nextStepAt: new Date(),
          },
        });

        // P1-2: Dedup — check before creating advance event
        const existingAdvanceEvent = await prisma.collectionEvent.findFirst({
          where: { taskId: existingTask.id, stepOrder, type: "EMAIL_SENT" },
        });
        if (!existingAdvanceEvent) {
          await prisma.collectionEvent.create({
            data: {
              taskId: existingTask.id,
              type: "EMAIL_SENT",
              channel: step.channel,
              stepOrder,
              toneLevel: step.toneLevel,
              aiGenerated: step.useAI,
            },
          });
        }

        // Enqueue actual email delivery
        const daysOverdue = Math.floor(
          (Date.now() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const shopId = invoice.shop?.id ?? "";
        const shopDomain = invoice.shop?.shopDomain ?? "";
        const paymentLink = (invoice as Record<string, unknown>).paymentUrl as string
          || (shopDomain
            ? `https://${shopDomain}/account/orders/${invoice.shopifyOrderName || invoice.invoiceNumber}`
            : undefined);
        await enqueueEmail({
          shopId,
          toEmail: invoice.customer.email,
          stage: daysToCollectionStage(daysOverdue),
          useAI: step.useAI,
          toneLevel: step.toneLevel,
          vars: {
            customerName: invoice.customer.name,
            companyName: invoice.customer.company ?? undefined,
            invoiceNumber: invoice.invoiceNumber,
            amount: String(invoice.amount),
            currency: invoice.currency,
            dueDate: invoice.dueDate.toISOString().slice(0, 10),
            daysOverdue,
            paymentLink,
          },
          taskId: existingTask.id,
          stepOrder,
        });

        // P1: Create Shopify native draft order at later collection stages (30+ days)
        if (stepOrder >= 4 && shopId && invoice.customer.shopifyCustomerId) {
          void createCollectionDraftOrder({
            shopId,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: Number(invoice.amount),
            currency: invoice.currency,
            customerEmail: invoice.customer.email,
            shopifyCustomerId: invoice.customer.shopifyCustomerId,
          }).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            logger.app("WARN", "Collection draft order failed (task advance)", msg, logCtx);
          });
        }

        logger.app("INFO", "Invoice worker: task advanced + email queued", undefined, {
          ...logCtx,
          from: existingTask.currentStep,
          to: stepOrder,
        });
        return { advanced: true, from: existingTask.currentStep, to: stepOrder };
      }

      return { skipped: true, reason: "Already at or past this step" };
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    logger.app("ERROR", "Invoice job failed", err?.message, {
      data: job?.data,
    });
  });

  return worker;
}

// ═══════════════════ Reply Worker ═══════════════════
export function createReplyWorker(): Worker<ReplyJob> {
  const worker = new Worker<ReplyJob>(
    replyQueue.name,
    async (job) => {
      const { taskId, fromEmail, subject, body, emailMessageId } = job.data;

      const result = await processReply({
        taskId,
        fromEmail,
        subject,
        body,
        emailMessageId,
      });

      logger.app("INFO", "Reply worker: processed", undefined, {
        taskId,
        intent: result.intent,
        confidence: result.confidence,
        canAutoResolve: result.canAutoResolve,
      });

      return result;
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 3,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.app("ERROR", "Reply job failed", err?.message);
  });

  return worker;
}

// ═══════════════════ Score Worker ═══════════════════
export function createScoreWorker(): Worker<ScoreJob> {
  const worker = new Worker<ScoreJob>(
    scoreQueue.name,
    async (job) => {
      const { customerId, shopId } = job.data;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId, shopId },
      });
      if (!customer) return { skipped: true, reason: "Customer not found" };

      await recalculateCreditScore({
        customerId,
        shopId,
        triggeredBy: "score-worker",
      });

      logger.app("INFO", "Score worker: scored", undefined, { customerId });
      return { scored: true };
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 2,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.app("ERROR", "Score job failed", err?.message);
  });

  return worker;
}

// ═══════════════════ Freeze Check Worker ═══════════════════
export function createFreezeCheckWorker(): Worker<FreezeJob> {
  const worker = new Worker<FreezeJob>(
    freezeCheckQueue.name,
    async (job) => {
      const { customerId, shopId } = job.data;

      try {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId, shopId },
        });
        if (!customer) return { skipped: true, reason: "Customer not found" };
        if (customer.isFrozen) return { skipped: true, reason: "Already frozen" };

        // Load credit rules — conditions are stored as JSON
        const rules = await prisma.creditRule.findMany({
          where: { shopId, isActive: true },
        });

        let shouldFreeze = false;
        let freezeReason = "";

        for (const rule of rules) {
          const conditions = rule.conditions as Record<string, unknown> | null;
          if (!conditions) continue;

          let ruleMatch = false;

          // Parse conditions JSON — supports "overdueAmountExceeds" and "maxOverdueDays"
          if (conditions.overdueAmountExceeds !== undefined) {
            const threshold = Number(conditions.overdueAmountExceeds);
            const totalOverdue = await prisma.invoice.aggregate({
              where: { customerId, shopId, status: "OVERDUE" },
              _sum: { amount: true },
            });
            const overdueAmt = Number(totalOverdue._sum.amount ?? 0);
            if (threshold > 0 && overdueAmt > threshold) {
              ruleMatch = true;
              freezeReason = `Overdue amount $${overdueAmt.toFixed(2)} exceeds threshold $${threshold.toFixed(2)}`;
            }
          }

          if (!ruleMatch && conditions.maxOverdueDays !== undefined) {
            const threshold = Number(conditions.maxOverdueDays);
            const oldestOverdue = await prisma.invoice.findFirst({
              where: { customerId, shopId, status: "OVERDUE" },
              orderBy: { dueDate: "asc" },
            });
            if (oldestOverdue) {
              const daysOverdue = Math.floor(
                (Date.now() - oldestOverdue.dueDate.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (threshold > 0 && daysOverdue > threshold) {
                ruleMatch = true;
                freezeReason = `Max overdue ${daysOverdue} days exceeds threshold ${threshold}`;
              }
            }
          }

          if (ruleMatch) {
            shouldFreeze = true;
            break;
          }
        }

        if (shouldFreeze) {
          await freezeCustomer({
            shopId,
            customerId,
            reason: freezeReason,
            triggeredBy: "freeze-check-worker",
          });

          await prisma.creditEvent.create({
            data: {
              customerId,
              type: "FROZEN",
              reason: freezeReason,
              triggeredBy: "freeze-check-worker",
            },
          });

          logger.app("INFO", "Freeze worker: customer frozen", undefined, {
            customerId,
            reason: freezeReason,
          });
          return { frozen: true, reason: freezeReason };
        }

        return { frozen: false };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("ERROR", "Freeze check worker failed for customer", msg, { customerId, shopId });
        return { error: true, message: msg };
      }
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 3,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.app("ERROR", "Freeze job failed", err?.message);
  });

  return worker;
}

// ═══════════════════ Start All ═══════════════════
export function startCollectionWorkers() {
  const hasRedis = !!process.env.REDIS_URL;
  if (!hasRedis) {
    logger.app("WARN", "REDIS_URL not configured, workers not started");
    return null;
  }

  try {
    const workers = {
      sweep: createSweepWorker(),
      invoice: createInvoiceWorker(),
      reply: createReplyWorker(),
      score: createScoreWorker(),
      freeze: createFreezeCheckWorker(),
    };

    logger.app("INFO", "Collection workers started", undefined, {
      sweep: "active",
      invoice: "active",
      reply: "active",
      score: "active",
      freeze: "active",
    });

    return workers;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Failed to start collection workers", msg);
    return null;
  }
}
