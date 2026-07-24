import { describe, it, expect } from "vitest";
import { PLAN_QUOTAS, PLAN_FEATURES, CREDIT_SCORE, COLLECTION, PAGINATION } from "~/lib/constants";
import type { Plan } from "@prisma/client";

// ─── PLAN_QUOTAS ───────────────────────────────────

describe("PLAN_QUOTAS", () => {
  it("ENTERPRISE has unlimited quotas", () => {
    expect(PLAN_QUOTAS.ENTERPRISE.customers).toBe(Infinity);
    expect(PLAN_QUOTAS.ENTERPRISE.invoices).toBe(Infinity);
  });

  it("plans scale from FREE → STARTER → PRO", () => {
    expect(PLAN_QUOTAS.FREE.customers).toBeLessThan(PLAN_QUOTAS.STARTER.customers);
    expect(PLAN_QUOTAS.STARTER.customers).toBeLessThan(PLAN_QUOTAS.PRO.customers);
    expect(PLAN_QUOTAS.FREE.invoices).toBeLessThan(PLAN_QUOTAS.STARTER.invoices);
    expect(PLAN_QUOTAS.STARTER.invoices).toBeLessThan(PLAN_QUOTAS.PRO.invoices);
  });

  it("GROWTH mirrors STARTER (backward compat)", () => {
    expect(PLAN_QUOTAS.GROWTH).toEqual(PLAN_QUOTAS.STARTER);
  });
});

// ─── PLAN_FEATURES ─────────────────────────────────

describe("PLAN_FEATURES", () => {
  const featureKeys = Object.keys(PLAN_FEATURES) as Array<keyof typeof PLAN_FEATURES>;
  const plans: Plan[] = ["FREE", "STARTER", "PRO", "ENTERPRISE", "GROWTH"];

  it("all features define boolean for every plan", () => {
    for (const feat of featureKeys) {
      const f = PLAN_FEATURES[feat];
      for (const plan of plans) {
        expect(f[plan as keyof typeof f], `${feat}.${plan} should be boolean`).toStrictEqual(expect.any(Boolean));
      }
    }
  });

  it("FREE plan does not have AI or auto features", () => {
    expect(PLAN_FEATURES.aiEmailGeneration.FREE).toBe(false);
    expect(PLAN_FEATURES.automatedCollections.FREE).toBe(false);
    expect(PLAN_FEATURES.basicCreditScoring.FREE).toBe(true);
  });

  it("ENTERPRISE has all features", () => {
    for (const feat of featureKeys) {
      expect(PLAN_FEATURES[feat].ENTERPRISE).toBe(true);
    }
  });
});

// ─── CREDIT_SCORE ──────────────────────────────────

describe("CREDIT_SCORE", () => {
  it("range is 0-100", () => {
    expect(CREDIT_SCORE.MIN).toBe(0);
    expect(CREDIT_SCORE.MAX).toBe(100);
  });

  it("grade thresholds are monotonic", () => {
    const t = CREDIT_SCORE.GRADE_THRESHOLDS;
    expect(t.A_PLUS).toBeGreaterThan(t.A);
    expect(t.A).toBeGreaterThan(t.B);
    expect(t.B).toBeGreaterThan(t.C);
    expect(t.C).toBeGreaterThan(t.D);
  });
});

// ─── COLLECTION ────────────────────────────────────

describe("COLLECTION", () => {
  it("default net terms is 30 days", () => {
    expect(COLLECTION.DEFAULT_NET_TERMS).toBe(30);
  });

  it("max steps per sequence is 10", () => {
    expect(COLLECTION.MAX_STEPS_PER_SEQUENCE).toBe(10);
  });

  it("tone levels range from 1 to 7", () => {
    expect(COLLECTION.TONE_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ─── PAGINATION ────────────────────────────────────

describe("PAGINATION", () => {
  it("default page size is 20, max is 100", () => {
    expect(PAGINATION.DEFAULT_PAGE_SIZE).toBe(20);
    expect(PAGINATION.MAX_PAGE_SIZE).toBe(100);
  });

  it("max exceeds default", () => {
    expect(PAGINATION.MAX_PAGE_SIZE).toBeGreaterThan(PAGINATION.DEFAULT_PAGE_SIZE);
  });
});
