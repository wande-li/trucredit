// TruCredit — B2B Company service
// Handles syncing Shopify B2B companies to local Customer records
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "~/db.server";
import { GET_COMPANIES } from "~/lib/graphql-queries";
import { adminGraphQL } from "~/lib/graphql-client.server";
import type { GraphQLResponse } from "~/lib/graphql-client.server";
import { logger } from "~/services/logger.server";

interface ShopifyCompanyNode {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  locations: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        billingAddress?: {
          address1?: string;
          city?: string;
          province?: string;
          country?: string;
          zip?: string;
        };
        buyerExperienceConfiguration?: {
          paymentTermsTemplate?: {
            paymentTermsType?: string;
            dueInDays?: number;
          };
        };
      };
    }>;
  };
  contacts: {
    edges: Array<{
      node: {
        id: string;
        customer?: {
          id: string;
          email?: string;
          firstName?: string;
          lastName?: string;
          phone?: string;
        };
      };
    }>;
  };
}

interface CompaniesPageData {
  companies: {
    edges: Array<{ node: ShopifyCompanyNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/**
 * Fetch all B2B companies from Shopify (paginated) and upsert as Customer records.
 * Called during initial sync and via companies/create & companies/update webhooks.
 */
export async function syncAllCompanies(
  admin: AdminApiContext,
  shopDomain: string,
  shopId: string,
): Promise<{ created: number; updated: number; errors: string[] }> {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    let result: GraphQLResponse<CompaniesPageData>;
    try {
      result = await adminGraphQL<CompaniesPageData>(
        admin,
        shopDomain,
        GET_COMPANIES,
        { first: 50, after: cursor },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("ERROR", "GraphQL call failed during company sync", msg, { shopDomain, shopId, cursor });
      errors.push(`GraphQL request failed at cursor "${cursor}": ${msg}`);
      break;
    }

    // Collect GraphQL-level errors (non-throwing)
    if (result.errors?.length) {
      for (const gqlErr of result.errors) {
        const code = gqlErr.extensions?.code ?? "UNKNOWN";
        errors.push(`GraphQL error [${code}]: ${gqlErr.message}`);
        logger.app("WARN", "GraphQL error during company sync", gqlErr.message, { shopDomain, code, cursor });
      }
    }

    if (!result.data?.companies) {
      logger.app("WARN", "Sync companies: no data returned", undefined, { shopDomain, cursor });
      if (!result.errors?.length) {
        errors.push("No companies data returned from Shopify (empty response)");
      }
      break;
    }

    const companies = result.data.companies.edges;

    for (const { node: company } of companies) {
      for (const contactEdge of company.contacts.edges) {
        const c = contactEdge.node.customer;
        if (!c?.id || !c?.email) continue;

        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
        const primaryLocation = company.locations.edges[0]?.node;
        const netTermsDays =
          primaryLocation?.buyerExperienceConfiguration?.paymentTermsTemplate?.dueInDays || 30;

        try {
          const existing = await prisma.customer.findUnique({
            where: {
              shopId_shopifyCustomerId: { shopId, shopifyCustomerId: String(c.id) },
            },
            select: { id: true },
          });

          if (existing) {
            await prisma.customer.update({
              where: { id: existing.id },
              data: {
                name,
                email: c.email.toLowerCase(),
                company: company.name,
                phone: c.phone || undefined,
                netTermsDays,
                updatedAt: new Date(),
              },
            });
            updated++;
          } else {
            await prisma.customer.create({
              data: {
                shopId,
                shopifyCustomerId: String(c.id),
                name,
                email: c.email.toLowerCase(),
                company: company.name,
                phone: c.phone || null,
                netTermsDays,
                creditLimit: 0,
                creditUsed: 0,
                creditAvailable: 0,
                isFrozen: false,
                creditGrade: "C",
              },
            });
            created++;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "Failed to upsert customer", msg, { shopId, customerId: c.id, email: c.email });
        }
      }
    }

    hasNextPage = result.data.companies.pageInfo.hasNextPage;
    cursor = result.data.companies.pageInfo.endCursor;
  }

  logger.app("INFO", "Company sync complete", undefined, { shopId, created, updated, errorCount: errors.length });
  return { created, updated, errors };
}

/**
 * Upsert a single company contact as a Customer record.
 * Called from companies/create and companies/update webhooks.
 */
export async function upsertCompanyContact(
  shopId: string,
  contact: {
    shopifyCustomerId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    companyName: string;
    phone?: string;
    netTermsDays?: number;
  },
): Promise<{ id: string; created: boolean }> {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;

  const existing = await prisma.customer.findUnique({
    where: {
      shopId_shopifyCustomerId: {
        shopId,
        shopifyCustomerId: contact.shopifyCustomerId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        name,
        email: contact.email.toLowerCase(),
        company: contact.companyName,
        phone: contact.phone || undefined,
        netTermsDays: contact.netTermsDays || undefined,
        updatedAt: new Date(),
      },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.customer.create({
    data: {
      shopId,
      shopifyCustomerId: contact.shopifyCustomerId,
      name,
      email: contact.email.toLowerCase(),
      company: contact.companyName,
      phone: contact.phone || null,
      netTermsDays: contact.netTermsDays || 30,
      creditLimit: 0,
      creditUsed: 0,
      creditAvailable: 0,
      isFrozen: false,
      creditGrade: "C",
    },
  });
  return { id: created.id, created: true };
}
