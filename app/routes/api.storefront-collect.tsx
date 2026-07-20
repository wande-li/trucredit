// Storefront credit collect API — Called after order to reserve credit
// POST /api/storefront-collect
// Authenticated via x-api-key header (shared secret per app)
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { reserveCredit } from "~/services/checkout.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import { verifyApiKey } from "~/lib/api-auth.server";
import { checkRateLimit, getRateLimitKey } from "~/services/rate-limit.server";

const CollectSchema = z.object({
  shopDomain: z.string().min(1, "shopDomain is required"),
  customerEmail: z.string().email("Invalid customer email"),
  orderId: z.string().min(1, "orderId is required"),
  orderName: z.string().optional(),
  totalPrice: z.number().positive("totalPrice must be positive"),
});

/**
 * POST /api/storefront-collect
 *
 * Called by storefront post-checkout to reserve credit and
 * confirm net terms usage. Requires x-api-key header.
 * Validates customer identity and deducts from creditUsed.
 *
 * Body: { shopDomain, customerEmail, orderId, orderName, totalPrice }
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
  const allowed = await checkRateLimit(getRateLimitKey(request, "storefront-collect"));
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

  const parsed = CollectSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid parameters" },
      { status: 400 },
    );
  }

  const { shopDomain, customerEmail, orderId, orderName: rawOrderName, totalPrice } = parsed.data;
  const orderName = rawOrderName ?? `#${orderId}`;

  // Find customer
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }

  const customer = await prisma.customer.findFirst({
    where: {
      shopId: shop.id,
      email: customerEmail.toLowerCase().trim(),
    },
    select: { id: true },
  });

  if (!customer) {
    return json({ success: false, error: "Customer not found" }, { status: 404 });
  }

  // Reserve credit
  const result = await reserveCredit({
    customerId: customer.id,
    amount: totalPrice,
    orderName,
  });

  if (!result.success) {
    return json({ success: false, error: result.error }, { status: 402 });
  }

  logger.app("INFO", "Storefront credit collected", undefined, {
    shopId: shop.id,
    customerId: customer.id,
    orderId,
    orderName,
    totalPrice,
  });

  return json({ success: true, orderId });
};
