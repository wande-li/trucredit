# TruCredit — Shopify B2B Net Terms & Collections

B2B credit and AR collections app for Shopify. Let merchants offer net terms, manage credit limits, automate collections, and accept payments — all within Shopify.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Remix v2 + Express |
| UI | Polaris (Shopify Admin) + custom Portal |
| Database | PostgreSQL (Prisma ORM) |
| Cache | Redis (BullMQ workers) |
| AI | DeepSeek (email drafting + reply parsing) |
| Email | AWS SES |
| Billing | Shopify Managed Pricing |
| Payments | Shopify Draft Orders (native checkout) |

## Quick Start

```bash
npm install
npx prisma generate

# Dev (with dev shop)
set DEV_SHOP=your-dev-store.myshopify.com
set SHOPIFY_APP_URL=http://127.0.0.1:8080
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection (Railway auto-set) |
| `REDIS_URL` | Yes | Redis connection (Railway auto-set) |
| `SHOPIFY_API_KEY` | Yes | Shopify Partner Dashboard → App → API key |
| `SHOPIFY_API_SECRET` | Yes | Shopify Partner Dashboard → App → API secret |
| `SCOPES` | Yes | OAuth scopes (see shopify.app.toml) |
| `SHOPIFY_APP_URL` | Yes | App public URL (Railway auto-set) |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek AI API key |
| `ENCRYPTION_KEY` | Yes | 64-char hex string for AES-256-GCM |
| `AWS_ACCESS_KEY_ID` | Yes | AWS SES credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS SES credentials |
| `EMAIL_FROM` | Yes | Sender email address |
| `FEATURE_EMAIL_REPORTS` | No | Enable email notification features |

## Architecture

```
app/
  routes/           # Remix routes (loaders + actions + components)
    webhooks/        # Shopify webhook handlers (11 files)
    api.*.tsx        # Public API endpoints (inbound email, storefront)
    app.*.tsx        # Admin UI pages
    pay.$token.tsx   # Buyer payment portal
  services/          # Business logic (no route layer dependency)
  components/        # Shared React components
  lib/               # Infrastructure (redis, i18n, constants)
  workers/           # BullMQ workers (collection + email)
  styles/            # CSS (portal.css)
  locales/           # i18n translations (en.json)
  bootstrap.server.ts # App startup (seed, cron, workers)
  entry.server.tsx   # Remix SSR entry + health check
prisma/
  schema.prisma      # Database models + indexes
scripts/
  backup-db.ps1      # Daily DB backup (pg_dump)
  scan-large-files.mjs # File size audit
  start.mjs          # Production entry point
e2e/
  auth-flow.spec.ts  # Health check + auth tests (Playwright)
```

## Key Features

- **Credit Management**: Approve/reject credit applications, set limits, grade rules
- **Invoicing**: Create invoices linked to Shopify Draft Orders
- **AR Aging**: Real-time aging buckets with dashboard
- **Collections Engine**: Multi-step sequences, AI-generated emails
- **AI Reply Parser**: Auto-classify customer replies (promise-to-pay, dispute, etc.)
- **Buyer Portal**: Token-secured payment page (Shopify native checkout)
- **Webhooks**: Full lifecycle — orders, refunds, subscriptions, GDPR
- **Billing**: Shopify Managed Pricing with plan-based quotas

## Deployment

```bash
# Railway (auto-deploy from GitHub)
git push origin main

# Manual verify before push
npm run typecheck
npm run lint
node scripts/pre-deploy.ps1
```

## Health Check

`GET /health` returns DB + Redis status:
- `200` — all healthy
- `503` — degraded (DB or Redis down)

## Database Backup

```bash
pwsh scripts/backup-db.ps1 -DbUrl $env:DATABASE_URL -RetainDays 7
```

## Development Conventions

- No `any` types (ESLint `no-explicit-any: error`)
- No `console.log` (use `logger.server.ts`)
- All `catch` blocks: `catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); }`
- Data mutations: 100% `fetcher.submit()`, no bare `fetch()`
- Form data: `String(formData.get("x") ?? "")`, not `as string`
- All input validated through Zod schemas
