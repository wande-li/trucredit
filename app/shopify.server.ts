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

// Billing Plans
export const PLAN_MONTHLY = "TruCredit Pro";
export const PLAN_ANNUAL = "TruCredit Pro Annual";

const shopify = shopifyApp({
  apiKey,
  apiSecretKey: apiSecret,
  apiVersion: ApiVersion.October25,
  billing: {
    [PLAN_MONTHLY]: {
      lineItems: [
        {
          amount: 49.0,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PLAN_ANNUAL]: {
      lineItems: [
        {
          amount: 470.4,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
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
      const upserted = await prisma.shop.upsert({
        where: { shopDomain },
        create: {
          shopDomain,
          accessToken: session.accessToken || "",
        },
        update: {
          accessToken: session.accessToken || "",
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
