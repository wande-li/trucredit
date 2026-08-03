// Webhook handler: ORDERS_CREATE / DRAFT_ORDERS_COMPLETE / DRAFT_ORDERS_DELETE
import type { WebhookContext, ShopifyPayload } from "./types";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import { toGid } from "~/lib/shopify-id";
import prisma from "~/db.server";

export async function handleOrdersCreate(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;

  const orderingCustomerId = payload.customer && typeof payload.customer === "object"
    ? String((payload.customer as ShopifyPayload).id ?? "")
    : "";

  if (!orderingCustomerId || !shopDomain) {
    return new Response(null, { status: 200 });
  }

  const dbShop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true },
  });
  if (!dbShop) return new Response(null, { status: 200 });

  // Find customer by Shopify customer ID (more reliable than email)
  const customer = await prisma.customer.findFirst({
    where: {
      shopId: dbShop.id,
      shopifyCustomerId: orderingCustomerId,
      creditLimit: { gt: 0 },
    },
    select: { id: true },
  });
  if (!customer) return new Response(null, { status: 200 });

  const orderId = String(payload.id ?? "");
  const orderName = payload.name ? String(payload.name) : `#${orderId}`;
  const totalPrice = Number(payload.total_price ?? 0);
  const currency = String(payload.currency ?? "USD");
  const sourceName = String(payload.source_name ?? "");

  const existing = await prisma.invoice.findFirst({
    where: { shopifyOrderId: orderId, shopId: dbShop.id },
    select: { id: true },
  });

  // Prevent duplicate: if this order came from a draft conversion, link to existing manual invoice
  if (!existing && sourceName === "draft_order") {
    const draftInvoice = await prisma.invoice.findFirst({
      where: {
        shopId: dbShop.id,
        customerId: customer.id,
        shopifyDraftOrderId: { not: null },
        shopifyOrderId: null,
        status: { not: "PAID" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (draftInvoice) {
      await prisma.invoice.update({
        where: { id: draftInvoice.id },
        data: { shopifyOrderId: orderId, shopifyOrderName: orderName },
      });
      logger.app("INFO", "webhooks:ORDERS_CREATE linked_draft OK", null, {
        invoiceId: draftInvoice.id,
        orderId,
        orderName,
      });
      return new Response(null, { status: 200 });
    }
  }

  if (!existing && totalPrice > 0) {
    const dueDays = 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    await prisma.$transaction(async (tx) => {
      await tx.invoice.create({
        data: {
          shopId: dbShop.id,
          customerId: customer.id,
          invoiceNumber: orderName.replace("#", ""),
          amount: totalPrice,
          currency,
          issueDate: new Date(),
          dueDate,
          status: "PENDING",
          shopifyOrderId: orderId,
          shopifyOrderName: orderName,
        },
      });

      // Occupy credit
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          creditUsed: { increment: totalPrice },
          creditAvailable: { decrement: totalPrice },
        },
      });
    });

    // Sync metafield for Shopify Function
    if (shopifyAdmin) {
      await syncCreditMetafield(shopifyAdmin, shopDomain, customer.id).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.app("WARN", "webhooks:ORDERS_CREATE metafield_sync failed", msg);
      });
    }

    logger.app("INFO", "webhooks:ORDERS_CREATE invoice_created OK", null, {
      shopId: dbShop.id,
      customerId: customer.id,
      orderName,
      totalPrice,
    });
  }

  return new Response(null, { status: 200 });
}

// ─── Draft Order Complete — bridge DraftOrder → Order ID ──
export async function handleDraftOrdersComplete(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain } = ctx;

  const draftOrderId = String(payload.id ?? "");
  const resultingOrderId = payload.order_id ? String(payload.order_id) : "";

  if (draftOrderId && resultingOrderId && shopDomain) {
    const draftOrderGid = toGid(draftOrderId, "DraftOrder");

    const result = await prisma.invoice.updateMany({
      where: {
        shop: { shopDomain: shopDomain.trim() },
        shopifyDraftOrderId: draftOrderGid,
        shopifyOrderId: null,
      },
      data: { shopifyOrderId: resultingOrderId },
    });

    if (result.count > 0) {
      logger.app("INFO", "webhooks:DRAFT_ORDERS_COMPLETE bridged OK", null, {
        shopDomain: shopDomain.trim(),
        draftOrderId,
        resultingOrderId,
        updatedInvoices: result.count,
      });
    }
  }

  return new Response(null, { status: 200 });
}

// ─── Draft Order Deleted — void linked invoice + release credit ──
export async function handleDraftOrdersDelete(ctx: WebhookContext): Promise<Response> {
  const { payload, shopDomain, shopifyAdmin } = ctx;

  const draftOrderId = String(payload.id ?? "");
  if (draftOrderId && shopDomain) {
    const draftOrderGid = toGid(draftOrderId, "DraftOrder");
    const invoice = await prisma.invoice.findFirst({
      where: {
        shop: { shopDomain: shopDomain.trim() },
        shopifyDraftOrderId: draftOrderGid,
        status: { notIn: ["PAID", "VOID"] },
      },
      select: { id: true, customerId: true, amount: true, paidAmount: true, status: true },
    });

    if (invoice) {
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "VOID", voidedAt: new Date() },
        }),
        prisma.customer.update({
          where: { id: invoice.customerId },
          data: {
            creditUsed: { decrement: Number(invoice.amount) - Number(invoice.paidAmount ?? 0) },
            creditAvailable: { increment: Number(invoice.amount) - Number(invoice.paidAmount ?? 0) },
          },
        }),
        prisma.collectionTask.updateMany({
          where: { invoiceId: invoice.id, status: "ACTIVE" },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedReason: "draft_order_deleted",
          },
        }),
      ]);

      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.app("WARN", "webhooks:DRAFT_ORDERS_DELETE metafield_sync failed", msg);
        });
      }

      logger.app("INFO", "webhooks:DRAFT_ORDERS_DELETE invoice_voided OK", null, {
        shopDomain: shopDomain.trim(),
        draftOrderId,
        invoiceId: invoice.id,
      });
    }
  }

  return new Response(null, { status: 200 });
}
