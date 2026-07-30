// Webhook handler: REFUNDS_CREATE
import type { WebhookContext, ShopifyPayload } from "./types";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export async function handleRefundsCreate(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;

  // P0-1: Idempotency — prevent double credit release on Shopify retry
  const refundId = String(payload.id ?? "");
  const orderId = String(payload.order_id ?? "");
  const dedupTag = `refund:${refundId}:order:${orderId}`;
  if (refundId && orderId) {
    const dupEvent = await prisma.creditEvent.findFirst({
      where: {
        triggeredBy: "webhook:refunds_create",
        reason: { contains: dedupTag },
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // 30-min window
        customer: { shop: { shopDomain: shopDomain?.trim() || undefined } },
      },
      select: { id: true },
    });
    if (dupEvent) {
      logger.app("INFO", "webhooks:REFUNDS_CREATE duplicate_skipped OK", null, {
        refundId,
        orderId,
        previousEventId: dupEvent.id,
      });
      return new Response(null, { status: 200 });
    }
  }

  const refundLineItems: Array<{ quantity?: number; subtotal?: number | string }> =
    Array.isArray(payload.refund_line_items) ? payload.refund_line_items : [];
  let refundTotal = 0;
  for (const item of refundLineItems) {
    refundTotal += Number(item.subtotal ?? 0);
  }
  // Fallback: sum from transactions
  if (refundTotal === 0) {
    const txs: Array<{ amount?: string | number; kind?: string }> =
      Array.isArray(payload.transactions) ? payload.transactions : [];
    for (const tx of txs) {
      if (tx.kind === "refund") refundTotal += Number(tx.amount ?? 0);
    }
  }

  if (orderId && refundTotal > 0) {
    let invoice = await prisma.invoice.findFirst({
      where: { shopifyOrderId: orderId, shop: { shopDomain: shopDomain?.trim() || undefined } },
      select: { id: true, customerId: true, amount: true, status: true },
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
        select: { id: true, customerId: true, amount: true, status: true },
      });
    }

    if (invoice && invoice.status !== "VOID") {
      const invoiceAmount = Number(invoice.amount);
      const releasedAmount = Math.min(refundTotal, invoiceAmount);
      const remainingAfter = invoiceAmount - releasedAmount;
      const isFullyRefunded = remainingAfter <= 0.01;
      const wasAlreadyPaid = invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID";

      // P1-2: Fetch customer credit state BEFORE transaction for audit log
      const customer = await prisma.customer.findUnique({
        where: { id: invoice.customerId },
        select: { creditUsed: true, creditAvailable: true },
      });
      const prevCreditUsed = Number(customer?.creditUsed ?? 0);
      const prevCreditAvailable = Number(customer?.creditAvailable ?? 0);

      const creditTxn = wasAlreadyPaid
        ? []
        : [
            prisma.customer.update({
              where: { id: invoice.customerId },
              data: {
                creditUsed: { decrement: releasedAmount },
                creditAvailable: { increment: releasedAmount },
              },
            }),
            prisma.creditEvent.create({
              data: {
                customerId: invoice.customerId,
                type: "LIMIT_CHANGE",
                previousValue: { creditUsed: prevCreditUsed, creditAvailable: prevCreditAvailable },
                newValue: {
                  creditUsed: Math.max(0, prevCreditUsed - releasedAmount),
                  creditAvailable: prevCreditAvailable + releasedAmount,
                },
                reason: `Refund ${refundTotal} → ${releasedAmount} credit released, invoice #${invoice.id} [${dedupTag}]`,
                triggeredBy: "webhook:refunds_create",
              },
            }),
          ];

      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(isFullyRefunded
              ? { status: "VOID", voidedAt: new Date() }
              : { amount: remainingAfter }),
          },
        }),
        ...creditTxn,
        ...(isFullyRefunded
          ? [
              prisma.collectionTask.updateMany({
                where: { invoiceId: invoice.id, status: "ACTIVE" },
                data: { status: "COMPLETED" },
              }),
            ]
          : []),
      ]);

      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "webhooks:REFUNDS_CREATE metafield_sync ERROR", msg);
        });
      }

      logger.app("INFO", "webhooks:REFUNDS_CREATE OK", null, {
        orderId,
        refundTotal,
        releasedAmount,
        isFullyRefunded,
        invoiceId: invoice.id,
      });
    }
  }

  return new Response(null, { status: 200 });
}
