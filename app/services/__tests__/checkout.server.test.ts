import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma (vi.hoisted to avoid hoist init error) ──
const { mockPrismaClient } = vi.hoisted(() => ({
  mockPrismaClient: {
    shop: { findUnique: vi.fn() },
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
    creditEvent: { findFirst: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({ default: mockPrismaClient }));

vi.mock("~/services/logger.server", () => ({
  logger: { app: vi.fn() },
}));

import { checkCreditEligibility, reserveCredit } from "~/services/checkout.server";

// ── Helpers ─────────────────────────────────────────
const mockShop = { id: "shop_001" };
const mockCustomer = {
  id: "cust_001",
  name: "Acme Corp",
  creditLimit: "10000",
  creditUsed: "3000",
  isFrozen: false,
  email: "acme@test.com",
  shopifyCustomerId: "12345",
};
const mockCustomerFrozen = { ...mockCustomer, isFrozen: true };

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════
// checkCreditEligibility
// ═════════════════════════════════════════════════════

describe("checkCreditEligibility", () => {
  it("returns eligible=true when all checks pass", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomer);
    mockPrismaClient.invoice.findFirst.mockResolvedValue(null); // no severely overdue

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 5000,
    });

    expect(result.eligible).toBe(true);
    expect(result.customerId).toBe("cust_001");
    expect(result.suggestion).toBeUndefined();
  });

  it("returns eligible=false when shop not found", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(null);

    const result = await checkCreditEligibility({
      shopDomain: "unknown.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 5000,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Shop not found");
    expect(result.suggestion).toBe("PAY_NOW");
  });

  it("returns eligible=false when customer not found", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(null);

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "unknown@test.com",
      cartTotal: 5000,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("approved B2B account");
    expect(result.suggestion).toBe("PAY_NOW");
  });

  it("returns eligible=false when customer is frozen", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomerFrozen);

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 100,
    });

    expect(result.eligible).toBe(false);
    expect(result.isFrozen).toBe(true);
    expect(result.reason).toContain("suspended");
    expect(result.suggestion).toBe("PAY_NOW");
  });

  it("returns eligible=false when cart exceeds available credit", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomer); // limit 10k, used 3k → avail 7k

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 8000, // > 7000 available
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("exceeds available credit");
    // creditLimit > 0, so suggest REDUCE_CART not PAY_NOW
    expect(result.suggestion).toBe("REDUCE_CART");
    expect(result.availableCredit).toBe(7000);
  });

  it("returns eligible=false when severely overdue (>90 days)", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomer);
    mockPrismaClient.invoice.findFirst.mockResolvedValue({ id: "inv_overdue" });

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 100,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("90+ days");
    expect(result.suggestion).toBe("PAY_NOW");
  });

  it("returns eligible=false when credit limit is zero", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue({
      ...mockCustomer,
      creditLimit: "0",
      creditUsed: "0",
    });
    mockPrismaClient.invoice.findFirst.mockResolvedValue(null);

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 100,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("exceeds available credit");
    expect(result.creditLimit).toBe(0);
    expect(result.availableCredit).toBe(0);
  });

  it("trims whitespace from domain and email", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomer);
    mockPrismaClient.invoice.findFirst.mockResolvedValue(null);

    const result = await checkCreditEligibility({
      shopDomain: "  test.myshopify.com  ",
      customerEmail: "  ACME@TEST.COM  ",
      cartTotal: 100,
    });

    expect(result.eligible).toBe(true);
    expect(mockPrismaClient.shop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shopDomain: "test.myshopify.com" } }),
    );
    expect(mockPrismaClient.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: "acme@test.com" }) }),
    );
  });

  it("returns customer detail fields on eligible result", async () => {
    mockPrismaClient.shop.findUnique.mockResolvedValue(mockShop);
    mockPrismaClient.customer.findFirst.mockResolvedValue(mockCustomer);
    mockPrismaClient.invoice.findFirst.mockResolvedValue(null);

    const result = await checkCreditEligibility({
      shopDomain: "test.myshopify.com",
      customerEmail: "acme@test.com",
      cartTotal: 1000,
    });

    expect(result.eligible).toBe(true);
    expect(result.customerName).toBe("Acme Corp");
    expect(result.creditLimit).toBe(10000);
    expect(result.creditUsed).toBe(3000);
    expect(result.availableCredit).toBe(7000);
    expect(result.isFrozen).toBe(false);
  });
});

// ═════════════════════════════════════════════════════
// reserveCredit (atomic credit reservation)
// ═════════════════════════════════════════════════════

describe("reserveCredit", () => {
  it("successfully reserves credit when available", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue(null); // no existing event
    mockPrismaClient.$executeRaw.mockResolvedValue(1); // 1 row updated = success
    mockPrismaClient.creditEvent.create.mockResolvedValue({ id: "evt_001" });

    const result = await reserveCredit({
      customerId: "cust_001",
      amount: 1000,
      orderName: "#ORD-1001",
    });

    expect(result.success).toBe(true);
    expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.creditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "cust_001",
          triggeredBy: "checkout",
          reason: "#ORD-1001",
        }),
      }),
    );
  });

  it("returns success=true on idempotent retry (same order within 30min)", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue({ id: "evt_001" });
    // $executeRaw should NOT be called on retry
    mockPrismaClient.$executeRaw.mockResolvedValue(1);

    const result = await reserveCredit({
      customerId: "cust_001",
      amount: 1000,
      orderName: "#ORD-1001",
    });

    expect(result.success).toBe(true);
    // Idempotent: did not call $executeRaw
    expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrismaClient.creditEvent.create).not.toHaveBeenCalled();
  });

  it("returns success=false when $executeRaw returns 0 (insufficient credit)", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue(null);
    mockPrismaClient.$executeRaw.mockResolvedValue(0); // no rows updated
    mockPrismaClient.customer.findUnique.mockResolvedValue({
      id: "cust_001",
      isFrozen: false,
      creditLimit: "5000",
      creditUsed: "4000",
    });

    const result = await reserveCredit({
      customerId: "cust_001",
      amount: 2000,
      orderName: "#ORD-1002",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient credit");
    expect(result.error).toContain("2000");
  });

  it("returns success=false when account is frozen", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue(null);
    mockPrismaClient.$executeRaw.mockResolvedValue(0);
    mockPrismaClient.customer.findUnique.mockResolvedValue({
      id: "cust_001",
      isFrozen: true,
      creditLimit: "10000",
      creditUsed: "0",
    });

    const result = await reserveCredit({
      customerId: "cust_001",
      amount: 100,
      orderName: "#ORD-1003",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Account frozen");
  });

  it("returns success=false when customer not found", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue(null);
    mockPrismaClient.$executeRaw.mockResolvedValue(0);
    mockPrismaClient.customer.findUnique.mockResolvedValue(null);

    const result = await reserveCredit({
      customerId: "cust_unknown",
      amount: 100,
      orderName: "#ORD-1004",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Customer not found");
  });

  it("returns success=false on unexpected DB error", async () => {
    mockPrismaClient.creditEvent.findFirst.mockResolvedValue(null);
    mockPrismaClient.$executeRaw.mockRejectedValue(new Error("Connection timeout"));

    const result = await reserveCredit({
      customerId: "cust_001",
      amount: 100,
      orderName: "#ORD-1005",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Internal error");
  });
});
