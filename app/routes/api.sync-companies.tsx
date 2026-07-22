// Sync Companies API — Called from Customers page "Sync from Shopify" button
// Authenticated via Shopify admin session, syncs all B2B companies to local Customer records
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { syncAllCompanies } from "~/services/company.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

/**
 * POST /api/sync-companies
 *
 * Called by the Customers page "Sync from Shopify" button via fetcher.submit().
 * Pulls all B2B companies from Shopify (via GraphQL) and upserts them as Customer records.
 *
 * Returns: { success: true, created: number, updated: number }
 *       or: { success: false, error: string }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method Not Allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }

  try {
    logger.app("INFO", "Manual sync triggered from Customers page", undefined, { shopDomain, shopId: shop.id });

    const result = await syncAllCompanies(admin, shopDomain, shop.id);

    logger.app("INFO", "Manual sync complete", undefined, {
      shopId: shop.id,
      created: result.created,
      updated: result.updated,
      errorCount: result.errors.length,
    });

    return json({
      success: true,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.app("ERROR", "Manual sync failed", msg, { shopDomain, stack: stack?.slice(0, 500) });
    return json(
      {
        success: false,
        error: msg,
        detail: stack?.slice(0, 800) ?? "No stack trace available",
      },
      { status: 500 },
    );
  }
};
