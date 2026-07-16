// Credit Check API — Public endpoint called by Shopify storefront / Payment Function
// No OAuth required — validates via shop domain parameter + HMAC or direct API key
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { checkCreditEligibility } from "~/services/checkout.server";
import { logger } from "~/services/logger.server";

/**
 * POST /api/credit-check
 *
 * Called by Shopify Functions (Payment Customization) or ScriptTag at checkout.
 * Validates B2B customer eligibility for net terms payment.
 *
 * Body: { shopDomain, customerEmail, cartTotal, currency? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = String(body.shopDomain ?? "").trim();
  const customerEmail = String(body.customerEmail ?? "").trim();
  const cartTotal = Number(body.cartTotal);

  if (!shopDomain || !customerEmail || isNaN(cartTotal) || cartTotal < 0) {
    return json(
      { eligible: false, reason: "Missing or invalid parameters" },
      { status: 400 },
    );
  }

  try {
    const result = await checkCreditEligibility({
      shopDomain,
      customerEmail,
      cartTotal,
      currency: body.currency ? String(body.currency) : undefined,
    });

    return json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Credit check API failed", undefined, {
      shopDomain,
      customerEmail,
      error: msg,
    });
    return json(
      { eligible: false, reason: "Credit check service unavailable" },
      { status: 500 },
    );
  }
};

/**
 * Also support GET for quick checks (health / debug).
 */
export const loader = async () => {
  return json({ service: "TruCredit Check API", status: "ok" });
};
