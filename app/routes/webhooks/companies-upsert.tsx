// Webhook handler: COMPANIES_CREATE / COMPANIES_UPDATE
import type { WebhookContext, ShopifyPayload } from "./types";
import { upsertCompanyContact } from "~/services/company.server";
import { checkCustomerQuota } from "~/services/customer.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export async function handleCompaniesUpsert(ctx: WebhookContext): Promise<Response> {
  const { topic, payload, shopDomain } = ctx;

  if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });

  const dbShop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true, plan: true },
  });
  if (!dbShop) throw new Response("Shop not found", { status: 404 });

  const companyName = String(payload.name || "");
  const contacts: Array<{
    id: string;
    customer?: { id: string; email?: string; firstName?: string; lastName?: string; phone?: string };
  }> = Array.isArray(payload.contacts) ? payload.contacts : [];

  // Quota gate: check once before processing all contacts
  let quotaChecked = false;
  const getQuotaOk = async () => {
    if (quotaChecked) return true;
    const q = await checkCustomerQuota(dbShop.id, dbShop.plan);
    quotaChecked = true;
    if (!q.allowed) {
      logger.app("WARN", `webhooks:${topic} quota_exceeded skip`, null, {
        shopDomain: shopDomain.trim(),
        current: q.current,
        limit: q.limit,
        plan: dbShop.plan,
        contactCount: contacts.length,
      });
      return false;
    }
    return true;
  };

  for (const contact of contacts) {
    const c = contact.customer;
    if (!c?.id || !c?.email) continue;

    // Skip new contacts when quota exceeded (existing contacts still update)
    const exists = await prisma.customer.findFirst({
      where: { shopId: dbShop.id, shopifyCustomerId: String(c.id) },
      select: { id: true },
    });
    if (!exists && !(await getQuotaOk())) continue;

    await upsertCompanyContact(dbShop.id, {
      shopifyCustomerId: String(c.id),
      email: String(c.email),
      firstName: c.firstName ? String(c.firstName) : undefined,
      lastName: c.lastName ? String(c.lastName) : undefined,
      companyName,
      phone: c.phone ? String(c.phone) : undefined,
    });
  }

  logger.app("INFO", `webhooks:${topic} OK`, null, {
    shopId: dbShop.id,
    companyName,
    contactCount: contacts.length,
  });

  return new Response(null, { status: 200 });
}
