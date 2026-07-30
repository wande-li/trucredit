// TruCredit — Metafield sync service
// Writes customer credit status to Shopify metafield (namespace: "trucredit", key: "credit_status")
// Shopify Function reads this metafield at checkout — must stay in sync
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "~/db.server";
import { METAFIELDS_SET, GET_CUSTOMER_METAFIELD } from "~/lib/graphql-queries";
import { adminGraphQL } from "~/lib/graphql-client.server";
import { toGid } from "~/lib/shopify-id";
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
  logger.app("INFO", "metafield.syncCreditMetafield START", null, { customerId });
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
    logger.app("WARN", "metafield.syncCreditMetafield skipped: no Shopify ID", { customerId });
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
        ownerId: toGid(customer.shopifyCustomerId, "Customer"),
        namespace: "trucredit",
        key: "credit_status",
        type: "json",
        value: JSON.stringify(payload),
      },
    ],
  });

  if (result?.data) {
    logger.app("INFO", "metafield.syncCreditMetafield OK", null, {
      customerId,
      shopifyCustomerId: customer.shopifyCustomerId,
      grade: payload.grade,
      available: payload.creditAvailable,
    });
  } else {
    logger.app("ERROR", "metafield.syncCreditMetafield ERROR", null, {
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
  logger.app("INFO", "metafield.syncAllCreditMetafields START", null, { shopId });
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
        logger.app("ERROR", "metafield.syncAllCreditMetafields failed for customer", { error: msg });
        failed++;
      }
    }
  }

  logger.app("INFO", "metafield.syncAllCreditMetafields OK", null, { shopId, synced, failed });
  return { synced, failed };
}

/**
 * Verify a customer's Shopify metafield matches the DB credit status.
 * Used for diagnostics and initial sync verification.
 * Returns true if metafield matches DB (or no metafield exists).
 */
export async function verifyCreditMetafield(
  admin: AdminApiContext,
  shopDomain: string,
  customerId: string,
): Promise<{ matches: boolean; shopifyValue: CreditStatusPayload | null; dbValue: CreditStatusPayload | null }> {
  logger.app("INFO", "metafield.verifyCreditMetafield START", null, { customerId });
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
    return { matches: false, shopifyValue: null, dbValue: null };
  }

  const dbValue: CreditStatusPayload = {
    creditLimit: Number(customer.creditLimit),
    creditUsed: Number(customer.creditUsed),
    creditAvailable: Number(customer.creditAvailable),
    isFrozen: customer.isFrozen,
    grade: customer.creditGrade || "C",
    netTermsDays: customer.netTermsDays || 30,
  };

  let shopifyValue: CreditStatusPayload | null = null;

  try {
    const result = await adminGraphQL(admin, shopDomain, GET_CUSTOMER_METAFIELD, {
      customerId: toGid(customer.shopifyCustomerId, "Customer"),
    });

    const data = result?.data as Record<string, unknown> | undefined;
    const customer = data?.customer as Record<string, unknown> | undefined;
    const metafield = customer?.metafield as { value?: string } | undefined;
    const metafieldVal = metafield?.value;

    if (metafieldVal && typeof metafieldVal === "string") {
      try {
        const parsed: unknown = JSON.parse(metafieldVal);
        if (parsed && typeof parsed === "object" && "creditLimit" in parsed) {
          shopifyValue = parsed as CreditStatusPayload;
        }
      } catch {
        // JSON parse failed — leave shopifyValue as null
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "metafield.verifyCreditMetafield read failed", { customerId, error: msg });
    return { matches: false, shopifyValue: null, dbValue };
  }

  if (!shopifyValue) {
    return { matches: false, shopifyValue: null, dbValue };
  }

  const matches =
    Math.abs(shopifyValue.creditLimit - dbValue.creditLimit) < 0.01 &&
    Math.abs(shopifyValue.creditUsed - dbValue.creditUsed) < 0.01 &&
    shopifyValue.isFrozen === dbValue.isFrozen &&
    shopifyValue.grade === dbValue.grade;

  if (!matches) {
    logger.app("WARN", "metafield.verifyCreditMetafield mismatch detected", {
      customerId,
      db: JSON.stringify(dbValue),
      shopify: JSON.stringify(shopifyValue),
    });
  }

  logger.app("INFO", "metafield.verifyCreditMetafield OK", null, { customerId, matches });
  return { matches, shopifyValue, dbValue };
}

/**
 * P1-3: Zero out a single customer's credit metafield (used during app uninstall).
 * Uses METAFIELDS_SET with a zeroed payload — effectively disables credit at checkout.
 * Doesn't require reading the existing metafield ID first.
 */
export async function clearCreditMetafield(
  admin: AdminApiContext,
  shopDomain: string,
  shopifyCustomerId: string,
): Promise<void> {
  logger.app("INFO", "metafield.clearCreditMetafield START", null, { shopifyCustomerId });
  const zeroPayload = JSON.stringify({
    creditLimit: 0,
    creditUsed: 0,
    creditAvailable: 0,
    isFrozen: false,
    grade: "N/A",
    netTermsDays: 0,
  });

  await adminGraphQL(admin, shopDomain, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: toGid(shopifyCustomerId, "Customer"),
        namespace: "trucredit",
        key: "credit_status",
        type: "json",
        value: zeroPayload,
      },
    ],
  });

  logger.app("INFO", "metafield.clearCreditMetafield OK", null, { shopifyCustomerId });
}
