// Credit Check API — Called by Shopify storefront / Payment Function
// Authenticated via x-api-key header (shared secret per app)
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { checkCreditEligibility } from "~/services/checkout.server";
import { logger } from "~/services/logger.server";
import { verifyApiKey } from "~/lib/api-auth.server";
import { checkRateLimit, getRateLimitKey } from "~/services/rate-limit.server";

const CreditCheckSchema = z.object({
  shopDomain: z.string().min(1, "shopDomain is required"),
  customerEmail: z.string().email("Invalid customer email"),
  cartTotal: z.number().min(0, "cartTotal must be non-negative"),
  currency: z.string().optional(),
});

/**
 * POST /api/credit-check
 *
 * Called by Shopify Functions (Payment Customization) or ScriptTag at checkout.
 * Requires x-api-key header. Validates B2B customer eligibility for net terms payment.
 *
 * Body: { shopDomain, customerEmail, cartTotal, currency? }
 * Rate limit: 100 req/min per IP (RATE_LIMIT_RPM env, default 100)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  if (!verifyApiKey(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit by IP
  const allowed = await checkRateLimit(getRateLimitKey(request, "credit-check"));
  if (!allowed) {
    return json({ error: "Too Many Requests" }, { status: 429 });
  }

  // Parse + validate body with Zod
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreditCheckSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { eligible: false, reason: parsed.error.issues[0]?.message ?? "Invalid parameters" },
      { status: 400 },
    );
  }

  const { shopDomain, customerEmail, cartTotal, currency } = parsed.data;

  try {
    const result = await checkCreditEligibility({
      shopDomain,
      customerEmail,
      cartTotal,
      currency,
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
