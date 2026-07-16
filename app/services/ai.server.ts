// AI Services — Prompt building, email generation, reply parsing
// Combines CollectFlow's prompt.server.ts + deepseek.server.ts patterns with B2B's aiComplete()
// CollectFlow → B2B: 7-stage tone definitions, reply intent classification, all prompt engineering

import { aiComplete } from "~/lib/deepseek.server";
import { logger } from "~/services/logger.server";
import type { CollectionStage, ToneLevel, GeneratedEmail, ParsedReply } from "~/types";
import type { ReplyIntent } from "@prisma/client";

// ═══════════════════ System Prompts ═══════════════════
// Reused from CollectFlow

const EMAIL_SYSTEM_PROMPT = `You are a professional B2B credit and collections assistant. Generate polite, firm, and effective payment reminder emails for business-to-business invoices. Output valid JSON with "subject" and "body" fields. Never use threatening language. Maintain a professional, collaborative tone appropriate for business relationships.`;

// 7-stage tone definitions — direct copy from CollectFlow's STAGE_TONES
const STAGE_TONES: Record<CollectionStage, string> = {
  STAGE_MINUS_7: "Friendly, warm reminder before the due date. No pressure. Helpful tone.",
  STAGE_PLUS_0: "Polite and gentle. Assume the invoice may have been overlooked. No blame.",
  STAGE_PLUS_7: "Firm but respectful. Mention the overdue status directly. Suggest contacting if there are issues.",
  STAGE_PLUS_14: "Professional and formal. Include specific overdue duration. Mention the account status.",
  STAGE_PLUS_30: "Serious and formal. State urgency clearly. Mention potential credit restrictions if unpaid.",
  STAGE_PLUS_60: "Final notice tone. Urgent and direct. Mention possible escalation or credit freeze.",
  STAGE_PLUS_90: "Collections referral tone. Very serious. Mention impact on business relationship and credit standing.",
};

// Reply intent classification prompt — direct copy from CollectFlow
const REPLY_INTENT_PROMPT = `You are an AI assistant for a B2B accounts receivable team. Analyze customer reply emails and classify them into one of these intents:

- WILL_PAY: Customer confirms they will pay by a specific date or soon
- ALREADY_PAID: Customer claims they already made the payment
- DISPUTE: Customer disputes the invoice (wrong amount, wrong product, unexpected charge)
- PAYMENT_PLAN: Customer wants to set up a payment plan or installment arrangement
- DELAY_REQUEST: Customer asks for more time to pay
- CANNOT_PAY: Customer states they cannot pay (financial difficulty)
- UNRELATED: Spam, out-of-office, or completely unrelated content

Also determine if this is a dispute.

Output JSON format:
{
  "intent": "WILL_PAY",
  "confidence": 0.92,
  "isDispute": false,
  "summary": "short 1-sentence summary",
  "suggestedAction": "what the AR team should do",
  "canAutoResolve": false,
  "autoResponse": null
}`;

// ═══════════════════ Email Generation ═══════════════════

/**
 * Generate a collection email using AI (DeepSeek)
 * Reused pattern from CollectFlow's generateEmail + buildPrompt
 */
export async function generateCollectionEmail(params: {
  stage: CollectionStage;
  toneLevel: ToneLevel;
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  paymentLink: string;
}): Promise<GeneratedEmail> {
  const tone = STAGE_TONES[params.stage] || "Professional and polite.";

  const systemPrompt = `${EMAIL_SYSTEM_PROMPT}\n\nTone for this email: ${tone}. Stage: ${params.stage}. Tone level: ${params.toneLevel}/7.`;

  const userPrompt = `Generate a B2B collection email with the following context:
- Customer: ${params.customerName}
- Company: ${params.companyName}
- Invoice: ${params.invoiceNumber}
- Amount: ${params.currency} ${params.amount}
- Due Date: ${params.dueDate}
- Days Overdue: ${params.daysOverdue > 0 ? params.daysOverdue + " days" : "Not yet due"}
- Payment Link: ${params.paymentLink}

Keep it to 3-4 paragraphs. Use the payment link placeholder naturally in the email body.`;

  try {
    const response = await aiComplete({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.7,
      maxTokens: 2048,
      responseFormat: "json_object",
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { subject: string; body: string };

    if (!parsed.subject || !parsed.body) {
      throw new Error("AI returned incomplete email (missing subject or body)");
    }

    return { subject: parsed.subject, body: parsed.body };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "AI generation failed", { stage: params.stage, invoice: params.invoiceNumber, error: msg });
    throw new Error(`Failed to generate collection email: ${msg}`);
  }
}

// ═══════════════════ Reply Parsing ═══════════════════

/**
 * Parse a customer's reply email — classify intent
 * Direct copy of CollectFlow's parseReplyEmail pattern
 */
export async function parseCustomerReply(params: {
  fromEmail: string;
  subject: string;
  body: string;
  invoiceContext?: {
    invoiceNumber: string;
    amount: string;
    dueDate: string;
    customerName: string;
  };
}): Promise<ParsedReply> {
  let context = `Email from: ${params.fromEmail}\nSubject: ${params.subject}\nBody: ${params.body}`;

  if (params.invoiceContext) {
    context = `Context: This reply is about invoice ${params.invoiceContext.invoiceNumber} (${params.invoiceContext.amount}, due ${params.invoiceContext.dueDate}) for customer ${params.invoiceContext.customerName}.\n\n${context}`;
  }

  try {
    const response = await aiComplete({
      system: REPLY_INTENT_PROMPT,
      user: context,
      temperature: 0.1,
      maxTokens: 1024,
      responseFormat: "json_object",
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as {
      intent: string;
      confidence: number;
      isDispute: boolean;
      summary: string;
      suggestedAction: string;
      canAutoResolve: boolean;
      autoResponse: string | null;
    };

    // Map AI intent string to Prisma enum
    const intent = mapToReplyIntent(parsed.intent);

    return {
      intent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      isDispute: Boolean(parsed.isDispute),
      summary: parsed.summary || "No summary available",
      suggestedAction: parsed.suggestedAction || "Manual review required",
      canAutoResolve: Boolean(parsed.canAutoResolve),
      autoResponse: parsed.autoResponse || null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Reply parsing failed, returning UNRELATED", { from: params.fromEmail, error: msg });
    return {
      intent: "UNRELATED",
      confidence: 0,
      isDispute: false,
      summary: "AI classification failed — manual review required",
      suggestedAction: "Manual review",
      canAutoResolve: false,
      autoResponse: null,
    };
  }
}

/**
 * Map AI output string to ReplyIntent enum
 */
function mapToReplyIntent(aiIntent: string): ReplyIntent {
  const map: Record<string, ReplyIntent> = {
    WILL_PAY: "WILL_PAY",
    ALREADY_PAID: "ALREADY_PAID",
    DISPUTE: "DISPUTE",
    PAYMENT_PLAN: "PAYMENT_PLAN",
    DELAY_REQUEST: "DELAY_REQUEST",
    CANNOT_PAY: "CANNOT_PAY",
    UNRELATED: "UNRELATED",
  };
  return map[aiIntent.toUpperCase()] ?? "UNRELATED";
}

// ═══════════════════ Credit Rule Evaluation ═══════════════════

/**
 * Evaluate a credit rule against a customer — for automatic credit decisions
 */
export async function evaluateCreditRule(params: {
  rule: {
    action: string;
    conditions: Record<string, unknown>;
    actionValue: Record<string, unknown>;
  };
  customer: {
    creditScore: number | null;
    onTimePaymentRate: number | null;
    totalOrders: number;
    avgPaymentDays: number | null;
  };
}): Promise<{ matched: boolean; action?: string; value?: Record<string, unknown> }> {
  const conditions = params.rule.conditions as Record<string, unknown>;
  let matched = true;

  // Check score threshold
  if (conditions.scoreBelow !== undefined && params.customer.creditScore !== null) {
    if (params.customer.creditScore >= Number(conditions.scoreBelow)) {
      matched = false;
    }
  }

  // Check payment rate threshold
  if (conditions.onTimeRateBelow !== undefined && params.customer.onTimePaymentRate !== null) {
    if (params.customer.onTimePaymentRate >= Number(conditions.onTimeRateBelow)) {
      matched = false;
    }
  }

  // Check order count
  if (conditions.minOrders !== undefined) {
    if (params.customer.totalOrders < Number(conditions.minOrders)) {
      matched = false;
    }
  }

  if (matched) {
    return {
      matched: true,
      action: params.rule.action,
      value: params.rule.actionValue as Record<string, unknown>,
    };
  }

  return { matched: false };
}
