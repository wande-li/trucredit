import { describe, it, expect } from "vitest";
import {
  PLANS,
  billingPlanToEnum,
  planToBillingName,
  planToBillingNameAnnual,
  hasFeature,
} from "~/services/billing.server";

// ─── Plan Definitions ──────────────────────────────

describe("PLANS", () => {
  it("has all 4 plan types", () => {
    const keys = PLANS.map((p) => p.key);
    expect(keys).toContain("FREE");
    expect(keys).toContain("STARTER");
    expect(keys).toContain("PRO");
    expect(keys).toContain("ENTERPRISE");
  });

  it("FREE plan has price 0 and no billing integration", () => {
    const free = PLANS.find((p) => p.key === "FREE")!;
    expect(free.price).toBe(0);
    expect(free.billingPlanName).toBeNull();
    expect(free.billingPlanNameAnnual).toBeNull();
  });

  it("paid plans have billingPlanName defined", () => {
    const paid = PLANS.filter((p) => p.key !== "FREE");
    for (const plan of paid) {
      expect(plan.billingPlanName).toBeTruthy();
    }
  });

  it("no duplicate plan keys", () => {
    const keys = PLANS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("STARTER has lower quotas than PRO", () => {
    const starter = PLANS.find((p) => p.key === "STARTER")!;
    const pro = PLANS.find((p) => p.key === "PRO")!;
    expect(Number(starter.customerQuota)).toBeLessThan(Number(pro.customerQuota));
    expect(Number(starter.invoiceQuota)).toBeLessThan(Number(pro.invoiceQuota));
  });

  it("ENTERPRISE has unlimited quotas", () => {
    const ent = PLANS.find((p) => p.key === "ENTERPRISE")!;
    expect(ent.customerQuota).toEqual(expect.stringMatching(/unlimited|∞|infinity/i) || "∞");
  });
});

// ─── billingPlanToEnum ─────────────────────────────

describe("billingPlanToEnum", () => {
  it("returns FREE for null/empty plan name", () => {
    expect(billingPlanToEnum(null)).toBe("FREE");
    expect(billingPlanToEnum("")).toBe("FREE");
  });

  it("maps monthly and annual variants to same enum", () => {
    expect(billingPlanToEnum("TruCredit Starter")).toBe("STARTER");
    expect(billingPlanToEnum("TruCredit Starter Annual")).toBe("STARTER");
  });

  it("returns FREE for unknown plan names", () => {
    expect(billingPlanToEnum("Unknown Plan")).toBe("FREE");
  });
});

// ─── planToBillingName ─────────────────────────────

describe("planToBillingName", () => {
  it("returns null for FREE plan", () => {
    expect(planToBillingName("FREE")).toBeNull();
  });

  it("returns monthly billing name for STARTER", () => {
    expect(planToBillingName("STARTER")).toBeTruthy();
    expect(planToBillingName("STARTER")).toContain("Starter");
  });

  it("returns null for unknown plan", () => {
    expect(planToBillingName("UNKNOWN" as Parameters<typeof planToBillingName>[0])).toBeNull();
  });
});

// ─── planToBillingNameAnnual ───────────────────────

describe("planToBillingNameAnnual", () => {
  it("returns null for FREE plan", () => {
    expect(planToBillingNameAnnual("FREE")).toBeNull();
  });

  it("returns annual billing name for PRO", () => {
    expect(planToBillingNameAnnual("PRO")).toBeTruthy();
    expect(planToBillingNameAnnual("PRO")).toContain("Pro");
    expect(planToBillingNameAnnual("PRO")).toContain("Annual");
  });

  it("returns null for unknown plan", () => {
    expect(planToBillingNameAnnual("UNKNOWN" as Parameters<typeof planToBillingNameAnnual>[0])).toBeNull();
  });
});

// ─── hasFeature ────────────────────────────────────

describe("hasFeature", () => {
  // hasFeature() uses PLAN_FEATURES at runtime (constants.ts).
  // Keys: basicCreditScoring, advancedCreditScoring, manualCollections,
  //       automatedCollections, aiEmailGeneration, replyClassification,
  //       autoSequences, customRules, prioritySupport, dedicatedSupport,
  //       customPaymentGateway

  it("FREE has basic scoring and manual collections only", () => {
    expect(hasFeature("FREE", "basicCreditScoring")).toBe(true);
    expect(hasFeature("FREE", "manualCollections")).toBe(true);
    expect(hasFeature("FREE", "advancedCreditScoring")).toBe(false);
    expect(hasFeature("FREE", "aiEmailGeneration")).toBe(false);
    expect(hasFeature("FREE", "automatedCollections")).toBe(false);
  });

  it("STARTER adds automation and AI, no advanced rules", () => {
    expect(hasFeature("STARTER", "basicCreditScoring")).toBe(true);
    expect(hasFeature("STARTER", "advancedCreditScoring")).toBe(true);
    expect(hasFeature("STARTER", "automatedCollections")).toBe(true);
    expect(hasFeature("STARTER", "aiEmailGeneration")).toBe(true);
    expect(hasFeature("STARTER", "replyClassification")).toBe(false);
    expect(hasFeature("STARTER", "customRules")).toBe(false);
  });

  it("PRO has reply classification and auto sequences", () => {
    expect(hasFeature("PRO", "replyClassification")).toBe(true);
    expect(hasFeature("PRO", "autoSequences")).toBe(true);
    expect(hasFeature("PRO", "prioritySupport")).toBe(true);
    expect(hasFeature("PRO", "customRules")).toBe(false);
    expect(hasFeature("PRO", "dedicatedSupport")).toBe(false);
  });

  it("ENTERPRISE has everything", () => {
    expect(hasFeature("ENTERPRISE", "basicCreditScoring")).toBe(true);
    expect(hasFeature("ENTERPRISE", "aiEmailGeneration")).toBe(true);
    expect(hasFeature("ENTERPRISE", "customRules")).toBe(true);
    expect(hasFeature("ENTERPRISE", "dedicatedSupport")).toBe(true);
    expect(hasFeature("ENTERPRISE", "customPaymentGateway")).toBe(true);
  });

  it("returns false for unknown plan", () => {
    expect(hasFeature("UNKNOWN" as Parameters<typeof hasFeature>[0], "basicCreditScoring")).toBe(false);
  });
});
