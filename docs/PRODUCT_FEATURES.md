# TruCredit — Product Feature Guide

> B2B Net Terms & AR Collections App for Shopify  
> Current Version: v1.0 | Date: 2026-07-27

---

## 1. Credit Management

| Feature | Description | File |
|---------|-------------|------|
| Auto Credit Limit Calculation | AI-powered credit scoring based on order history, payment behavior, and risk profile | `services/credit.server.ts` |
| Manual Credit Limit Adjustment | Admin/Manager can override or lock credit limits per customer | `components/credit/CreditLimitModal.tsx` |
| Credit Risk Grading | A/B/C/D grade auto-classification with visual badges | `components/credit/CustomerStatusBadge.tsx` |
| Credit Checkout Interception | Real-time credit validation at Shopify checkout — blocks orders exceeding available credit | `services/checkout.server.ts`, `api.storefront-collect.tsx` |
| Credit Event History | Full audit trail of credit limit changes with reason tracking | `services/credit.server.ts`, `app.customers.$id.tsx` |
| Metafield Sync | Two-way sync of credit data between TruCredit and Shopify customer metafields | `services/metafield.server.ts` |

## 2. Customer Management

| Feature | Description | File |
|---------|-------------|------|
| Customer Directory | Paginated list with search, filter (by status/risk), sort, and inline stats | `app.customers.tsx` |
| Customer Detail | Full profile: contact info, credit summary, invoice list, AR aging, email history, credit events | `app.customers.$id.tsx`, `components/credit/CustomerDetailModal.tsx` |
| CSV Export | One-click export filtered customer list to CSV | `api.customers.export.csv.tsx` |
| Customer Sync | Bidirectional sync with Shopify customers (auto on create/update/delete webhooks) | `services/sync.server.ts`, `webhooks.tsx` |
| Company Auto-linking | Automatic company dedup and linking by domain/shop | `services/company.server.ts` |

## 3. Invoice Management

| Feature | Description | File |
|---------|-------------|------|
| Invoice List | Full list with status filter (open/overdue/paid/void), aging columns, overdue indicators | `app.invoices.tsx` |
| Create Invoice | Multi-line item creation with due date, notes, auto customer lookup | `app.invoices.new.tsx` |
| Invoice Detail | Line items, payment history, PDF generation, email status, activity log | `app.invoices.$id.tsx` |
| Invoice PDF | Generate branded PDF invoice with company info, line items, terms | `api.invoices.$id.pdf.tsx`, `services/pdf.server.ts` |
| Statement PDF | Multi-invoice account statement per customer | `api.statements.$customerId.pdf.tsx` |
| CSV Export | Export filtered invoice data | `api.invoices.export.csv.tsx` |
| Custom Ordering | Drag-and-drop reorder of invoice line items | `services/invoice-ordering.server.ts` |
| Status Tracking | Auto-managed status lifecycle: open → overdue (based on due date) | `services/invoice.server.ts` |

## 4. Collections Engine

| Feature | Description | File |
|---------|-------------|------|
| Collection Dashboard | AR aging summary (0-30/31-60/61-90/90+), overdue KPI, top delinquent accounts | `app.collections.tsx` |
| Collection Detail | Per-customer collection workflow: payment promises, notes, call log, timeline | `app.collections.$id.tsx` |
| Task Queue | Automated collection task generation + manual task management with priority assignment | `app.tasks.tsx`, `queues/collection.queue.ts` |
| Collection Worker | Background worker processing overdue detection → auto-escalation → task creation → email triggers | `workers/collection.worker.ts` |
| Rate Limiting | Per-customer email frequency control to prevent spamming | `services/rate-limit.server.ts` |
| Sweep Processing | Periodic AR sweep with idempotent lock to prevent duplicate processing | `services/collection.server.ts` |

## 5. AI-Powered Email

| Feature | Description | File |
|---------|-------------|------|
| AI Email Generation | DeepSeek AI generates collection emails with tone customization (friendly/firm/legal) | `services/ai.server.ts` |
| Email Composer | Rich compose UI with AI draft, template selection, manual editing, preview | `app.emails.$id.tsx` |
| Email History | Per-customer email timeline with open/click/bounce tracking | `app.emails.tsx` |
| Smart Reply Engine | AI generates context-aware reply suggestions for customer responses | `services/reply.server.ts`, `app.replies.tsx` |
| Inbound Email Processing | AWS SES inbound → SNS → webhook → reply parsing + auto-categorization | `api.email-inbound.tsx`, `services/inbound.server.ts` |
| Email Queue | BullMQ-backed reliable async email delivery with retry | `queues/email.queue.ts` |
| Email Worker | Background email sender via AWS SES with rate limiting | `workers/email.worker.ts` |
| Email Templates | Editable HTML/text templates with variable interpolation | `services/email.server.ts` |
| Delivery Tracking | SES send/open/click webhook processing | `services/email-delivery.server.ts` |

## 6. Automation Rules

| Feature | Description | File |
|---------|-------------|------|
| Collection Rules | Configurable rule engine: trigger (days overdue/missed payment) → action (send email/flag account/escalate) | `app.rules.tsx` |
| Rule Templates | Pre-built rule templates for common collection workflows (first reminder, final notice, legal escalation) | `services/credit-rule.server.ts` |
| Rule Management | Create/edit/delete custom rules with conditions and actions | `app.rules.$id.tsx` |
| Global Settings | Company-wide defaults: payment terms, late fee %, grace period, email sender name | `app.settings.tsx` |

## 7. Dashboard & Analytics

| Feature | Description | File |
|---------|-------------|------|
| KPI Dashboard | Total AR, overdue %, collection rate, avg days to pay, at-risk accounts, trend sparklines | `app._index.tsx` |
| AR Aging Chart | Visual aging breakdown with color-coded bars | `app._index.tsx` |
| Quick Actions | One-click: new invoice, view overdue, send reminders, export statements | `app._index.tsx` |
| Redis Cache | Dashboard data cached with TTL + invalidation on data change | `app._index.tsx` (loader) |

## 8. Security & RBAC

| Feature | Description | File |
|---------|-------------|------|
| Role-Based Access | 4 roles: Admin, Manager, Collector, Viewer — with granular permissions | `services/rbac.server.ts` |
| Permission System | View / Edit / Export / Send Email / Manage Collections — per-page enforcement | `app.customers.tsx`, `app.invoices.tsx`, etc. |
| Tenant Isolation | All database queries filtered by shopId — zero cross-tenant data leak | All Prisma queries |
| Plan Gating | Paid features gated in both loader (data) and action (write) layers | All `app.*` routes |
| Shopify OAuth | Standard Shopify OAuth flow with session management | `auth.$.tsx`, `auth.login.tsx` |

## 9. System Integration

| Feature | Description | File |
|---------|-------------|------|
| Webhook Hub | Central webhook handler for 14 Shopify events | `webhooks.tsx` |
| GDPR Compliance | customers/data_request, customers/redact, shop/redact handlers | `webhooks.tsx` |
| App Uninstall | Cleanup: delete shop data, invalidate Redis cache, unsubscribe webhooks | `webhooks.tsx` |
| Managed Pricing | Shopify Billing API integration with plan-based pricing | `billing.callback.tsx`, `api.create-charge.tsx`, `services/billing.server.ts` |
| Privacy & Terms | GDPR-compliant privacy policy + terms of service pages | `privacy.tsx`, `terms.tsx` |

## 10. Platform Infrastructure

| Feature | Description | File |
|---------|-------------|------|
| Redis Cache | Dashboard + credit score caching, distributed locks for sweep/idempotent ops | `lib/redis.server.ts` |
| BullMQ Job Queue | Reliable async processing for emails and collections | `queues/index.ts` |
| PostgreSQL | Prisma ORM, full schema: Customer, Invoice, CreditEvent, CollectionTask, Email, Rule, Shop, Plan | `prisma/schema.prisma` |
| Railway Deploy | CI/CD via `railway up`, Postgres + Redis volumes | `.env`, `railway.json` |
| Error Boundaries | Per-route ErrorBoundary with user-friendly messages | All `app.*.tsx` routes |
| Loading States | HydrateFallback for every route | All `app.*.tsx` routes |

## 11. API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/credit-check` | POST | Public | Checkout credit validation |
| `/api/storefront-collect` | POST | Public | Storefront credit event capture |
| `/api/email-inbound` | POST | SNS | AWS SES inbound email handler |
| `/api/create-charge` | POST | Admin | Shopify billing charge creation |
| `/api/invoices/export.csv` | GET | Admin | CSV invoice export |
| `/api/invoices/:id.pdf` | GET | Admin | Invoice PDF generation |
| `/api/customers/export.csv` | GET | Admin | CSV customer export |
| `/api/statements/:id.pdf` | GET | Admin | Statement PDF generation |
| `/api/sync-companies` | POST | Admin | Company sync trigger |
| `/api/permissions` | GET | Admin | User permissions lookup |
| `/api/team-members` | GET | Admin | Team member list |

---

## Summary

| Category | Count |
|----------|-------|
| User-facing pages | 15 |
| API endpoints | 11 |
| Backend services | 21 |
| Webhook events | 14 |
| Background workers | 2 |
| Components | 4 |
