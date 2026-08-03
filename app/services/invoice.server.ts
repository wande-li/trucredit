// Invoice Service — AR management, aging, status transitions
// Server-only, follows Wandex pattern

import prisma from "~/db.server";
import { PAGINATION, COLLECTION } from "~/lib/constants";
import { calcOverdueDays } from "~/types/invoice";
import type { InvoiceStatus } from "@prisma/client";
import type {
  InvoiceRecord,
  InvoiceSummary,
  ARAgingReport,
  AgingBucket,
  PaginatedResult,
} from "~/types";
import { createCollectionDraftOrder } from "~/services/draft-order.server";
import { logger } from "~/services/logger.server";
import { generatePaymentToken, buildPaymentUrl } from "~/services/token.server";

// Reusable select row types to avoid implicit any
type InvListRow = {
  id: string; invoiceNumber: string; amount: { toString(): string };
  paidAmount?: number | { toString(): string };
  currency: string; issueDate: Date; dueDate: Date;
  status: InvoiceStatus; daysOverdue: number; netTermsDays: number;
  customer: { name: string; company: string | null };
};

type BaseRow = {
  id: string; invoiceNumber: string; amount: { toString(): string };
  paidAmount?: number | { toString(): string };
  currency: string; issueDate: Date; dueDate: Date;
  status: InvoiceStatus; daysOverdue: number; netTermsDays: number;
  customer: { name: string; company: string | null };
};

/**
 * Get single invoice with full details
 */
export async function getInvoice(params: {
  shopId: string;
  invoiceId: string;
}): Promise<InvoiceRecord | null> {
  logger.app("INFO", "invoice.getInvoice START", null, { shopId: params.shopId, invoiceId: params.invoiceId });
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, shopId: params.shopId },
  });

  if (!invoice) {
    logger.app("INFO", "invoice.getInvoice — not found", null, { shopId: params.shopId, invoiceId: params.invoiceId });
    return null;
  }
  logger.app("INFO", "invoice.getInvoice OK", null, { shopId: params.shopId, invoiceId: params.invoiceId });
  return { ...invoice, amount: invoice.amount.toString(), paidAmount: (invoice.paidAmount ?? 0).toString() };
}

/**
 * List invoices with filters and pagination
 */
export async function listInvoices(params: {
  shopId: string;
  search?: string;
  status?: string;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}): Promise<PaginatedResult<InvoiceSummary>> {
  const { shopId, search, status, customerId, dateFrom, dateTo } = params;
  logger.app("INFO", "invoice.listInvoices START", null, { shopId, page: params.page, search, status, customerId });
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(
    PAGINATION.MAX_PAGE_SIZE,
    params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE,
  );

  const where: Record<string, unknown> = { shopId };

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { shopifyOrderName: { contains: search, mode: "insensitive" } },
    ];
  }
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (dateFrom || dateTo) {
    where.issueDate = {};
    if (dateFrom) (where.issueDate as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.issueDate as Record<string, unknown>).lte = new Date(dateTo);
  }

  // P2: Dynamic sort
  const sortField = params.sortBy ?? "dueDate";
  const sortDir = params.sortOrder ?? "asc";
  const orderBy: Record<string, unknown> = {};
  orderBy[sortField] = sortDir;

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        status: true,
        daysOverdue: true,
        netTermsDays: true,
        customer: { select: { name: true, company: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: orderBy as Record<string, "asc" | "desc">,
    }),
    prisma.invoice.count({ where }),
  ]);

  logger.app("INFO", "invoice.listInvoices OK", null, { shopId, total, page });
  return {
    items: (items as InvListRow[]).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customer.name,
      customerCompany: inv.customer.company,
      amount: inv.amount.toString(),
      paidAmount: String(inv.paidAmount ?? 0),
      currency: inv.currency,
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      status: inv.status,
      daysOverdue: inv.daysOverdue,
      netTermsDays: inv.netTermsDays,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Generate AR Aging Report
 */
export async function getARAgingReport(shopId: string): Promise<ARAgingReport> {
  logger.app("INFO", "invoice.getARAgingReport START", null, { shopId });
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      shopId,
      status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      paidAmount: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      status: true,
      daysOverdue: true,
      netTermsDays: true,
      customer: { select: { name: true, company: true } },
    },
  });

  const bucketDefs: Array<{ label: string; min: number; max: number }> = [
    { label: "Current", min: -9999, max: 0 },
    { label: "1-30 Days", min: 1, max: 30 },
    { label: "31-60 Days", min: 31, max: 60 },
    { label: "61-90 Days", min: 61, max: 90 },
    { label: "90+ Days", min: 91, max: 9999 },
  ];

  // Single-pass bucketing: O(n) instead of iterating 5×n
  const bucketData = bucketDefs.map((def) => ({
    ...def,
    count: 0,
    totalAmount: 0,
    invoices: [] as BaseRow[],
  }));

  for (const inv of invoices as BaseRow[]) {
    const overdue = calcOverdueDays(inv.dueDate, now);
    const bucket = bucketData.find((b) => overdue >= b.min && overdue <= b.max);
    if (bucket) {
      bucket.count++;
      bucket.totalAmount += Number(inv.amount) - Number(inv.paidAmount ?? 0);
      bucket.invoices.push(inv);
    }
  }

  let totalOutstanding = 0;
  let totalOverdue = 0;
  const customerSet = new Set<string>();

  const buckets: AgingBucket[] = bucketData.map((b) => {
    totalOutstanding += b.totalAmount;
    if (["OVERDUE"].some((s) => b.invoices.some((inv) => inv.status === s))) {
      totalOverdue += b.invoices
        .filter((inv) => inv.status === "OVERDUE")
        .reduce((s, inv) => s + Number(inv.amount) - Number(inv.paidAmount ?? 0), 0);
    }
    for (const inv of b.invoices) customerSet.add(inv.customer.name);

    return {
      label: b.label,
      minDays: b.min === -9999 ? null : b.min,
      maxDays: b.max === 9999 ? null : b.max,
      count: b.count,
      totalAmount: b.totalAmount.toFixed(2),
      invoices: b.invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer.name,
        customerCompany: inv.customer.company,
        amount: inv.amount.toString(),
        paidAmount: (inv.paidAmount ?? 0).toString(),
        currency: inv.currency,
        issueDate: inv.issueDate.toISOString(),
        dueDate: inv.dueDate.toISOString(),
        status: inv.status,
        daysOverdue: inv.daysOverdue,
        netTermsDays: inv.netTermsDays,
      })),
    };
  });

  // DSO = (AR / Total Credit Sales) × Days
  const allPaidInvoices = await prisma.invoice.findMany({
    where: { shopId, status: "PAID" },
    select: { amount: true, paidDate: true, issueDate: true, dueDate: true },
    orderBy: { paidDate: "desc" },
    take: 90,
  });

  const recentSales = (allPaidInvoices as Array<{ amount: { toString(): string } }>).reduce(
    (sum: number, inv) => sum + Number(inv.amount), 0,
  );
  const dso =
    recentSales > 0
      ? Math.round((totalOutstanding / recentSales) * 90)
      : null;

  logger.app("INFO", "invoice.getARAgingReport OK", null, { shopId, totalInvoices: invoices.length, dso });
  return {
    shopId,
    totalOutstanding: totalOutstanding.toFixed(2),
    totalOverdue: totalOverdue.toFixed(2),
    totalCustomers: customerSet.size,
    totalInvoices: invoices.length,
    buckets,
    dso,
  };
}

/**
 * Update overdue days for all matching invoices — called by cron/sweeper
 */
export async function refreshOverdueDays(shopId: string): Promise<number> {
  logger.app("INFO", "invoice.refreshOverdueDays START", null, { shopId });
  const now = new Date();

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      shopId,
      status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
      dueDate: { lt: now },
    },
    select: { id: true, dueDate: true, daysOverdue: true, status: true },
  });

  let updated = 0;

  // Batch update: collect all changed invoices, then update concurrently in a transaction
  const changes: Array<{ id: string; daysOverdue: number; status?: InvoiceStatus }> = [];

  for (const inv of overdueInvoices) {
    const newDays = calcOverdueDays(inv.dueDate, now);
    if (newDays !== inv.daysOverdue) {
      // Preserve manual statuses (DISPUTED, PARTIALLY_PAID) — only auto-transition PENDING↔OVERDUE
      const shouldUpdateStatus = !["DISPUTED", "PARTIALLY_PAID"].includes(inv.status as string);
      changes.push({
        id: inv.id,
        daysOverdue: newDays,
        ...(shouldUpdateStatus ? { status: (newDays > 0 ? "OVERDUE" : "PENDING") as InvoiceStatus } : {}),
      });
    }
  }

  if (changes.length > 0) {
    await prisma.$transaction(
      changes.map((c) =>
        prisma.invoice.update({
          where: { id: c.id },
          data: { daysOverdue: c.daysOverdue, status: c.status },
        }),
      ),
    );
    updated = changes.length;
  }

  logger.app("INFO", "invoice.refreshOverdueDays OK", null, { shopId, updated });
  return updated;
}

/**
 * Create an invoice
 */
export async function createInvoice(params: {
  shopId: string;
  customerId: string;
  amount: number;
  currency?: string;
  netTermsDays?: number;
  invoiceNumber: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  shopifyDraftOrderId?: string;
  paymentUrl?: string;
}): Promise<InvoiceRecord> {
  logger.app("INFO", "invoice.createInvoice START", null, {
    shopId: params.shopId,
    customerId: params.customerId,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
  });
  const netTerms = params.netTermsDays ?? COLLECTION.DEFAULT_NET_TERMS;
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + netTerms);

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        shopId: params.shopId,
        customerId: params.customerId,
        invoiceNumber: params.invoiceNumber,
        amount: params.amount,
        currency: params.currency ?? "USD",
        issueDate,
        dueDate,
        netTermsDays: netTerms,
        status: "PENDING",
        shopifyOrderId: params.shopifyOrderId,
        shopifyOrderName: params.shopifyOrderName,
        shopifyDraftOrderId: params.shopifyDraftOrderId,
        paymentUrl: params.paymentUrl,
      },
    });

    // Atomic credit utilization — no read-then-write race
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: params.customerId },
      select: { creditLimit: true, creditUsed: true, email: true, shopifyCustomerId: true },
    });

    await tx.customer.update({
      where: { id: params.customerId },
      data: {
        creditUsed: { increment: params.amount },
        creditAvailable: { decrement: params.amount },
        totalOrders: { increment: 1 },
        totalRevenue: { increment: params.amount },
      },
    });

    return { inv, customer };
  });

  // Generate tokenized payment link for collection emails
  const paymentToken = generatePaymentToken({
    shopId: params.shopId,
    customerId: params.customerId,
    invoiceId: invoice.inv.id,
  });
  const paymentUrl = buildPaymentUrl(paymentToken);

  // Persist payment URL on the invoice record
  await prisma.invoice.update({
    where: { id: invoice.inv.id },
    data: { paymentUrl },
  });

  // Fire-and-forget: create Shopify draft order to generate real payment link for collection emails
  const customerEmail = invoice.customer.email;
  const customerShopifyId = invoice.customer.shopifyCustomerId;
  if (customerEmail && customerShopifyId) {
    void createCollectionDraftOrder({
      shopId: params.shopId,
      customerId: params.customerId,
      invoiceId: invoice.inv.id,
      invoiceNumber: invoice.inv.invoiceNumber,
      amount: params.amount,
      currency: params.currency ?? "USD",
      customerEmail,
      shopifyCustomerId: customerShopifyId,
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "invoice.createInvoice — draft order creation failed", msg, { invoiceId: invoice.inv.id });
    });
  }

  logger.app("INFO", "invoice.createInvoice OK", null, { shopId: params.shopId, invoiceId: invoice.inv.id });
  logger.metrics("invoice.created", 1, { shopId: params.shopId });
  return { ...invoice.inv, amount: invoice.inv.amount.toString(), paidAmount: (invoice.inv.paidAmount ?? 0).toString(), paymentUrl };
}

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(params: {
  shopId: string;
  invoiceId: string;
  paymentMethod?: string;
}): Promise<InvoiceRecord> {
  logger.app("INFO", "invoice.markInvoicePaid START", null, { shopId: params.shopId, invoiceId: params.invoiceId });
  const paidDate = new Date();

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirstOrThrow({
      where: { id: params.invoiceId, shopId: params.shopId },
    });

    if (invoice.status === "PAID") {
      return { ...invoice, amount: invoice.amount.toString(), paidAmount: (invoice.paidAmount ?? 0).toString() };
    }

    // Calculate outstanding: only release remaining credit, not the full original amount
    const existingPaid = Number(invoice.paidAmount ?? 0);
    const outstandingAmount = Number(invoice.amount) - existingPaid;

    // Create payment record before updating invoice
    await tx.payment.create({
      data: {
        shopId: params.shopId,
        invoiceId: params.invoiceId,
        customerId: invoice.customerId,
        amount: outstandingAmount > 0 ? outstandingAmount : Number(invoice.amount),
        paymentMethod: params.paymentMethod ?? invoice.paymentMethod,
        paymentDate: paidDate,
      },
    });

    const updated = await tx.invoice.update({
      where: { id: params.invoiceId },
      data: {
        status: "PAID",
        paidDate,
        daysOverdue: 0,
        paymentMethod: params.paymentMethod,
        paidAmount: invoice.amount, // fully paid = original amount
      },
    });

    // Update customer credit utilization and payment stats
    // Payment stats (onTimeRate/avgPaymentDays) need absolute reads — safe inside $transaction
    const paidHistory: Array<{ dueDate: Date; paidDate: Date }> = await tx.invoice.findMany({
      where: {
        customerId: invoice.customerId,
        status: "PAID",
        paidDate: { not: null },
      },
      select: { dueDate: true, paidDate: true },
    }) as Array<{ dueDate: Date; paidDate: Date }>;

    const onTimeCount = paidHistory.filter(
      (inv) => inv.paidDate <= inv.dueDate,
    ).length;

    const onTimeRate =
      paidHistory.length > 0
        ? onTimeCount / paidHistory.length
        : null;

    const paymentDays = paidHistory.map(
      (inv) =>
        (inv.paidDate.getTime() - inv.dueDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const avgPaymentDays =
      paymentDays.length > 0
        ? paymentDays.reduce((s: number, d: number) => s + d, 0) / paymentDays.length
        : null;

    // Only release outstanding credit (if partial payments already reduced it)
    if (outstandingAmount > 0) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: {
          creditUsed: { decrement: outstandingAmount },
          creditAvailable: { increment: outstandingAmount },
          onTimePaymentRate: onTimeRate,
          avgPaymentDays,
          lastPaymentDate: paidDate,
        },
      });
    }

    // Auto-complete any related collection tasks
    await tx.collectionTask.updateMany({
      where: {
        invoiceId: params.invoiceId,
        status: { in: ["PENDING", "ACTIVE", "PAUSED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: paidDate,
        completedReason: "Invoice paid",
      },
    });

    logger.app("INFO", "invoice.markInvoicePaid OK", null, { shopId: params.shopId, invoiceId: params.invoiceId });
    return { ...updated, amount: updated.amount.toString(), paidAmount: (updated.paidAmount ?? 0).toString() };
  });
}

/**
 * Get per-customer AR aging breakdown
 */
export async function getARAgingByCustomer(params: {
  shopId: string;
  customerId: string;
}): Promise<{
  totalOutstanding: string;
  totalOverdue: string;
  invoiceCount: number;
  buckets: Array<{ label: string; count: number; totalAmount: string }>;
  invoices: InvoiceSummary[];
}> {
  const { shopId, customerId } = params;
  logger.app("INFO", "invoice.getARAgingByCustomer START", null, { shopId, customerId });
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      shopId,
      customerId,
      status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      paidAmount: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      status: true,
      daysOverdue: true,
      netTermsDays: true,
      customer: { select: { name: true, company: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const bucketDefs: Array<{ label: string; min: number; max: number }> = [
    { label: "Current", min: -9999, max: 0 },
    { label: "1-30 Days", min: 1, max: 30 },
    { label: "31-60 Days", min: 31, max: 60 },
    { label: "61-90 Days", min: 61, max: 90 },
    { label: "90+ Days", min: 91, max: 9999 },
  ];

  const buckets = bucketDefs.map((def) => {
    const filtered = (invoices as BaseRow[]).filter((inv) => {
      const overdue = calcOverdueDays(inv.dueDate, now);
      return overdue >= def.min && overdue <= def.max;
    });
    return {
      label: def.label,
      count: filtered.length,
      totalAmount: filtered.reduce((sum, inv) => sum + Number(inv.amount) - Number(inv.paidAmount ?? 0), 0).toFixed(2),
    };
  });

  const totalOutstanding = (invoices as BaseRow[])
    .reduce((sum, inv) => sum + Number(inv.amount) - Number(inv.paidAmount ?? 0), 0)
    .toFixed(2);
  const totalOverdue = (invoices as BaseRow[])
    .filter((inv) => inv.status === "OVERDUE")
    .reduce((sum, inv) => sum + Number(inv.amount) - Number(inv.paidAmount ?? 0), 0)
    .toFixed(2);

  const invoiceSummaries: InvoiceSummary[] = (invoices as InvListRow[]).map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customer.name,
    customerCompany: inv.customer.company,
    amount: inv.amount.toString(),
    paidAmount: inv.paidAmount ? (typeof inv.paidAmount === "number" ? inv.paidAmount.toString() : inv.paidAmount.toString()) : "0",
    currency: inv.currency,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    status: inv.status,
    daysOverdue: inv.daysOverdue,
    netTermsDays: inv.netTermsDays,
  }));

  logger.app("INFO", "invoice.getARAgingByCustomer OK", null, { shopId, customerId, invoiceCount: invoices.length });
  return {
    totalOutstanding,
    totalOverdue,
    invoiceCount: invoices.length,
    buckets,
    invoices: invoiceSummaries,
  };
}

/**
 * Get next invoice sequence number for a shop
 */
export async function getNextInvoiceSequence(shopId: string): Promise<number> {
  logger.app("INFO", "invoice.getNextInvoiceSequence START", null, { shopId });
  const count = await prisma.invoice.count({ where: { shopId } });
  const nextSeq = count + 1;
  logger.app("INFO", "invoice.getNextInvoiceSequence OK", null, { shopId, nextSeq });
  return nextSeq;
}

/**
 * P2: Update invoice fields (amount, netTermsDays)
 */
export async function updateInvoice(params: {
  shopId: string;
  invoiceId: string;
  amount?: number;
  netTermsDays?: number;
}): Promise<InvoiceRecord> {
  logger.app("INFO", "invoice.updateInvoice START", null, { shopId: params.shopId, invoiceId: params.invoiceId });
  const data: Record<string, unknown> = {};
  if (params.amount !== undefined) data.amount = params.amount;
  if (params.netTermsDays !== undefined) data.netTermsDays = params.netTermsDays;

  const updated = await prisma.invoice.update({
    where: { id: params.invoiceId, shopId: params.shopId },
    data,
  });

  logger.app("INFO", "invoice.updateInvoice OK", null, { shopId: params.shopId, invoiceId: params.invoiceId });
  return { ...updated, amount: updated.amount.toString(), paidAmount: (updated.paidAmount ?? 0).toString() };
}

/**
 * P2: Bulk mark invoices as paid
 */
export async function bulkMarkInvoicePaid(params: {
  shopId: string;
  invoiceIds: string[];
  paymentMethod?: string;
}): Promise<number> {
  const { shopId, invoiceIds, paymentMethod } = params;
  logger.app("INFO", "invoice.bulkMarkInvoicePaid START", null, { shopId, count: invoiceIds.length });
  let count = 0;

  await prisma.$transaction(async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { id: { in: invoiceIds }, shopId, status: { notIn: ["PAID", "VOID"] } },
      select: { id: true, customerId: true, amount: true, paidAmount: true },
    });

    // P0-5: Parallel bulk update — replaces N+1 sequential loop
    await Promise.all(invoices.map(async (inv) => {
      // Create payment record for each invoice
      await tx.payment.create({
        data: {
          shopId,
          invoiceId: inv.id,
          customerId: inv.customerId,
          amount: inv.amount,
          paymentMethod: paymentMethod ?? "Manual/Bulk",
          paymentDate: new Date(),
        },
      });

      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: "PAID",
          paidDate: new Date(),
          daysOverdue: 0,
          paymentMethod: paymentMethod ?? "Manual/Bulk",
          paidAmount: inv.amount, // fully paid
        },
      });

      // Only release outstanding credit
      const outstanding = Number(inv.amount) - Number(inv.paidAmount ?? 0);
      if (outstanding > 0) {
        await tx.customer.update({
          where: { id: inv.customerId },
          data: {
            creditUsed: { decrement: outstanding },
            creditAvailable: { increment: outstanding },
          },
        });
      }

      await tx.collectionTask.updateMany({
        where: { invoiceId: inv.id, status: "ACTIVE" },
        data: { status: "COMPLETED", completedAt: new Date(), completedReason: "bulk-paid" },
      });

      count++;
    }));
  });

  logger.app("INFO", "invoice.bulkMarkInvoicePaid OK", null, { shopId, paid: count });
  return count;
}

/**
 * P2: Record partial payment against an invoice
 */
export async function recordPartialPayment(params: {
  shopId: string;
  invoiceId: string;
  paymentAmount: number;
  paymentMethod?: string;
}): Promise<InvoiceRecord> {
  const { shopId, invoiceId, paymentAmount, paymentMethod } = params;
  logger.app("INFO", "invoice.recordPartialPayment START", null, { shopId, invoiceId, paymentAmount });
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirstOrThrow({
      where: { id: invoiceId, shopId },
    });

    if (invoice.status === "PAID" || invoice.status === "VOID") {
      throw new Error(`Cannot record payment against a ${invoice.status.toLowerCase()} invoice`);
    }

    const originalAmount = Number(invoice.amount);
    const existingPaid = Number(invoice.paidAmount ?? 0);
    const outstanding = originalAmount - existingPaid;

    if (paymentAmount <= 0 || paymentAmount > outstanding) {
      throw new Error("Payment amount must be between 0 and the outstanding balance");
    }

    const newPaidAmount = existingPaid + paymentAmount;
    const isFullyPaid = newPaidAmount >= originalAmount - 0.001; // floating point tolerance

    // Create payment record before updating invoice
    await tx.payment.create({
      data: {
        shopId,
        invoiceId,
        customerId: invoice.customerId,
        amount: paymentAmount,
        paymentMethod: paymentMethod ?? invoice.paymentMethod,
        paymentDate: new Date(),
      },
    });

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: newPaidAmount,
        status: isFullyPaid ? "PAID" : "PARTIALLY_PAID",
        paidDate: isFullyPaid ? new Date() : invoice.paidDate ?? new Date(),
        daysOverdue: isFullyPaid ? 0 : undefined,
        paymentMethod: paymentMethod ?? invoice.paymentMethod,
      },
    });

    // Update customer credit utilization
    await tx.customer.update({
      where: { id: invoice.customerId },
      data: {
        creditUsed: { decrement: paymentAmount },
        creditAvailable: { increment: paymentAmount },
      },
    });

    if (isFullyPaid) {
      // Auto-complete collection tasks on full payment
      await tx.collectionTask.updateMany({
        where: { invoiceId, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedReason: "Invoice paid via partial payment",
        },
      });
    }

    return { ...updated, amount: updated.amount.toString(), paidAmount: (updated.paidAmount ?? 0).toString() };
  });
  logger.app("INFO", "invoice.recordPartialPayment OK", null, { shopId, invoiceId, paymentAmount });
  return result;
}

/**
 * Get invoice for buyer-facing payment page (no admin auth required).
 * Validates token ownership: shopId + customerId + invoiceId must all match.
 */
export async function getInvoiceForPayment(params: {
  invoiceId: string;
  shopId: string;
  customerId: string;
}): Promise<{
  invoice: InvoiceRecord;
  customer: { id: string; name: string; company: string | null; email: string };
  shop: { shopDomain: string };
} | null> {
  const { invoiceId, shopId, customerId } = params;
  logger.app("INFO", "invoice.getInvoiceForPayment START", null, { shopId, customerId, invoiceId });

  const result = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      shopId,
      customerId,
      status: { notIn: ["VOID", "DRAFT"] },
    },
    include: {
      customer: { select: { id: true, name: true, company: true, email: true } },
      shop: { select: { shopDomain: true } },
    },
  });

  if (!result) {
    logger.app("WARN", "invoice.getInvoiceForPayment — not found or ownership mismatch", undefined, {
      shopId,
      customerId,
      invoiceId,
    });
    return null;
  }

  const { customer, shop, ...invoiceFields } = result;
  logger.app("INFO", "invoice.getInvoiceForPayment OK", null, { shopId, invoiceId });
  return {
    invoice: {
      ...invoiceFields,
      amount: invoiceFields.amount.toString(),
      paidAmount: (invoiceFields.paidAmount ?? 0).toString(),
    } as InvoiceRecord,
    customer,
    shop,
  };
}

/**
 * Get payment history for an invoice (all Payment records)
 */
export async function getPaymentHistory(invoiceId: string, shopId: string): Promise<Array<{
  id: string;
  amount: string;
  paymentMethod: string | null;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}>> {
  logger.app("INFO", "invoice.getPaymentHistory START", null, { shopId, invoiceId });
  const payments = await prisma.payment.findMany({
    where: { invoiceId, shopId },
    orderBy: { paymentDate: "desc" },
    select: {
      id: true,
      amount: true,
      paymentMethod: true,
      paymentDate: true,
      reference: true,
      notes: true,
      createdAt: true,
    },
  });

  const result = payments.map((p) => ({
    id: p.id,
    amount: p.amount.toString(),
    paymentMethod: p.paymentMethod,
    paymentDate: p.paymentDate.toISOString(),
    reference: p.reference,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  }));

  logger.app("INFO", "invoice.getPaymentHistory OK", null, { shopId, invoiceId, count: result.length });
  return result;
}
