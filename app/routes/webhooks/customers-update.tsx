// Webhook handler: CUSTOMERS_UPDATE
import type { WebhookContext, ShopifyPayload } from "./types";
import { upsertCustomerFromShopify, checkCustomerQuota } from "~/services/customer.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export async function handleCustomersUpdate(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain } = ctx;

  if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });

  const dbShop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true, plan: true },
  });
  if (!dbShop) throw new Response("Shop not found", { status: 404 });

  // Quota gate: skip new customers when plan quota exceeded
  const existingCustomer = await prisma.customer.findFirst({
    where: { shopId: dbShop.id, shopifyCustomerId: String(payload.id) },
    select: { id: true },
  });
  if (!existingCustomer) {
    const quota = await checkCustomerQuota(dbShop.id, dbShop.plan);
    if (!quota.allowed) {
      logger.app("WARN", "webhooks:CUSTOMERS_UPDATE quota_exceeded skip", null, {
        shopDomain: shopDomain.trim(),
        current: quota.current,
        limit: quota.limit,
        plan: dbShop.plan,
      });
      return new Response(null, { status: 200 });
    }
  }

  const shopifyCustomerId = String(payload.id);
  const email = String(payload.email || "");
  const name = `${String(payload.first_name || "")} ${String(payload.last_name || "")}`.trim() || email;
  const company: string | undefined = payload.default_address?.company || undefined;
  const phone: string | undefined = payload.phone || undefined;

  if (email) {
    await upsertCustomerFromShopify({
      shopId: dbShop.id,
      shopifyCustomerId,
      email,
      name: name || email,
      company,
      phone,
    });
  }

  return new Response(null, { status: 200 });
}
