import { type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { handleSubscriptionUpdate } from "~/services/billing.server";
import { upsertCustomerFromShopify } from "~/services/customer.server";
import { upsertCompanyContact } from "~/services/company.server";
import { syncCreditMetafield } from "~/services/metafield.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

// Shopify webhook payloads are dynamic — safe to use index access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SP = Record<string, any>;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, payload, admin } = await authenticate.webhook(request);
  const p = payload as SP;
  const shopDomain: string = String(p.shop_domain || p.myshopify_domain || "");
  const shopifyAdmin = admin; // may be undefined, guard before use

  // ─── App Uninstall ────────────────────────────────
  if (topic === "APP_UNINSTALLED") {
    if (shopDomain) {
      await prisma.shop.updateMany({
        where: { shopDomain: shopDomain.trim() },
        data: { uninstalledAt: new Date() },
      });
    }
    return new Response(null, { status: 200 });
  }

  // ─── Subscription Update ──────────────────────────
  if (topic === "APP_SUBSCRIPTIONS_UPDATE") {
    const domain = shopDomain || String(p.shop_domain || p.myshopify_domain || "");
    if (!domain) throw new Response("Missing shop domain", { status: 400 });

    const sub = p.app_subscription as SP | undefined;
    const charge = {
      id: String(sub?.admin_graphql_api_id || sub?.id || ""),
      name: String(sub?.name || ""),
      status: String(sub?.status || "UNKNOWN"),
      currentPeriodEnd: sub?.current_period_end as string | undefined,
      trialDays: sub?.trial_days as number | undefined,
      cancelledAt: sub?.cancelled_at as string | undefined,
      price: sub?.capped_amount || sub?.price,
    };

    await handleSubscriptionUpdate(String(domain).trim(), charge);
    return new Response(null, { status: 200 });
  }

  // ─── Customer Update ──────────────────────────────
  if (topic === "CUSTOMERS_UPDATE") {
    if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });

    const dbShop = await prisma.shop.findUnique({
      where: { shopDomain: shopDomain.trim() },
      select: { id: true },
    });
    if (!dbShop) throw new Response("Shop not found", { status: 404 });

    const shopifyCustomerId = String(p.id);
    const email = String(p.email || "");
    const name = `${String(p.first_name || "")} ${String(p.last_name || "")}`.trim() || email;
    const company: string | undefined = p.default_address?.company || undefined;
    const phone: string | undefined = p.phone || undefined;

    if (email) {
      await upsertCustomerFromShopify({
        shopId: dbShop.id,
        shopifyCustomerId,
        email,
        name: name || email,
        company,
        phone,
      });
    }

    return new Response(null, { status: 200 });
  }

  // ─── Company Create / Update ──────────────────────
  if (topic === "COMPANIES_CREATE" || topic === "COMPANIES_UPDATE") {
    if (!shopDomain) throw new Response("Missing shop domain", { status: 400 });

    const dbShop = await prisma.shop.findUnique({
      where: { shopDomain: shopDomain.trim() },
      select: { id: true },
    });
    if (!dbShop) throw new Response("Shop not found", { status: 404 });

    const companyName = String(p.name || "");
    const contacts: Array<{
      id: string;
      customer?: { id: string; email?: string; firstName?: string; lastName?: string; phone?: string };
    }> = Array.isArray(p.contacts) ? p.contacts : [];

    for (const contact of contacts) {
      const c = contact.customer;
      if (!c?.id || !c?.email) continue;

      await upsertCompanyContact(dbShop.id, {
        shopifyCustomerId: String(c.id),
        email: String(c.email),
        firstName: c.firstName ? String(c.firstName) : undefined,
        lastName: c.lastName ? String(c.lastName) : undefined,
        companyName,
        phone: c.phone ? String(c.phone) : undefined,
      });
    }

    logger.app("INFO", `Company ${topic} processed`, {
      shopId: dbShop.id,
      companyName,
      contactCount: contacts.length,
    });

    return new Response(null, { status: 200 });
  }

  // ─── Order Create — occupy credit + create invoice ─
  if (topic === "ORDERS_CREATE") {
    const orderingCustomerId = p.customer && typeof p.customer === "object"
      ? String((p.customer as SP).id ?? "")
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

    const orderId = String(p.id ?? "");
    const orderName = p.name ? String(p.name) : `#${orderId}`;
    const totalPrice = Number(p.total_price ?? 0);
    const currency = String(p.currency ?? "USD");

    const existing = await prisma.invoice.findFirst({
      where: { shopifyOrderId: orderId, shopId: dbShop.id },
      select: { id: true },
    });

    if (!existing && totalPrice > 0) {
      const dueDays = 30;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + dueDays);

      await prisma.invoice.create({
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
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          creditUsed: { increment: totalPrice },
          creditAvailable: { decrement: totalPrice },
        },
      });

      // Sync metafield for Shopify Function
      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, customer.id).catch(() => {});
      }

      logger.app("INFO", "Invoice created from order", {
        shopId: dbShop.id,
        customerId: customer.id,
        orderName,
        totalPrice,
      });
    }

    return new Response(null, { status: 200 });
  }

  // ─── Order Paid — release credit + mark PAID ──────
  if (topic === "ORDERS_PAID") {
    const orderId = String(p.id ?? "");

    const invoice = await prisma.invoice.findFirst({
      where: { shopifyOrderId: orderId },
      select: { id: true, customerId: true, amount: true },
    });

    if (invoice) {
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

      // Sync metafield
      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch(() => {});
      }
    }

    return new Response(null, { status: 200 });
  }

  // ─── Order Updated ────────────────────────────────
  if (topic === "ORDERS_UPDATED") {
    const orderId = String(p.id ?? "");
    const financialStatus = String(p.financial_status ?? "pending");

    if (financialStatus === "paid") {
      const invoice = await prisma.invoice.findFirst({
        where: { shopifyOrderId: orderId },
        select: { id: true, customerId: true, amount: true, status: true },
      });

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
        ]);

        if (shopifyAdmin) {
          await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch(() => {});
        }
      }
    }

    return new Response(null, { status: 200 });
  }

  // ─── Order Cancelled ──────────────────────────────
  if (topic === "ORDERS_CANCELLED") {
    const orderId = String(p.id ?? "");

    const invoice = await prisma.invoice.findFirst({
      where: { shopifyOrderId: orderId },
      select: { id: true, customerId: true, amount: true, status: true },
    });

    if (invoice && invoice.status !== "PAID") {
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "VOID" },
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
            completedReason: "cancelled",
          },
        }),
      ]);

      if (shopifyAdmin) {
        await syncCreditMetafield(shopifyAdmin, shopDomain, invoice.customerId).catch(() => {});
      }
    }

    return new Response(null, { status: 200 });
  }

  throw new Response(`Unhandled webhook topic: ${topic}`, { status: 400 });
};
