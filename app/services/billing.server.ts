// Billing Service — plan management, Shopify subscription integration
// Server-only, follows Wandex pattern: pure data in, pure data out

import prisma from "~/db.server";
import { PLAN_QUOTAS } from "~/lib/constants";
import { PLAN_MONTHLY, PLAN_ANNUAL } from "~/shopify.server";
import { logger } from "~/services/logger.server";
import type { Plan } from "@prisma/client";

// ─── Plan Features ─────────────────────────────────────────

export interface PlanFeature {
  key: string;
  label: string;
  included: boolean;
}

export interface PlanDefinition {
  key: Plan;
  name: string;
  price: number | null;
  period: string | null;
  billingPlanName: string | null;
  customerQuota: number | string;
  invoiceQuota: number | string;
  features: PlanFeature[];
  highlight?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    key: "FREE",
    name: "Starter",
    price: 0,
    period: null,
    billingPlanName: null,
    customerQuota: PLAN_QUOTAS.FREE.customers,
    invoiceQuota: PLAN_QUOTAS.FREE.invoices,
    features: [
      { key: "customers", label: "Up to 5 customers", included: true },
      { key: "invoices", label: "Up to 10 invoices", included: true },
      { key: "credit", label: "Basic credit scoring", included: true },
      { key: "collections", label: "Manual collections", included: true },
      { key: "ai", label: "AI email generation", included: false },
      { key: "replies", label: "Reply classification", included: false },
      { key: "sequences", label: "Auto sequences", included: false },
      { key: "priority", label: "Priority support", included: false },
    ],
  },
  {
    key: "GROWTH",
    name: "Growth",
    price: 49,
    period: "month",
    billingPlanName: PLAN_MONTHLY,
    customerQuota: PLAN_QUOTAS.GROWTH.customers,
    invoiceQuota: PLAN_QUOTAS.GROWTH.invoices,
    features: [
      { key: "customers", label: "Up to 50 customers", included: true },
      { key: "invoices", label: "Up to 200 invoices", included: true },
      { key: "credit", label: "Advanced credit scoring", included: true },
      { key: "collections", label: "Automated collections", included: true },
      { key: "ai", label: "AI email generation", included: true },
      { key: "replies", label: "Reply classification", included: true },
      { key: "sequences", label: "Auto sequences", included: true },
      { key: "priority", label: "Priority support", included: false },
    ],
    highlight: true,
  },
  {
    key: "PRO",
    name: "Pro",
    price: 470.4,
    period: "year",
    billingPlanName: PLAN_ANNUAL,
    customerQuota: "Unlimited",
    invoiceQuota: "Unlimited",
    features: [
      { key: "customers", label: "Unlimited customers", included: true },
      { key: "invoices", label: "Unlimited invoices", included: true },
      { key: "credit", label: "Advanced credit scoring", included: true },
      { key: "collections", label: "Automated collections", included: true },
      { key: "ai", label: "AI email generation", included: true },
      { key: "replies", label: "Reply classification", included: true },
      { key: "sequences", label: "Auto sequences", included: true },
      { key: "priority", label: "Priority support", included: true },
    ],
  },
];

// ─── Type Definitions ──────────────────────────────────────

export interface QuotaCheck {
  allowed: boolean;
  current: number;
  limit: number;
  plan: Plan;
}

export interface ShopBilling {
  plan: Plan;
  planName: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  customerQuota: number;
  customerCount: number;
  invoiceQuota: number;
  invoiceCount: number;
  customerQuotaPercent: number;
  invoiceQuotaPercent: number;
  needsUpgrade: boolean;
}

// Plan → billing name mapping
export function billingPlanToEnum(planName: string | null): Plan {
  switch (planName) {
    case PLAN_ANNUAL:
      return "PRO";
    case PLAN_MONTHLY:
      return "GROWTH";
    default:
      return "FREE";
  }
}

export function planToBillingName(
  plan: Plan,
): typeof PLAN_MONTHLY | typeof PLAN_ANNUAL | null {
  if (plan === "PRO") return PLAN_ANNUAL;
  if (plan === "GROWTH") return PLAN_MONTHLY;
  return null;
}

// ─── Plan Access & Quota ───────────────────────────────────

/**
 * Get full billing context for dashboard / billing page
 */
export async function getShopBilling(shopId: string): Promise<ShopBilling> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: {
      plan: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      customerQuota: true,
      invoiceQuota: true,
      _count: {
        select: { customers: true, invoices: true },
      },
    },
  });

  const customerCount = shop._count.customers;
  const invoiceCount = shop._count.invoices;

  return {
    plan: shop.plan,
    planName:
      PLANS.find((p) => p.key === shop.plan)?.name ?? shop.plan,
    subscriptionStatus: shop.subscriptionStatus,
    currentPeriodEnd: shop.currentPeriodEnd?.toISOString() ?? null,
    customerQuota: shop.customerQuota,
    customerCount,
    invoiceQuota: shop.invoiceQuota,
    invoiceCount,
    customerQuotaPercent: Math.min(
      100,
      Math.round((customerCount / shop.customerQuota) * 100),
    ),
    invoiceQuotaPercent: Math.min(
      100,
      Math.round((invoiceCount / shop.invoiceQuota) * 100),
    ),
    needsUpgrade:
      customerCount >= shop.customerQuota ||
      invoiceCount >= shop.invoiceQuota,
  };
}

/**
 * Verify shop can access features for current plan
 * Returns false if FREE plan quota exceeded — caller should prompt upgrade
 */
export async function checkPlanAccess(shopId: string): Promise<{
  plan: Plan;
  isPaid: boolean;
  quotaBlocked: boolean;
  reason: string | null;
}> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: {
      plan: true,
      subscriptionStatus: true,
      _count: { select: { customers: true, invoices: true } },
    },
  });

  const quota = PLAN_QUOTAS[shop.plan];
  const isQuotaExceeded =
    shop._count.customers >= quota.customers ||
    shop._count.invoices >= quota.invoices;

  return {
    plan: shop.plan,
    isPaid: shop.plan !== "FREE" && shop.subscriptionStatus === "ACTIVE",
    quotaBlocked: isQuotaExceeded && shop.plan === "FREE",
    reason: isQuotaExceeded
      ? `Quota exceeded: ${shop._count.customers}/${quota.customers} customers, ${shop._count.invoices}/${quota.invoices} invoices`
      : null,
  };
}

/**
 * Check invoice creation quota
 */
export async function checkInvoiceQuota(
  shopId: string,
  plan: Plan,
): Promise<QuotaCheck> {
  const limit = PLAN_QUOTAS[plan].invoices;
  const current = await prisma.invoice.count({ where: { shopId } });

  return {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
}

// ─── Webhook Handler ───────────────────────────────────────

interface ShopifyCharge {
  id: string;
  gid?: string;
  name: string;
  status: string;
  lineItems?: Array<{ plan?: { pricingDetails?: Record<string, unknown> } }>;
  currentPeriodEnd?: string;
  billing_on?: string;
  trialDays?: number;
  cancelledAt?: string;
  price?: string | number;
}

/**
 * Handle app_subscriptions/update webhook
 * Updates Shop plan, status, and quota based on incoming charge data
 */
export async function handleSubscriptionUpdate(
  shopDomain: string,
  charge: ShopifyCharge,
): Promise<void> {
  const plan = billingPlanToEnum(charge.name);
  const quotas = PLAN_QUOTAS[plan];

  const data: Record<string, unknown> = {
    plan,
    subscriptionStatus: mapShopifyStatus(charge.status),
    shopifyChargeId: charge.id.toString(),
  };

  if (charge.currentPeriodEnd) {
    data.currentPeriodEnd = new Date(charge.currentPeriodEnd);
  }
  if (charge.trialDays !== undefined) {
    data.trialDays = charge.trialDays;
  }
  if (charge.price) {
    data.priceAmount = typeof charge.price === "string"
      ? parseFloat(charge.price)
      : charge.price;
  }

  // Update quota based on new plan
  if (plan !== "FREE") {
    data.customerQuota = quotas.customers;
    data.invoiceQuota = quotas.invoices;
  }

  // Handle cancellation
  if (charge.status === "CANCELLED" || charge.status === "EXPIRED") {
    data.plan = "FREE";
    data.subscriptionStatus = "NONE";
    data.customerQuota = PLAN_QUOTAS.FREE.customers;
    data.invoiceQuota = PLAN_QUOTAS.FREE.invoices;
    if (charge.cancelledAt) {
      data.cancelledAt = new Date(charge.cancelledAt);
    }
  }

  try {
    await prisma.shop.update({
      where: { shopDomain },
      data,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Prisma P2025 = shop not found — webhook may arrive before OAuth completes
    // Shop will be created by afterAuth hook; silently skip this update
    if (msg.includes("P2025")) {
      logger.app("WARN", "Subscription webhook skipped: shop not found", {
        shopDomain,
        chargeId: charge.id,
      });
      return;
    }
    throw e;
  }
}

/**
 * Map Shopify charge status to our subscription status string
 */
function mapShopifyStatus(chargeStatus: string): string {
  switch (chargeStatus.toUpperCase()) {
    case "ACTIVE":
      return "ACTIVE";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "FROZEN":
    case "PAUSED":
      return "PAUSED";
    case "DECLINED":
      return "DECLINED";
    default:
      return chargeStatus.toUpperCase();
  }
}
