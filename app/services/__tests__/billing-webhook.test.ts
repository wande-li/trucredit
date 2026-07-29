import { describe, it, expect, vi, beforeEach } from "vitest";

import { handleSubscriptionUpdate, checkPlanAccess, checkInvoiceQuota } from "~/services/billing.server";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shop: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    invoice: { count: vi.fn() },
  },
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));
vi.mock("~/shopify.server", () => ({
  PLAN_STARTER_MONTHLY: "TruCredit Starter",
  PLAN_STARTER_ANNUAL: "TruCredit Starter Annual",
  PLAN_PRO_MONTHLY: "TruCredit Pro",
  PLAN_PRO_ANNUAL: "TruCredit Pro Annual",
  PLAN_ENTERPRISE_MONTHLY: "TruCredit Business",
  PLAN_ENTERPRISE_ANNUAL: "TruCredit Business Annual",
  PLAN_MONTHLY: "TruCredit Pro",
  PLAN_ANNUAL: "TruCredit Pro Annual",
}));
vi.mock("~/services/logger.server", () => ({ logger: { app: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

// ═════════════════════════════════════════════════════
// handleSubscriptionUpdate — webhook-driven plan sync
// ═════════════════════════════════════════════════════

describe("handleSubscriptionUpdate", () => {
  it("updates shop to STARTER plan with quotas on ACTIVE charge", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "charge_001",
      name: "TruCredit Starter",
      status: "ACTIVE",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { shopDomain: "test.myshopify.com" },
      data: expect.objectContaining({
        plan: "STARTER",
        subscriptionStatus: "ACTIVE",
        customerQuota: expect.any(Number),
        invoiceQuota: expect.any(Number),
      }),
    }));
  });

  it("updates shop to PRO plan with higher quotas", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_pro",
      name: "TruCredit Pro Annual",
      status: "ACTIVE",
      price: "79.00",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan: "PRO",
        subscriptionStatus: "ACTIVE",
        priceAmount: 79,
      }),
    }));
  });

  it("falls back to FREE on CANCELLED charge", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_cancel",
      name: "TruCredit Pro",
      status: "CANCELLED",
      cancelledAt: "2026-07-25T00:00:00Z",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan: "FREE",
        subscriptionStatus: "NONE",
      }),
    }));
  });

  it("falls back to FREE on EXPIRED charge", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_expired",
      name: "TruCredit Starter",
      status: "EXPIRED",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: "FREE", subscriptionStatus: "NONE" }),
    }));
  });

  it("handles DECLINED status without crash", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_dec",
      name: "TruCredit Starter",
      status: "DECLINED",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subscriptionStatus: "DECLINED" }),
    }));
  });

  it("gracefully skips if shop not found (P2025)", async () => {
    mockPrisma.shop.update.mockRejectedValue(new Error("P2025: Record not found"));
    // Should NOT throw — logged and skipped
    await expect(
      handleSubscriptionUpdate("unknown.myshopify.com", {
        id: "ch_orphan",
        name: "TruCredit Starter",
        status: "ACTIVE",
      }),
    ).resolves.toBeUndefined();
  });

  it("re-throws unexpected errors", async () => {
    mockPrisma.shop.update.mockRejectedValue(new Error("Connection timeout"));
    await expect(
      handleSubscriptionUpdate("test.myshopify.com", {
        id: "ch_err",
        name: "TruCredit Pro",
        status: "ACTIVE",
      }),
    ).rejects.toThrow("Connection timeout");
  });

  it("maps unknown plan name to FREE", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_unknown",
      name: "SomeUnknownPlan",
      status: "ACTIVE",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: "FREE" }),
    }));
  });

  it("stores currentPeriodEnd when provided", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_date",
      name: "TruCredit Starter",
      status: "ACTIVE",
      currentPeriodEnd: "2026-08-20T15:30:00Z",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currentPeriodEnd: new Date("2026-08-20T15:30:00Z"),
      }),
    }));
  });

  it("handles NaN price gracefully → 0", async () => {
    mockPrisma.shop.update.mockResolvedValue({});
    await handleSubscriptionUpdate("test.myshopify.com", {
      id: "ch_nan",
      name: "TruCredit Pro",
      status: "ACTIVE",
      price: "not-a-number",
    });
    expect(mockPrisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ priceAmount: 0 }),
    }));
  });
});

// ═════════════════════════════════════════════════════
// checkPlanAccess
// ═════════════════════════════════════════════════════

describe("checkPlanAccess", () => {
  it("returns isPaid=true for STARTER", async () => {
    mockPrisma.shop.findUniqueOrThrow.mockResolvedValue({
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      _count: { customers: 10, invoices: 20 },
    });
    const r = await checkPlanAccess("s1");
    expect(r.isPaid).toBe(true);
    expect(r.quotaBlocked).toBe(false);
    expect(r.plan).toBe("STARTER");
  });

  it("returns isPaid=false for FREE", async () => {
    mockPrisma.shop.findUniqueOrThrow.mockResolvedValue({
      plan: "FREE",
      subscriptionStatus: "NONE",
      _count: { customers: 3, invoices: 5 },
    });
    const r = await checkPlanAccess("s1");
    expect(r.isPaid).toBe(false);
    expect(r.quotaBlocked).toBe(false);
  });

  it("returns quotaBlocked=true when FREE plan exceeds limit", async () => {
    mockPrisma.shop.findUniqueOrThrow.mockResolvedValue({
      plan: "FREE",
      subscriptionStatus: "NONE",
      _count: { customers: 10, invoices: 20 }, // FREE limit is 5/10
    });
    const r = await checkPlanAccess("s1");
    expect(r.quotaBlocked).toBe(true);
    expect(r.reason).toContain("Quota exceeded");
  });

  it("returns quotaBlocked=false for paid plan even at limit", async () => {
    mockPrisma.shop.findUniqueOrThrow.mockResolvedValue({
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      _count: { customers: 50, invoices: 100 },
    });
    const r = await checkPlanAccess("s1");
    expect(r.isPaid).toBe(true);
    expect(r.quotaBlocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════
// checkInvoiceQuota
// ═════════════════════════════════════════════════════

describe("checkInvoiceQuota", () => {
  it("returns allowed=true when under limit", async () => {
    mockPrisma.invoice.count.mockResolvedValue(3);
    const r = await checkInvoiceQuota("s1", "FREE");
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(3);
  });

  it("returns allowed=false when at limit", async () => {
    mockPrisma.invoice.count.mockResolvedValue(10); // FREE limit = 10
    const r = await checkInvoiceQuota("s1", "FREE");
    expect(r.allowed).toBe(false);
    expect(r.current).toBe(10);
    expect(r.limit).toBe(10);
  });
});
