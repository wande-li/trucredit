// Shared email utilities — safe for both client and server
// Pure functions only: no DB, no network, no .server imports

export interface TplDef { subject: string; body: string; }

/** Template variable interpolation — replaces {{key}} placeholders */
export function fillTemplate(tpl: TplDef, vars: Record<string, string>): TplDef {
  let { subject, body } = tpl;
  for (const [k, v] of Object.entries(vars)) {
    subject = subject.replaceAll(`{{${k}}}`, v);
    body = body.replaceAll(`{{${k}}}`, v);
  }
  return { subject, body };
}

/** Human-readable labels for email template types */
export const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  REMINDER_BEFORE_DUE: "Reminder — Before Due",
  REMINDER_ON_DUE: "Reminder — On Due",
  COLLECTION_GENTLE: "Collection — Gentle (7d)",
  COLLECTION_FIRM: "Collection — Firm (14d)",
  COLLECTION_URGENT: "Collection — Urgent (30d)",
  COLLECTION_FINAL: "Collection — Final (60d)",
  PAYMENT_RECEIVED: "Payment Received",
  CREDIT_APPROVED: "Credit Approved",
  CREDIT_FROZEN: "Credit Frozen",
  CUSTOM: "Custom",
};
