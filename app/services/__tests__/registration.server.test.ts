import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    shop: { findUnique: vi.fn() },
    creditApplication: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customer: { create: vi.fn() },
    $transaction: vi.fn((fn: Function) => fn({
      customer: { create: vi.fn() },
      creditApplication: { update: vi.fn() },
    })),
  },
}));

vi.mock("~/services/credit.server", () => ({
  coldStartCreditAssessment: vi.fn(),
  scoreToGrade: vi.fn(() => "B"),
}));

vi.mock("~/services/token.server", () => ({
  generatePortalToken: vi.fn(),
  buildPortalUrl: vi.fn(),
}));

vi.mock("~/services/email-delivery.server", () => ({
  sendSimpleEmail: vi.fn(),
}));

vi.mock("~/services/logger.server", () => ({
  logger: { app: vi.fn(), metrics: vi.fn() },
}));

const mockPrisma = (await import("~/db.server")).default;
const { coldStartCreditAssessment } = await import("~/services/credit.server");
const { generatePortalToken, buildPortalUrl } = await import("~/services/token.server");

const {
  submitCreditApplication,
  RegisterSchema,
} = await import("~/services/registration.server");

describe("registration.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Zod Schema ───────────────────────────────────────────────

  describe("RegisterSchema", () => {
    const validInput = {
      shopDomain: "test.myshopify.com",
      companyName: "Acme Corp",
      contactEmail: "buyer@acme.com",
      yearsInBusiness: 5,
      companySize: "10-49",
      annualRevenue: 1_000_000,
      requestedCredit: 50_000,
    };

    it("accepts valid input", () => {
      expect(RegisterSchema.safeParse(validInput).success).toBe(true);
    });

    it("rejects missing shopDomain", () => {
      const { shopDomain: _, ...rest } = validInput;
      const result = RegisterSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = RegisterSchema.safeParse({ ...validInput, contactEmail: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects empty company name", () => {
      const result = RegisterSchema.safeParse({ ...validInput, companyName: "" });
      expect(result.success).toBe(false);
    });

    it("rejects negative yearsInBusiness", () => {
      const result = RegisterSchema.safeParse({ ...validInput, yearsInBusiness: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects negative annualRevenue", () => {
      const result = RegisterSchema.safeParse({ ...validInput, annualRevenue: -100 });
      expect(result.success).toBe(false);
    });

    it("rejects negative requestedCredit", () => {
      const result = RegisterSchema.safeParse({ ...validInput, requestedCredit: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects yearsInBusiness > 100", () => {
      const result = RegisterSchema.safeParse({ ...validInput, yearsInBusiness: 150 });
      expect(result.success).toBe(false);
    });

    it("rejects company name > 200 chars", () => {
      const result = RegisterSchema.safeParse({ ...validInput, companyName: "X".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  // ── submitCreditApplication ──────────────────────────────────

  describe("submitCreditApplication", () => {
    const baseInput = {
      shopId: "shop-1",
      companyName: "Acme",
      contactEmail: "new@test.com",
      yearsInBusiness: 10,
      companySize: "50-199",
      annualRevenue: 5_000_000,
      requestedCredit: 20_000,
    };

    it("returns duplicate error when email exists in cooldown", async () => {
      vi.mocked(mockPrisma.creditApplication.findFirst).mockResolvedValue({
        id: "dup-1",
        status: "APPROVED",
      } as never);

      const result = await submitCreditApplication(baseInput);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("already being reviewed");
      }
    });

    it("auto-approves when score is above threshold", async () => {
      vi.mocked(mockPrisma.creditApplication.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.creditApplication.create).mockResolvedValue({
        id: "app-2",
      } as never);
      vi.mocked(coldStartCreditAssessment).mockReturnValue({
        score: 85,
        recommendedLimit: 30_000,
        autoApproved: true,
        components: { yearsInBusiness: 20, revenue: 30, size: 10, creditRatio: 20 },
        flags: [],
        message: "Approved",
      });
      vi.mocked(generatePortalToken).mockResolvedValue("test-portal-token");
      vi.mocked(buildPortalUrl).mockReturnValue("https://app.example.com/portal/test-portal-token");
      // Mock the $transaction to return a mock customer
      vi.mocked(mockPrisma.$transaction).mockImplementation(async (fn: Function) => fn({
        customer: {
          create: vi.fn().mockResolvedValue({ id: "cust-2" }),
        },
        creditApplication: {
          update: vi.fn().mockResolvedValue({}),
        },
      }));

      const result = await submitCreditApplication(baseInput);

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.status).toBe("APPROVED");
      }
    });

    it("returns PENDING for low score", async () => {
      vi.mocked(mockPrisma.creditApplication.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.creditApplication.create).mockResolvedValue({
        id: "app-3",
      } as never);
      vi.mocked(coldStartCreditAssessment).mockReturnValue({
        score: 30,
        recommendedLimit: 1000,
        autoApproved: false,
        components: { yearsInBusiness: 5, revenue: 5, size: 5, creditRatio: 5 },
        flags: ["low_revenue"],
        message: "Manual review required",
      });

      const result = await submitCreditApplication({
        shopId: "shop-1",
        companyName: "Startup",
        contactEmail: "new@test.com",
        yearsInBusiness: 1,
        companySize: "1-4",
        annualRevenue: 10_000,
        requestedCredit: 50_000,
      });

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.status).toBe("PENDING");
        expect(result.creditLimit).toBeUndefined();
      }
    });
  });
});
