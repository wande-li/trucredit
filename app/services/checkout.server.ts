// Credit Check Service — Validates TruCredit net terms eligibility at checkout
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";

// ═══════════════════ Types ═══════════════════

export interface CreditCheckInput {
  shopDomain: string;
  customerEmail: string;
  cartTotal: number;
  currency?: string;
}

export interface CreditCheckResult {
  eligible: boolean;
  reason?: string;
  customerId?: string;
  customerName?: string;
  creditLimit?: number;
  creditUsed?: number;
  availableCredit?: number;
  isFrozen?: boolean;
  /** Suggested alternative action */
  suggestion?: "PROCEED" | "REDUCE_CART" | "PAY_NOW" | "OVER_LIMIT";
}

// ═══════════════════ Core Logic ═══════════════════

/**
 * Check if a customer is eligible for net terms payment at checkout.
 *
 * Rules:
 * 1. Customer must exist and have a credit limit > 0
 * 2. Customer must not be frozen
 * 3. cartTotal must not exceed available credit
 * 4. Must have no severely overdue invoices (>90 days)
 */
export async function checkCreditEligibility(input: CreditCheckInput): Promise<CreditCheckResult> {
  const { shopDomain, customerEmail, cartTotal } = input;

  // Step 1: Find shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: shopDomain.trim() },
    select: { id: true },
  });

  if (!shop) {
    return { eligible: false, reason: "Shop not found", suggestion: "PAY_NOW" };
  }

  // Step 2: Find customer
  const customer = await prisma.customer.findFirst({
    where: {
      shopId: shop.id,
      email: customerEmail.toLowerCase().trim(),
    },
    select: {
      id: true,
      name: true,
      creditLimit: true,
      creditUsed: true,
      isFrozen: true,
    },
  });

  if (!customer) {
    return {
      eligible: false,
      reason: "Customer not found — net terms requires an approved B2B account",
      suggestion: "PAY_NOW",
    };
  }

  // Step 3: Check frozen status
  if (customer.isFrozen) {
    return {
      eligible: false,
      reason: "Your net terms account has been suspended. Please contact support.",
      suggestion: "PAY_NOW",
      customerId: customer.id,
      customerName: customer.name,
      creditLimit: Number(customer.creditLimit),
      creditUsed: Number(customer.creditUsed),
      availableCredit: Number(customer.creditLimit) - Number(customer.creditUsed),
      isFrozen: true,
    };
  }

  // Step 4: Check credit limit
  const creditLimit = Number(customer.creditLimit);
  const creditUsed = Number(customer.creditUsed);
  const availableCredit = creditLimit - creditUsed;

  if (cartTotal > availableCredit) {
    return {
      eligible: false,
      reason: `Cart total ${input.currency ?? "USD"} ${cartTotal.toFixed(2)} exceeds available credit ${input.currency ?? "USD"} ${availableCredit.toFixed(2)}`,
      suggestion: creditLimit > 0 ? "REDUCE_CART" : "PAY_NOW",
      customerId: customer.id,
      customerName: customer.name,
      creditLimit,
      creditUsed,
      availableCredit,
      isFrozen: false,
    };
  }

  // Step 5: Check for severely overdue invoices (90+ days)
  const severelyOverdue = await prisma.invoice.findFirst({
    where: {
      customerId: customer.id,
      status: "OVERDUE",
      dueDate: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });

  if (severelyOverdue) {
    return {
      eligible: false,
      reason: "Your account has invoices overdue by 90+ days. Please settle outstanding balances first.",
      suggestion: "PAY_NOW",
      customerId: customer.id,
      customerName: customer.name,
      creditLimit,
      creditUsed,
      availableCredit,
      isFrozen: false,
    };
  }

  // Step 6: Check credit limit > 0
  if (creditLimit <= 0) {
    return {
      eligible: false,
      reason: "No credit limit assigned. Contact your account manager.",
      suggestion: "PAY_NOW",
      customerId: customer.id,
      customerName: customer.name,
      creditLimit: 0,
      creditUsed,
      availableCredit: 0,
      isFrozen: false,
    };
  }

  // All checks passed
  return {
    eligible: true,
    customerId: customer.id,
    customerName: customer.name,
    creditLimit,
    creditUsed,
    availableCredit,
    isFrozen: false,
  };
}

/**
 * Reserve credit for a pending checkout (atomic, race-condition safe).
 * Uses a conditional UPDATE WHERE to prevent double-spending under concurrency.
 *
 * Idempotency: tracks reservations by orderName via CreditEvent records.
 * Duplicate calls for the same orderName within 30 minutes return success
 * without double-deducting credit.
 */
export async function reserveCredit(params: {
  customerId: string;
  amount: number;
  orderName: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Idempotency: check if credit was already reserved for this order
    const existingEvent = await prisma.creditEvent.findFirst({
      where: {
        customerId: params.customerId,
        triggeredBy: "checkout",
        reason: params.orderName,
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // 30-min window
      },
    });
    if (existingEvent) {
      logger.app("INFO", "Credit reservation — idempotent skip (already reserved)", undefined, {
        customerId: params.customerId,
        orderName: params.orderName,
        eventId: existingEvent.id,
      });
      return { success: true };
    }

    // Atomic: only UPDATE if creditLimit >= creditUsed + amount AND not frozen
    // Returns count of updated rows (0 = failed, 1 = success)
    const result = await prisma.$executeRaw<number>`
      UPDATE "Customer"
      SET "creditUsed" = "creditUsed" + ${params.amount},
          "creditAvailable" = "creditLimit" - ("creditUsed" + ${params.amount}),
          "updatedAt" = NOW()
      WHERE "id" = ${params.customerId}
        AND "isFrozen" = false
        AND "creditLimit" >= "creditUsed" + ${params.amount}
    `;

    if (result === 0) {
      // Check why it failed — frozen or insufficient credit
      const customer = await prisma.customer.findUnique({
        where: { id: params.customerId },
        select: { id: true, isFrozen: true, creditLimit: true, creditUsed: true },
      });
      if (!customer) return { success: false, error: "Customer not found" };
      if (customer.isFrozen) return { success: false, error: "Account frozen" };
      const available = Number(customer.creditLimit) - Number(customer.creditUsed);
      return {
        success: false,
        error: `Insufficient credit: need ${params.amount}, available ${available}`,
      };
    }

    // Record reservation event for idempotency
    await prisma.creditEvent.create({
      data: {
        customerId: params.customerId,
        type: "LIMIT_CHANGE",
        reason: params.orderName,
        triggeredBy: "checkout",
        newValue: { amount: params.amount },
      },
    });

    logger.app("INFO", "Credit reserved for checkout", undefined, {
      customerId: params.customerId,
      amount: params.amount,
      orderName: params.orderName,
    });

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Credit reservation failed", undefined, { error: msg });
    return { success: false, error: "Internal error" };
  }
}
