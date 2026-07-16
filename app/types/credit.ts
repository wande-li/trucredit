// Credit & Customer type definitions — mirrors Prisma schema

import type { CreditGrade, RiskLevel, CustomerStatus, Plan } from "@prisma/client";

export type { CreditGrade, RiskLevel, CustomerStatus, Plan };

// Customer from DB
export interface CustomerRecord {
  id: string;
  shopId: string;
  shopifyCustomerId: string;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  creditLimit: string; // Decimal → string in JS
  creditUsed: string;
  creditAvailable: string;
  creditScore: number | null;
  creditGrade: CreditGrade | null;
  riskLevel: RiskLevel;
  totalOrders: number;
  totalRevenue: string;
  avgPaymentDays: number | null;
  onTimePaymentRate: number | null;
  lastPaymentDate: Date | null;
  status: CustomerStatus;
  isFrozen: boolean;
  frozenReason: string | null;
  frozenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Credit score components
export interface CreditScoreComponents {
  paymentHistory: number; // 0-40 — on-time rate × 40
  creditUtilization: number; // 0-25 — inverse utilization
  orderVolume: number; // 0-20 — scaled by total orders
  revenueHistory: number; // 0-15 — scaled by total revenue
}

// Credit limit recommendation from scoring engine
export interface CreditRecommendation {
  score: number;
  grade: CreditGrade;
  riskLevel: RiskLevel;
  recommendedLimit: number;
  components: CreditScoreComponents;
  warnings: string[];
}

// Credit event log entry
export interface CreditEventEntry {
  customerId: string;
  type: "LIMIT_CHANGE" | "GRADE_CHANGE" | "FROZEN" | "UNFROZEN" | "SCORE_UPDATE";
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string;
  triggeredBy: string; // "SYSTEM" | "USER" | "RULE"
}

// Customer summary for list views
export interface CustomerSummary {
  id: string;
  name: string;
  company: string | null;
  email: string;
  creditLimit: string;
  creditUsed: string;
  creditAvailable: string;
  creditGrade: CreditGrade | null;
  riskLevel: RiskLevel;
  status: CustomerStatus;
  isFrozen: boolean;
  totalOrders: number;
  totalRevenue: string;
  invoiceCount: number;
  overdueCount: number;
}

// Plan-aware quota check
export interface QuotaCheck {
  allowed: boolean;
  current: number;
  limit: number;
  plan: Plan;
}
