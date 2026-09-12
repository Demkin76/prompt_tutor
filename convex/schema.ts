import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("finished"),
  v.literal("error"),
);

export const runHost = v.union(v.literal("daytona"), v.literal("inprocess"));

export const indicatorId = v.union(
  v.literal("sma"),
  v.literal("ema"),
  v.literal("rsi"),
  v.literal("macd"),
  v.literal("bollinger"),
  v.literal("atr"),
);

/** IndicatorConfig (src/core/types.ts) */
export const indicatorConfig = v.object({
  id: indicatorId,
  enabled: v.boolean(),
  period: v.optional(v.number()),
  fastPeriod: v.optional(v.number()),
  slowPeriod: v.optional(v.number()),
  signalPeriod: v.optional(v.number()),
  deviations: v.optional(v.number()),
  color: v.optional(v.string()),
});

/** RunSettings (src/core/types.ts) — rune trading indicator set, frozen per run. */
export const runSettings = v.object({
  indicators: v.array(indicatorConfig),
});

export default defineSchema({
  ...authTables,

  sessions: defineTable({
    userId: v.optional(v.id("users")),
    sessionId: v.string(),
    /** Record<ModeId, number> — highest unlocked tier per mode (default 1). */
    progress: v.any(),
    /** Record<`${mode}-${tier}`, { score, passedLevels, charter }> */
    best: v.any(),
    updatedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  runs: defineTable({
    userId: v.optional(v.id("users")),
    runId: v.string(),
    sessionId: v.string(),
    mode: v.string(),
    /** Tier the run started at. */
    tier: v.number(),
    /** Tier currently being played (ladder: advances while every level of a tier is passed). */
    currentTier: v.optional(v.number()),
    /** TierResult[] — one entry per tier played so far. */
    ladder: v.optional(v.any()),
    charter: v.string(),
    /** Immutable per-run indicator configuration (rune trading). */
    settings: v.optional(runSettings),
    status: runStatus,
    host: runHost,
    /** RunSummary */
    summary: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"]),

  levelRuns: defineTable({
    runId: v.string(),
    levelId: v.string(),
    seed: v.number(),
    /** LevelSpec */
    spec: v.any(),
    /** WorldState */
    initialState: v.any(),
    /** LevelRunResult */
    result: v.optional(v.any()),
    /** Replay */
    replay: v.optional(v.any()),
    order: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_level", ["runId", "levelId"]),

  frames: defineTable({
    runId: v.string(),
    levelId: v.string(),
    tick: v.number(),
    /** Frame */
    frame: v.any(),
  }).index("by_run_level_tick", ["runId", "levelId", "tick"]),

  decisions: defineTable({
    runId: v.string(),
    levelId: v.string(),
    tick: v.number(),
    /** DecisionRecord */
    record: v.any(),
  }).index("by_run_level", ["runId", "levelId"]),
});
