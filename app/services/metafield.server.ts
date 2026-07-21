// TruCredit — Metafield sync service
// Writes customer credit status to Shopify metafield (namespace: "trucredit", key: "credit_status")
// Shopify Function reads this metafield at checkout — must stay in sync
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "~/db.server";
import { METAFIELDS_SET } from "~/lib/graphql-queries";
import { adminGraphQL } from "~/lib/graphql-client.server";
import { logger } from "~/services/logger.server";

interface CreditStatusPayload {
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  isFrozen: boolean;
  grade: string;
  netTermsDays: number;
}

/**
 * Sync a single customer's credit status to Shopify metafield.
 * Called after any credit event: limit change, order placed, order paid, freeze/unfreeze.
 */
export async function syncCreditMetafield(
  admin: AdminApiContext,
  shopDomain: string,
  customerId: string,
): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      shopifyCustomerId: true,
      creditLimit: true,
      creditUsed: true,
      creditAvailable: true,
      isFrozen: true,
      creditGrade: true,
      netTermsDays: true,
    },
  });

  if (!customer || !customer.shopifyCustomerId) {
    logger.app("WARN", "Sync metafield skipped: customer not found or no Shopify ID", {
      customerId,
    });
    return;
  }

  const payload: CreditStatusPayload = {
    creditLimit: Number(customer.creditLimit),
    creditUsed: Number(customer.creditUsed),
    creditAvailable: Number(customer.creditAvailable),
    isFrozen: customer.isFrozen,
    grade: customer.creditGrade || "C",
    netTermsDays: customer.netTermsDays || 30,
  };

  const result = await adminGraphQL(admin, shopDomain, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
        namespace: "trucredit",
        key: "credit_status",
        type: "json",
        value: JSON.stringify(payload),
      },
    ],
  });

  if (result?.data) {
    logger.app("INFO", "Credit metafield synced", {
      customerId,
      shopifyCustomerId: customer.shopifyCustomerId,
      grade: payload.grade,
      available: payload.creditAvailable,
    });
  } else {
    logger.app("ERROR", "Metafield sync failed", {
      customerId,
      errors: result?.errors?.map((e) => e.message),
    });
  }
}

/**
 * Bulk sync metafields for all customers of a shop.
 * Called after initial sync or recovery scenarios.
 * P2-3: Uses limited concurrency (5 per batch) instead of sequential or unlimited.
 */
export async function syncAllCreditMetafields(
  admin: AdminApiContext,
  shopDomain: string,
  shopId: string,
): Promise<{ synced: number; failed: number }> {
  const customers = await prisma.customer.findMany({
    where: { shopId },
    select: {
      id: true,
      shopifyCustomerId: true,
      creditLimit: true,
      creditUsed: true,
      creditAvailable: true,
      isFrozen: true,
      creditGrade: true,
      netTermsDays: true,
    },
  });

  const validCustomers = customers.filter((c) => c.shopifyCustomerId);
  let synced = 0;
  let failed = 0;

  // P2-3: Process in batches of 5 for limited concurrency
  const BATCH_SIZE = 5;
  for (let i = 0; i < validCustomers.length; i += BATCH_SIZE) {
    const batch = validCustomers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((customer) =>
        syncCreditMetafield(admin, shopDomain, customer.id),
      ),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        synced++;
      } else {
        const msg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        logger.app("ERROR", "Bulk metafield sync failed for customer", {
          error: msg,
        });
        failed++;
      }
    }
  }

  logger.app("INFO", "Bulk metafield sync complete", { shopId, synced, failed });
  return { synced, failed };
}
