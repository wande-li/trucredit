// Collection engine type definitions — mirrors Prisma + service layer

import type { Channel, TaskStatus, EventType, ReplyIntent, TriggerType } from "@prisma/client";

export type { Channel, TaskStatus, EventType, ReplyIntent, TriggerType };

// Collection stage derived from overdue days
export type CollectionStage =
  | "STAGE_MINUS_7"  // 7 days before due
  | "STAGE_PLUS_0"   // on due date
  | "STAGE_PLUS_7"   // 7 days overdue
  | "STAGE_PLUS_14"  // 14 days overdue
  | "STAGE_PLUS_30"  // 30 days overdue
  | "STAGE_PLUS_60"  // 60 days overdue
  | "STAGE_PLUS_90"; // 90+ days overdue

// Map overdue days to collection stage
export function daysToStage(daysDifference: number): CollectionStage {
  if (daysDifference <= -7) return "STAGE_MINUS_7";
  if (daysDifference <= 0) return "STAGE_PLUS_0";
  if (daysDifference <= 7) return "STAGE_PLUS_7";
  if (daysDifference <= 14) return "STAGE_PLUS_14";
  if (daysDifference <= 30) return "STAGE_PLUS_30";
  if (daysDifference <= 60) return "STAGE_PLUS_60";
  return "STAGE_PLUS_90";
}

// Tone level (1=friendly → 7=legal)
export type ToneLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Map stage to recommended tone level
export function stageToTone(stage: CollectionStage): ToneLevel {
  const map: Record<CollectionStage, ToneLevel> = {
    STAGE_MINUS_7: 1,
    STAGE_PLUS_0: 2,
    STAGE_PLUS_7: 3,
    STAGE_PLUS_14: 4,
    STAGE_PLUS_30: 5,
    STAGE_PLUS_60: 6,
    STAGE_PLUS_90: 7,
  };
  return map[stage];
}

// Collection task state machine
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ["ACTIVE", "STOPPED"],
  ACTIVE: ["PAUSED", "COMPLETED", "STOPPED", "ESCALATED"],
  PAUSED: ["ACTIVE", "STOPPED"],
  COMPLETED: [],
  STOPPED: [],
  ESCALATED: ["ACTIVE", "COMPLETED", "STOPPED"],
};

// Check if a status transition is valid
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// Step timing — delay after previous step before next action
export interface StepTiming {
  stepOrder: number;
  delayDays: number;
  channel: Channel;
  toneLevel: ToneLevel;
}

// Sweep result (collection engine batch run)
export interface SweepResult {
  shopsProcessed: number;
  invoicesMatched: number;
  emailsSent: number;
  emailsSkipped: number;
  tasksCreated: number;
  tasksAdvanced: number;
  errors: number;
  errorsList: string[];
}

// Single invoice evaluation result
export interface InvoiceEvalResult {
  invoiceId: string;
  customerId: string;
  matched: boolean;
  stage: CollectionStage;
  action: "SEND_EMAIL" | "CREATE_TASK" | "ADVANCE_TASK" | "SKIP" | "ERROR";
  reason: string;
}

// Reply parse result from AI
export interface ParsedReply {
  intent: ReplyIntent;
  confidence: number; // 0-1
  isDispute: boolean;
  summary: string;
  suggestedAction: string;
  canAutoResolve: boolean;
  autoResponse: string | null;
}

// AI-generated email result
export interface GeneratedEmail {
  subject: string;
  body: string; // plain text
}
