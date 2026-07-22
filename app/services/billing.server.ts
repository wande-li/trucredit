// Billing Service — plan management, Shopify subscription integration
// Server-only, follows Wandex pattern: pure data in, pure data out

import prisma from "~/db.server";
import { PLAN_QUOTAS, resolvePlan, type PlanKey } from "~/lib/constants";
import {
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ENTERPRISE_MONTHLY,
  PLAN_ENTERPRISE_ANNUAL,
} from "~/shopify.server";
import { logger } from "~/services/logger.server";
import type { Plan } from "@prisma/client";

// ─── Plan Definition (for billing page UI) ──────────────────

export interface PlanFeature {
  key: string;
  label: string;
  included: boolean;
}

export interface PlanDefinition {
  key: Plan;
  name: string;
  price: number | null;
  annualPrice: number | null;
  monthlyEquivalent: number | null;
  period: string | null;
  billingPlanName: string | null;
  billingPlanNameAnnual: string | null;
  customerQuota: number | string;
  invoiceQuota: number | string;
  features: PlanFeature[];
  highlight?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    key: "FREE",
    name: "Free",
    price: 0,
    annualPrice: 0,
    monthlyEquivalent: 0,
    period: null,
    billingPlanName: null,
    billingPlanNameAnnual: null,
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
      { key: "rules", label: "Custom rules engine", included: false },
      { key: "priority", label: "Priority support", included: false },
      { key: "dedicated", label: "Dedicated support", included: false },
    ],
  },
  {
    key: "STARTER",
    name: "Starter",
    price: 29,
    annualPrice: 290,
    monthlyEquivalent: 24.17,
    period: "month",
    billingPlanName: PLAN_STARTER_MONTHLY,
    billingPlanNameAnnual: PLAN_STARTER_ANNUAL,
    customerQuota: PLAN_QUOTAS.STARTER.customers,
    invoiceQuota: PLAN_QUOTAS.STARTER.invoices,
    features: [
      { key: "customers", label: "Up to 50 customers", included: true },
      { key: "invoices", label: "Up to 100 invoices", included: true },
      { key: "credit", label: "Advanced AI credit scoring", included: true },
      { key: "collections", label: "Automated collections", included: true },
      { key: "ai", label: "AI email generation", included: true },
      { key: "replies", label: "Reply classification", included: false },
      { key: "sequences", label: "Auto sequences", included: false },
      { key: "rules", label: "Custom rules engine", included: false },
      { key: "priority", label: "Priority support", included: false },
      { key: "dedicated", label: "Dedicated support", included: false },
    ],
    highlight: true,
  },
  {
    key: "PRO",
    name: "Pro",
    price: 79,
    annualPrice: 790,
    monthlyEquivalent: 65.83,
    period: "month",
    billingPlanName: PLAN_PRO_MONTHLY,
    billingPlanNameAnnual: PLAN_PRO_ANNUAL,
    customerQuota: PLAN_QUOTAS.PRO.customers,
    invoiceQuota: PLAN_QUOTAS.PRO.invoices,
    features: [
      { key: "customers", label: "Up to 200 customers", included: true },
      { key: "invoices", label: "Up to 500 invoices", included: true },
      { key: "credit", label: "Advanced AI credit scoring", included: true },
      { key: "collections", label: "Automated collections", included: true },
      { key: "ai", label: "AI email generation", included: true },
      { key: "replies", label: "Reply classification", included: true },
      { key: "sequences", label: "Auto sequences", included: true },
      { key: "rules", label: "Custom rules engine", included: false },
      { key: "priority", label: "Priority support", included: true },
      { key: "dedicated", label: "Dedicated support", included: false },
    ],
  },
  {
    key: "ENTERPRISE",
    name: "Enterprise",
    price: 149,
    annualPrice: 1490,
    monthlyEquivalent: 124.17,
    period: "month",
    billingPlanName: PLAN_ENTERPRISE_MONTHLY,
    billingPlanNameAnnual: PLAN_ENTERPRISE_ANNUAL,
    customerQuota: "Unlimited",
    invoiceQuota: "Unlimited",
    features: [
      { key: "customers", label: "Unlimited customers", included: true },
      { key: "invoices", label: "Unlimited invoices", included: true },
      { key: "credit", label: "Advanced AI credit scoring", included: true },
      { key: "collections", label: "Automated collections", included: true },
      { key: "ai", label: "AI email generation", included: true },
      { key: "replies", label: "Reply classification", included: true },
      { key: "sequences", label: "Auto sequences", included: true },
      { key: "rules", label: "Custom rules engine", included: true },
      { key: "priority", label: "Priority support", included: true },
      { key: "dedicated", label: "Dedicated support", included: true },
    ],
  },
];

// ─── Billing Plan Name ↔ Plan Enum Mapping ──────────────────

/**
 * Map Shopify charge name → Plan enum.
 * Covers both monthly and annual variants.
 */
export function billingPlanToEnum(planName: string | null): Plan {
  if (!planName) return "FREE";
  switch (planName) {
    case PLAN_STARTER_MONTHLY:
    case PLAN_STARTER_ANNUAL:
      return "STARTER";
    case PLAN_PRO_MONTHLY:
    case PLAN_PRO_ANNUAL:
      return "PRO";
    case PLAN_ENTERPRISE_MONTHLY:
    case PLAN_ENTERPRISE_ANNUAL:
      return "ENTERPRISE";
    default:
      return "FREE";
  }
}

/**
 * Map Plan enum → Shopify billing plan name (monthly variant)
 */
export function planToBillingName(plan: Plan): string | null {
  switch (plan) {
    case "STARTER":
      return PLAN_STARTER_MONTHLY;
    case "PRO":
      return PLAN_PRO_MONTHLY;
    case "ENTERPRISE":
      return PLAN_ENTERPRISE_MONTHLY;
    default:
      return null;
  }
}

/**
 * Map Plan enum → Shopify billing plan name (annual variant)
 */
export function planToBillingNameAnnual(plan: Plan): string | null {
  switch (plan) {
    case "STARTER":
      return PLAN_STARTER_ANNUAL;
    case "PRO":
      return PLAN_PRO_ANNUAL;
    case "ENTERPRISE":
      return PLAN_ENTERPRISE_ANNUAL;
    default:
      return null;
  }
}

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
  const resolvedPlan = resolvePlan(shop.plan);

  return {
    plan: resolvedPlan,
    planName:
      PLANS.find((p) => p.key === resolvedPlan)?.name ?? resolvedPlan,
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
 * Verify shop can access features for current plan.
 * Only blocks FREE plan at quota limit — paid plans are feature-gated at route level.
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

  const resolvedPlan = resolvePlan(shop.plan);
  const quota = PLAN_QUOTAS[resolvedPlan] ?? PLAN_QUOTAS.FREE;
  const isQuotaExceeded =
    shop._count.customers >= quota.customers ||
    shop._count.invoices >= quota.invoices;

  // Self-heal: if plan is non-FREE, the merchant has paid. Auto-correct stale status.
  if (resolvedPlan !== "FREE" && shop.subscriptionStatus !== "ACTIVE") {
    await prisma.shop.update({
      where: { id: shopId },
      data: { subscriptionStatus: "ACTIVE" },
    });
    logger.app("INFO", "checkPlanAccess — auto-healed subscriptionStatus to ACTIVE", { shopId, plan: resolvedPlan });
  }

  return {
    plan: resolvedPlan,
    isPaid: resolvedPlan !== "FREE",
    quotaBlocked: isQuotaExceeded && resolvedPlan === "FREE",
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
  const quotaRef = PLAN_QUOTAS[plan as PlanKey] ?? PLAN_QUOTAS.FREE;
  const limit = quotaRef.invoices;
  const current = await prisma.invoice.count({ where: { shopId } });

  return {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
}

// ─── Feature Gating ────────────────────────────────────────

/**
 * Check whether current plan has a specific feature.
 * Returns false for FREE plan and plans without the feature.
 */
export function hasFeature(plan: Plan, feature: keyof typeof import("~/lib/constants").PLAN_FEATURES): boolean {
  // Dynamic import not possible at module level; use the PLAN_DEFINITIONS check instead
  const def = PLANS.find((p) => p.key === plan);
  if (!def) return false;
  const feat = def.features.find((f) => f.key === feature);
  return feat?.included ?? false;
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
 * Handle app_subscriptions/update webhook.
 * Updates Shop plan, status, and quota based on incoming charge data.
 */
export async function handleSubscriptionUpdate(
  shopDomain: string,
  charge: ShopifyCharge,
): Promise<void> {
  const plan = billingPlanToEnum(charge.name);
  const quotas = PLAN_QUOTAS[plan as PlanKey] ?? PLAN_QUOTAS.FREE;

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

  // Handle cancellation → fallback to FREE
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
