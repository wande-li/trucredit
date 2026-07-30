// Webhook handler: SHOP_REDACT (GDPR — full shop data deletion)
import type { WebhookContext } from "./types";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export async function handleShopRedact(ctx: WebhookContext): Promise<Response> {
  const { shopDomain } = ctx;
  if (!shopDomain) return new Response(null, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true },
  });

  if (shop) {
    await prisma.$transaction([
      // Remove child records first (reverse dependency order)
      prisma.collectionEvent.deleteMany({ where: { task: { customer: { shopId: shop.id } } } }),
      prisma.collectionTask.deleteMany({ where: { customer: { shopId: shop.id } } }),
      prisma.collectionStep.deleteMany({ where: { sequence: { shopId: shop.id } } }),
      prisma.collectionSequence.deleteMany({ where: { shopId: shop.id } }),
      prisma.creditEvent.deleteMany({ where: { customer: { shopId: shop.id } } }),
      prisma.invoice.deleteMany({ where: { shopId: shop.id } }),
      prisma.customer.deleteMany({ where: { shopId: shop.id } }),
      prisma.emailTemplate.deleteMany({ where: { shopId: shop.id } }),
      prisma.creditRule.deleteMany({ where: { shopId: shop.id } }),
      prisma.shop.delete({ where: { id: shop.id } }),
    ]);

    // Session records (standalone — no cascade from Shop)
    await prisma.session.deleteMany({ where: { shop: shopDomain.trim() } });

    logger.app("INFO", "webhooks:SHOP_REDACT OK", null, { shopDomain: shopDomain.trim() });
  }

  return new Response(null, { status: 200 });
}
