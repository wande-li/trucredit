import { describe, it, expect, vi, beforeEach } from "vitest";

// ── All mocks must be hoisted ──
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("~/shopify.server", () => ({
  authenticate: { webhook: mockAuth },
  PLAN_STARTER_MONTHLY: "TruCredit Starter",
  PLAN_STARTER_ANNUAL: "TruCredit Starter Annual",
  PLAN_PRO_MONTHLY: "TruCredit Pro",
  PLAN_PRO_ANNUAL: "TruCredit Pro Annual",
  PLAN_ENTERPRISE_MONTHLY: "TruCredit Enterprise",
  PLAN_ENTERPRISE_ANNUAL: "TruCredit Enterprise Annual",
  PLAN_MONTHLY: "TruCredit Pro",
  PLAN_ANNUAL: "TruCredit Pro Annual",
  apiVersion: "2025-10",
  appUninstalled: vi.fn(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shop: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    collectionTask: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    creditEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    session: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((fn: Function) => fn(mockPrisma)),
    $executeRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));

vi.mock("~/services/logger.server", () => ({
  logger: { app: vi.fn(), error: vi.fn() },
}));

vi.mock("~/services/customer.server", () => ({
  upsertCustomerFromShopify: vi.fn().mockResolvedValue({ id: "c1" }),
}));

vi.mock("~/services/company.server", () => ({
  upsertCompanyContact: vi.fn().mockResolvedValue({ id: "co1" }),
}));

vi.mock("~/services/metafield.server", () => ({
  syncCreditMetafield: vi.fn().mockResolvedValue(undefined),
  clearCreditMetafield: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/services/billing.server", () => ({
  handleSubscriptionUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/services/redis.server", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  getCachedShop: vi.fn(),
  invalidateShopCache: vi.fn(),
}));

vi.mock("~/services/email-delivery.server", () => ({
  sendCollectionEmail: vi.fn(),
}));

vi.mock("~/services/invoice.server", () => ({
  markInvoicePaid: vi.fn().mockResolvedValue({}),
  createInvoiceFromOrder: vi.fn().mockResolvedValue({ success: true, invoiceId: "inv1" }),
  markInvoiceVoided: vi.fn().mockResolvedValue({}),
  applyInvoiceRefund: vi.fn().mockResolvedValue({}),
}));

import { action } from "~/routes/webhooks";

function req(topic: string, body: unknown, domain = "test.myshopify.com") {
  return new Request("https://a.up.railway.app/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": domain,
      "x-shopify-hmac-sha256": "mock_hmac",
    },
    body: JSON.stringify(body),
  });
}

const shop = { id: "s1", shopDomain: "test.myshopify.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ admin: {}, session: { shop: "test.myshopify.com" } });
  mockPrisma.shop.findUnique.mockResolvedValue(shop);
});

// ═════════════════════════════════════════════════════
// Error Handling (不看深层 Prisma 断言)
// ═════════════════════════════════════════════════════

describe("Error resilience", () => {
  it("returns 4xx on invalid JSON body", async () => {
    const r = new Request("https://a.up.railway.app/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-topic": "ORDERS_CREATE" },
      body: "not-json{{{",
    });
    const res = await action({ request: r, params: {}, context: {} });
    expect(res.status).toBeLessThan(500);
  });

  it("handles unknown shop gracefully (Shopify retry-safe)", async () => {
    mockPrisma.shop.findUnique.mockResolvedValue(null);
    const res = await action({
      request: req("ORDERS_CREATE", { id: 1, name: "#X" }),
      params: {},
      context: {},
    });
    // Shopify webhooks expect non-5xx to prevent retry storms; 200 is standard
    expect(res.status).toBeLessThan(500);
  });
});

// ═════════════════════════════════════════════════════
// 15 Webhook Topics — All return 200 (basic routing)
// ═════════════════════════════════════════════════════

describe("Topic routing — all handlers return 200", () => {
  const orderPayload = {
    id: 123456789,
    name: "#1001",
    email: "acme@test.com",
    customer: { id: 999, email: "acme@test.com" },
    total_price_set: { shop_money: { amount: "5000.00" } },
    billing_address: { company: "Acme Corp", name: "John Doe" },
    financial_status: "pending",
    created_at: "2026-07-20T10:00:00Z",
  };

  beforeEach(() => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({ id: "c1", creditLimit: "10000", creditUsed: "0" });
    mockPrisma.customer.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.shop.upsert.mockResolvedValue({});
    mockPrisma.shop.update.mockResolvedValue({});
  });

  it("ORDERS_CREATE — creates invoice", async () => {
    const res = await action({ request: req("ORDERS_CREATE", orderPayload), params: {}, context: {} });
    expect(res.status).toBe(200);
  });

  it("ORDERS_PAID — marks paid", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv1", status: "SENT", amount: 5000n, customer: {} });
    const res = await action({
      request: req("ORDERS_PAID", { ...orderPayload, financial_status: "paid" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("ORDERS_UPDATED — syncs financial status", async () => {
    const res = await action({
      request: req("ORDERS_UPDATED", { ...orderPayload, financial_status: "partially_paid" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("ORDERS_CANCELLED — voids invoice", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv1", status: "SENT", amount: 5000n, customer: {} });
    const res = await action({
      request: req("ORDERS_CANCELLED", { id: 123456789, name: "#1001", cancel_reason: "customer" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("DRAFT_ORDERS_COMPLETE — bridges to order", async () => {
    const res = await action({
      request: req("DRAFT_ORDERS_COMPLETE", { id: 1, order: { id: 1001, name: "#DO-1" } }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("REFUNDS_CREATE — applies refund", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv1", customerId: "c1", status: "PAID", amount: "5000", paidAmount: "5000", refundedAmount: "0",
    });
    const res = await action({
      request: req("REFUNDS_CREATE", { id: 777, order_id: 1, transactions: [{ amount: "1000", kind: "refund" }] }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("CUSTOMERS_UPDATE — syncs customer", async () => {
    const res = await action({
      request: req("CUSTOMERS_UPDATE", { id: 999, email: "a@b.com", first_name: "Jane", last_name: "Doe" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("COMPANIES_CREATE — syncs company", async () => {
    const res = await action({
      request: req("COMPANIES_CREATE", {
        id: "gid://shopify/Company/500",
        name: "Acme Inc",
        customer_accounts: [{ customer: { id: "gid://shopify/Customer/999", email: "a@acme.com", displayName: "Acme" } }],
        main_contact: { email: "contact@acme.com" },
      }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("COMPANIES_UPDATE — syncs company changes", async () => {
    const res = await action({
      request: req("COMPANIES_UPDATE", {
        id: "gid://shopify/Company/500",
        name: "Acme Updated",
        main_contact: { email: "new@acme.com" },
      }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("APP_SUBSCRIPTIONS_CREATE — handles billing", async () => {
    const res = await action({
      request: req("APP_SUBSCRIPTIONS_CREATE", { id: "sub_001", name: "TruCredit Pro", status: "ACTIVE" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("APP_SUBSCRIPTIONS_UPDATE — handles billing change", async () => {
    const res = await action({
      request: req("APP_SUBSCRIPTIONS_UPDATE", { id: "sub_001", name: "TruCredit Starter", status: "ACTIVE" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("APP_UNINSTALLED — marks shop uninstalled", async () => {
    const res = await action({
      request: req("APP_UNINSTALLED", { domain: "test.myshopify.com" }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("CUSTOMERS_DATA_REQUEST — GDPR query (200)", async () => {
    const res = await action({
      request: req("CUSTOMERS_DATA_REQUEST", {
        shop_domain: "test.myshopify.com", customer: { id: 999, email: "a@b.com" },
      }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("CUSTOMERS_REDACT — GDPR deletion (200)", async () => {
    const res = await action({
      request: req("CUSTOMERS_REDACT", {
        shop_domain: "test.myshopify.com", customer: { id: 999, email: "a@b.com" },
      }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });

  it("SHOP_REDACT — GDPR full shop deletion (200)", async () => {
    const res = await action({
      request: req("SHOP_REDACT", { shop_domain: "test.myshopify.com", shop_id: 1 }),
      params: {}, context: {},
    });
    expect(res.status).toBe(200);
  });
});
