/**
 * Daytona runner entry. Bundled by scripts/build-runner.mjs into a single CJS file.
 *
 * Env:
 *   RUN_ID       run identifier (Convex run row)
 *   CONVEX_URL   deployment URL, e.g. https://xxx.convex.cloud
 *   MODE         "maze" | "redfloor" | "towerdefense"
 *   TIER         tier number (1-based)
 *   CHARTER      the player's charter text
 *   XAI_API_KEY  x.ai key
 *   XAI_MODEL    optional model override (default grok-4-fast)
 *
 * Streams RunnerMessages to Convex via POST ${CONVEX_URL}/api/mutation (runs:ingest).
 * Logs progress to stdout as single-line JSON. Exit code 0 on success, 1 on failure.
 */
import type { ModeId } from "@core/types";
import { getTier } from "@core/index";
import { createXaiClient } from "@runtime/llm";
import { createConvexHttpSink } from "@runtime/sink";
import { runTier } from "@runtime/episode";

function log(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const runId = requireEnv("RUN_ID");
  const convexUrl = requireEnv("CONVEX_URL");
  const mode = requireEnv("MODE") as ModeId;
  const tierNum = Number.parseInt(requireEnv("TIER"), 10);
  if (!Number.isInteger(tierNum) || tierNum < 1) throw new Error(`invalid TIER ${process.env.TIER}`);
  const charter = process.env.CHARTER ?? "";
  const apiKey = requireEnv("XAI_API_KEY");
  const model = process.env.XAI_MODEL || undefined;

  const tier = getTier(mode, tierNum);
  if (!tier) throw new Error(`unknown tier: MODE=${mode} TIER=${tierNum}`);
  const llm = createXaiClient({ apiKey, model });
  const sink = createConvexHttpSink({ convexUrl, runId, log: (line) => process.stdout.write(line + "\n") });

  log({ event: "runner_start", runId, mode, tier: tierNum, levels: tier.levels.map((l) => l.id), model: model ?? "default" });
  const summary = await runTier({ runId, tier, charter, llm, sink, log: (line) => process.stdout.write(line + "\n") });
  log({ event: "runner_done", runId, passedLevels: summary.passedLevels, score: summary.score });
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    log({ event: "runner_error", error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    process.exit(1);
  },
);
