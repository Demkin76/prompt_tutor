import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { runHost, runStatus } from "./schema";
import { ensureSession } from "./sessions";
import { requireUserId } from "./lib/auth";
import { MODES, getTier, listTiers } from "../src/core/index";
import type { ModeId, RunSummary, RunnerMessage, TierResult, TierSpec } from "../src/core/types";
import type { Doc, Id } from "./_generated/dataModel";

function newRunId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}

function resolveTier(mode: ModeId, tier: number): TierSpec {
  let spec: TierSpec | undefined;
  try {
    spec = getTier(mode, tier);
  } catch (e) {
    throw new Error(`No such tier ${mode}/${tier}: ${(e as Error).message}`);
  }
  if (!spec || !spec.levels?.length) throw new Error(`No such tier ${mode}/${tier}`);
  return spec;
}

async function loadRun(ctx: MutationCtx, runId: string) {
  return await ctx.db
    .query("runs")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

async function requireOwnedRun(
  ctx: QueryCtx | MutationCtx,
  runId: string,
): Promise<Doc<"runs"> | null> {
  const userId = await requireUserId(ctx);
  const run = await ctx.db
    .query("runs")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
  if (run && run.userId !== userId) throw new Error("Run not found");
  return run;
}

// ───────────────────────── Public API ─────────────────────────

export const create = mutation({
  args: {
    mode: v.string(),
    tier: v.number(),
    charter: v.string(),
  },
  handler: async (ctx, { mode, tier, charter }): Promise<string> => {
    if (!MODES.some((m) => m.id === mode)) throw new Error(`Unknown mode: ${mode}`);
    if (!Number.isInteger(tier) || tier < 1) throw new Error(`Invalid tier: ${tier}`);

    const userId = await requireUserId(ctx);
    const session = await ensureSession(ctx, userId);
    const unlocked = Number(session.progress?.[mode] ?? 1);
    if (tier > unlocked) throw new Error(`Tier ${tier} is locked for ${mode} (unlocked: ${unlocked})`);

    const tierSpec = resolveTier(mode as ModeId, tier);
    const budget = tierSpec.levels[0].promptBudget;
    const trimmed = charter.trim();
    if (trimmed.length === 0) throw new Error("Charter is empty");
    if (charter.length > budget) throw new Error(`Charter is ${charter.length} chars; budget for this tier is ${budget}`);

    const runId = newRunId();
    await ctx.db.insert("runs", {
      userId,
      runId,
      sessionId: session.sessionId,
      mode,
      tier,
      currentTier: tier,
      ladder: [],
      charter,
      status: "queued",
      // Real host is decided inside launch.run (process.env is only visible in actions).
      host: "inprocess",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.launch.run, { runId });
    return runId;
  },
});

/**
 * Ingest one RunnerMessage. PUBLIC: the Daytona runner calls this over HTTP
 * (`POST {CONVEX_CLOUD_URL}/api/mutation` with `{ path: "runs:ingest", args: { runId, message } }`),
 * and the in-process fallback calls it via ctx.runMutation.
 */
export const ingest = mutation({
  args: { runId: v.string(), message: v.any() },
  handler: async (ctx, { runId, message }): Promise<void> => {
    const run = await loadRun(ctx, runId);
    if (!run) throw new Error(`Unknown runId: ${runId}`);
    const msg = message as RunnerMessage;

    switch (msg.kind) {
      case "level_start": {
        const existing = await ctx.db
          .query("levelRuns")
          .withIndex("by_run_level", (q) => q.eq("runId", runId).eq("levelId", msg.levelId))
          .unique();
        if (existing) {
          await ctx.db.patch("levelRuns", existing._id, { seed: msg.seed, spec: msg.spec, initialState: msg.initialState });
        } else {
          const count = (await ctx.db.query("levelRuns").withIndex("by_run", (q) => q.eq("runId", runId)).collect()).length;
          await ctx.db.insert("levelRuns", {
            runId,
            levelId: msg.levelId,
            seed: msg.seed,
            spec: msg.spec,
            initialState: msg.initialState,
            order: count,
          });
        }
        if (run.status === "queued") await ctx.db.patch("runs", run._id, { status: "running" });
        return;
      }
      case "decision": {
        await ctx.db.insert("decisions", {
          runId,
          levelId: msg.levelId,
          tick: msg.record.tick,
          record: msg.record,
        });
        return;
      }
      case "frame": {
        await ctx.db.insert("frames", {
          runId,
          levelId: msg.frame.levelId,
          tick: msg.frame.tick,
          frame: msg.frame,
        });
        return;
      }
      case "level_end": {
        const levelRun = await ctx.db
          .query("levelRuns")
          .withIndex("by_run_level", (q) => q.eq("runId", runId).eq("levelId", msg.levelId))
          .unique();
        if (levelRun) {
          await ctx.db.patch("levelRuns", levelRun._id, { result: msg.result, replay: msg.replay });
        } else {
          // level_start got lost — still persist what we have.
          const count = (await ctx.db.query("levelRuns").withIndex("by_run", (q) => q.eq("runId", runId)).collect()).length;
          await ctx.db.insert("levelRuns", {
            runId,
            levelId: msg.levelId,
            seed: msg.result.seed,
            spec: null,
            initialState: msg.replay?.initialState ?? null,
            result: msg.result,
            replay: msg.replay,
            order: count,
          });
        }
        return;
      }
      case "run_end": {
        // One tier finished. Record it, unlock progress, and either climb to the next tier or finish the run.
        const tierSummary = msg.summary as RunSummary;
        const currentTier = run.currentTier ?? run.tier;
        const ladder: TierResult[] = [...((run.ladder as TierResult[] | undefined) ?? [])];
        if (!ladder.some((t) => t.tier === currentTier)) {
          ladder.push({
            tier: currentTier,
            passedLevels: tierSummary.passedLevels,
            totalLevels: tierSummary.totalLevels,
            score: tierSummary.score,
            unlocked: tierSummary.tierUnlocked,
          });
        }
        const prevLevels = ((run.summary as RunSummary | undefined)?.levels ?? []).filter((l) => !tierSummary.levels.some((n) => n.levelId === l.levelId));
        const summary: RunSummary = {
          passedLevels: ladder.reduce((a, t) => a + t.passedLevels, 0),
          totalLevels: ladder.reduce((a, t) => a + t.totalLevels, 0),
          score: Math.round(ladder.reduce((a, t) => a + t.score, 0) * 100) / 100,
          tierUnlocked: tierSummary.tierUnlocked,
          levels: [...prevLevels, ...tierSummary.levels],
          tiers: ladder,
          reachedTier: currentTier,
        };
        if (!run.userId) throw new Error("Run has no owner");
        await applyRunToSession(ctx, run.userId, run.mode, currentTier, run.charter, tierSummary);
        const maxTier = listTiers(run.mode as ModeId).length;
        if (tierSummary.tierUnlocked && currentTier < maxTier) {
          await ctx.db.patch("runs", run._id, { summary, ladder, currentTier: currentTier + 1, status: "running" });
          await ctx.scheduler.runAfter(0, internal.launch.run, { runId });
        } else {
          await ctx.db.patch("runs", run._id, { summary, ladder, status: "finished", finishedAt: Date.now() });
        }
        return;
      }
      case "error": {
        if (run.status === "finished") return; // late/duplicate error after success — ignore
        await ctx.db.patch("runs", run._id, { status: "error", error: String(msg.message ?? "unknown error"), finishedAt: Date.now() });
        return;
      }
      default:
        throw new Error(`Unknown message kind: ${String((msg as { kind?: unknown }).kind)}`);
    }
  },
});

async function applyRunToSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  mode: string,
  tier: number,
  charter: string,
  summary: RunSummary,
): Promise<void> {
  const session = await ensureSession(ctx, userId);
  const progress: Record<string, number> = { ...(session.progress ?? {}) };
  const best: Record<string, { score: number; passedLevels: number; charter: string }> = { ...(session.best ?? {}) };

  const unlocked = Number(progress[mode] ?? 1);
  if (summary.tierUnlocked && unlocked === tier) progress[mode] = tier + 1;

  const key = `${mode}-${tier}`;
  const prev = best[key];
  const better =
    !prev ||
    summary.passedLevels > prev.passedLevels ||
    (summary.passedLevels === prev.passedLevels && summary.score > prev.score);
  if (better) best[key] = { score: summary.score, passedLevels: summary.passedLevels, charter };

  await ctx.db.patch("sessions", session._id, { progress, best, updatedAt: Date.now() });
}

export const get = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await requireOwnedRun(ctx, runId);
  },
});

export const bySession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("runs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

export const levelRuns = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    if (!(await requireOwnedRun(ctx, runId))) return [];
    const rows = await ctx.db
      .query("levelRuns")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

export const frames = query({
  args: { runId: v.string(), levelId: v.string(), afterTick: v.optional(v.number()) },
  handler: async (ctx, { runId, levelId, afterTick }) => {
    if (!(await requireOwnedRun(ctx, runId))) return [];
    const after = afterTick ?? -1;
    return await ctx.db
      .query("frames")
      .withIndex("by_run_level_tick", (q) => q.eq("runId", runId).eq("levelId", levelId).gt("tick", after))
      .order("asc")
      .take(500);
  },
});

export const decisions = query({
  args: { runId: v.string(), levelId: v.string() },
  handler: async (ctx, { runId, levelId }) => {
    if (!(await requireOwnedRun(ctx, runId))) return [];
    const rows = await ctx.db
      .query("decisions")
      .withIndex("by_run_level", (q) => q.eq("runId", runId).eq("levelId", levelId))
      .collect();
    return rows.sort((a, b) => a.tick - b.tick);
  },
});

// ───────────────────────── Internal (used by launch.ts) ─────────────────────────

export const getInternal = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .unique();
  },
});

export const setHost = internalMutation({
  args: { runId: v.string(), host: runHost, status: v.optional(runStatus) },
  handler: async (ctx, { runId, host, status }) => {
    const run = await loadRun(ctx, runId);
    if (!run) throw new Error(`Unknown runId: ${runId}`);
    const patch: { host: "daytona" | "inprocess"; status?: "queued" | "running" | "finished" | "error" } = { host };
    if (status && run.status !== "finished" && run.status !== "error") patch.status = status;
    await ctx.db.patch("runs", run._id, patch);
  },
});
