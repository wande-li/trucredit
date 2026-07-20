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

// Plan quotas
export const PLAN_QUOTAS = {
  FREE: { customers: 5, invoices: 10 },
  GROWTH: { customers: 50, invoices: 200 },
  PRO: { customers: Infinity, invoices: Infinity },
} as const;

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
