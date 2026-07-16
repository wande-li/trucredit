// Storefront credit collect API — Called after order to reserve credit
// POST /api/storefront-collect
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { reserveCredit } from "~/services/checkout.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";

/**
 * POST /api/storefront-collect
 *
 * Called by storefront post-checkout to reserve credit and
 * confirm net terms usage. Validates customer identity and
 * deducts from creditUsed.
 *
 * Body: { shopDomain, customerEmail, orderId, orderName, totalPrice }
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
  const orderId = String(body.orderId ?? "").trim();
  const orderName = String(body.orderName ?? `#${orderId}`).trim();
  const totalPrice = Number(body.totalPrice ?? 0);

  if (!shopDomain || !customerEmail || !orderId || isNaN(totalPrice) || totalPrice <= 0) {
    return json({ success: false, error: "Missing or invalid parameters" }, { status: 400 });
  }

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
