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
import { CREDIT_SCORE, SCORING_WEIGHTS, CREDIT_BASE_LIMITS } from "~/lib/constants";

/**
 * Calculate credit score (0-100) from customer payment behavior
 *
 * Scoring model (weights defined in SCORING_WEIGHTS):
 * - Payment History: onTimePaymentRate × PAYMENT_HISTORY (max PAYMENT_HISTORY pts)
 * - Credit Utilization: inverse of creditUsed/creditLimit × CREDIT_UTILIZATION
 * - Order Volume: log10(totalOrders+1) / ORDER_LOG_DIVISOR × ORDER_VOLUME
 * - Revenue History: log10(totalRevenue+1) / REVENUE_LOG_DIVISOR × REVENUE_HISTORY
 */
export function calculateCreditScore(params: {
  onTimePaymentRate: number | null;
  creditUsed: number;
  creditLimit: number;
  totalOrders: number;
  totalRevenue: number;
}): { score: number; components: CreditScoreComponents } {
  const W = SCORING_WEIGHTS;

  // Payment History
  const paymentHistory = Math.round(
    (params.onTimePaymentRate ?? 0.5) * W.PAYMENT_HISTORY,
  );

  // Credit Utilization (more available = higher score)
  const utilization =
    params.creditLimit > 0
      ? 1 - params.creditUsed / params.creditLimit
      : 0;
  const creditUtilization = Math.round(
    Math.max(0, Math.min(1, utilization)) * W.CREDIT_UTILIZATION,
  );

  // Order Volume
  const orderVolume = Math.round(
    Math.min(1, Math.log10(params.totalOrders + 1) / W.ORDER_LOG_DIVISOR) * W.ORDER_VOLUME,
  );

  // Revenue History
  const revenueHistory = Math.round(
    Math.min(1, Math.log10(params.totalRevenue + 1) / W.REVENUE_LOG_DIVISOR) * W.REVENUE_HISTORY,
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
 *
 * Uses CREDIT_BASE_LIMITS by grade, then adjusts by:
 * - Revenue multiplier (capped by MAX_REVENUE_MULTIPLIER)
 * - Order volume bonus (capped by MAX_ORDER_BONUS, ORDER_BONUS_PER_ORDER per order)
 */
export function recommendCreditLimit(params: {
  score: number;
  grade: CreditGrade;
  totalRevenue: number;
  totalOrders: number;
  existingLimit: number;
}): number {
  const W = SCORING_WEIGHTS;

  const base = CREDIT_BASE_LIMITS[params.grade] ?? CREDIT_SCORE.DEFAULT_LIMIT;

  // Adjust by revenue history (capped by MAX_REVENUE_MULTIPLIER)
  const revenueMultiplier = Math.min(
    W.MAX_REVENUE_MULTIPLIER,
    1 + Math.log10(Math.max(1, params.totalRevenue)) / W.REVENUE_MULTIPLIER_LOG_DIVISOR,
  );

  // Adjust by order volume (bonus for repeat customers, capped by MAX_ORDER_BONUS)
  const orderBonus = Math.min(W.MAX_ORDER_BONUS, params.totalOrders * W.ORDER_BONUS_PER_ORDER);

  return Math.round(base * revenueMultiplier + orderBonus);
}

/**
 * Full credit assessment — score + grade + risk + recommendations
 *
 * Warnings generated using SCORING_WEIGHTS thresholds:
 * - SCORE_FLOOR: high risk warning
 * - ON_TIME_WARN: below threshold on-time payment rate
 * - UTILIZATION_WARN: above threshold credit utilization
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

  const W = SCORING_WEIGHTS;
  const warnings: string[] = [];
  if (score < W.SCORE_FLOOR) warnings.push("High credit risk — consider requiring prepayment");
  if (params.onTimePaymentRate !== null && params.onTimePaymentRate < W.ON_TIME_WARN) {
    warnings.push(`Below ${Math.round(W.ON_TIME_WARN * 100)}% on-time payment rate`);
  }
  if (params.creditLimit > 0 && params.creditUsed / params.creditLimit > W.UTILIZATION_WARN) {
    warnings.push(`Credit utilization over ${Math.round(W.UTILIZATION_WARN * 100)}%`);
  }

  return { score, grade, riskLevel, recommendedLimit, components, warnings };
}

/**
 * Determine customer status based on risk and payment behavior
 *
 * Uses SCORING_WEIGHTS.CRITICAL_RISK_ON_TIME to decide FROZEN status.
 */
export function determineCustomerStatus(
  currentStatus: CustomerStatus,
  riskLevel: RiskLevel,
  onTimePaymentRate: number | null,
): CustomerStatus {
  // Already blacklisted stays blacklisted (manual intervention required)
  if (currentStatus === "BLACKLISTED") return "BLACKLISTED";

  if (riskLevel === "CRITICAL" && (onTimePaymentRate ?? 0) < SCORING_WEIGHTS.CRITICAL_RISK_ON_TIME) {
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
 *
 * Uses SCORING_WEIGHTS thresholds:
 * - APPROVAL_SCORE_THRESHOLD + MAX_INCREASE_RATIO for auto-approval ceiling
 * - MAX_RECOMMENDED_MULTIPLIER for absolute cap on recommended limit
 */
export function validateCreditAdjustment(params: {
  currentLimit: number;
  newLimit: number;
  recommendedLimit: number;
  score: number;
}): { valid: boolean; reason?: string } {
  const W = SCORING_WEIGHTS;

  // Scores below threshold require approval for increases beyond the max ratio
  if (params.score < W.APPROVAL_SCORE_THRESHOLD && params.newLimit > params.currentLimit * W.MAX_INCREASE_RATIO) {
    return {
      valid: false,
      reason: `Score ${params.score} requires approval for increases > ${Math.round((W.MAX_INCREASE_RATIO - 1) * 100)}%`,
    };
  }

  // Never exceed the recommended multiplier cap automatically
  if (params.newLimit > params.recommendedLimit * W.MAX_RECOMMENDED_MULTIPLIER) {
    return {
      valid: false,
      reason: `New limit ${params.newLimit} exceeds ${W.MAX_RECOMMENDED_MULTIPLIER}x recommended (${params.recommendedLimit})`,
    };
  }

  return { valid: true };
}
