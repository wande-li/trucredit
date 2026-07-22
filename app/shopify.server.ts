import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { SHOPIFY_API_VERSION } from "~/lib/constants";

// Fail fast on missing critical env vars
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
const appUrl = process.env.SHOPIFY_APP_URL;

if (!apiKey) throw new Error("FATAL: SHOPIFY_API_KEY environment variable is required");
if (!apiSecret) throw new Error("FATAL: SHOPIFY_API_SECRET environment variable is required");
if (!appUrl) throw new Error("FATAL: SHOPIFY_APP_URL environment variable is required");

// Verify API Version consistency between constants and shopify.server.ts
const expectedApiVersion = ApiVersion.October25;
if (SHOPIFY_API_VERSION !== expectedApiVersion) {
  throw new Error(
    `FATAL: SHOPIFY_API_VERSION mismatch — constants.ts has "${SHOPIFY_API_VERSION}" ` +
    `but shopify.server.ts uses ApiVersion.October25 = "${expectedApiVersion}". ` +
    `Update both to the same version.`,
  );
}

// ── Billing Plans (4 tiers × 2 intervals = 8 entries, 6 active) ──
// Monthly plans
export const PLAN_STARTER_MONTHLY = "TruCredit Starter";
export const PLAN_PRO_MONTHLY = "TruCredit Pro";
export const PLAN_ENTERPRISE_MONTHLY = "TruCredit Enterprise";
// Annual plans (17% discount vs monthly)
export const PLAN_STARTER_ANNUAL = "TruCredit Starter Annual";
export const PLAN_PRO_ANNUAL = "TruCredit Pro Annual";
export const PLAN_ENTERPRISE_ANNUAL = "TruCredit Enterprise Annual";

// Union type for type-safe billing.request() calls
export type BillingPlanName =
  | typeof PLAN_STARTER_MONTHLY
  | typeof PLAN_STARTER_ANNUAL
  | typeof PLAN_PRO_MONTHLY
  | typeof PLAN_PRO_ANNUAL
  | typeof PLAN_ENTERPRISE_MONTHLY
  | typeof PLAN_ENTERPRISE_ANNUAL;

// Legacy plan names for webhook handler
export const PLAN_MONTHLY = PLAN_PRO_MONTHLY;
export const PLAN_ANNUAL = PLAN_PRO_ANNUAL;

const shopify = shopifyApp({
  apiKey,
  apiSecretKey: apiSecret,
  apiVersion: ApiVersion.October25,
  billing: {
    [PLAN_STARTER_MONTHLY]: {
      lineItems: [
        {
          amount: 29.0,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 14,
    },
    [PLAN_STARTER_ANNUAL]: {
      lineItems: [
        {
          amount: 290.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 14,
    },
    [PLAN_PRO_MONTHLY]: {
      lineItems: [
        {
          amount: 79.0,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 14,
    },
    [PLAN_PRO_ANNUAL]: {
      lineItems: [
        {
          amount: 790.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 14,
    },
    [PLAN_ENTERPRISE_MONTHLY]: {
      lineItems: [
        {
          amount: 149.0,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 14,
    },
    [PLAN_ENTERPRISE_ANNUAL]: {
      lineItems: [
        {
          amount: 1490.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 14,
    },
  },
  scopes: [
    "read_orders",
    "write_orders",
    "read_customers",
    "write_customers",
    "read_draft_orders",
    "write_draft_orders",
    "read_products",
    "write_products",
    "read_companies",
    "read_metafields",
    "write_metafields",
    "read_payment_terms",
    "write_payment_terms",
  ],
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  useOnlineTokens: false,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const shopDomain = session.shop.trim();
      // P2-11: Encrypt access token before storing
      const encryptedToken = session.accessToken
        ? (await import("~/lib/crypto.server")).encryptToken(session.accessToken)
        : "";
      const upserted = await prisma.shop.upsert({
        where: { shopDomain },
        create: {
          shopDomain,
          accessToken: encryptedToken,
        },
        update: {
          accessToken: encryptedToken,
        },
        select: { id: true, uninstalledAt: true },
      });

      // Trigger initial sync on first install (uninstalledAt is null for fresh install)
      if (upserted.uninstalledAt === null) {
        // Dynamic import to avoid bundling server-only sync into client
        const { initialSync } = await import("~/services/sync.server");
        initialSync(admin, shopDomain, upserted.id).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          // eslint-disable-next-line no-console
          console.warn(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "ERROR",
            service: "ShopifyAuth",
            message: "Initial sync failed after auth",
            shopDomain,
            error: msg,
          }));
        });
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
