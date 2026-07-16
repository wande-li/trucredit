// Credit Engine — scoring, grading, limit management
// Pure business logic, no HTTP/Shopify dependencies

import type {
  CreditGrade,
  RiskLevel,
  CustomerStatus,
} from "@prisma/client";
import type {
  CreditScoreComponents,
  CreditRecommendation,
} from "~/types/credit";
import { CREDIT_SCORE } from "~/lib/constants";

/**
 * Calculate credit score (0-100) from customer payment behavior
 *
 * Scoring model:
 * - Payment History (40%): onTimePaymentRate × 40
 * - Credit Utilization (25%): inverse of creditUsed/creditLimit
 * - Order Volume (20%): log10(totalOrders+1) × 10
 * - Revenue History (15%): log10(totalRevenue+1) × 7.5
 */
export function calculateCreditScore(params: {
  onTimePaymentRate: number | null;
  creditUsed: number;
  creditLimit: number;
  totalOrders: number;
  totalRevenue: number;
}): { score: number; components: CreditScoreComponents } {
  // Payment History: 0-40
  const paymentHistory = Math.round(
    (params.onTimePaymentRate ?? 0.5) * 40,
  );

  // Credit Utilization: 0-25 (more available = higher score)
  const utilization =
    params.creditLimit > 0
      ? 1 - params.creditUsed / params.creditLimit
      : 0;
  const creditUtilization = Math.round(
    Math.max(0, Math.min(1, utilization)) * 25,
  );

  // Order Volume: 0-20
  const orderVolume = Math.round(
    Math.min(1, Math.log10(params.totalOrders + 1) / 2) * 20,
  );

  // Revenue History: 0-15
  const revenueHistory = Math.round(
    Math.min(1, Math.log10(params.totalRevenue + 1) / 3) * 15,
  );

  const score = Math.min(
    CREDIT_SCORE.MAX,
    Math.max(CREDIT_SCORE.MIN, paymentHistory + creditUtilization + orderVolume + revenueHistory),
  );

  return {
    score,
    components: { paymentHistory, creditUtilization, orderVolume, revenueHistory },
  };
}

/**
 * Map score to grade
 */
export function scoreToGrade(score: number): CreditGrade {
  const t = CREDIT_SCORE.GRADE_THRESHOLDS;
  if (score >= t.A_PLUS) return "A_PLUS";
  if (score >= t.A) return "A";
  if (score >= t.B) return "B";
  if (score >= t.C) return "C";
  if (score >= t.D) return "D";
  return "F";
}

/**
 * Map grade to risk level
 */
export function gradeToRisk(grade: CreditGrade | null): RiskLevel {
  switch (grade) {
    case "A_PLUS":
    case "A":
      return "LOW";
    case "B":
      return "MEDIUM";
    case "C":
      return "MEDIUM";
    case "D":
      return "HIGH";
    case "F":
      return "CRITICAL";
    default:
      return "MEDIUM";
  }
}

/**
 * Recommend credit limit based on score and existing data
 */
export function recommendCreditLimit(params: {
  score: number;
  grade: CreditGrade;
  totalRevenue: number;
  totalOrders: number;
  existingLimit: number;
}): number {
  // Base limit by grade
  const baseByGrade: Record<CreditGrade, number> = {
    A_PLUS: 50000,
    A: 25000,
    B: 10000,
    C: 5000,
    D: 2000,
    F: 500,
  };

  const base = baseByGrade[params.grade];

  // Adjust by revenue history (up to 2x for high revenue)
  const revenueMultiplier = Math.min(
    2,
    1 + Math.log10(Math.max(1, params.totalRevenue)) / 10,
  );

  // Adjust by order volume (small bonus for repeat customers)
  const orderBonus = Math.min(5000, params.totalOrders * 100);

  return Math.round(base * revenueMultiplier + orderBonus);
}

/**
 * Full credit assessment — score + grade + risk + recommendations
 */
export function assessCredit(params: {
  onTimePaymentRate: number | null;
  creditUsed: number;
  creditLimit: number;
  totalOrders: number;
  totalRevenue: number;
}): CreditRecommendation {
  const { score, components } = calculateCreditScore(params);
  const grade = scoreToGrade(score);
  const riskLevel = gradeToRisk(grade);
  const recommendedLimit = recommendCreditLimit({
    score,
    grade,
    totalRevenue: params.totalRevenue,
    totalOrders: params.totalOrders,
    existingLimit: params.creditLimit,
  });

  const warnings: string[] = [];
  if (score < 50) warnings.push("High credit risk — consider requiring prepayment");
  if (params.onTimePaymentRate !== null && params.onTimePaymentRate < 0.7) {
    warnings.push("Below 70% on-time payment rate");
  }
  if (params.creditLimit > 0 && params.creditUsed / params.creditLimit > 0.8) {
    warnings.push("Credit utilization over 80%");
  }

  return { score, grade, riskLevel, recommendedLimit, components, warnings };
}

/**
 * Determine customer status based on risk and payment behavior
 */
export function determineCustomerStatus(
  currentStatus: CustomerStatus,
  riskLevel: RiskLevel,
  onTimePaymentRate: number | null,
): CustomerStatus {
  // Already blacklisted stays blacklisted (manual intervention required)
  if (currentStatus === "BLACKLISTED") return "BLACKLISTED";

  if (riskLevel === "CRITICAL" && (onTimePaymentRate ?? 0) < 0.3) {
    return "FROZEN";
  }

  return "ACTIVE";
}

/**
 * Calculate available credit
 */
export function calcAvailableCredit(creditLimit: number, creditUsed: number): number {
  return Math.max(0, creditLimit - creditUsed);
}

/**
 * Validate credit limit adjustment — returns true if change is within bounds
 */
export function validateCreditAdjustment(params: {
  currentLimit: number;
  newLimit: number;
  recommendedLimit: number;
  score: number;
}): { valid: boolean; reason?: string } {
  // Max 50% increase without manager approval for scores below 70
  if (params.score < 70 && params.newLimit > params.currentLimit * 1.5) {
    return {
      valid: false,
      reason: `Score ${params.score} requires approval for increases > 50%`,
    };
  }

  // Never exceed 2x recommended limit automatically
  if (params.newLimit > params.recommendedLimit * 2) {
    return {
      valid: false,
      reason: `New limit ${params.newLimit} exceeds 2x recommended (${params.recommendedLimit})`,
    };
  }

  return { valid: true };
}
