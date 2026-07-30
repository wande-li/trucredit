// Webhook handler: CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT (GDPR)
import type { WebhookContext, ShopifyPayload } from "./types";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

// ─── GDPR: Customers Data Request ──
export async function handleCustomersDataRequest(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain } = ctx;
  const customerId = String(payload.id ?? "");
  if (!shopDomain) return new Response(null, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true },
  });
  if (!shop) return new Response(null, { status: 200 });

  const customers = await prisma.customer.findMany({
    where: { shopId: shop.id, shopifyCustomerId: customerId },
    select: {
      email: true,
      name: true,
      company: true,
      phone: true,
      shopifyCustomerId: true,
      creditLimit: true,
      creditUsed: true,
      creditScore: true,
      creditGrade: true,
      invoices: {
        select: {
          invoiceNumber: true,
          amount: true,
          currency: true,
          status: true,
          issueDate: true,
          dueDate: true,
          paidDate: true,
          shopifyOrderName: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });

  logger.app("INFO", "webhooks:CUSTOMERS_DATA_REQUEST OK", null, {
    shopId: shop.id,
    customerId,
    recordCount: customers.length,
  });

  return Response.json(
    { shopDomain: shopDomain.trim(), customers },
    { status: 200 },
  );
}

// ─── GDPR: Customers Redact ──
export async function handleCustomersRedact(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain } = ctx;
  const customerId = String(payload.id ?? "");
  if (!shopDomain) return new Response(null, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true },
  });
  if (!shop) return new Response(null, { status: 200 });

  const now = new Date();
  const redactedTag = `redacted_${now.getTime()}`;

  const result = await prisma.customer.updateMany({
    where: { shopId: shop.id, shopifyCustomerId: customerId },
    data: {
      email: `${redactedTag}@privacy-deleted.example.com`,
      name: "Redacted Customer",
      company: null,
      phone: null,
      shopifyCustomerId: `REDACTED_${customerId}_${redactedTag}`,
    },
  });

  logger.app("INFO", "webhooks:CUSTOMERS_REDACT OK", null, {
    shopId: shop.id,
    customerId,
    updatedCount: result.count,
  });

  return new Response(null, { status: 200 });
}
