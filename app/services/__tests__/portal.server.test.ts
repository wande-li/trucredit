import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findFirst: vi.fn() },
    shop: { findUnique: vi.fn() },
    invoice: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("~/services/token.server", () => ({
  validateToken: vi.fn(),
}));

vi.mock("~/services/logger.server", () => ({
  logger: { app: vi.fn() },
}));

const mockPrisma = (await import("~/db.server")).default;
const { validateToken } = await import("~/services/token.server");

const {
  validatePortalSession,
  getPortalDashboard,
  getPortalInvoices,
  getPortalPaymentHistory,
} = await import("~/services/portal.server");

describe("portal.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── validatePortalSession ────────────────────────────────────

  describe("validatePortalSession", () => {
    it("returns null for invalid token", async () => {
      vi.mocked(validateToken).mockResolvedValue(null);
      const result = await validatePortalSession("bad-token");
      expect(result).toBeNull();
    });

    it("returns null for non-portal scope token", async () => {
      vi.mocked(validateToken).mockResolvedValue({
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "invoice_pay",
        resourceId: "inv-1",
        exp: 99999999,
      } as never);
      const result = await validatePortalSession("inv-token");
      expect(result).toBeNull();
    });

    it("returns null when customer not found", async () => {
      vi.mocked(validateToken).mockResolvedValue({
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "portal",
        resourceId: "cust-1",
        exp: 99999999,
      } as never);
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue(null);

      const result = await validatePortalSession("portal-token");
      expect(result).toBeNull();
    });

    it("returns null when customer is BLACKLISTED", async () => {
      vi.mocked(validateToken).mockResolvedValue({
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "portal",
        resourceId: "cust-1",
        exp: 99999999,
      } as never);
      // findFirst with status: { not: "BLACKLISTED" } will return null for blacklisted
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue(null);

      const result = await validatePortalSession("portal-token");
      expect(result).toBeNull();
    });

    it("returns session for valid portal token", async () => {
      vi.mocked(validateToken).mockResolvedValue({
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "portal",
        resourceId: "cust-1",
        exp: 99999999,
      } as never);
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue({ id: "cust-1" } as never);

      const result = await validatePortalSession("portal-token");
      expect(result).toEqual({ shopId: "shop-1", customerId: "cust-1", token: "portal-token" });
    });
  });

  // ── getPortalDashboard ───────────────────────────────────────

  describe("getPortalDashboard", () => {
    it("throws when customer not found", async () => {
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({ shopDomain: "test.com", currency: "USD", emailFromName: "Test" } as never);
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(0);

      await expect(getPortalDashboard("shop-1", "cust-1")).rejects.toThrow("Customer not found");
    });

    it("throws when shop not found", async () => {
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue({
        id: "cust-1", name: "Acme", company: "Acme Corp", email: "test@test.com",
        creditLimit: 100000, creditUsed: 25000, creditAvailable: 75000,
        creditGrade: "B", creditScore: 72, netTermsDays: 30, status: "ACTIVE",
      } as never);
      vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue(null);
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([]);

      await expect(getPortalDashboard("shop-1", "cust-1")).rejects.toThrow("Shop not found");
    });

    it("returns full dashboard for valid customer", async () => {
      vi.mocked(mockPrisma.customer.findFirst).mockResolvedValue({
        id: "cust-1", name: "Acme", company: "Acme Corp", email: "buyer@acme.com",
        creditLimit: 100000, creditUsed: 25000, creditAvailable: 75000,
        creditGrade: "B", creditScore: 72, netTermsDays: 30, status: "ACTIVE",
      } as never);
      vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({
        shopDomain: "test.myshopify.com", currency: "USD", emailFromName: "Test Store",
      } as never);
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(0);

      const dashboard = await getPortalDashboard("shop-1", "cust-1");

      expect(dashboard.customer).toMatchObject({
        name: "Acme",
        creditLimit: 100000,
        creditAvailable: 75000,
      });
      expect(dashboard.shop.domain).toBe("test.myshopify.com");
      expect(dashboard.summary.totalOutstanding).toBe(0);
      expect(dashboard.recentInvoices).toEqual([]);
      expect(dashboard.recentPayments).toEqual([]);
    });
  });

  // ── getPortalInvoices ────────────────────────────────────────

  describe("getPortalInvoices", () => {
    it("returns paginated invoices", async () => {
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-1", invoiceNumber: "INV-001", amount: 5000, currency: "USD",
          status: "OPEN", issueDate: new Date("2026-07-01"), dueDate: new Date("2026-07-30"),
          daysOverdue: 0, netTermsDays: 30, paymentUrl: null,
        },
      ] as never);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(1);

      const result = await getPortalInvoices("shop-1", "cust-1");

      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0]?.invoiceNumber).toBe("INV-001");
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it("returns empty list", async () => {
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(0);

      const result = await getPortalInvoices("shop-1", "cust-1");
      expect(result.invoices).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ── getPortalPaymentHistory ──────────────────────────────────

  describe("getPortalPaymentHistory", () => {
    it("returns payment history", async () => {
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([
        {
          id: "pay-1", invoiceNumber: "INV-001", amount: 5000, currency: "USD",
          paidDate: new Date("2026-07-20"), paymentMethod: "credit_card",
          issueDate: new Date("2026-06-20"),
        },
      ] as never);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(1);

      const result = await getPortalPaymentHistory("shop-1", "cust-1");

      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]?.amount).toBe(5000);
      expect(result.payments[0]?.daysToPay).toBe(30);
      expect(result.total).toBe(1);
    });

    it("returns empty list", async () => {
      vi.mocked(mockPrisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.invoice.count).mockResolvedValue(0);

      const result = await getPortalPaymentHistory("shop-1", "cust-1");
      expect(result.payments).toHaveLength(0);
    });
  });
});
