import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma (vi.hoisted to avoid hoist init error) ──
const { mockPrisma } = vi.hoisted(() => {
  const mock = {
    invoice: {
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    customer: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    collectionTask: { updateMany: vi.fn() },
    creditEvent: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn((fn: Function) => fn(mock)),
  };
  return { mockPrisma: mock };
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));
vi.mock("~/services/logger.server", () => ({ logger: { app: vi.fn() } }));

import { markInvoicePaid, bulkMarkInvoicePaid, recordPartialPayment } from "~/services/invoice.server";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction = vi.fn((fn: Function) => fn(mockPrisma));
});

// ═════════════════════════════════════════════════════
// markInvoicePaid(shopId, invoiceId, paymentMethod?)
// ═════════════════════════════════════════════════════

describe("markInvoicePaid", () => {
  const mockInvoice = {
    id: "inv_001",
    customerId: "cust_001",
    shopId: "shop_001",
    status: "SENT",
    amount: 5000n,
    paidDate: null,
  };

  const mockPaidHistory = [{ dueDate: new Date("2026-06-01"), paidDate: new Date("2026-06-05") }];

  it("marks SENT invoice as PAID and updates customer credit", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue(mockInvoice);
    mockPrisma.invoice.findMany.mockResolvedValue(mockPaidHistory);
    mockPrisma.invoice.update.mockResolvedValue({ ...mockInvoice, status: "PAID" });

    await markInvoicePaid({
      shopId: "shop_001",
      invoiceId: "inv_001",
      paymentMethod: "Bank Transfer",
    });

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv_001" },
        data: expect.objectContaining({
          status: "PAID",
          paymentMethod: "Bank Transfer",
        }),
      }),
    );
    expect(mockPrisma.customer.update).toHaveBeenCalled();
    expect(mockPrisma.collectionTask.updateMany).toHaveBeenCalled();
  });

  it("is idempotent: already PAID invoice returns early", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue({
      ...mockInvoice,
      status: "PAID",
      amount: 5000n,
    });

    await markInvoicePaid({
      shopId: "shop_001",
      invoiceId: "inv_001",
    });

    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it("throws when invoice not found (findFirstOrThrow)", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockRejectedValue(
      new Error("P2025: Record not found"),
    );

    await expect(
      markInvoicePaid({ shopId: "shop_001", invoiceId: "inv_nonexistent" }),
    ).rejects.toThrow("Record not found");
  });

  it("updates creditUsed and creditAvailable correctly", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue(mockInvoice);
    mockPrisma.invoice.findMany.mockResolvedValue(mockPaidHistory);
    mockPrisma.invoice.update.mockResolvedValue({ ...mockInvoice, status: "PAID" });

    await markInvoicePaid({ shopId: "shop_001", invoiceId: "inv_001" });

    expect(mockPrisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditUsed: { decrement: 5000 },
          creditAvailable: { increment: 5000 },
        }),
      }),
    );
  });

  it("calculates onTimePaymentRate from paid history", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue(mockInvoice);
    // 2 of 3 paid on time = 0.667
    mockPrisma.invoice.findMany.mockResolvedValue([
      { dueDate: new Date("2026-06-01"), paidDate: new Date("2026-05-30") }, // on time
      { dueDate: new Date("2026-06-10"), paidDate: new Date("2026-06-15") }, // late
      { dueDate: new Date("2026-07-01"), paidDate: new Date("2026-06-28") }, // on time
    ]);

    await markInvoicePaid({ shopId: "shop_001", invoiceId: "inv_001" });

    expect(mockPrisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onTimePaymentRate: 2 / 3,
        }),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════
// bulkMarkInvoicePaid → Promise<number>
// ═════════════════════════════════════════════════════

describe("bulkMarkInvoicePaid", () => {
  const mockInv = { id: "inv_001", customerId: "cust_001", amount: 5000n, status: "SENT" };

  it("returns 0 when no invoice IDs provided", async () => {
    // Reset findMany to return empty — no invoices to process
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const count = await bulkMarkInvoicePaid({
      shopId: "shop_001",
      invoiceIds: [],
    });

    expect(count).toBe(0);
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("processes multiple invoices in batch", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { ...mockInv, id: "inv_001" },
      { ...mockInv, id: "inv_002", customerId: "cust_002" },
      { ...mockInv, id: "inv_003", customerId: "cust_003" },
    ]);

    const count = await bulkMarkInvoicePaid({
      shopId: "shop_001",
      invoiceIds: ["inv_001", "inv_002", "inv_003"],
    });

    expect(count).toBe(3);
    expect(mockPrisma.invoice.update).toHaveBeenCalledTimes(3);
  });

  it("handles single invoice batch", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([mockInv]);

    const count = await bulkMarkInvoicePaid({
      shopId: "shop_001",
      invoiceIds: ["inv_001"],
    });

    expect(count).toBe(1);
  });
});

// ═════════════════════════════════════════════════════
// recordPartialPayment → Promise<InvoiceRecord>
// ═════════════════════════════════════════════════════

describe("recordPartialPayment", () => {
  it("records partial payment and decrements invoice amount", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue({
      id: "inv_001",
      customerId: "cust_001",
      shopId: "shop_001",
      amount: 10000n,
      status: "SENT",
    });
    mockPrisma.invoice.update.mockResolvedValue({
      id: "inv_001",
      amount: 7060n,
      status: "PARTIALLY_PAID",
      customerId: "cust_001",
      shopId: "shop_001",
      amountDue: 7060n,
    });

    const result = await recordPartialPayment({
      shopId: "shop_001",
      invoiceId: "inv_001",
      paymentAmount: 3000,
      paymentMethod: "ACH",
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("PARTIALLY_PAID");
    expect(mockPrisma.invoice.update).toHaveBeenCalledTimes(1);
  });

  it("rejects payment against PAID invoice", async () => {
    mockPrisma.invoice.findFirstOrThrow.mockResolvedValue({
      id: "inv_001",
      customerId: "cust_001",
      shopId: "shop_001",
      amount: 10000n,
      status: "PAID",
    });

    await expect(
      recordPartialPayment({
        shopId: "shop_001",
        invoiceId: "inv_001",
        paymentAmount: 3000,
      }),
    ).rejects.toThrow("paid");
  });
});
