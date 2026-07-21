import { ApiVersion } from "@shopify/shopify-app-remix/server";

// Shopify API version — must match shopify.server.ts
export const SHOPIFY_API_VERSION = ApiVersion.October25;

// App Handle — must match shopify.app.toml
export const APP_HANDLE = "trucredit";

/** Shopify Managed Pricing — redirect to plan selection page.
 *  Official URL format per Shopify docs:
 *  https://admin.shopify.com/store/{store-handle}/charges/{app-handle}/pricing_plans
 *
 *  Using window.top.location.href is the only reliable way for embedded apps
 *  to escape the iframe; redirect() / open() / shopify:// are all unreliable.
 */
export function pricingPageUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

// Plan quotas — maps to Prisma Plan enum
export const PLAN_QUOTAS = {
  FREE:       { customers: 5,  invoices: 10 },
  STARTER:    { customers: 50, invoices: 100 },
  PRO:        { customers: 200, invoices: 500 },
  ENTERPRISE: { customers: Infinity, invoices: Infinity },
  // @deprecated — retained for backward compat, maps to STARTER quotas
  GROWTH:     { customers: 50, invoices: 100 },
} as const;

// Type-safe plan helper
export type PlanKey = keyof typeof PLAN_QUOTAS;

/** Feature flags per plan — keys match features in plan comparison UI */
export const PLAN_FEATURES = {
  basicCreditScoring:   { FREE: true, STARTER: true, PRO: true, ENTERPRISE: true, GROWTH: true },
  advancedCreditScoring:{ FREE: false, STARTER: true, PRO: true, ENTERPRISE: true, GROWTH: true },
  manualCollections:    { FREE: true, STARTER: true, PRO: true, ENTERPRISE: true, GROWTH: true },
  automatedCollections: { FREE: false, STARTER: true, PRO: true, ENTERPRISE: true, GROWTH: true },
  aiEmailGeneration:    { FREE: false, STARTER: true, PRO: true, ENTERPRISE: true, GROWTH: true },
  replyClassification:  { FREE: false, STARTER: false, PRO: true, ENTERPRISE: true, GROWTH: false },
  autoSequences:        { FREE: false, STARTER: false, PRO: true, ENTERPRISE: true, GROWTH: false },
  customRules:          { FREE: false, STARTER: false, PRO: false, ENTERPRISE: true, GROWTH: false },
  prioritySupport:      { FREE: false, STARTER: false, PRO: true, ENTERPRISE: true, GROWTH: false },
  dedicatedSupport:     { FREE: false, STARTER: false, PRO: false, ENTERPRISE: true, GROWTH: false },
  customPaymentGateway: { FREE: false, STARTER: false, PRO: false, ENTERPRISE: true, GROWTH: false },
} as const;

// ── Plans (Managed Pricing — Shopify hosts payment) ──
// displayFeatures are user-facing strings rendered in plan cards
export const PLANS = {
  FREE: {
    name: "Free",
    price: 0,
    annualPrice: 0,
    period: null,
    billingPlanName: null as string | null,
    displayFeatures: [
      "Up to 5 customers",
      "Up to 10 invoices",
      "Basic credit scoring",
      "Manual collections",
    ],
  },
  STARTER: {
    name: "Starter",
    price: 29,
    annualPrice: 290,
    period: "month",
    billingPlanName: "TruCredit Starter",
    displayFeatures: [
      "Up to 50 customers",
      "Up to 100 invoices",
      "Advanced AI credit scoring",
      "Automated collections",
      "AI email generation",
    ],
  },
  PRO: {
    name: "Pro",
    price: 79,
    annualPrice: 790,
    period: "month",
    billingPlanName: "TruCredit Pro",
    displayFeatures: [
      "Up to 200 customers",
      "Up to 500 invoices",
      "Everything in Starter, plus:",
      "Reply classification",
      "Auto sequences",
      "Priority support",
    ],
  },
  ENTERPRISE: {
    name: "Enterprise",
    price: 149,
    annualPrice: 1490,
    period: "month",
    billingPlanName: "TruCredit Enterprise",
    displayFeatures: [
      "Unlimited customers",
      "Unlimited invoices",
      "Everything in Pro, plus:",
      "Custom rules engine",
      "Custom payment gateway",
      "Dedicated support",
    ],
  },
} as const;

// Plan ordering for UI
export const PLAN_ORDER: PlanKey[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

// @deprecated — backward compat for GROWTH plan
export const PLAN_ALIASES: Record<string, PlanKey> = {
  GROWTH: "STARTER",
} as const;

export function resolvePlan(raw: string): PlanKey {
  return (PLAN_ALIASES[raw] ?? raw) as PlanKey;
}

// Credit scoring
export const CREDIT_SCORE = {
  MIN: 0,
  MAX: 100,
  DEFAULT_LIMIT: 1000,
  GRADE_THRESHOLDS: {
    A_PLUS: 90,
    A: 80,
    B: 70,
    C: 60,
    D: 50,
    // below 50 = F
  },
} as const;

// Collection engine
export const COLLECTION = {
  DEFAULT_NET_TERMS: 30,
  TONE_LEVELS: [1, 2, 3, 4, 5, 6, 7] as const, // 1=friendly, 7=legal
  DEFAULT_TONE: 3,
  MAX_STEPS_PER_SEQUENCE: 10,
} as const;

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;
