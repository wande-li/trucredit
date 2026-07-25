// Credit Rule Service — CRUD + evaluation engine
// Pure business logic, no HTTP/Shopify dependencies

import prisma from "~/db.server";
import type { Prisma, CreditAction, CreditRule } from "@prisma/client";
import { PAGINATION } from "~/lib/constants";
import { logger } from "~/services/logger.server";

// ─── Types ───────────────────────────────────────────────

export interface RuleConditions {
  creditScore?: { min?: number; max?: number };
  creditGrade?: string[];
  riskLevel?: string[];
  totalOrders?: { min?: number; max?: number };
  totalRevenue?: { min?: number; max?: number };
  onTimePaymentRate?: { min?: number; max?: number };
}

export interface RuleActionValue {
  creditLimit?: number;
  creditGrade?: string;
  netTerms?: number;
}

export interface RuleListParams {
  shopId: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface RuleInput {
  shopId: string;
  name: string;
  description?: string;
  priority: number;
  isActive: boolean;
  action: CreditAction;
  conditions: RuleConditions;
  actionValue: RuleActionValue;
}

// ─── CRUD ────────────────────────────────────────────────

/** List rules with pagination */
export async function listRules(params: RuleListParams) {
  const { shopId, isActive } = params;
  logger.app("INFO", "creditRule.listRules START", null, { shopId, isActive });
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(
    PAGINATION.MAX_PAGE_SIZE,
    params.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE,
  );

  const where: Prisma.CreditRuleWhereInput = { shopId };
  if (isActive !== undefined) where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.creditRule.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.creditRule.count({ where }),
  ]);

  logger.app("INFO", "creditRule.listRules OK", null, { shopId, total, page });
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Get single rule */
export async function getRule(params: { shopId: string; ruleId: string }) {
  logger.app("INFO", "creditRule.getRule START", null, { shopId: params.shopId, ruleId: params.ruleId });
  const result = await prisma.creditRule.findFirst({
    where: { id: params.ruleId, shopId: params.shopId },
  });
  logger.app("INFO", "creditRule.getRule OK", null, { shopId: params.shopId, ruleId: params.ruleId, found: !!result });
  return result;
}

/** Create a new rule */
export async function createRule(input: RuleInput): Promise<CreditRule> {
  logger.app("INFO", "creditRule.createRule START", null, { shopId: input.shopId, name: input.name, action: input.action });
  const result = await prisma.creditRule.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      description: input.description,
      priority: input.priority,
      isActive: input.isActive,
      action: input.action,
      conditions: input.conditions as Prisma.JsonObject,
      actionValue: input.actionValue as Prisma.JsonObject,
    },
  });
  logger.app("INFO", "creditRule.createRule OK", null, { shopId: input.shopId, ruleId: result.id });
  return result;
}

/** Update an existing rule */
export async function updateRule(
  shopId: string,
  ruleId: string,
  input: Partial<RuleInput>,
): Promise<CreditRule> {
  logger.app("INFO", "creditRule.updateRule START", null, { shopId, ruleId });
  const data: Prisma.CreditRuleUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.action !== undefined) data.action = input.action;
  if (input.conditions !== undefined) data.conditions = input.conditions as Prisma.JsonObject;
  if (input.actionValue !== undefined) data.actionValue = input.actionValue as Prisma.JsonObject;

  const result = await prisma.creditRule.update({ where: { id: ruleId, shopId }, data });
  logger.app("INFO", "creditRule.updateRule OK", null, { shopId, ruleId });
  return result;
}

/** Toggle rule active state */
export async function toggleRule(params: {
  shopId: string;
  ruleId: string;
  isActive: boolean;
}): Promise<CreditRule> {
  logger.app("INFO", "creditRule.toggleRule START", null, { shopId: params.shopId, ruleId: params.ruleId, isActive: params.isActive });
  const result = await prisma.creditRule.update({
    where: { id: params.ruleId, shopId: params.shopId },
    data: { isActive: params.isActive },
  });
  logger.app("INFO", "creditRule.toggleRule OK", null, { shopId: params.shopId, ruleId: params.ruleId });
  return result;
}

/** Soft-delete a rule */
export async function deleteRule(shopId: string, ruleId: string): Promise<void> {
  logger.app("INFO", "creditRule.deleteRule START", null, { shopId, ruleId });
  await prisma.creditRule.delete({ where: { id: ruleId, shopId } });
  logger.app("INFO", "creditRule.deleteRule OK", null, { shopId, ruleId });
}

// ─── Evaluation Engine ───────────────────────────────────

interface EvaluateContext {
  creditScore: number | null;
  creditGrade: string | null;
  riskLevel: string;
  totalOrders: number;
  totalRevenue: number;
  onTimePaymentRate: number | null;
}

interface MatchResult {
  ruleId: string;
  ruleName: string;
  action: CreditAction;
  actionValue: RuleActionValue;
  priority: number;
  matchedConditions: string[];
}

/** Check if a numeric condition is met */
function checkRange(
  value: number,
  range: { min?: number; max?: number } | undefined,
): boolean {
  if (!range) return true;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/** Check if a string value matches an array of allowed values */
function checkIncludes(
  value: string | null,
  allowed: string[] | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!value) return false;
  return allowed.includes(value);
}

/** Evaluate a single rule against customer context */
export function evaluateRule(
  rule: {
    id: string;
    name: string;
    conditions: RuleConditions;
    action: CreditAction;
    actionValue: RuleActionValue;
    priority: number;
  },
  context: EvaluateContext,
): MatchResult | null {
  const conditions = rule.conditions;
  const matched: string[] = [];

  // Credit score range
  if (conditions.creditScore) {
    if (context.creditScore === null) return null;
    if (!checkRange(context.creditScore, conditions.creditScore)) return null;
    matched.push("creditScore");
  }

  // Credit grade
  if (conditions.creditGrade && conditions.creditGrade.length > 0) {
    if (!checkIncludes(context.creditGrade, conditions.creditGrade)) return null;
    matched.push("creditGrade");
  }

  // Risk level
  if (conditions.riskLevel && conditions.riskLevel.length > 0) {
    if (!checkIncludes(context.riskLevel, conditions.riskLevel)) return null;
    matched.push("riskLevel");
  }

  // Total orders
  if (conditions.totalOrders) {
    if (!checkRange(context.totalOrders, conditions.totalOrders)) return null;
    matched.push("totalOrders");
  }

  // Total revenue
  if (conditions.totalRevenue) {
    if (!checkRange(context.totalRevenue, conditions.totalRevenue)) return null;
    matched.push("totalRevenue");
  }

  // On-time payment rate
  if (conditions.onTimePaymentRate) {
    if (context.onTimePaymentRate === null) return null;
    if (!checkRange(context.onTimePaymentRate, conditions.onTimePaymentRate)) return null;
    matched.push("onTimePaymentRate");
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    action: rule.action,
    actionValue: rule.actionValue,
    priority: rule.priority,
    matchedConditions: matched,
  };
}

/** Evaluate all active rules for a shop against a customer */
export async function evaluateAllRules(
  shopId: string,
  context: EvaluateContext,
): Promise<MatchResult[]> {
  logger.app("INFO", "creditRule.evaluateAllRules START", null, { shopId, grade: context.creditGrade });
  const rules = await prisma.creditRule.findMany({
    where: { shopId, isActive: true },
    orderBy: { priority: "asc" },
  });

  const result = rules
    .map((rule) =>
      evaluateRule(
        {
          id: rule.id,
          name: rule.name,
          conditions: rule.conditions as RuleConditions,
          action: rule.action,
          actionValue: rule.actionValue as RuleActionValue,
          priority: rule.priority,
        },
        context,
      ),
    )
    .filter((r): r is MatchResult => r !== null);
  logger.app("INFO", "creditRule.evaluateAllRules OK", null, { shopId, totalRules: rules.length, matchedRules: result.length });
  return result;
}
