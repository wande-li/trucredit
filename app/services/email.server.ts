// Email Template Service — Templates, filling engine, defaults, CRUD
// Reused from CollectFlow's templates.ts + templates.server.ts
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import type { TemplateType } from "@prisma/client";
import { PAGINATION } from "~/lib/constants";
import { fillTemplate, type TplDef, TEMPLATE_TYPE_LABELS } from "~/lib/email-utils";
import { sendTestEmail as sendTestEmailViaSES } from "~/services/email-delivery.server";

export { fillTemplate, type TplDef, TEMPLATE_TYPE_LABELS };

type TplKey = "BEFORE_DUE" | "ON_DUE" | "OVERDUE_7" | "OVERDUE_14" | "OVERDUE_30" | "OVERDUE_60" | "OVERDUE_90" | "PAYMENT_RECEIVED";

// 8 default email templates — adapted from CollectFlow for TruCredit
export const DEFAULT_TEMPLATES: Record<TplKey, TplDef> = {
  BEFORE_DUE: {
    subject: "Friendly reminder: Invoice {{invoiceNumber}} due on {{dueDate}}",
    body: `Dear {{customerName}},\n\nJust a friendly reminder that invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}.\n\nYou can view and pay your invoice here: {{paymentLink}}\n\nIf you have already made the payment, please disregard this message.\n\nThank you for your business!\n{{companyName}}`,
  },
  ON_DUE: {
    subject: "Payment Due Today: Invoice {{invoiceNumber}}",
    body: `Dear {{customerName}},\n\nThis is a reminder that invoice {{invoiceNumber}} for {{amount}} is due today, {{dueDate}}.\n\nPlease submit your payment: {{paymentLink}}\n\nIf payment has already been sent, thank you and please ignore this notice.\n\nBest regards,\n{{companyName}}`,
  },
  OVERDUE_7: {
    subject: "Overdue: Invoice {{invoiceNumber}} — {{daysOverdue}} days past due",
    body: `Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now {{daysOverdue}} days past due.\n\nWe understand oversights happen. Please submit payment at:\n{{paymentLink}}\n\nIf you need to discuss arrangements, please contact us.\n\nSincerely,\n{{companyName}}`,
  },
  OVERDUE_14: {
    subject: "Second Reminder: Invoice {{invoiceNumber}} — {{daysOverdue}} days overdue",
    body: `Dear {{customerName}},\n\nThis is our second notice regarding invoice {{invoiceNumber}} for {{amount}}, now {{daysOverdue}} days past due.\n\nPlease remit the outstanding balance: {{paymentLink}}\n\nIf there is a reason for the delay, please reach out.\n\n{{companyName}}`,
  },
  OVERDUE_30: {
    subject: "Urgent: Invoice {{invoiceNumber}} — {{daysOverdue}} days overdue",
    body: `Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now {{daysOverdue}} days past due. Despite previous reminders, we have not received payment.\n\nPlease remit immediately: {{paymentLink}}\n\nContinued non-payment may affect your credit terms.\n\nRegards,\n{{companyName}}`,
  },
  OVERDUE_60: {
    subject: "Final Notice: Invoice {{invoiceNumber}} — {{daysOverdue}} days overdue",
    body: `Dear {{customerName}},\n\nThis is a final notice. Invoice {{invoiceNumber}} for {{amount}} is {{daysOverdue}} days past due.\n\nUnless payment is received within 5 business days, your account may be placed on credit hold.\n\nPay now: {{paymentLink}}\n\n{{companyName}}`,
  },
  OVERDUE_90: {
    subject: "Credit Hold: Invoice {{invoiceNumber}} — {{daysOverdue}} days overdue",
    body: `Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is {{daysOverdue}} days past due. Your account has been placed on credit hold.\n\nNew orders on credit are suspended until the balance is resolved.\n\nPay online: {{paymentLink}}\n\n{{companyName}}`,
  },
  PAYMENT_RECEIVED: {
    subject: "Payment Received: Invoice {{invoiceNumber}} — Thank you!",
    body: `Dear {{customerName}},\n\nWe have received your payment of {{amount}} for invoice {{invoiceNumber}}. Thank you!\n\nYour account is in good standing.\n\nBest regards,\n{{companyName}}`,
  },
};

// Stage → template key mapping
export function stageToTemplateKey(stage: string): TplKey {
  const m: Record<string, TplKey> = {
    STAGE_MINUS_7: "BEFORE_DUE", STAGE_PLUS_0: "ON_DUE",
    STAGE_PLUS_7: "OVERDUE_7", STAGE_PLUS_14: "OVERDUE_14",
    STAGE_PLUS_30: "OVERDUE_30", STAGE_PLUS_60: "OVERDUE_60",
    STAGE_PLUS_90: "OVERDUE_90",
  };
  return m[stage] ?? "OVERDUE_7";
}

// Get shop custom template or fallback to default
export async function getTemplate(params: {
  shopId: string; type: TemplateType;
}): Promise<TplDef> {
  logger.app("INFO", "email.getTemplate START", null, { shopId: params.shopId, type: params.type });
  const custom = await prisma.emailTemplate.findFirst({
    where: { shopId: params.shopId, type: params.type },
  });
  if (custom) {
    logger.app("INFO", "email.getTemplate OK (custom)", null, { shopId: params.shopId, type: params.type });
    return { subject: custom.subject, body: custom.body };
  }

  const key = templateTypeToKey(params.type);
  logger.app("INFO", "email.getTemplate OK (default)", null, { shopId: params.shopId, type: params.type, key });
  return DEFAULT_TEMPLATES[key];
}

function templateTypeToKey(t: TemplateType): TplKey {
  const m: Record<string, TplKey> = {
    REMINDER_BEFORE_DUE: "BEFORE_DUE", REMINDER_ON_DUE: "ON_DUE",
    COLLECTION_GENTLE: "OVERDUE_7", COLLECTION_FIRM: "OVERDUE_14",
    COLLECTION_URGENT: "OVERDUE_30", COLLECTION_FINAL: "OVERDUE_60",
    PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  };
  return m[t] ?? "OVERDUE_7";
}

// ═══════════════════ Email Template CRUD ═══════════════════



/** List all email templates for a shop, paginated */
export async function listTemplates(shopId: string, params?: { page?: number; pageSize?: number }) {
  const page = params?.page ?? 1;
  const pageSize = Math.min(params?.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE, PAGINATION.MAX_PAGE_SIZE);
  logger.app("INFO", "email.listTemplates START", null, { shopId, page, pageSize });

  const [items, total] = await Promise.all([
    prisma.emailTemplate.findMany({
      where: { shopId },
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.emailTemplate.count({ where: { shopId } }),
  ]);

  logger.app("INFO", "email.listTemplates OK", null, { shopId, total, page });
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Get a single template by ID */
export async function getTemplateById(templateId: string, shopId: string) {
  logger.app("INFO", "email.getTemplateById START", null, { templateId, shopId });
  const result = await prisma.emailTemplate.findFirst({
    where: { id: templateId, shopId },
  });
  logger.app("INFO", "email.getTemplateById OK", null, { templateId, shopId, found: !!result });
  return result;
}

/** Create a new email template */
export async function createTemplate(params: {
  shopId: string;
  name: string;
  type: TemplateType;
  subject: string;
  body: string;
  toneLevel?: number;
  isDefault?: boolean;
}) {
  logger.app("INFO", "email.createTemplate START", null, { shopId: params.shopId, name: params.name, type: params.type });
  const result = await prisma.emailTemplate.create({
    data: {
      shopId: params.shopId,
      name: params.name,
      type: params.type,
      subject: params.subject,
      body: params.body,
      toneLevel: params.toneLevel,
      isDefault: params.isDefault ?? false,
    },
  });
  logger.app("INFO", "email.createTemplate OK", null, { shopId: params.shopId, templateId: result.id });
  return result;
}

/** Update an existing email template */
export async function updateTemplate(params: {
  templateId: string;
  shopId: string;
  name?: string;
  subject?: string;
  body?: string;
  toneLevel?: number;
  isActive?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  logger.app("INFO", "email.updateTemplate START", null, { templateId: params.templateId, shopId: params.shopId });
  const existing = await prisma.emailTemplate.findFirst({
    where: { id: params.templateId, shopId: params.shopId },
  });
  if (!existing) {
    logger.app("WARN", "email.updateTemplate — not found", null, { templateId: params.templateId, shopId: params.shopId });
    return { success: false, error: "Template not found" };
  }

  await prisma.emailTemplate.update({
    where: { id: params.templateId, shopId: params.shopId },
    data: {
      ...(params.name !== undefined && { name: params.name }),
      ...(params.subject !== undefined && { subject: params.subject }),
      ...(params.body !== undefined && { body: params.body }),
      ...(params.toneLevel !== undefined && { toneLevel: params.toneLevel }),
    },
  });

  logger.app("INFO", "email.updateTemplate OK", null, { templateId: params.templateId, shopId: params.shopId });
  return { success: true };
}

/** Delete a template */
export async function deleteTemplate(
  templateId: string,
  shopId: string,
): Promise<{ success: boolean; error?: string }> {
  logger.app("INFO", "email.deleteTemplate START", null, { templateId, shopId });
  const existing = await prisma.emailTemplate.findFirst({
    where: { id: templateId, shopId },
  });
  if (!existing) {
    logger.app("WARN", "email.deleteTemplate — not found", null, { templateId, shopId });
    return { success: false, error: "Template not found" };
  }

  await prisma.emailTemplate.delete({ where: { id: templateId, shopId } });
  logger.app("INFO", "email.deleteTemplate OK", null, { templateId, shopId });
  return { success: true };
}

/**
 * P3: Send a test email using a template preview
 */
export async function sendTestEmail(params: {
  shopId: string;
  templateId: string;
  testEmail: string;
}): Promise<{ success: boolean; error?: string }> {
  const { shopId, templateId, testEmail } = params;

  const template = await prisma.emailTemplate.findFirst({
    where: { id: templateId, shopId },
  });
  if (!template) return { success: false, error: "Template not found" };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return { success: false, error: "Invalid email address" };
  }

  // Send via SES delivery service
  try {
    const result = await sendTestEmailViaSES(testEmail, shopId);
    if (result.sent) {
      logger.app("INFO", "email.sendTestEmail OK", null, { shopId, templateId, testEmail, messageId: result.messageId });
      return { success: true };
    }
    logger.app("WARN", "email.sendTestEmail — delivery failed", result.error, { shopId, templateId });
    return { success: false, error: result.error || "Email delivery failed" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "email.sendTestEmail ERROR", msg, { shopId, templateId });
    return { success: false, error: msg };
  }
}

/** Seed default templates for a shop if none exist */
export async function ensureDefaultTemplates(shopId: string): Promise<void> {
  // Clean up orphaned domain-based templates (pre-fix: shopDomain was incorrectly used as shopId)
  const orphaned = await prisma.emailTemplate.deleteMany({
    where: { shopId: { contains: "." } },
  });
  if (orphaned.count > 0) {
    logger.app("INFO", "email.ensureDefaultTemplates — cleaned orphaned templates", null, { shopId, count: orphaned.count });
  }

  const count = await prisma.emailTemplate.count({ where: { shopId } });
  if (count > 0) {
    logger.app("INFO", "email.ensureDefaultTemplates — already exist", null, { shopId, count });
    return;
  }

  const defaults: Array<{ name: string; type: TemplateType; subject: string; body: string; toneLevel: number }> = [
    { name: "Before Due Reminder", type: "REMINDER_BEFORE_DUE", subject: DEFAULT_TEMPLATES.BEFORE_DUE.subject, body: DEFAULT_TEMPLATES.BEFORE_DUE.body, toneLevel: 2 },
    { name: "On Due Reminder", type: "REMINDER_ON_DUE", subject: DEFAULT_TEMPLATES.ON_DUE.subject, body: DEFAULT_TEMPLATES.ON_DUE.body, toneLevel: 3 },
    { name: "Gentle Collection (7d)", type: "COLLECTION_GENTLE", subject: DEFAULT_TEMPLATES.OVERDUE_7.subject, body: DEFAULT_TEMPLATES.OVERDUE_7.body, toneLevel: 3 },
    { name: "Firm Collection (14d)", type: "COLLECTION_FIRM", subject: DEFAULT_TEMPLATES.OVERDUE_14.subject, body: DEFAULT_TEMPLATES.OVERDUE_14.body, toneLevel: 4 },
    { name: "Urgent Collection (30d)", type: "COLLECTION_URGENT", subject: DEFAULT_TEMPLATES.OVERDUE_30.subject, body: DEFAULT_TEMPLATES.OVERDUE_30.body, toneLevel: 5 },
    { name: "Final Notice (60d)", type: "COLLECTION_FINAL", subject: DEFAULT_TEMPLATES.OVERDUE_60.subject, body: DEFAULT_TEMPLATES.OVERDUE_60.body, toneLevel: 6 },
    { name: "Payment Received", type: "PAYMENT_RECEIVED", subject: DEFAULT_TEMPLATES.PAYMENT_RECEIVED.subject, body: DEFAULT_TEMPLATES.PAYMENT_RECEIVED.body, toneLevel: 2 },
  ];

  try {
    await prisma.emailTemplate.createMany({
      data: defaults.map((d) => ({ ...d, shopId, isDefault: true })),
    });
    logger.app("INFO", "email.ensureDefaultTemplates OK", null, { shopId, count: defaults.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "email.ensureDefaultTemplates — seed failed", { shopId, error: msg });
  }
}
