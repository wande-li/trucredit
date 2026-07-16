// TruCredit — Initial sync service
// Orchestrates full data pull on app install: companies → orders → metafields
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "~/db.server";
import { syncAllCompanies } from "~/services/company.server";
import { syncAllCreditMetafields } from "~/services/metafield.server";
import { GET_ORDERS } from "~/lib/graphql-queries";
import { adminGraphQL } from "~/lib/graphql-client.server";
import type { GraphQLResponse } from "~/lib/graphql-client.server";
import { logger } from "~/services/logger.server";

interface OrdersPageData {
  orders: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFinancialStatus: string;
        totalPriceSet: {
          shopMoney: { amount: string; currencyCode: string };
        };
        customer?: {
          id: string;
          email?: string;
          firstName?: string;
          lastName?: string;
        };
        purchasingEntity?: {
          company?: { id: string; name: string };
          location?: { id: string; name: string };
        };
        paymentTerms?: {
          paymentTermsType: string;
          dueInDays: number;
          overdue: boolean;
          paymentSchedules: {
            edges: Array<{
              node: {
                dueAt: string;
                completedAt?: string;
                amount: { amount: string; currencyCode: string };
              };
            }>;
          };
        };
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface HistoricalOrder {
  shopId: string;
  customerId: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  amount: number;
  currency: string;
  issueDate: Date;
  dueDate?: Date;
  paidDate?: Date;
  status: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
  netTermsDays: number;
}

/**
 * Full initial sync: pull all B2B companies + historical orders (last 90 days) + write metafields.
 * Called after OAuth install completes (shopify.server.ts afterAuth hook).
 */
export async function initialSync(
  admin: AdminApiContext,
  shopDomain: string,
  shopId: string,
): Promise<{
  companies: { created: number; updated: number };
  invoices: { created: number; skipped: number };
  metafields: { synced: number; failed: number };
}> {
  logger.app("INFO", "Starting initial sync", { shopDomain, shopId });

  // Step 1: Sync B2B companies
  const companies = await syncAllCompanies(admin, shopDomain, shopId);

  // Step 2: Sync historical orders (last 90 days)
  const invoices = await syncHistoricalOrders(admin, shopDomain, shopId);

  // Step 3: Write credit metafields for all customers
  const metafields = await syncAllCreditMetafields(admin, shopDomain, shopId);

  logger.app("INFO", "Initial sync complete", {
    shopId,
    companiesCreated: companies.created,
    companiesUpdated: companies.updated,
    invoicesCreated: invoices.created,
    metafieldsSynced: metafields.synced,
  });

  return { companies, invoices, metafields };
}

/**
 * Pull historical B2B orders (last 90 days) and create Invoice records.
 */
async function syncHistoricalOrders(
  admin: AdminApiContext,
  shopDomain: string,
  shopId: string,
): Promise<{ created: number; skipped: number }> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const dateFilter = `created_at:>=${ninetyDaysAgo.toISOString().split("T")[0]}`;

  let created = 0;
  let skipped = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result: GraphQLResponse<OrdersPageData> = await adminGraphQL<OrdersPageData>(
      admin,
      shopDomain,
      GET_ORDERS,
      { first: 50, query: dateFilter, after: cursor },
    );

    if (!result.data?.orders) {
      logger.app("WARN", "Sync orders: no data", { shopDomain, cursor });
      break;
    }

    for (const { node: order } of result.data.orders.edges) {
      // Only process B2B orders (with purchasingEntity)
      if (!order.purchasingEntity?.company) continue;

      const customerId = order.customer?.id;
      if (!customerId) continue;

      const dbCustomer = await prisma.customer.findUnique({
        where: { shopId_shopifyCustomerId: { shopId, shopifyCustomerId: String(customerId) } },
        select: { id: true },
      });
      if (!dbCustomer) continue;

      const existing = await prisma.invoice.findFirst({
        where: { shopifyOrderId: String(order.id), shopId },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const amount = parseFloat(order.totalPriceSet.shopMoney.amount);
      const currency = order.totalPriceSet.shopMoney.currencyCode;
      const status = mapFinancialStatus(order.displayFinancialStatus);
      const netTermsDays = order.paymentTerms?.dueInDays || 30;

      const dueDate = new Date(order.createdAt);
      dueDate.setDate(dueDate.getDate() + netTermsDays);

      const paidDate =
        status === "PAID" && order.paymentTerms?.paymentSchedules?.edges?.[0]?.node?.completedAt
          ? new Date(order.paymentTerms.paymentSchedules.edges[0].node.completedAt)
          : null;

      await prisma.invoice.create({
        data: {
          shopId,
          customerId: dbCustomer.id,
          shopifyOrderId: String(order.id),
          shopifyOrderName: order.name,
          invoiceNumber: order.name.replace("#", ""),
          amount,
          currency,
          issueDate: new Date(order.createdAt),
          dueDate,
          status,
          netTermsDays,
          ...(paidDate ? { paidDate } : {}),
        },
      });
      created++;
    }

    hasNextPage = result.data.orders.pageInfo.hasNextPage;
    cursor = result.data.orders.pageInfo.endCursor;
  }

  logger.app("INFO", "Historical order sync complete", { shopId, created, skipped });
  return { created, skipped };
}

function mapFinancialStatus(status: string): "PENDING" | "PAID" | "OVERDUE" | "VOID" {
  switch (status.toUpperCase()) {
    case "PAID":
      return "PAID";
    case "PARTIALLY_PAID":
      return "PENDING";
    case "PENDING":
      return "PENDING";
    case "OVERDUE":
      return "OVERDUE";
    case "VOIDED":
    case "CANCELLED":
      return "VOID";
    default:
      return "PENDING";
  }
}

// Export historical order type for external use
export type { HistoricalOrder };
