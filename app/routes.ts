import type { RouteConfig } from "@remix-run/route-config";

// Flat routes 自动发现在此项目中不稳定，改为手动显式注册。
// 每次新增路由文件时在此处同步添加。
export default [
  // ── Auth ──
  { file: "routes/auth.$.tsx", id: "auth.$", path: "auth/*" },
  { file: "routes/auth.login.tsx", id: "auth.login", path: "auth/login" },

  // ── Legal ──
  { file: "routes/privacy.tsx", id: "privacy", path: "privacy" },
  { file: "routes/terms.tsx", id: "terms", path: "terms" },

  // ── Webhooks ──
  { file: "routes/webhooks.tsx", id: "webhooks", path: "webhooks" },

  // ── Billing ──
  { file: "routes/billing.callback.tsx", id: "billing.callback", path: "billing/callback" },

  // ── API ──
  { file: "routes/api.create-charge.tsx", id: "api.create-charge", path: "api/create-charge" },
  { file: "routes/api.credit-check.tsx", id: "api.credit-check", path: "api/credit-check" },
  { file: "routes/api.email-inbound.tsx", id: "api.email-inbound", path: "api/email-inbound" },
  { file: "routes/api.fix-plan.tsx", id: "api.fix-plan", path: "api/fix-plan" },
  { file: "routes/api.storefront-collect.tsx", id: "api.storefront-collect", path: "api/storefront-collect" },
  { file: "routes/api.sync-companies.tsx", id: "api.sync-companies", path: "api/sync-companies" },

  // ── App (layout + children) ──
  {
    file: "routes/app.tsx",
    id: "app",
    path: "app",
    children: [
      { file: "routes/app._index.tsx", id: "app._index", index: true },
      { file: "routes/app.settings.tsx", id: "app.settings", path: "settings" },
      { file: "routes/app.billing.tsx", id: "app.billing", path: "billing" },
      { file: "routes/app.tasks.tsx", id: "app.tasks", path: "tasks" },
      { file: "routes/app.replies.tsx", id: "app.replies", path: "replies" },
      // ── List + Detail routes ──
      { file: "routes/app.customers.tsx", id: "app.customers", path: "customers" },
      { file: "routes/app.customers.$id.tsx", id: "app.customers.$id", path: "customers/:id" },
      { file: "routes/app.invoices.tsx", id: "app.invoices", path: "invoices" },
      { file: "routes/app.invoices.new.tsx", id: "app.invoices.new", path: "invoices/new" },
      { file: "routes/app.invoices.$id.tsx", id: "app.invoices.$id", path: "invoices/:id" },
      { file: "routes/app.rules.tsx", id: "app.rules", path: "rules" },
      { file: "routes/app.rules.$id.tsx", id: "app.rules.$id", path: "rules/:id" },
      { file: "routes/app.collections.tsx", id: "app.collections", path: "collections" },
      { file: "routes/app.collections.$id.tsx", id: "app.collections.$id", path: "collections/:id" },
      { file: "routes/app.emails.tsx", id: "app.emails", path: "emails" },
      { file: "routes/app.emails.$id.tsx", id: "app.emails.$id", path: "emails/:id" },
    ],
  },
] satisfies RouteConfig;
