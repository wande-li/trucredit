// Customer Service — CRUD, quota checks, credit state management
// Server-only (imports Prisma), follows Wandex pattern: service receives pure data, returns pure data

import prisma from "~/db.server";
import {
  assessCredit,
  determineCustomerStatus,
  calcAvailableCredit,
} from "~/services/credit.server";
import { PLAN_QUOTAS, PAGINATION, CREDIT_SCORE } from "~/lib/constants";
import type { Plan, CreditGrade, RiskLevel, CustomerStatus } from "@prisma/client";
import type {
  CustomerRecord,
  CustomerSummary,
  QuotaCheck,
  PaginatedResult,
} from "~/types";

/**
 * Get customer by ID with full credit data
 */
export async function getCustomer(params: {
  shopId: string;
  customerId: string;
}): Promise<CustomerRecord | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, shopId: params.shopId },
  });

  if (!customer) return null;

  return {
    ...customer,
    creditLimit: customer.creditLimit.toString(),
    creditUsed: customer.creditUsed.toString(),
    creditAvailable: customer.creditAvailable.toString(),
    totalRevenue: customer.totalRevenue.toString(),
  };
}

/**
 * List customers with pagination, search, and filters
 */
export async function listCustomers(params: {
  shopId: string;
  search?: string;
  status?: string;
  creditGrade?: string;
  riskLevel?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<CustomerSummary>> {
  const { shopId, search, status, creditGrade, riskLevel } = params;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE);

  const where: Record<string, unknown> = { shopId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { company: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (status) where.status = status;
  if (creditGrade) where.creditGrade = creditGrade;
  if (riskLevel) where.riskLevel = riskLevel;

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        creditLimit: true,
        creditUsed: true,
        creditAvailable: true,
        creditGrade: true,
        riskLevel: true,
        status: true,
        isFrozen: true,
        totalOrders: true,
        totalRevenue: true,
        _count: { select: { invoices: true } },
        invoices: {
          where: { status: "OVERDUE" },
          select: { id: true },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    items: (items as Array<{
      id: string; name: string; company: string | null; email: string;
      creditLimit: { toString(): string }; creditUsed: { toString(): string };
      creditAvailable: { toString(): string }; creditGrade: CreditGrade | null;
      riskLevel: RiskLevel; status: CustomerStatus; isFrozen: boolean;
      totalOrders: number; totalRevenue: { toString(): string };
      _count: { invoices: number };
      invoices: Array<{ id: string }>;
    }>).map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      creditLimit: c.creditLimit.toString(),
      creditUsed: c.creditUsed.toString(),
      creditAvailable: c.creditAvailable.toString(),
      creditGrade: c.creditGrade,
      riskLevel: c.riskLevel,
      status: c.status,
      isFrozen: c.isFrozen,
      totalOrders: c.totalOrders,
      totalRevenue: c.totalRevenue.toString(),
      invoiceCount: c._count.invoices,
      overdueCount: c.invoices.length,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Recalculate credit score for a customer and update the record
 */
export async function recalculateCreditScore(params: {
  customerId: string;
  shopId: string;
  triggeredBy: string;
}): Promise<CustomerRecord | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, shopId: params.shopId },
  });

  if (!customer) return null;

  const assessment = assessCredit({
    onTimePaymentRate: customer.onTimePaymentRate,
    creditUsed: Number(customer.creditUsed),
    creditLimit: Number(customer.creditLimit),
    totalOrders: customer.totalOrders,
    totalRevenue: Number(customer.totalRevenue),
  });

  const newStatus = determineCustomerStatus(
    customer.status,
    assessment.riskLevel,
    customer.onTimePaymentRate,
  );

  const updated = await prisma.customer.update({
    where: { id: params.customerId },
    data: {
      creditScore: assessment.score,
      creditGrade: assessment.grade,
      riskLevel: assessment.riskLevel,
      creditAvailable: calcAvailableCredit(
        Number(customer.creditLimit),
        Number(customer.creditUsed),
      ),
      status: newStatus,
      isFrozen: newStatus === "FROZEN",
      creditEvents: {
        create: {
          type: "SCORE_UPDATE",
          previousValue: {
            score: customer.creditScore,
            grade: customer.creditGrade,
            riskLevel: customer.riskLevel,
          },
          newValue: {
            score: assessment.score,
            grade: assessment.grade,
            riskLevel: assessment.riskLevel,
          },
          reason: "Automated score recalculation",
          triggeredBy: params.triggeredBy,
        },
      },
    },
  });

  return {
    ...updated,
    creditLimit: updated.creditLimit.toString(),
    creditUsed: updated.creditUsed.toString(),
    creditAvailable: updated.creditAvailable.toString(),
    totalRevenue: updated.totalRevenue.toString(),
  };
}

/**
 * Set credit limit — creates audit event
 */
export async function setCreditLimit(params: {
  shopId: string;
  customerId: string;
  newLimit: number;
  reason: string;
  triggeredBy: string;
}): Promise<CustomerRecord> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { id: params.customerId, shopId: params.shopId },
  });

  const updated = await prisma.customer.update({
    where: { id: params.customerId },
    data: {
      creditLimit: params.newLimit,
      creditAvailable: calcAvailableCredit(params.newLimit, Number(customer.creditUsed)),
      creditEvents: {
        create: {
          type: "LIMIT_CHANGE",
          previousValue: { creditLimit: Number(customer.creditLimit) },
          newValue: { creditLimit: params.newLimit },
          reason: params.reason,
          triggeredBy: params.triggeredBy,
        },
      },
    },
  });

  return {
    ...updated,
    creditLimit: updated.creditLimit.toString(),
    creditUsed: updated.creditUsed.toString(),
    creditAvailable: updated.creditAvailable.toString(),
    totalRevenue: updated.totalRevenue.toString(),
  };
}

/**
 * Freeze a customer's credit
 */
export async function freezeCustomer(params: {
  shopId: string;
  customerId: string;
  reason: string;
  triggeredBy: string;
}): Promise<CustomerRecord> {
  const updated = await prisma.customer.update({
    where: { id: params.customerId, shopId: params.shopId },
    data: {
      isFrozen: true,
      status: "FROZEN",
      frozenReason: params.reason,
      frozenAt: new Date(),
      creditEvents: {
        create: {
          type: "FROZEN",
          previousValue: { isFrozen: false },
          newValue: { isFrozen: true },
          reason: params.reason,
          triggeredBy: params.triggeredBy,
        },
      },
    },
  });

  return {
    ...updated,
    creditLimit: updated.creditLimit.toString(),
    creditUsed: updated.creditUsed.toString(),
    creditAvailable: updated.creditAvailable.toString(),
    totalRevenue: updated.totalRevenue.toString(),
  };
}

/**
 * Unfreeze a customer
 */
export async function unfreezeCustomer(params: {
  shopId: string;
  customerId: string;
  triggeredBy: string;
}): Promise<CustomerRecord> {
  const updated = await prisma.customer.update({
    where: { id: params.customerId, shopId: params.shopId },
    data: {
      isFrozen: false,
      status: "ACTIVE",
      frozenReason: null,
      frozenAt: null,
      creditEvents: {
        create: {
          type: "UNFROZEN",
          previousValue: { isFrozen: true },
          newValue: { isFrozen: false },
          reason: "Manual unfreeze",
          triggeredBy: params.triggeredBy,
        },
      },
    },
  });

  return {
    ...updated,
    creditLimit: updated.creditLimit.toString(),
    creditUsed: updated.creditUsed.toString(),
    creditAvailable: updated.creditAvailable.toString(),
    totalRevenue: updated.totalRevenue.toString(),
  };
}

/**
 * Check if shop is within customer quota
 */
export async function checkCustomerQuota(
  shopId: string,
  plan: Plan,
): Promise<QuotaCheck> {
  const limit = PLAN_QUOTAS[plan].customers;
  const current = await prisma.customer.count({ where: { shopId } });

  return {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
}

/**
 * Upsert customer from Shopify data — idempotent
 */
export async function upsertCustomerFromShopify(params: {
  shopId: string;
  shopifyCustomerId: string;
  email: string;
  name: string;
  company?: string;
  phone?: string;
}): Promise<CustomerRecord> {
  const customer = await prisma.customer.upsert({
    where: {
      shopId_shopifyCustomerId: {
        shopId: params.shopId,
        shopifyCustomerId: params.shopifyCustomerId,
      },
    },
    create: {
      shopId: params.shopId,
      shopifyCustomerId: params.shopifyCustomerId,
      email: params.email,
      name: params.name,
      company: params.company,
      phone: params.phone,
      creditLimit: CREDIT_SCORE.DEFAULT_LIMIT,
    },
    update: {
      email: params.email,
      name: params.name,
      company: params.company ?? undefined,
      phone: params.phone ?? undefined,
    },
  });

  return {
    ...customer,
    creditLimit: customer.creditLimit.toString(),
    creditUsed: customer.creditUsed.toString(),
    creditAvailable: customer.creditAvailable.toString(),
    totalRevenue: customer.totalRevenue.toString(),
  };
}
