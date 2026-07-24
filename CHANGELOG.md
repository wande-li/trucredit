# TruCredit Changelog

## [1.1.0] — 2026-07-24

### Added
- 122 unit tests (credit, billing, collection, constants) — Vitest
- GitHub Actions CI/CD pipeline (lint + typecheck + test + verify, Node 20/22)
- Playwright E2E golden path test (5 scenarios)
- `CHANGELOG.md` + version `1.1.0` in `package.json`
- `scripts/fix-plan.mjs` — CLI tool replacing the web-exposed endpoint

### Fixed
- **P0**: Removed `api.fix-plan.tsx` (hardcoded token + shop domain — security risk)
- **P1**: parseFloat NaN guard (5 locations: billing, rules, CustomerDetailModal, CreditLimitModal, invoices.new)
- **P1**: ORDERS_UPDATED webhook now syncs invoice amount for non-paid order updates
- **P1**: REFUNDS_CREATE webhook now writes CreditEvent audit trail
- **P1**: APP_UNINSTALLED webhook now clears customer metafields on uninstall
- **P1**: Collection task state machine — DB-level status guards on advanceTask/pauseTask/stopTask/escalateTask
- **P1**: DRAFT_ORDERS_DELETE + ORDERS_CANCELLED webhooks now set `voidedAt`
- **P2**: `hasFeature()` type/runtime mismatch fixed — now uses `PLAN_FEATURES` matrix
- **P2**: Dashboard loader — Redis cache (30s TTL) + eliminated duplicate `shop.findUnique`

### Changed
- `QuickTips.tsx` — data-driven: prioritizes tips based on user setup state (customers/invoices/rules/tasks)
- CI workflow includes `npx playwright install chromium` step

## [1.0.0] — Initial Release
- Shopify B2B Net Terms credit system
- Customer credit limits, risk grading, freezing
- Invoice creation, status tracking, AR aging
- Collection sequences with escalating tones
- AI-powered email replies
- Webhook-driven lifecycle: orders/create, orders/paid, orders/cancelled, refunds
- Managed Pricing billing integration
