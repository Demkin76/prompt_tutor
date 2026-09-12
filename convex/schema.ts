import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("finished"),
  v.literal("error"),
);

export const runHost = v.union(v.literal("daytona"), v.literal("inprocess"));

export default defineSchema({
  sessions: defineTable({
    sessionId: v.string(),
    /** Record<ModeId, number> — highest unlocked tier per mode (default 1). */
    progress: v.any(),
    /** Record<`${mode}-${tier}`, { score, passedLevels, charter }> */
    best: v.any(),
    updatedAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),

  runs: defineTable({
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
    status: runStatus,
    host: runHost,
    /** RunSummary */
    summary: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_session", ["sessionId"]),

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
