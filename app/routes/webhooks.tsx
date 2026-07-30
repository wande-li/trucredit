// Shopify Webhooks — unified entry point
// HMAC auth → topic dispatch → delegate to individual handlers in webhooks/
import { type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { logger } from "~/services/logger.server";
import type { WebhookContext, ShopifyPayload } from "~/routes/webhooks/types";
import { handleAppUninstalled } from "~/routes/webhooks/app-uninstalled";
import { handleSubscriptionUpdate } from "~/routes/webhooks/subscription-update";
import { handleCustomersUpdate } from "~/routes/webhooks/customers-update";
import { handleCompaniesUpsert } from "~/routes/webhooks/companies-upsert";
import { handleOrdersCreate, handleDraftOrdersComplete, handleDraftOrdersDelete } from "~/routes/webhooks/orders-create";
import { handleOrdersPaid, handleOrdersUpdated } from "~/routes/webhooks/orders-paid";
import { handleOrdersCancelled } from "~/routes/webhooks/orders-cancelled";
import { handleRefundsCreate } from "~/routes/webhooks/refunds-create";
import { handleCustomersDataRequest, handleCustomersRedact } from "~/routes/webhooks/gdpr-customers";
import { handleShopRedact } from "~/routes/webhooks/gdpr-shop-redact";

export const action = async ({ request }: ActionFunctionArgs) => {
  let topic = "";
  let p: ShopifyPayload = {};
  let shopDomain = "";
  let shopifyAdmin;

  // HMAC auth — Shopify Mandatory Webhook requires 401 on invalid HMAC
  try {
    const auth = await authenticate.webhook(request);
    topic = String(auth.topic ?? "");
    p = auth.payload as ShopifyPayload;
    shopDomain = String(p.shop_domain || p.myshopify_domain || "");
    shopifyAdmin = auth.admin;

    logger.app("INFO", "action:webhooks START", null, { shopDomain, topic });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:webhooks HMAC_invalid", msg);
    return new Response(null, { status: 401 }); // Shopify Mandatory Webhook requirement
  }

  // P0-2: Wrap each handler in try-catch → log + return 200
  const safe = async (name: string, fn: () => Promise<Response>): Promise<Response> => {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("ERROR", `action:webhooks ${name} ERROR`, msg, { shopDomain });
      return new Response(null, { status: 200 });
    }
  };

  const ctx: WebhookContext = { topic, payload: p, shopDomain, shopifyAdmin };

  // Topic → handler dispatch
  switch (topic) {
    // ─── App ───
    case "APP_UNINSTALLED":
      return safe("APP_UNINSTALLED", () => handleAppUninstalled(ctx));

    // ─── Subscription ───
    case "APP_SUBSCRIPTIONS_CREATE":
    case "APP_SUBSCRIPTIONS_UPDATE":
      return safe(topic, () => handleSubscriptionUpdate(ctx));

    // ─── Customers ───
    case "CUSTOMERS_UPDATE":
      return safe("CUSTOMERS_UPDATE", () => handleCustomersUpdate(ctx));

    // ─── Companies ───
    case "COMPANIES_CREATE":
    case "COMPANIES_UPDATE":
      return safe(topic, () => handleCompaniesUpsert(ctx));

    // ─── Orders ───
    case "ORDERS_CREATE":
      return safe("ORDERS_CREATE", () => handleOrdersCreate(ctx));
    case "DRAFT_ORDERS_COMPLETE":
      return safe("DRAFT_ORDERS_COMPLETE", () => handleDraftOrdersComplete(ctx));
    case "DRAFT_ORDERS_DELETE":
      return safe("DRAFT_ORDERS_DELETE", () => handleDraftOrdersDelete(ctx));
    case "ORDERS_PAID":
      return safe("ORDERS_PAID", () => handleOrdersPaid(ctx));
    case "ORDERS_UPDATED":
      return safe("ORDERS_UPDATED", () => handleOrdersUpdated(ctx));
    case "ORDERS_CANCELLED":
      return safe("ORDERS_CANCELLED", () => handleOrdersCancelled(ctx));

    // ─── Refunds ───
    case "REFUNDS_CREATE":
      return safe("REFUNDS_CREATE", () => handleRefundsCreate(ctx));

    // ─── GDPR ───
    case "CUSTOMERS_DATA_REQUEST":
      return safe("CUSTOMERS_DATA_REQUEST", () => handleCustomersDataRequest(ctx));
    case "CUSTOMERS_REDACT":
      return safe("CUSTOMERS_REDACT", () => handleCustomersRedact(ctx));
    case "SHOP_REDACT":
      return safe("SHOP_REDACT", () => handleShopRedact(ctx));

    default:
      logger.app("WARN", "action:webhooks unhandled_topic ERROR", null, { topic });
      return new Response(null, { status: 200 });
  }
};
