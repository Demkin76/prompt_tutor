"use node";

import { internalAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { RUNNER_SOURCE } from "./_runner/bundle";
import type { LevelSpec, ModeId, RunSettings, RunnerMessage, Sink } from "../src/core/types";

/** Convex actions are capped at 10 minutes; leave headroom for sandbox setup/teardown. */
const RUNNER_TIMEOUT_SECONDS = 540;

/**
 * Executes a queued run. Scheduled by runs.create.
 * - With DAYTONA_API_KEY: uploads the esbuild-bundled runner into a fresh Daytona sandbox and runs it there.
 *   The runner streams RunnerMessages back via `POST {CONVEX_CLOUD_URL}/api/mutation` → runs:ingest.
 * - Without it: runs the same episode loop in-process, pushing messages through ctx.runMutation.
 */
export const run = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, { runId }): Promise<void> => {
    const runDoc = await ctx.runQuery(internal.runs.getInternal, { runId });
    if (!runDoc) throw new Error(`launch.run: unknown runId ${runId}`);
    if (runDoc.status === "finished" || runDoc.status === "error") return;

    const ingest = (message: RunnerMessage) => ctx.runMutation(api.runs.ingest, { runId, message });

    try {
      const daytonaKey = process.env.DAYTONA_API_KEY;
      if (daytonaKey && RUNNER_SOURCE.length > 0) {
        await ctx.runMutation(internal.runs.setHost, { runId, host: "daytona", status: "running" });
        await runInDaytona(ctx, daytonaKey, runDoc);
      } else {
        if (daytonaKey) console.warn("launch.run: DAYTONA_API_KEY is set but convex/_runner/bundle.ts is empty — run `npm run build:runner`. Falling back to in-process.");
        await ctx.runMutation(internal.runs.setHost, { runId, host: "inprocess", status: "running" });
        await runInProcess(ctx, runDoc);
      }
    } catch (e) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`launch.run(${runId}) failed:`, message);
      // runTier / the runner report their own errors; only fill in if the run is still non-terminal.
      const current = await ctx.runQuery(internal.runs.getInternal, { runId });
      if (!current || (current.status !== "finished" && current.status !== "error")) {
        await ingest({ kind: "error", message });
      }
    }
  },
});

type RunDoc = { runId: string; mode: string; tier: number; currentTier?: number; charter: string; settings?: RunSettings };

async function runInDaytona(ctx: ActionCtx, apiKey: string, runDoc: RunDoc): Promise<void> {
  const { Daytona } = await import("@daytonaio/sdk");

  const convexUrl = process.env.CONVEX_CLOUD_URL;
  if (!convexUrl) throw new Error("CONVEX_CLOUD_URL is not set (Convex sets it automatically inside deployments)");
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) throw new Error("XAI_API_KEY is not set in the Convex dashboard");

  const envVars: Record<string, string> = {
    RUN_ID: runDoc.runId,
    CONVEX_URL: convexUrl,
    MODE: runDoc.mode,
    TIER: String(runDoc.currentTier ?? runDoc.tier),
    CHARTER: runDoc.charter,
    XAI_API_KEY: xaiKey,
  };
  if (runDoc.settings) envVars.SETTINGS = JSON.stringify(runDoc.settings);
  if (process.env.XAI_MODEL) envVars.XAI_MODEL = process.env.XAI_MODEL;

  const daytona = new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL || undefined,
    target: process.env.DAYTONA_TARGET || undefined,
  });

  const sandbox = await daytona.create(
    {
      language: "typescript",
      envVars,
      labels: { app: "golem", runId: runDoc.runId },
      autoStopInterval: 15,
      autoDeleteInterval: 15,
    },
    { timeout: 120 },
  );
  console.log(`launch.run(${runDoc.runId}): sandbox ${sandbox.id} created`);

  try {
    await sandbox.fs.uploadFile(Buffer.from(RUNNER_SOURCE, "utf8"), "runner.cjs");
    const res = await sandbox.process.executeCommand("node runner.cjs", undefined, undefined, RUNNER_TIMEOUT_SECONDS);
    const tail = (res.result ?? "").slice(-4000);
    console.log(`launch.run(${runDoc.runId}): runner exit=${res.exitCode}\n${tail}`);

    // The runner reports run_end/error itself; only synthesize an error if it died without reporting.
    const after = await ctx.runQuery(internal.runs.getInternal, { runId: runDoc.runId });
    if (after && after.status !== "finished" && after.status !== "error") {
      throw new Error(`runner exited with code ${res.exitCode} without run_end. Output tail:\n${tail}`);
    }
  } finally {
    try {
      await sandbox.delete();
    } catch (e) {
      console.warn(`launch.run(${runDoc.runId}): sandbox.delete failed (autoDeleteInterval will reap it):`, e);
    }
  }
}

async function runInProcess(ctx: ActionCtx, runDoc: RunDoc): Promise<void> {
  const [{ runTier, createXaiClient }, { getTier, createRng, pickApprovedSeed }] = await Promise.all([
    import("../src/runtime/index"),
    import("../src/core/index"),
  ]);

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not set in the Convex dashboard");

  const sink: Sink = {
    async push(message: RunnerMessage) {
      await ctx.runMutation(api.runs.ingest, { runId: runDoc.runId, message });
    },
  };
  const llm = createXaiClient({ apiKey, model: process.env.XAI_MODEL || undefined });
  const tierNo = runDoc.currentTier ?? runDoc.tier;
  const tier = getTier(runDoc.mode as ModeId, tierNo);
  if (!tier) throw new Error(`No such tier ${runDoc.mode}/${tierNo}`);

  // Fresh hidden seeds per run, each proven passable by the full-knowledge solver.
  const rng = createRng((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const pickSeed = (spec: LevelSpec) => pickApprovedSeed(spec, rng).seed;
  const summary = await runTier({ runId: runDoc.runId, tier, charter: runDoc.charter, llm, sink, pickSeed, settings: runDoc.settings });
  console.log(`launch.run(${runDoc.runId}): in-process finished, passed ${summary.passedLevels}/${summary.totalLevels}, score ${summary.score}`);

  // runTier is expected to push run_end itself; make sure the run doesn't stay "running" if it didn't.
  const after = await ctx.runQuery(internal.runs.getInternal, { runId: runDoc.runId });
  if (after && after.status !== "finished" && after.status !== "error") {
    await sink.push({ kind: "run_end", summary });
  }
}
