// Email Delivery Service — AWS SES + template filling + AI generation
// Handles actual email sending for the collection engine

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "~/services/logger.server";
import { getTemplate, fillTemplate, stageToTemplateKey } from "~/services/email.server";
import { generateCollectionEmail } from "~/services/ai.server";
import type { TemplateType } from "@prisma/client";

// ═══════════════════ SES Client ═══════════════════

function getSESClient(): SESClient | null {
  const region = process.env.AWS_REGION || process.env.AWS_SES_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    logger.app("WARN", "SES not configured — emails will be logged but not sent");
    return null;
  }

  return new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// ═══════════════════ Types ═══════════════════

export interface SendCollectionEmailParams {
  /** Shop ID for template lookup */
  shopId: string;
  /** Override template type (defaults to stage-based) */
  templateType?: TemplateType;
  /** Collection stage for tone-aware AI generation */
  stage?: string;
  /** Whether to use AI (DeepSeek) instead of template */
  useAI?: boolean;
  /** Template variables */
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
  /** Recipient email */
  toEmail: string;
  /** Optional: record as CollectionEvent */
  taskId?: string;
  /** Step order in collection sequence */
  stepOrder?: number;
  /** Tone level 1-7 */
  toneLevel?: number;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  subject?: string;
  error?: string;
}

// ═══════════════════ Core Send ═══════════════════

/**
 * Send a collection email — fills template (or uses AI), sends via SES
 */
export async function sendCollectionEmail(
  params: SendCollectionEmailParams,
): Promise<SendEmailResult> {
  const ses = getSESClient();
  const fromEmail = process.env.FROM_EMAIL || process.env.SES_FROM_EMAIL || "noreply@example.com";
  const useAI = params.useAI ?? false;

  let subject: string;
  let body: string;

  // Warn if paymentLink is missing — critical CTA for collection emails
  if (!params.vars.paymentLink) {
    logger.app("WARN", "Collection email missing paymentLink — customer won't see pay CTA", undefined, {
      invoice: params.vars.invoiceNumber,
      customer: params.vars.customerName,
    });
  }

  try {
    if (useAI) {
      // AI-generated email
      const generated = await generateCollectionEmail({
        stage: (params.stage || "STAGE_PLUS_7") as import("~/types").CollectionStage,
        toneLevel: (params.toneLevel || 3) as import("~/types").ToneLevel,
        customerName: params.vars.customerName,
        companyName: params.vars.companyName || "Our Company",
        invoiceNumber: params.vars.invoiceNumber,
        amount: params.vars.amount,
        currency: params.vars.currency || "USD",
        dueDate: params.vars.dueDate,
        daysOverdue: params.vars.daysOverdue,
        paymentLink: params.vars.paymentLink || "",
      });
      subject = generated.subject;
      body = generated.body;
    } else {
      // Template-based email
      const tplType = params.templateType || stageToTemplateType(params.stage);
      const tpl = await getTemplate({ shopId: params.shopId, type: tplType });
      const fillVars: Record<string, string> = {
        customerName: params.vars.customerName,
        companyName: params.vars.companyName || "Our Company",
        invoiceNumber: params.vars.invoiceNumber,
        amount: params.vars.amount,
        dueDate: params.vars.dueDate,
        daysOverdue: String(params.vars.daysOverdue),
        paymentLink: params.vars.paymentLink || "",
      };
      const filled = fillTemplate(tpl, fillVars);
      subject = filled.subject;
      body = filled.body;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Email content generation failed", msg, { invoice: params.vars.invoiceNumber });
    return { sent: false, error: `Content generation failed: ${msg}` };
  }

  // Plain-text body (strip HTML if any)
  const textBody = body.replace(/<[^>]*>/g, "");

  // Send via SES
  if (ses) {
    try {
      const command = new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [params.toEmail] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: textBody, Charset: "UTF-8" },
            Html: { Data: body.replace(/\n/g, "<br>"), Charset: "UTF-8" },
          },
        },
      });

      const response = await ses.send(command);
      const messageId = response.MessageId;

      logger.app("INFO", "Collection email sent via SES", undefined, {
        to: params.toEmail,
        invoice: params.vars.invoiceNumber,
        messageId,
        aiGenerated: useAI,
        stage: params.stage,
      });

      return { sent: true, messageId, subject };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("ERROR", "SES send failed", msg, {
        to: params.toEmail,
        invoice: params.vars.invoiceNumber,
      });
      return { sent: false, error: `SES error: ${msg}`, subject };
    }
  }

  // No SES — log only (dev mode)
  logger.app("INFO", "Email (dry-run — no SES config)", undefined, {
    to: params.toEmail,
    subject,
    invoice: params.vars.invoiceNumber,
  });
  return { sent: false, error: "SES not configured — dry run only", subject };
}

/**
 * Send a test email to verify SES configuration
 */
export async function sendTestEmail(toEmail: string): Promise<SendEmailResult> {
  const ses = getSESClient();
  const fromEmail = process.env.FROM_EMAIL || "noreply@example.com";

  if (!ses) {
    return { sent: false, error: "SES not configured" };
  }

  try {
    const command = new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: "TruCredit — Test Email", Charset: "UTF-8" },
        Body: {
          Text: {
            Data: "This is a test email from TruCredit. Your SES configuration is working correctly.",
            Charset: "UTF-8",
          },
        },
      },
    });

    const response = await ses.send(command);
    return { sent: true, messageId: response.MessageId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sent: false, error: msg };
  }
}

// ═══════════════════ Helpers ═══════════════════

function stageToTemplateType(stage?: string): TemplateType {
  if (!stage) return "COLLECTION_GENTLE";
  const key = stageToTemplateKey(stage);
  const map: Record<string, TemplateType> = {
    BEFORE_DUE: "REMINDER_BEFORE_DUE",
    ON_DUE: "REMINDER_ON_DUE",
    OVERDUE_7: "COLLECTION_GENTLE",
    OVERDUE_14: "COLLECTION_FIRM",
    OVERDUE_30: "COLLECTION_URGENT",
    OVERDUE_60: "COLLECTION_FINAL",
    OVERDUE_90: "COLLECTION_FINAL",
  };
  return map[key] ?? "COLLECTION_GENTLE";
}
