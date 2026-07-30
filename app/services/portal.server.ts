// Portal Service — buyer-facing portal data queries (no Shopify auth required)
import prisma from "~/db.server";
import { validateToken } from "~/services/token.server";
import { logger } from "~/services/logger.server";

export interface PortalSession {
  shopId: string;
  customerId: string;
  token: string;
}

export interface PortalDashboardData {
  customer: {
    id: string;
    name: string;
    company: string | null;
    email: string;
    creditLimit: number;
    creditUsed: number;
    creditAvailable: number;
    creditGrade: string | null;
    creditScore: number | null;
    netTermsDays: number;
    status: string;
  };
  summary: {
    totalOutstanding: number;
    totalOverdue: number;
    overdueCount: number;
    unpaidCount: number;
    paidCount: number;
  };
  shop: {
    domain: string;
    currency: string;
    name: string | null;
  };
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    status: string;
    dueDate: string;
    daysOverdue: number;
  }>;
  recentPayments: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    paidDate: string;
  }>;
}

export interface PortalInvoiceListData {
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    status: string;
    issueDate: string;
    dueDate: string;
    daysOverdue: number;
    netTermsDays: number;
    paymentUrl: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PortalPaymentHistoryData {
  payments: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    paidDate: string;
    paymentMethod: string | null;
    daysToPay: number | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PortalApplicationData {
  application: {
    id: string;
    companyName: string;
    contactEmail: string;
    status: string;
    requestedCredit: number;
    approvedLimit: number | null;
    coldStartScore: number | null;
    submittedAt: string;
    reviewedAt: string | null;
    reviewNotes: string | null;
  } | null;
  customer: {
    creditLimit: number;
    creditUsed: number;
    creditAvailable: number;
    creditGrade: string | null;
    status: string;
  } | null;
  shop: {
    domain: string;
    currency: string;
  };
}

export interface PortalStatementData {
  customer: {
    name: string;
    company: string | null;
    creditLimit: number;
    creditAvailable: number;
  };
  shop: {
    domain: string;
    currency: string;
  };
  aging: {
    current: { count: number; total: number };
    days1to30: { count: number; total: number };
    days31to60: { count: number; total: number };
    days61to90: { count: number; total: number };
    days90plus: { count: number; total: number };
  };
  totalOutstanding: number;
}

/** Fetch minimal shop info for portal layout */
export async function getShopInfo(shopId: string): Promise<{ shopDomain: string; currency: string } | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true, currency: true },
  });
  return shop ?? null;
}

/** Validate portal token and extract session data */
export async function validatePortalSession(token: string): Promise<PortalSession | null> {
  const payload = await validateToken(token);
  if (!payload || payload.scope !== "portal") {
    logger.app("WARN", "portal.validatePortalSession — invalid token", null, { tokenHash: token.substring(0, 8) + "..." });
    return null;
  }

  const { shopId, resourceId } = payload;

  // Verify the customer exists and is active
  const customer = await prisma.customer.findFirst({
    where: { id: resourceId, shopId, status: { not: "BLACKLISTED" } },
    select: { id: true },
  });
  if (!customer) {
    logger.app("WARN", "portal.validatePortalSession — customer not found or blacklisted", null, { shopId, customerId: resourceId });
    return null;
  }

  return { shopId, customerId: resourceId, token };
}

/** Dashboard: full portal summary for a customer */
export async function getPortalDashboard(
  shopId: string,
  customerId: string,
): Promise<PortalDashboardData> {
  const [customer, shop, invoices, paidInvoices] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, shopId },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        creditLimit: true,
        creditUsed: true,
        creditAvailable: true,
        creditGrade: true,
        creditScore: true,
        netTermsDays: true,
        status: true,
      },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, currency: true, emailFromName: true },
    }),
    prisma.invoice.findMany({
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
        status: true,
        dueDate: true,
        daysOverdue: true,
      },
      orderBy: { dueDate: "desc" },
      take: 5,
    }),
    prisma.invoice.findMany({
      where: { shopId, customerId, status: "PAID", paidDate: { not: null } },
      select: { id: true, invoiceNumber: true, amount: true, paidDate: true },
      orderBy: { paidDate: "desc" },
      take: 5,
    }),
  ]);

  if (!customer) throw new Error("Customer not found");
  if (!shop) throw new Error("Shop not found");

  // Aggregate summary
  const allUnpaid = await prisma.invoice.groupBy({
    by: ["status"],
    where: {
      shopId,
      customerId,
      status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
    },
    _sum: { amount: true },
    _count: true,
  });

  let totalOutstanding = 0;
  let totalOverdue = 0;
  let overdueCount = 0;
  let unpaidCount = 0;

  for (const group of allUnpaid) {
    const amt = Number(group._sum.amount ?? 0);
    totalOutstanding += amt;
    unpaidCount += group._count;
    if (group.status === "OVERDUE") {
      totalOverdue += amt;
      overdueCount += group._count;
    }
  }

  const paidCount = await prisma.invoice.count({
    where: { shopId, customerId, status: "PAID" },
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      company: customer.company,
      email: customer.email,
      creditLimit: Number(customer.creditLimit),
      creditUsed: Number(customer.creditUsed),
      creditAvailable: Number(customer.creditAvailable),
      creditGrade: customer.creditGrade,
      creditScore: customer.creditScore,
      netTermsDays: customer.netTermsDays,
      status: customer.status,
    },
    summary: {
      totalOutstanding,
      totalOverdue,
      overdueCount,
      unpaidCount,
      paidCount,
    },
    shop: {
      domain: shop.shopDomain,
      currency: shop.currency,
      name: shop.emailFromName,
    },
    recentInvoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      currency: inv.currency,
      status: inv.status,
      dueDate: inv.dueDate.toISOString(),
      daysOverdue: inv.daysOverdue,
    })),
    recentPayments: paidInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      paidDate: inv.paidDate!.toISOString(),
    })),
  };
}

/** Invoice list for a customer — paginated */
export async function getPortalInvoices(
  shopId: string,
  customerId: string,
  statusFilter?: string,
  page = 1,
  pageSize = 20,
): Promise<PortalInvoiceListData> {
  const where: Record<string, unknown> = { shopId, customerId };
  if (statusFilter && statusFilter !== "ALL") {
    where.status = statusFilter;
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        status: true,
        issueDate: true,
        dueDate: true,
        daysOverdue: true,
        netTermsDays: true,
        paymentUrl: true,
      },
      orderBy: { dueDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      currency: inv.currency,
      status: inv.status,
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      daysOverdue: inv.daysOverdue,
      netTermsDays: inv.netTermsDays,
      paymentUrl: inv.paymentUrl,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** Payment history: paid invoices — paginated */
export async function getPortalPaymentHistory(
  shopId: string,
  customerId: string,
  page = 1,
  pageSize = 20,
): Promise<PortalPaymentHistoryData> {
  const where = {
    shopId,
    customerId,
    status: { in: ["PAID", "PARTIALLY_PAID"] as string[] },
    paidDate: { not: null },
  };

  const [payments, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        paidDate: true,
        paymentMethod: true,
        issueDate: true,
      },
      orderBy: { paidDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    payments: payments.map((inv) => {
      const issueMs = inv.issueDate.getTime();
      const paidMs = inv.paidDate!.getTime();
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.amount),
        currency: inv.currency,
        paidDate: inv.paidDate!.toISOString(),
        paymentMethod: inv.paymentMethod,
        daysToPay: Math.round((paidMs - issueMs) / (1000 * 60 * 60 * 24)),
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** Credit application status for a customer */
export async function getPortalApplication(
  shopId: string,
  customerId: string,
): Promise<PortalApplicationData> {
  const [application, customer, shop] = await Promise.all([
    prisma.creditApplication.findFirst({
      where: { shopId, customerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        companyName: true,
        contactEmail: true,
        status: true,
        requestedCredit: true,
        approvedLimit: true,
        coldStartScore: true,
        createdAt: true,
        reviewedAt: true,
        reviewNotes: true,
      },
    }),
    prisma.customer.findFirst({
      where: { id: customerId, shopId },
      select: {
        creditLimit: true,
        creditUsed: true,
        creditAvailable: true,
        creditGrade: true,
        status: true,
      },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, currency: true },
    }),
  ]);

  return {
    application: application
      ? {
          id: application.id,
          companyName: application.companyName,
          contactEmail: application.contactEmail,
          status: application.status,
          requestedCredit: Number(application.requestedCredit),
          approvedLimit: application.approvedLimit ? Number(application.approvedLimit) : null,
          coldStartScore: application.coldStartScore,
          submittedAt: application.createdAt.toISOString(),
          reviewedAt: application.reviewedAt?.toISOString() ?? null,
          reviewNotes: application.reviewNotes,
        }
      : null,
    customer: customer
      ? {
          creditLimit: Number(customer.creditLimit),
          creditUsed: Number(customer.creditUsed),
          creditAvailable: Number(customer.creditAvailable),
          creditGrade: customer.creditGrade,
          status: customer.status,
        }
      : null,
    shop: {
      domain: shop?.shopDomain ?? "",
      currency: shop?.currency ?? "USD",
    },
  };
}

/** AR Aging statement for a customer */
export async function getPortalStatement(
  shopId: string,
  customerId: string,
): Promise<PortalStatementData> {
  const [customer, shop, invoices] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, shopId },
      select: { name: true, company: true, creditLimit: true, creditAvailable: true },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, currency: true },
    }),
    prisma.invoice.findMany({
      where: {
        shopId,
        customerId,
        status: { in: ["PENDING", "OVERDUE", "PARTIALLY_PAID", "DISPUTED"] },
      },
      select: { amount: true, daysOverdue: true },
    }),
  ]);

  if (!customer) throw new Error("Customer not found");
  if (!shop) throw new Error("Shop not found");

  const aging = {
    current: { count: 0, total: 0 },
    days1to30: { count: 0, total: 0 },
    days31to60: { count: 0, total: 0 },
    days61to90: { count: 0, total: 0 },
    days90plus: { count: 0, total: 0 },
  };

  for (const inv of invoices) {
    const amt = Number(inv.amount);
    if (inv.daysOverdue <= 0) {
      aging.current.count++;
      aging.current.total += amt;
    } else if (inv.daysOverdue <= 30) {
      aging.days1to30.count++;
      aging.days1to30.total += amt;
    } else if (inv.daysOverdue <= 60) {
      aging.days31to60.count++;
      aging.days31to60.total += amt;
    } else if (inv.daysOverdue <= 90) {
      aging.days61to90.count++;
      aging.days61to90.total += amt;
    } else {
      aging.days90plus.count++;
      aging.days90plus.total += amt;
    }
  }

  const totalOutstanding = Object.values(aging).reduce((sum, b) => sum + b.total, 0);

  return {
    customer: {
      name: customer.name,
      company: customer.company,
      creditLimit: Number(customer.creditLimit),
      creditAvailable: Number(customer.creditAvailable),
    },
    shop: { domain: shop.shopDomain, currency: shop.currency },
    aging,
    totalOutstanding,
  };
}
