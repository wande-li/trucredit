import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures mocks are available before module import hoisting
const mockPrisma = vi.hoisted(() => ({
  collectionTask: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  collectionEvent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  invoice: {
    update: vi.fn(),
  },
  $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
}));

vi.mock("~/db.server", () => ({ default: mockPrisma }));
vi.mock("~/services/ai.server", () => ({
  parseCustomerReply: vi.fn(),
}));

import { processReply, listReplies, getTaskTimeline, resolveReply } from "~/services/reply.server";
import { parseCustomerReply } from "~/services/ai.server";

const aiMock = vi.mocked(parseCustomerReply);

const fakeParsed = {
  intent: "WILL_PAY" as const,
  confidence: 0.95,
  isDispute: false,
  summary: "Will pay Friday",
  suggestedAction: "Wait",
  canAutoResolve: true,
  autoResponse: "Thanks for confirming",
};

beforeEach(() => {
  vi.clearAllMocks();
  aiMock.mockResolvedValue(fakeParsed);

  mockPrisma.collectionTask.findFirst.mockResolvedValue({
    id: "task-1",
    status: "ACTIVE",
    invoiceId: "inv-1",
    invoice: {
      invoiceNumber: "INV-001",
      amount: 1500,
      currency: "USD",
      dueDate: new Date("2026-08-15"),
      customerId: "cust-1",
    },
  });

  mockPrisma.collectionEvent.create.mockResolvedValue({ id: "evt-1" });
  mockPrisma.collectionEvent.findMany.mockResolvedValue([]);
  mockPrisma.collectionEvent.count.mockResolvedValue(0);
  mockPrisma.collectionTask.update.mockResolvedValue({});
  mockPrisma.collectionTask.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.invoice.update.mockResolvedValue({});
});

// ─── processReply ─────────────────────────────────────

describe("processReply", () => {
  const baseParams = {
    taskId: "task-1",
    shopId: "shop-1",
    fromEmail: "buyer@acme.com",
    subject: "Re: Invoice INV-001",
    body: "We will pay on Friday.",
  };

  it("returns success with parsed intent", async () => {
    const result = await processReply(baseParams);

    expect(result.success).toBe(true);
    expect(result.intent).toBe("WILL_PAY");
    expect(result.confidence).toBe(0.95);
  });

  it("returns error when task not found", async () => {
    mockPrisma.collectionTask.findFirst.mockResolvedValue(null);

    const result = await processReply(baseParams);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task not found");
  });

  it("records REPLY_RECEIVED and INTENT_DETECTED events", async () => {
    await processReply(baseParams);

    expect(mockPrisma.collectionEvent.create).toHaveBeenCalled();
    const allCalls = mockPrisma.collectionEvent.create.mock.calls;
    const types = allCalls.map(c => (c[0] as Record<string, unknown>).data as Record<string, unknown>).map(d => d.type);
    expect(types).toContain("REPLY_RECEIVED");
    expect(types).toContain("INTENT_DETECTED");
  });

  it("updates task reply tracking", async () => {
    await processReply(baseParams);

    expect(mockPrisma.collectionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-1" },
        data: expect.objectContaining({
          lastReplyIntent: "WILL_PAY",
        }),
      }),
    );
  });
});

// ─── Dispute Handling ─────────────────────────────────

describe("processReply — dispute handling", () => {
  it("auto-pauses task when reply is a dispute", async () => {
    aiMock.mockResolvedValue({
      ...fakeParsed,
      intent: "DISPUTE" as const,
      isDispute: true,
      canAutoResolve: false,
    });

    await processReply({
      taskId: "task-1",
      shopId: "shop-1",
      fromEmail: "buyer@acme.com",
      subject: "Wrong invoice amount",
      body: "This amount is incorrect.",
    });

    expect(mockPrisma.collectionTask.updateMany).toHaveBeenCalled();
    expect(mockPrisma.collectionEvent.create).toHaveBeenCalled();
  });
});

// ─── listReplies ──────────────────────────────────────

describe("listReplies", () => {
  it("returns paginated reply events for a shop", async () => {
    mockPrisma.collectionEvent.findMany.mockResolvedValue([
      { id: "evt-1", type: "REPLY_RECEIVED", createdAt: new Date() },
    ]);
    mockPrisma.collectionEvent.count.mockResolvedValue(50);

    const result = await listReplies("shop-1", { page: 2, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(50);
    expect(result.page).toBe(2);
  });

  it("returns empty list when no replies", async () => {
    mockPrisma.collectionEvent.findMany.mockResolvedValue([]);
    mockPrisma.collectionEvent.count.mockResolvedValue(0);

    const result = await listReplies("shop-1");

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─── getTaskTimeline ──────────────────────────────────

describe("getTaskTimeline", () => {
  it("returns task with events for authorized shop", async () => {
    mockPrisma.collectionTask.findFirst.mockResolvedValue({
      id: "task-1",
      events: [{ id: "evt-1", type: "EMAIL_SENT" }],
      invoice: { customer: { name: "Acme" } },
    });

    const result = await getTaskTimeline("task-1", "shop-1");

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(1);
  });
});

// ─── resolveReply ─────────────────────────────────────

describe("resolveReply", () => {
  it("returns error when event not found", async () => {
    mockPrisma.collectionEvent.findFirst.mockResolvedValue(null);

    const result = await resolveReply({
      eventId: "evt-1",
      taskId: "task-1",
      shopId: "shop-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Reply event not found");
  });

  it("creates MANUAL_NOTE on successful resolve", async () => {
    mockPrisma.collectionEvent.findFirst.mockResolvedValue({ id: "evt-1" });

    const result = await resolveReply({
      eventId: "evt-1",
      taskId: "task-1",
      shopId: "shop-1",
      notes: "Resolved by staff",
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.collectionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "MANUAL_NOTE",
        }),
      }),
    );
  });
});
