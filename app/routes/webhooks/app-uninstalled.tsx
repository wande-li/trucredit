// Webhook handler: APP_UNINSTALLED
import type { WebhookContext, ShopifyPayload } from "./types";
import { clearCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";
import redis, { REDIS_PREFIX } from "~/lib/redis.server";

export async function handleAppUninstalled(ctx: WebhookContext): Promise<Response> {
  const { shopDomain, shopifyAdmin } = ctx;

  if (shopDomain) {
    if (shopifyAdmin) {
      try {
        const customers = await prisma.customer.findMany({
          where: { shop: { shopDomain: shopDomain.trim() } },
          select: { shopifyCustomerId: true },
        });
        const validIds = customers
          .map((c) => c.shopifyCustomerId)
          .filter((id): id is string => Boolean(id));
        const BATCH = 5;
        let cleared = 0;
        for (let i = 0; i < validIds.length; i += BATCH) {
          const batch = validIds.slice(i, i + BATCH);
          await Promise.allSettled(
            batch.map((id) => clearCreditMetafield(shopifyAdmin, shopDomain, id)),
          );
          cleared += batch.length;
        }
        logger.app("INFO", "webhooks:APP_UNINSTALLED metafield_cleanup OK", null, {
          shopDomain,
          customersCleared: cleared,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "webhooks:APP_UNINSTALLED metafield_cleanup failed (non-blocking)", msg, { shopDomain });
      }
    }
    // P1-2 GDPR note: APP_UNINSTALLED keeps data for Shopify 48h reinstall window.
    // Full data deletion happens via SHOP_REDACT (explicit GDPR request).
    await prisma.shop.updateMany({
      where: { shopDomain: shopDomain.trim() },
      data: { uninstalledAt: new Date() },
    });
  }

  // P0-13: Clean Redis cache keys for uninstalled shop (best-effort, non-blocking)
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: shopDomain.trim() },
      select: { id: true },
    });
    if (shop && redis) {
      const pipe = redis.pipeline();
      pipe.del(`${REDIS_PREFIX}dashboard:${shop.id}`);
      pipe.del(`${REDIS_PREFIX}dashboard:lock:${shop.id}`);
      const customers = await prisma.customer.findMany({
        where: { shopId: shop.id },
        select: { id: true },
      });
      customers.forEach((c) => pipe.del(`${REDIS_PREFIX}credit:${c.id}`));
      await pipe.exec();
      logger.app("INFO", "webhooks:APP_UNINSTALLED redis_cleanup OK", null, {
        shopDomain,
        shopId: shop.id,
        keysDeleted: 2 + customers.length,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "webhooks:APP_UNINSTALLED redis_cleanup failed (non-blocking)", msg, { shopDomain });
  }

  return new Response(null, { status: 200 });
}

// Re-export for barrel imports
export type { WebhookContext, ShopifyPayload };
