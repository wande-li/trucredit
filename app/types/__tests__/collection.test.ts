import { describe, it, expect } from "vitest";
import {
  daysToStage,
  stageToTone,
  isValidTransition,
  VALID_TRANSITIONS,
} from "~/types/collection";

// ─── daysToStage ───────────────────────────────────

describe("daysToStage", () => {
  it.each([
    [-365, "STAGE_MINUS_7"],
    [-10, "STAGE_MINUS_7"],
    [-7, "STAGE_MINUS_7"],
    [-6, "STAGE_PLUS_0"],
    [-1, "STAGE_PLUS_0"],
    [0, "STAGE_PLUS_0"],
    [1, "STAGE_PLUS_7"],
    [7, "STAGE_PLUS_7"],
    [8, "STAGE_PLUS_14"],
    [14, "STAGE_PLUS_14"],
    [15, "STAGE_PLUS_30"],
    [30, "STAGE_PLUS_30"],
    [31, "STAGE_PLUS_60"],
    [60, "STAGE_PLUS_60"],
    [61, "STAGE_PLUS_90"],
    [90, "STAGE_PLUS_90"],
    [365, "STAGE_PLUS_90"],
  ])("daysDifference %i → %s", (days, expected) => {
    expect(daysToStage(days)).toBe(expected);
  });

  it("covers all 7 stages", () => {
    const seen = new Set<string>();
    const testValues = [-10, -5, 0, 3, 10, 20, 40, 70, 100];
    for (const v of testValues) seen.add(daysToStage(v));
    expect(seen.size).toBe(7);
  });
});

// ─── stageToTone ───────────────────────────────────

describe("stageToTone", () => {
  it.each([
    ["STAGE_MINUS_7", 1],
    ["STAGE_PLUS_0", 2],
    ["STAGE_PLUS_7", 3],
    ["STAGE_PLUS_14", 4],
    ["STAGE_PLUS_30", 5],
    ["STAGE_PLUS_60", 6],
    ["STAGE_PLUS_90", 7],
  ])("%s → tone %i", (stage, tone) => {
    expect(stageToTone(stage as Parameters<typeof stageToTone>[0])).toBe(tone);
  });

  it("tone increases monotonically with overdue days", () => {
    // Not applicable since stageToTone only takes CollectionStage, not TaskStatus
    const collectionStages = [
      "STAGE_MINUS_7", "STAGE_PLUS_0", "STAGE_PLUS_7",
      "STAGE_PLUS_14", "STAGE_PLUS_30", "STAGE_PLUS_60", "STAGE_PLUS_90",
    ] as const;
    for (let i = 1; i < collectionStages.length; i++) {
      expect(
        stageToTone(collectionStages[i] as Parameters<typeof stageToTone>[0]),
      ).toBeGreaterThan(
        stageToTone(collectionStages[i - 1] as Parameters<typeof stageToTone>[0]),
      );
    }
  });
});

// ─── VALID_TRANSITIONS ─────────────────────────────

describe("VALID_TRANSITIONS", () => {
  it("COMPLETED has no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.COMPLETED).toEqual([]);
  });

  it("STOPPED has no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.STOPPED).toEqual([]);
  });

  it("ACTIVE can transition to PAUSED, COMPLETED, STOPPED, ESCALATED", () => {
    expect(VALID_TRANSITIONS.ACTIVE).toContain("PAUSED");
    expect(VALID_TRANSITIONS.ACTIVE).toContain("COMPLETED");
    expect(VALID_TRANSITIONS.ACTIVE).toContain("STOPPED");
    expect(VALID_TRANSITIONS.ACTIVE).toContain("ESCALATED");
    expect(VALID_TRANSITIONS.ACTIVE).toHaveLength(4);
  });

  it("ESCALATED can return to ACTIVE or be completed/stopped", () => {
    expect(VALID_TRANSITIONS.ESCALATED).toContain("ACTIVE");
    expect(VALID_TRANSITIONS.ESCALATED).toContain("COMPLETED");
    expect(VALID_TRANSITIONS.ESCALATED).toContain("STOPPED");
  });

  it("covers all 6 TaskStatus values", () => {
    expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(6);
  });
});

// ─── isValidTransition ─────────────────────────────

describe("isValidTransition", () => {
  it.each([
    ["PENDING", "ACTIVE", true],
    ["PENDING", "STOPPED", true],
    ["PENDING", "PAUSED", false],
    ["ACTIVE", "PAUSED", true],
    ["ACTIVE", "COMPLETED", true],
    ["ACTIVE", "ESCALATED", true],
    ["PAUSED", "ACTIVE", true],
    ["PAUSED", "COMPLETED", false],
    ["COMPLETED", "ACTIVE", false],
    ["COMPLETED", "STOPPED", false],
    ["STOPPED", "ACTIVE", false],
    ["ESCALATED", "COMPLETED", true],
    ["ESCALATED", "ACTIVE", true],
    ["ESCALATED", "PAUSED", false],
  ])("%s → %s = %s", (from, to, expected) => {
    expect(
      isValidTransition(
        from as Parameters<typeof isValidTransition>[0],
        to as Parameters<typeof isValidTransition>[1],
      ),
    ).toBe(expected);
  });

  it("no transition can reach COMPLETED from COMPLETED", () => {
    // COMPLETED has empty transitions, so nothing can go FROM completed
    expect(isValidTransition("COMPLETED", "COMPLETED")).toBe(false);
  });
});

// ─── Tone monotonicity ─────────────────────────────

describe("Tone coverage", () => {
  it("all 7 tone levels used", () => {
    const tones = [
      "STAGE_MINUS_7", "STAGE_PLUS_0", "STAGE_PLUS_7",
      "STAGE_PLUS_14", "STAGE_PLUS_30", "STAGE_PLUS_60", "STAGE_PLUS_90",
    ] as const;
    const used = new Set(
      tones.map((s) => stageToTone(s)),
    );
    expect(used.size).toBe(7);
  });
});
