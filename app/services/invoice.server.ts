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

// Reusable select row types to avoid implicit any
type InvListRow = {
  id: string; invoiceNumber: string; amount: { toString(): string };
  currency: string; issueDate: Date; dueDate: Date;
  status: InvoiceStatus; daysOverdue: number; netTermsDays: number;
  customer: { name: string; company: string | null };
};

type BaseRow = {
  id: string; invoiceNumber: string; amount: { toString(): string };
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
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, shopId: params.shopId },
  });

  if (!invoice) return null;
  return { ...invoice, amount: invoice.amount.toString() };
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
}): Promise<PaginatedResult<InvoiceSummary>> {
  const { shopId, search, status, customerId, dateFrom, dateTo } = params;
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
      orderBy: { dueDate: "asc" },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    items: (items as InvListRow[]).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customer.name,
      customerCompany: inv.customer.company,
      amount: inv.amount.toString(),
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
      bucket.totalAmount += Number(inv.amount);
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
        .reduce((s, inv) => s + Number(inv.amount), 0);
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
  const now = new Date();

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      shopId,
      status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
      dueDate: { lt: now },
    },
    select: { id: true, dueDate: true, daysOverdue: true },
  });

  let updated = 0;

  // Batch update: collect all changed invoices, then update concurrently in a transaction
  const changes: Array<{ id: string; daysOverdue: number; status: InvoiceStatus }> = [];

  for (const inv of overdueInvoices) {
    const newDays = calcOverdueDays(inv.dueDate, now);
    if (newDays !== inv.daysOverdue) {
      changes.push({
        id: inv.id,
        daysOverdue: newDays,
        status: newDays > 0 ? "OVERDUE" : "PENDING",
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
  const netTerms = params.netTermsDays ?? COLLECTION.DEFAULT_NET_TERMS;
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + netTerms);

  const invoice = await prisma.invoice.create({
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

  // Update customer credit utilization
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: params.customerId },
  });
  const newUsed = Number(customer.creditUsed) + params.amount;

  await prisma.customer.update({
    where: { id: params.customerId },
    data: {
      creditUsed: newUsed,
      creditAvailable: Math.max(0, Number(customer.creditLimit) - newUsed),
      totalOrders: { increment: 1 },
      totalRevenue: { increment: params.amount },
    },
  });

  return { ...invoice, amount: invoice.amount.toString() };
}

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(params: {
  shopId: string;
  invoiceId: string;
  paymentMethod?: string;
}): Promise<InvoiceRecord> {
  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { id: params.invoiceId, shopId: params.shopId },
  });

  const paidDate = new Date();

  const updated = await prisma.invoice.update({
    where: { id: params.invoiceId },
    data: {
      status: "PAID",
      paidDate,
      daysOverdue: 0,
      paymentMethod: params.paymentMethod,
    },
  });

  // Update customer credit utilization and payment stats
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: invoice.customerId },
  });

  const newUsed = Math.max(0, Number(customer.creditUsed) - Number(invoice.amount));

  // Calculate new on-time rate
  const paidHistory: Array<{ dueDate: Date; paidDate: Date }> = await prisma.invoice.findMany({
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

  await prisma.customer.update({
    where: { id: invoice.customerId },
    data: {
      creditUsed: newUsed,
      creditAvailable: Math.max(0, Number(customer.creditLimit) - newUsed),
      onTimePaymentRate: onTimeRate,
      avgPaymentDays,
      lastPaymentDate: paidDate,
    },
  });

  // Auto-complete any related collection tasks
  await prisma.collectionTask.updateMany({
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

  return { ...updated, amount: updated.amount.toString() };
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
      totalAmount: filtered.reduce((sum, inv) => sum + Number(inv.amount), 0).toFixed(2),
    };
  });

  const totalOutstanding = (invoices as BaseRow[])
    .reduce((sum, inv) => sum + Number(inv.amount), 0)
    .toFixed(2);
  const totalOverdue = (invoices as BaseRow[])
    .filter((inv) => inv.status === "OVERDUE")
    .reduce((sum, inv) => sum + Number(inv.amount), 0)
    .toFixed(2);

  const invoiceSummaries: InvoiceSummary[] = (invoices as InvListRow[]).map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customer.name,
    customerCompany: inv.customer.company,
    amount: inv.amount.toString(),
    currency: inv.currency,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    status: inv.status,
    daysOverdue: inv.daysOverdue,
    netTermsDays: inv.netTermsDays,
  }));

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
  const count = await prisma.invoice.count({ where: { shopId } });
  return count + 1;
}
