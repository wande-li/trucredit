import { describe, it, expect } from "vitest";
import {
  calculateCreditScore,
  scoreToGrade,
  gradeToRisk,
  recommendCreditLimit,
  assessCredit,
  determineCustomerStatus,
  calcAvailableCredit,
  validateCreditAdjustment,
} from "~/services/credit.server";

// ─── calculateCreditScore ──────────────────────────

describe("calculateCreditScore", () => {
  it("returns perfect 100 for ideal customer", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: 1.0,
      creditUsed: 0,
      creditLimit: 10000,
      totalOrders: 100,
      totalRevenue: 500000,
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.components.paymentHistory).toBe(40);
    expect(result.components.creditUtilization).toBe(25);
  });

  it("returns low score for risky customer", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: 0.2,
      creditUsed: 9000,
      creditLimit: 10000,
      totalOrders: 1,
      totalRevenue: 100,
    });
    expect(result.score).toBeLessThan(30);
  });

  it("clamps score to 0-100 range", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: 1.0,
      creditUsed: 0,
      creditLimit: 1000000,
      totalOrders: 10000,
      totalRevenue: 10000000,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("handles null onTimePaymentRate (defaults to 0.5)", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: null,
      creditUsed: 500,
      creditLimit: 1000,
      totalOrders: 5,
      totalRevenue: 5000,
    });
    expect(result.components.paymentHistory).toBe(20); // 0.5 × 40
  });

  it("handles zero credit limit (100% utilization = 0 score)", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: 0.8,
      creditUsed: 100,
      creditLimit: 0,
      totalOrders: 10,
      totalRevenue: 10000,
    });
    expect(result.components.creditUtilization).toBe(0);
  });

  it("component sum equals score within rounding tolerance", () => {
    const result = calculateCreditScore({
      onTimePaymentRate: 0.75,
      creditUsed: 3000,
      creditLimit: 10000,
      totalOrders: 20,
      totalRevenue: 50000,
    });
    const sum = Object.values(result.components).reduce((a, b) => a + b, 0);
    expect(Math.abs(result.score - Math.min(100, sum))).toBeLessThanOrEqual(1);
  });
});

// ─── scoreToGrade ──────────────────────────────────

describe("scoreToGrade", () => {
  it.each([
    [95, "A_PLUS"],
    [90, "A_PLUS"],
    [89, "A"],
    [80, "A"],
    [79, "B"],
    [70, "B"],
    [69, "C"],
    [60, "C"],
    [59, "D"],
    [50, "D"],
    [49, "F"],
    [0, "F"],
  ])("score %i → grade %s", (score, expected) => {
    expect(scoreToGrade(score)).toBe(expected);
  });
});

// ─── gradeToRisk ────────────────────────────────────

describe("gradeToRisk", () => {
  it.each([
    ["A_PLUS", "LOW"],
    ["A", "LOW"],
    ["B", "MEDIUM"],
    ["C", "MEDIUM"],
    ["D", "HIGH"],
    ["F", "CRITICAL"],
    [null, "MEDIUM"],
  ])("grade %s → risk %s", (grade, expected) => {
    expect(gradeToRisk(grade as Parameters<typeof gradeToRisk>[0])).toBe(expected);
  });
});

// ─── recommendCreditLimit ──────────────────────────

describe("recommendCreditLimit", () => {
  it("recommends higher limits for A+ customers", () => {
    const limit = recommendCreditLimit({
      score: 95,
      grade: "A_PLUS",
      totalRevenue: 500000,
      totalOrders: 100,
      existingLimit: 10000,
    });
    expect(limit).toBeGreaterThan(25000);
  });

  it("recommends low limits for F grade", () => {
    const limit = recommendCreditLimit({
      score: 20,
      grade: "F",
      totalRevenue: 1000,
      totalOrders: 1,
      existingLimit: 500,
    });
    expect(limit).toBeLessThanOrEqual(2000);
  });

  it("includes order volume bonus", () => {
    const limit = recommendCreditLimit({
      score: 80,
      grade: "A",
      totalRevenue: 50000,
      totalOrders: 10,
      existingLimit: 5000,
    });
    expect(limit).toBeGreaterThan(25000); // base + revenue multiplier + orders × 100
  });
});

// ─── assessCredit ──────────────────────────────────

describe("assessCredit", () => {
  it("full assessment includes all fields", () => {
    const result = assessCredit({
      onTimePaymentRate: 0.9,
      creditUsed: 2000,
      creditLimit: 10000,
      totalOrders: 50,
      totalRevenue: 200000,
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.grade).toBeDefined();
    expect(result.riskLevel).toBeDefined();
    expect(result.recommendedLimit).toBeGreaterThan(0);
    expect(result.components).toBeDefined();
  });

  it("generates warnings for high utilization", () => {
    const result = assessCredit({
      onTimePaymentRate: 0.8,
      creditUsed: 9000,
      creditLimit: 10000,
      totalOrders: 30,
      totalRevenue: 100000,
    });
    expect(result.warnings.some((w) => w.includes("80%"))).toBe(true);
  });

  it("generates warnings for low payment rate", () => {
    const result = assessCredit({
      onTimePaymentRate: 0.5,
      creditUsed: 1000,
      creditLimit: 10000,
      totalOrders: 10,
      totalRevenue: 50000,
    });
    expect(result.warnings.some((w) => w.includes("70%"))).toBe(true);
  });
});

// ─── determineCustomerStatus ───────────────────────

describe("determineCustomerStatus", () => {
  it("blacklisted stays blacklisted", () => {
    expect(
      determineCustomerStatus("BLACKLISTED", "CRITICAL", 0.1),
    ).toBe("BLACKLISTED");
  });

  it("freezes critical risk + below 30% payment", () => {
    expect(
      determineCustomerStatus("ACTIVE", "CRITICAL", 0.2),
    ).toBe("FROZEN");
  });

  it("does not freeze critical risk if payment rate is OK", () => {
    expect(
      determineCustomerStatus("ACTIVE", "CRITICAL", 0.5),
    ).toBe("ACTIVE");
  });

  it("does not freeze low risk customers", () => {
    expect(
      determineCustomerStatus("ACTIVE", "LOW", 0.1),
    ).toBe("ACTIVE");
  });

  it("handles null payment rate for freeze check", () => {
    // (onTimePaymentRate ?? 0) → null ?? 0 = 0 → 0 < 0.3 = true → FROZEN
    expect(
      determineCustomerStatus("ACTIVE", "CRITICAL", null),
    ).toBe("FROZEN");
  });
});

// ─── calcAvailableCredit ───────────────────────────

describe("calcAvailableCredit", () => {
  it("calculates available credit correctly", () => {
    expect(calcAvailableCredit(10000, 3000)).toBe(7000);
  });

  it("returns 0 when credit used exceeds limit", () => {
    expect(calcAvailableCredit(1000, 2000)).toBe(0);
  });

  it("returns limit when nothing used", () => {
    expect(calcAvailableCredit(5000, 0)).toBe(5000);
  });
});

// ─── validateCreditAdjustment ──────────────────────

describe("validateCreditAdjustment", () => {
  it("allows reasonable adjustment", () => {
    const result = validateCreditAdjustment({
      currentLimit: 5000,
      newLimit: 6000,
      recommendedLimit: 8000,
      score: 80,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects >50% increase for score < 70", () => {
    const result = validateCreditAdjustment({
      currentLimit: 5000,
      newLimit: 8000,
      recommendedLimit: 10000,
      score: 60,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("50%");
  });

  it("rejects exceeding 2x recommended limit", () => {
    const result = validateCreditAdjustment({
      currentLimit: 5000,
      newLimit: 20000,
      recommendedLimit: 5000,
      score: 90,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("2x");
  });

  it("allows decrease regardless of score", () => {
    const result = validateCreditAdjustment({
      currentLimit: 10000,
      newLimit: 3000,
      recommendedLimit: 5000,
      score: 30,
    });
    expect(result.valid).toBe(true);
  });
});
