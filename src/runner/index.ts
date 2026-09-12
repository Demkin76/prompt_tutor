/**
 * Daytona runner entry. Bundled by scripts/build-runner.mjs into a single CJS file.
 *
 * Env:
 *   RUN_ID       run identifier (Convex run row)
 *   CONVEX_URL   deployment URL, e.g. https://xxx.convex.cloud
 *   MODE         "maze" | "redfloor" | "towerdefense" | "runetrading"
 *   TIER         tier number (1-based)
 *   SEEDS        optional "a,b,c" fixed seeds; otherwise fresh approved random seeds are picked per level
 *   CHARTER      the player's charter text
 *   SETTINGS     optional RunSettings JSON (rune trading: indicator configuration)
 *   XAI_API_KEY  x.ai key
 *   XAI_MODEL    optional model override (default grok-4-fast)
 *
 * Streams RunnerMessages to Convex via POST ${CONVEX_URL}/api/mutation (runs:ingest).
 * Logs progress to stdout as single-line JSON. Exit code 0 on success, 1 on failure.
 */
import type { LevelSpec, ModeId, RunSettings } from "@core/types";
import { createRng, getTier, pickApprovedSeed, validateRunSettings } from "@core/index";
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
  let settings: RunSettings | undefined;
  if (process.env.SETTINGS && process.env.SETTINGS.trim() !== "") {
    settings = JSON.parse(process.env.SETTINGS) as RunSettings;
    validateRunSettings(settings);
  }
  const llm = createXaiClient({ apiKey, model });
  const sink = createConvexHttpSink({ convexUrl, runId, log: (line) => process.stdout.write(line + "\n") });

  const fixed = (process.env.SEEDS ?? "").split(",").map((x) => Number.parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);
  const rng = createRng((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  let li = 0;
  const pickSeed = (spec: LevelSpec): number => {
    const i = li++;
    if (fixed[i]) return fixed[i];
    const picked = pickApprovedSeed(spec, rng);
    log({ event: "seed_picked", levelId: spec.id, seed: picked.seed, approved: picked.approval.ok, tries: picked.tries });
    return picked.seed;
  };

  log({ event: "runner_start", runId, mode, tier: tierNum, levels: tier.levels.map((l) => l.id), model: model ?? "default", settings: settings ?? null });
  const summary = await runTier({ runId, tier, charter, llm, sink, pickSeed, settings, log: (line) => process.stdout.write(line + "\n") });
  log({ event: "runner_done", runId, passedLevels: summary.passedLevels, score: summary.score });
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    log({ event: "runner_error", error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    process.exit(1);
  },
);
