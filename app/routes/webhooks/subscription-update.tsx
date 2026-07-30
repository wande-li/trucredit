// Webhook handler: APP_SUBSCRIPTIONS_CREATE / APP_SUBSCRIPTIONS_UPDATE
import type { WebhookContext, ShopifyPayload } from "./types";
import { handleSubscriptionUpdate } from "~/services/billing.server";
import { logger } from "~/services/logger.server";

export async function handleSubscriptionUpdate(ctx: WebhookContext): Promise<Response> {
  const { topic, payload, shopDomain } = ctx;

  const domain = shopDomain || String(payload.shop_domain || payload.myshopify_domain || "");
  if (!domain) throw new Response("Missing shop domain", { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Shopify webhook payload fields not in SDK types
  const sub = payload.app_subscription as Record<string, any> | undefined;
  const charge = {
    id: String(sub?.admin_graphql_api_id || sub?.id || ""),
    name: String(sub?.name || ""),
    status: String(sub?.status || "UNKNOWN"),
    currentPeriodEnd: typeof sub?.current_period_end === "string" ? sub.current_period_end : undefined,
    trialDays: typeof sub?.trial_days === "number" ? sub.trial_days : undefined,
    cancelledAt: typeof sub?.cancelled_at === "string" ? sub.cancelled_at : undefined,
    price: sub?.capped_amount || sub?.price,
  };

  await handleSubscriptionUpdate(String(domain).trim(), charge);
  logger.app("INFO", `webhooks:${topic} OK`, null, { domain, status: charge.status });
  return new Response(null, { status: 200 });
}
