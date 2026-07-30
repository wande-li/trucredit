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
  ColdStartProfile,
  ColdStartComponents,
  ColdStartResult,
} from "~/types/credit";
import { CREDIT_SCORE, SCORING_WEIGHTS, CREDIT_BASE_LIMITS, COLD_START_WEIGHTS, COLD_START_SIZE_SCORE, COLD_START_THRESHOLDS } from "~/lib/constants";
import { logger } from "~/services/logger.server";

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
  logger.app("INFO", "credit.calculateCreditScore START", null, { orders: params.totalOrders, revenue: params.totalRevenue });
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

  logger.app("INFO", "credit.calculateCreditScore OK", null, { score });
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
  let result: CreditGrade;
  if (score >= t.A_PLUS) result = "A_PLUS";
  else if (score >= t.A) result = "A";
  else if (score >= t.B) result = "B";
  else if (score >= t.C) result = "C";
  else if (score >= t.D) result = "D";
  else result = "F";
  logger.app("INFO", "credit.scoreToGrade OK", null, { score, grade: result });
  return result;
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

  const result = Math.round(base * revenueMultiplier + orderBonus);
  logger.app("INFO", "credit.recommendCreditLimit OK", null, { grade: params.grade, limit: result });
  return result;
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
  logger.app("INFO", "credit.assessCredit START", null, { orders: params.totalOrders, revenue: params.totalRevenue });
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

  const result = { score, grade, riskLevel, recommendedLimit, components, warnings };
  logger.app("INFO", "credit.assessCredit OK", null, { score, grade, riskLevel });
  return result;
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

/**
 * Calculate cold-start credit score (0-100) from company profile.
 * Used when buyer has no transaction history (creditSource = COLD_START).
 *
 * Scoring dimensions:
 * - Business Age (30 pts): log10(years+1) / log10(21) * 30
 * - Company Size (20 pts): solo=5, 2-10=10, 11-50=15, 51+=20
 * - Debt Service Ratio (30 pts): annualRevenue / requestedCredit tiers
 * - Request Amount (20 pts): smaller requests score higher
 */
export function calculateColdStartScore(profile: ColdStartProfile): { score: number; components: ColdStartComponents } {
  const W = COLD_START_WEIGHTS;

  // Business Age: log scale, 10+ years = full score
  const businessAge = Math.round(
    Math.min(1, Math.log10(Math.min(profile.yearsInBusiness, 20) + 1) / Math.log10(21)) * W.BUSINESS_AGE,
  );

  // Company Size: tiered scoring
  const companySize = COLD_START_SIZE_SCORE[profile.companySize] ?? 5;

  // Debt Service Ratio: annualRevenue / requestedCredit
  // Higher ratio = lower risk, capped at 10:1 for full score
  const ratio = profile.requestedCredit > 0 ? profile.annualRevenue / profile.requestedCredit : 0;
  const dsrScore = Math.min(1, ratio / 10) * W.DEBT_SERVICE_RATIO;
  const debtServiceRatio = Math.round(Math.max(0, dsrScore));

  // Request Amount: conservatism bonus for smaller requests
  let requestScore = 20; // ≤ $1000
  if (profile.requestedCredit > 10000) requestScore = 5;
  else if (profile.requestedCredit > 5000) requestScore = 10;
  else if (profile.requestedCredit > 1000) requestScore = 15;
  const requestAmount = Math.round(requestScore * W.REQUEST_AMOUNT / 20);

  const score = Math.min(100, Math.max(0, businessAge + companySize + debtServiceRatio + requestAmount));

  logger.app("INFO", "credit.calculateColdStartScore OK", null, { score, ...profile });

  return {
    score,
    components: { businessAge, companySize, debtServiceRatio, requestAmount },
  };
}

/**
 * Full cold-start credit assessment — score + auto/manual decision + recommended limit
 */
export function coldStartCreditAssessment(
  profile: ColdStartProfile,
  merchantMaxLimit?: number,
): ColdStartResult {
  const { score, components } = calculateColdStartScore(profile);
  const maxLimit = merchantMaxLimit ?? COLD_START_THRESHOLDS.MAX_AUTO_LIMIT_DEFAULT;
  const autoApproved = score >= COLD_START_THRESHOLDS.AUTO_APPROVE;
  const recommendedLimit = autoApproved
    ? Math.min(profile.requestedCredit, maxLimit)
    : 0;

  const reason = autoApproved
    ? `Auto-approved: score ${score} meets threshold ${COLD_START_THRESHOLDS.AUTO_APPROVE}`
    : `Manual review required: score ${score} below threshold ${COLD_START_THRESHOLDS.AUTO_APPROVE}`;

  logger.app("INFO", "credit.coldStartCreditAssessment OK", null, { score, autoApproved, recommendedLimit });

  return { score, components, recommendedLimit, autoApproved, reason };
}
