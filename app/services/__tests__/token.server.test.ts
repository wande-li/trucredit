import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock crypto before importing the module under test
vi.mock("~/lib/crypto.server", () => ({
  encryptToken: vi.fn((json: string) => `enc_${Buffer.from(json).toString("hex")}`),
  decryptToken: vi.fn((token: string) => {
    if (token.startsWith("enc_")) return Buffer.from(token.slice(4), "hex").toString("utf-8");
    throw new Error("Decryption failed");
  }),
}));

vi.mock("~/db.server", () => ({
  default: {
    portalToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("~/services/logger.server", () => ({
  logger: { app: vi.fn() },
}));

const mockPrisma = (await import("~/db.server")).default;

const {
  generateToken,
  validateToken,
  generatePaymentToken,
  generatePortalToken,
  revokePortalToken,
  buildPaymentUrl,
  buildPortalUrl,
} = await import("~/services/token.server");

const withEnv = (key: string, value: string, fn: () => void) => {
  const prev = process.env[key];
  process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
};

describe("token.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── generateToken / validateToken ────────────────────────────

  describe("generateToken / validateToken round-trip", () => {
    it("encrypts and decrypts payload", async () => {
      const payload = {
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "invoice_pay" as const,
        resourceId: "inv-1",
      };

      const token = generateToken(payload);
      expect(token).toBeTruthy();
      expect(token.startsWith("enc_")).toBe(true);

      const decoded = await validateToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.shopId).toBe("shop-1");
      expect(decoded?.customerId).toBe("cust-1");
      expect(decoded?.scope).toBe("invoice_pay");
      expect(decoded?.resourceId).toBe("inv-1");
      expect(decoded?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("returns null for expired token", async () => {
      vi.mocked(mockPrisma.portalToken.findUnique).mockResolvedValue(null);

      // Manually create an expired token
      const expired = JSON.stringify({
        shopId: "s",
        customerId: "c",
        scope: "invoice_pay",
        resourceId: "r",
        exp: Math.floor(Date.now() / 1000) - 3600,
      });
      const token = `enc_${Buffer.from(expired).toString("hex")}`;

      const result = await validateToken(token);
      expect(result).toBeNull();
    });

    it("returns null for invalid token (decrypt fails)", async () => {
      const result = await validateToken("garbage_token");
      expect(result).toBeNull();
    });

    it("returns null for token with missing fields", async () => {
      const broken = JSON.stringify({ shopId: "s" });
      const token = `enc_${Buffer.from(broken).toString("hex")}`;
      const result = await validateToken(token);
      expect(result).toBeNull();
    });
  });

  // ── generatePaymentToken ──────────────────────────────────────

  describe("generatePaymentToken", () => {
    it("generates a valid invoice_pay token", () => {
      const token = generatePaymentToken({
        shopId: "shop-1",
        customerId: "cust-1",
        invoiceId: "inv-1",
      });
      expect(token).toBeTruthy();
      expect(token.startsWith("enc_")).toBe(true);
    });
  });

  // ── generatePortalToken ───────────────────────────────────────

  describe("generatePortalToken", () => {
    it("generates token and persists hash to DB", async () => {
      vi.mocked(mockPrisma.portalToken.create).mockResolvedValue({} as never);

      const token = await generatePortalToken({
        shopId: "shop-1",
        customerId: "cust-1",
      });

      expect(token).toBeTruthy();
      expect(token.startsWith("enc_")).toBe(true);
      expect(mockPrisma.portalToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: "shop-1",
            customerId: "cust-1",
            scope: "portal",
            tokenHash: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it("still returns token when DB persist fails", async () => {
      vi.mocked(mockPrisma.portalToken.create).mockRejectedValue(new Error("DB down"));

      const token = await generatePortalToken({
        shopId: "shop-1",
        customerId: "cust-1",
      });

      // Token still generated, just not persisted
      expect(token).toBeTruthy();
      expect(token.startsWith("enc_")).toBe(true);
    });
  });

  // ── revokePortalToken ─────────────────────────────────────────

  describe("revokePortalToken", () => {
    it("returns true when token found and revoked", async () => {
      vi.mocked(mockPrisma.portalToken.updateMany).mockResolvedValue({ count: 1 });

      const result = await revokePortalToken("some-token");
      expect(result).toBe(true);
    });

    it("returns false when no matching token", async () => {
      vi.mocked(mockPrisma.portalToken.updateMany).mockResolvedValue({ count: 0 });

      const result = await revokePortalToken("unknown");
      expect(result).toBe(false);
    });

    it("returns false on DB error", async () => {
      vi.mocked(mockPrisma.portalToken.updateMany).mockRejectedValue(new Error("DB error"));

      const result = await revokePortalToken("some-token");
      expect(result).toBe(false);
    });
  });

  // ── validateToken (portal scope revocation check) ─────────────

  describe("validateToken — portal revocation", () => {
    it("returns null for revoked portal token", async () => {
      vi.mocked(mockPrisma.portalToken.findUnique).mockResolvedValue({
        revokedAt: new Date(),
      } as never);

      const payload = {
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "portal" as const,
        resourceId: "cust-1",
      };
      const token = generateToken(payload);

      const result = await validateToken(token);
      expect(result).toBeNull();
    });

    it("allows access when DB revocation check fails (fail open)", async () => {
      vi.mocked(mockPrisma.portalToken.findUnique).mockRejectedValue(new Error("DB error"));

      const payload = {
        shopId: "shop-1",
        customerId: "cust-1",
        scope: "portal" as const,
        resourceId: "cust-1",
      };
      const token = generateToken(payload);

      const result = await validateToken(token);
      expect(result).not.toBeNull();
    });
  });

  // ── URL builders ─────────────────────────────────────────────

  describe("buildPaymentUrl", () => {
    it("returns correct URL with token", () => {
      withEnv("SHOPIFY_APP_URL", "https://example.com", () => {
        expect(buildPaymentUrl("tok-123")).toBe("https://example.com/pay/tok-123");
      });
    });

    it("strips trailing slash", () => {
      withEnv("SHOPIFY_APP_URL", "https://example.com/", () => {
        expect(buildPaymentUrl("tok-456")).toBe("https://example.com/pay/tok-456");
      });
    });

    it("throws when SHOPIFY_APP_URL is not set", () => {
      withEnv("SHOPIFY_APP_URL", "", () => {
        expect(() => buildPaymentUrl("tok")).toThrow("SHOPIFY_APP_URL");
      });
    });
  });

  describe("buildPortalUrl", () => {
    it("returns correct URL with token", () => {
      withEnv("SHOPIFY_APP_URL", "https://example.com", () => {
        expect(buildPortalUrl("tok-abc")).toBe("https://example.com/portal/tok-abc");
      });
    });

    it("throws when SHOPIFY_APP_URL is not set", () => {
      withEnv("SHOPIFY_APP_URL", "", () => {
        expect(() => buildPortalUrl("tok")).toThrow("SHOPIFY_APP_URL");
      });
    });
  });
});
