// Customer Service — CRUD, quota checks, credit state management
// Server-only (imports Prisma), follows Wandex pattern: service receives pure data, returns pure data

import prisma from "~/db.server";
import {
  assessCredit,
  determineCustomerStatus,
  calcAvailableCredit,
} from "~/services/credit.server";
import { PLAN_QUOTAS, PAGINATION, CREDIT_SCORE, resolvePlan } from "~/lib/constants";
import { logger } from "~/services/logger.server";
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
  logger.app("INFO", "customer.getCustomer START", null, { shopId: params.shopId, customerId: params.customerId });
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, shopId: params.shopId },
  });

  if (!customer) {
    logger.app("INFO", "customer.getCustomer — not found", null, { shopId: params.shopId, customerId: params.customerId });
    return null;
  }

  logger.app("INFO", "customer.getCustomer OK", null, { shopId: params.shopId, customerId: params.customerId });
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
  sortBy?: "name" | "creditUsed" | "creditLimit" | "overdueCount" | "riskLevel";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<CustomerSummary>> {
  const { shopId, search, status, creditGrade, riskLevel, sortBy = "name", sortOrder = "asc" } = params;
  logger.app("INFO", "customer.listCustomers START", null, { shopId, page: params.page, search, status, creditGrade, riskLevel, sortBy, sortOrder });
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE);

  // Build sort config
  const sortFieldMap: Record<string, Record<string, unknown>> = {
    name: { name: sortOrder },
    creditUsed: { creditUsed: sortOrder },
    creditLimit: { creditLimit: sortOrder },
    overdueCount: { invoices: { _count: sortOrder } },
    riskLevel: { riskLevel: sortOrder },
  };
  const orderBy = sortFieldMap[sortBy] ?? { name: sortOrder };

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
      orderBy,
    }),
    prisma.customer.count({ where }),
  ]);

  const result = {
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
  logger.app("INFO", "customer.listCustomers OK", null, { shopId, total, page });
  return result;
}
/**
 * Recalculate credit score for a customer and update the record
 */
export async function recalculateCreditScore(params: {
  customerId: string;
  shopId: string;
  triggeredBy: string;
}): Promise<CustomerRecord | null> {
  logger.app("INFO", "customer.recalculateCreditScore START", null, { customerId: params.customerId, shopId: params.shopId, triggeredBy: params.triggeredBy });

  const updated = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: params.customerId, shopId: params.shopId },
    });

    if (!customer) {
      logger.app("WARN", "customer.recalculateCreditScore — customer not found", null, { customerId: params.customerId });
      return null;
    }

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

    return tx.customer.update({
      where: { id: params.customerId, shopId: params.shopId },
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
  });

  if (!updated) return null;

  logger.app("INFO", "customer.recalculateCreditScore OK", null, { customerId: params.customerId, score: updated.creditScore, grade: updated.creditGrade });
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
  logger.app("INFO", "customer.setCreditLimit START", null, { customerId: params.customerId, shopId: params.shopId, newLimit: params.newLimit });
  const updated = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: params.customerId, shopId: params.shopId },
    });

    return tx.customer.update({
      where: { id: params.customerId, shopId: params.shopId },
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
  });

  logger.app("INFO", "customer.setCreditLimit OK", null, { customerId: params.customerId, shopId: params.shopId, newLimit: params.newLimit });
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
  logger.app("INFO", "customer.freezeCustomer START", null, { customerId: params.customerId, shopId: params.shopId, reason: params.reason });
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

  logger.app("INFO", "customer.freezeCustomer OK", null, { customerId: params.customerId, shopId: params.shopId });
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
  logger.app("INFO", "customer.unfreezeCustomer START", null, { customerId: params.customerId, shopId: params.shopId });
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

  logger.app("INFO", "customer.unfreezeCustomer OK", null, { customerId: params.customerId, shopId: params.shopId });
  return {
    ...updated,
    creditLimit: updated.creditLimit.toString(),
    creditUsed: updated.creditUsed.toString(),
    creditAvailable: updated.creditAvailable.toString(),
    totalRevenue: updated.totalRevenue.toString(),
  };
}

/**
 * Un-blacklist a customer, restoring them to ACTIVE status
 */
export async function unblacklistCustomer(params: {
  shopId: string;
  customerId: string;
  triggeredBy: string;
}): Promise<CustomerRecord> {
  logger.app("INFO", "customer.unblacklistCustomer START", null, { customerId: params.customerId, shopId: params.shopId });
  const updated = await prisma.customer.update({
    where: { id: params.customerId, shopId: params.shopId },
    data: {
      status: "ACTIVE",
      isFrozen: false,
      frozenReason: null,
      frozenAt: null,
      creditEvents: {
        create: {
          type: "UNBLACKLIST",
          previousValue: { status: "BLACKLISTED", isFrozen: true },
          newValue: { status: "ACTIVE", isFrozen: false },
          reason: "Manual unblacklist",
          triggeredBy: params.triggeredBy,
        },
      },
    },
  });

  logger.app("INFO", "customer.unblacklistCustomer OK", null, { customerId: params.customerId, shopId: params.shopId });
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
  logger.app("INFO", "customer.checkCustomerQuota START", null, { shopId, plan });
  const resolved = resolvePlan(plan);
  const limit = PLAN_QUOTAS[resolved as keyof typeof PLAN_QUOTAS].customers;
  const current = await prisma.customer.count({ where: { shopId } });

  const result: QuotaCheck = {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
  logger.app("INFO", "customer.checkCustomerQuota OK", null, { shopId, plan, current, limit, allowed: result.allowed });
  return result;
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
  logger.app("INFO", "customer.upsertCustomerFromShopify START", null, { shopId: params.shopId, shopifyCustomerId: params.shopifyCustomerId });
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

  logger.app("INFO", "customer.upsertCustomerFromShopify OK", null, { shopId: params.shopId, customerId: customer.id, shopifyCustomerId: params.shopifyCustomerId });
  return {
    ...customer,
    creditLimit: customer.creditLimit.toString(),
    creditUsed: customer.creditUsed.toString(),
    creditAvailable: customer.creditAvailable.toString(),
    totalRevenue: customer.totalRevenue.toString(),
  };
}

/**
 * P3: Delete (soft-delete) a customer — only if no active invoices
 */
export async function deleteCustomer(
  id: string,
  shopId: string,
): Promise<{ success: boolean; error?: string }> {
  logger.app("INFO", "customer.deleteCustomer START", null, { id, shopId });
  const customer = await prisma.customer.findFirst({ where: { id, shopId } });
  if (!customer) return { success: false, error: "Customer not found" };

  const hasActiveInvoices = await prisma.invoice.findFirst({
    where: { customerId: id, status: { notIn: ["PAID", "VOID"] } },
    select: { id: true },
  });
  if (hasActiveInvoices) {
    return {
      success: false,
      error: "Cannot delete customer with active (unpaid/open) invoices. Mark all invoices as PAID or VOID first.",
    };
  }

  await prisma.customer.update({
    where: { id },
    data: { status: "FROZEN", isFrozen: true, frozenAt: new Date(), frozenReason: "Customer deleted" },
  });

  logger.app("INFO", "customer.deleteCustomer OK", null, { id, shopId });
  return { success: true };
}
