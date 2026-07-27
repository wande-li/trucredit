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
  ENTERPRISE: { customers: 500, invoices: 2000 },
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
      "Advanced credit scoring",
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
      "Up to 500 customers",
      "Up to 2,000 invoices",
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

// ── RBAC (Role-Based Access Control) ──
export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  VIEWER: "viewer",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  viewer: "Viewer",
};

/** Actions that can be guarded by permission checks */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  admin: ["*"], // All permissions — wildcard
  manager: ["view", "edit", "export", "send_email", "manage_collections"],
  viewer: ["view"],
};

/** Ordered role hierarchy (lowest → highest) for comparison */
export const ROLE_HIERARCHY: Role[] = ["viewer", "manager", "admin"];

/**
 * Check whether a numeric role level meets or exceeds a required level.
 * viewer=0, manager=1, admin=2
 */
export function roleLevel(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role);
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

// Scoring weights — max score contribution per component + adjustment caps
export const SCORING_WEIGHTS = {
  PAYMENT_HISTORY: 40,          // max score for payment history component
  CREDIT_UTILIZATION: 25,       // max score for credit utilization component
  ORDER_VOLUME: 20,             // max score for order volume component
  REVENUE_HISTORY: 15,          // max score for revenue history component
  ORDER_LOG_DIVISOR: 2,         // log10 divisor for order volume normalization
  REVENUE_LOG_DIVISOR: 3,       // log10 divisor for revenue normalization (scoring)
  SCORE_FLOOR: 50,              // below this = high risk warning
  ON_TIME_WARN: 0.7,            // below 70% on-time rate = warning
  UTILIZATION_WARN: 0.8,        // above 80% utilization = warning
  APPROVAL_SCORE_THRESHOLD: 70, // below this needs approval for >50% increase
  MAX_INCREASE_RATIO: 1.5,      // max 50% increase without approval
  MAX_RECOMMENDED_MULTIPLIER: 2, // never exceed 2x recommended
  ORDER_BONUS_PER_ORDER: 100,   // bonus per order for repeat customers
  MAX_ORDER_BONUS: 5000,        // cap on order volume bonus
  REVENUE_MULTIPLIER_LOG_DIVISOR: 10, // divisor for revenue multiplier adjustment
  MAX_REVENUE_MULTIPLIER: 2,    // cap on revenue-based multiplier
  CRITICAL_RISK_ON_TIME: 0.3,   // below this on-time rate = FROZEN
} as const;

// Base credit limits by grade — starting point before revenue/order adjustments
export const CREDIT_BASE_LIMITS: Record<string, number> = {
  A_PLUS: 50000,
  A: 25000,
  B: 10000,
  C: 5000,
  D: 2000,
  F: 500,
} as const;

// Collection engine
export const COLLECTION = {
  DEFAULT_NET_TERMS: 30,
  TONE_LEVELS: [1, 2, 3, 4, 5, 6, 7] as const,
  DEFAULT_TONE: 3,
  MAX_STEPS_PER_SEQUENCE: 10,
} as const;

/** Unified tone labels — single source of truth across Emails and Collections pages */
export const TONE_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Polite",
  3: "Neutral",
  4: "Firm",
  5: "Strong",
  6: "Urgent",
  7: "Final",
};

export const TONE_COLORS: Record<number, "success" | "attention" | "warning" | "critical"> = {
  1: "success",
  2: "success",
  3: "attention",
  4: "attention",
  5: "warning",
  6: "critical",
  7: "critical",
};

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

// Export safety cap — prevents OOM on large shops
export const EXPORT_MAX_ROWS = 5000;

// Collection Retry — transient error handling for sweep/worker operations
export const COLLECTION_RETRY = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 5000,       // 5s base delay for step progression
  MAX_DELAY_MS: 300000,       // 5 min max delay
  RETRYABLE_PATTERNS: [       // error patterns that should trigger retry
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "timeout",
    "transient",
    "rate limit",
    "503",
    "502",
    "504",
  ],
} as const;

/**
 * Check whether an error is transient and should be retried.
 * Matches error messages against COLLECTION_RETRY.RETRYABLE_PATTERNS (case-insensitive).
 */
export function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  return COLLECTION_RETRY.RETRYABLE_PATTERNS.some((pattern) =>
    lower.includes(pattern.toLowerCase()),
  );
}

// ─── Route pathnames (single source of truth for layout Outlet checks) ───
export const PATH_NAMES = {
  CUSTOMERS: "/app/customers",
  INVOICES: "/app/invoices",
  COLLECTIONS: "/app/collections",
  RULES: "/app/rules",
  EMAILS: "/app/emails",
  BILLING: "/app/billing",
  DASHBOARD: "/app",
} as const;

// Default locale for date/number formatting (user-visible English markets)
export const DEFAULT_LOCALE = "en-US";
