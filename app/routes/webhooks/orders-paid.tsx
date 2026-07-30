// Webhook handler: ORDERS_PAID / ORDERS_UPDATED
import type { WebhookContext, ShopifyPayload } from "./types";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

// ─── Order Paid — release credit + mark PAID ──
export async function handleOrdersPaid(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;
  const orderId = String(payload.id ?? "");

  let invoice = await prisma.invoice.findFirst({
    where: { shopifyOrderId: orderId, shop: { shopDomain: shopDomain?.trim() || undefined } },
    select: { id: true, customerId: true, amount: true, status: true },
  });

  // Fallback: DRAFT_ORDERS_COMPLETE webhook might not have been processed yet.
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
    if (invoice) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { shopifyOrderId: orderId },
      });
      logger.app("INFO", "webhooks:ORDERS_PAID fallback_bridged OK", null, {
        invoiceId: invoice.id,
        orderId,
      });
    }
  }

  if (invoice && invoice.status !== "PAID") {
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidDate: new Date() },
      }),
      prisma.customer.update({
        where: { id: invoice.customerId },
        data: {
          creditUsed: { decrement: Number(invoice.amount) },
          creditAvailable: { increment: Number(invoice.amount) },
        },
      }),
      prisma.collectionTask.updateMany({
        where: { invoiceId: invoice.id, status: "ACTIVE" },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedReason: "paid",
        },
      }),
    ]);

    if (shopifyAdmin) {
      await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "webhooks:ORDERS_PAID metafield_sync ERROR", msg);
      });
    }
  }

  return new Response(null, { status: 200 });
}

// ─── Order Updated ──
export async function handleOrdersUpdated(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;
  const orderId = String(payload.id ?? "");
  const financialStatus = String(payload.financial_status ?? "pending");

  if (financialStatus === "paid") {
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
      if (invoice) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { shopifyOrderId: orderId },
        });
      }
    }

    if (invoice && invoice.status !== "PAID") {
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "PAID", paidDate: new Date() },
        }),
        prisma.customer.update({
          where: { id: invoice.customerId },
          data: {
            creditUsed: { decrement: Number(invoice.amount) },
            creditAvailable: { increment: Number(invoice.amount) },
          },
        }),
        prisma.collectionTask.updateMany({
          where: { invoiceId: invoice.id, status: "ACTIVE" },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedReason: "paid",
          },
        }),
      ]);

      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "webhooks:ORDERS_UPDATED metafield_sync ERROR", msg);
        });
      }
    }
  }

  // P1-1: Sync invoice amount when order total changes (non-payment updates)
  if (financialStatus !== "paid") {
    const currentTotal = Number(payload.total_price ?? 0);
    if (currentTotal > 0) {
      const syncInvoice = await prisma.invoice.findFirst({
        where: { shopifyOrderId: orderId, status: { notIn: ["PAID", "VOID"] }, shop: { shopDomain: shopDomain?.trim() || undefined } },
        select: { id: true, amount: true },
      });
      if (syncInvoice && Number(syncInvoice.amount) !== currentTotal) {
        await prisma.invoice.update({
          where: { id: syncInvoice.id },
          data: { amount: currentTotal },
        });
        logger.app("INFO", "webhooks:ORDERS_UPDATED amount_synced OK", null, {
          orderId,
          invoiceId: syncInvoice.id,
          oldAmount: syncInvoice.amount,
          newAmount: currentTotal,
        });
      }
    }
  }

  return new Response(null, { status: 200 });
}
