// Webhook handler: ORDERS_CANCELLED
import type { WebhookContext } from "./types";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export async function handleOrdersCancelled(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;
  const orderId = String(payload.id ?? "");

  let invoice = await prisma.invoice.findFirst({
    where: { shopifyOrderId: orderId, shop: { shopDomain: shopDomain?.trim() || undefined } },
    select: { id: true, customerId: true, amount: true, paidAmount: true, status: true },
  });

  // Fallback: draft-order-converted invoice
  if (!invoice && shopDomain) {
    invoice = await prisma.invoice.findFirst({
      where: {
        shop: { shopDomain: shopDomain.trim() },
        shopifyDraftOrderId: { not: null },
        shopifyOrderId: null,
        status: { not: "PAID" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, customerId: true, amount: true, paidAmount: true, status: true },
    });
  }

  if (invoice && invoice.status !== "PAID" && invoice.status !== "VOID") {
    // PARTIALLY_PAID: skip credit release (unknown paid amount, admin adjusts manually)
    const isPartiallyPaid = invoice.status === "PARTIALLY_PAID";
    const outstanding = Number(invoice.amount) - Number(invoice.paidAmount ?? 0);

    const creditOps = isPartiallyPaid
      ? []
      : [
          prisma.customer.update({
            where: { id: invoice.customerId },
            data: {
              creditUsed: { decrement: outstanding },
              creditAvailable: { increment: outstanding },
            },
          }),
        ];

    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "VOID", voidedAt: new Date() },
      }),
      ...creditOps,
      prisma.collectionTask.updateMany({
        where: { invoiceId: invoice.id, status: "ACTIVE" },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedReason: "cancelled",
        },
      }),
    ]);

    if (shopifyAdmin) {
      await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "webhooks:ORDERS_CANCELLED metafield_sync ERROR", msg);
      });
    }
  }

  return new Response(null, { status: 200 });
}
