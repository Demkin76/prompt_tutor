/**
 * Local end-to-end runner: runs one tier (3 levels) without Convex/Daytona.
 *
 *   npx tsx scripts/run-local.ts --mode redfloor --tier 1 --charter "Go to the altar. Never step on red tiles."
 *   npx tsx scripts/run-local.ts --mode maze --tier 2 --fake            # scripted explorer instead of the LLM
 *   npx tsx scripts/run-local.ts --mode towerdefense --tier 1 --out app/public/demo/td-t1.json
 *   npx tsx scripts/run-local.ts --mode maze --ladder --random      # climb tiers while 3/3, fresh approved seeds
 *
 * Uses XAI_API_KEY / XAI_MODEL from .env unless --fake is given. Writes all runner messages to --out (demo replay fallback).
 */
import "dotenv/config";
import { keymasterDemoDecision } from "../src/runtime/keymaster-demo";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getTier, bfs, DIRS, DIR_DELTA, createRng, pickApprovedSeed, listTiers } from "../src/core/index";
import type { AgentDecision, Action, Dir, LevelSpec, ModeId, Observation, RunnerMessage, Vec, TileType } from "../src/core/types";
import { createFakeLlm, createXaiClient, runTier } from "../src/runtime/index";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(a.slice(2), next);
      i++;
    } else args.set(a.slice(2), "true");
  }
}

const mode = (args.get("mode") ?? "redfloor") as ModeId;
const tierNo = Number(args.get("tier") ?? 1);
const charter =
  args.get("charter") ??
  (mode === "towerdefense"
    ? "Place towers next to the longest straight stretch of the path, closest to the base first. Then start the wave."
    : "Reach the altar. Never step on red tiles. If you carry a plank, place it on a red tile that blocks the only way. Explore unknown areas methodically and do not revisit dead ends.");
const useFake = args.has("fake") || !process.env.XAI_API_KEY;
const out = args.get("out");

const tier = getTier(mode, tierNo);
if (!tier) throw new Error(`unknown tier ${mode} ${tierNo}`);

/** Scripted explorer that only uses the observation (no cheating), for smoke tests and demo recordings. */
function makeScriptedDecider() {
  let known = new Map<string, TileType>();
  let levelId = "";
  const key = (p: Vec) => `${p[0]},${p[1]}`;
  return (obs: Observation): AgentDecision => {
    if (obs.levelId !== levelId) {
      levelId = obs.levelId;
      known = new Map();
    }
    if (obs.td) {
      if (obs.td.towersLeft > 0 && obs.td.buildableSlots.length > 0) {
        const slot = obs.td.buildableSlots[0];
        return { intent: "Build a tower", plan: [{ type: "place_tower", args: { pos: slot, towerType: obs.td.towerTypes[0].id } }], stopOn: [] };
      }
      return { intent: "Start the wave", plan: [{ type: "start_wave" }], stopOn: [] };
    }
    for (const t of obs.visible.tiles) known.set(key(t.pos), t.tile);
    const me = obs.self.pos;
    const size: Vec = [64, 64];
    const safe = (p: Vec) => {
      const t = known.get(key(p));
      return t !== undefined && t !== "wall" && t !== "hazard";
    };
    const onTile = obs.visible.tiles.find((t) => t.pos[0] === me[0] && t.pos[1] === me[1]);
    const itemHere = obs.visible.entities.find((e) => e.pos[0] === me[0] && e.pos[1] === me[1] && (e.kind === "plank" || e.kind === "key"));
    if (itemHere && obs.self.inventory.length === 0) return { intent: "Pick up item", plan: [{ type: "pickup" }], stopOn: [] };
    // place plank on adjacent hazard when altar is beyond it
    if (obs.self.inventory.includes("plank")) {
      for (const d of DIRS) {
        const p: Vec = [me[0] + DIR_DELTA[d][0], me[1] + DIR_DELTA[d][1]];
        if (known.get(key(p)) === "hazard") {
          const altar = [...known.entries()].find(([, t]) => t === "altar");
          if (altar && !bfs(size, safe, me, altar[0].split(",").map(Number) as Vec)) {
            return { intent: "Bridge the red tile", plan: [{ type: "place", args: { dir: d } }], stopOn: [] };
          }
        }
      }
    }
    // door handling: interact with adjacent lever/door
    for (const e of obs.visible.entities) {
      const dx = e.pos[0] - me[0], dy = e.pos[1] - me[1];
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const dir = (DIRS.find((d) => DIR_DELTA[d][0] === dx && DIR_DELTA[d][1] === dy) as Dir) ?? "north";
        if (e.kind === "lever" && !e.props.on) return { intent: "Pull the lever", plan: [{ type: "interact", args: { dir } }], stopOn: [] };
        if (e.kind === "door" && !e.props.open && obs.self.inventory.includes("key")) return { intent: "Open the door", plan: [{ type: "interact", args: { dir } }], stopOn: [] };
      }
    }
    const blockedBy = new Set<string>();
    for (const e of obs.visible.entities) if ((e.kind === "door" && !e.props.open) || e.kind === "crate") blockedBy.add(key(e.pos));
    const passable = (p: Vec) => safe(p) && !blockedBy.has(key(p));
    let target: Vec | undefined;
    const altarEntry = [...known.entries()].find(([, t]) => t === "altar");
    if (altarEntry) target = altarEntry[0].split(",").map(Number) as Vec;
    let path = target ? bfs(size, passable, me, target) : null;
    if (!path) {
      // nearest reachable item, then frontier
      const items = obs.visible.entities.filter((e) => e.kind === "plank" || e.kind === "key");
      for (const it of items) {
        const p = bfs(size, passable, me, it.pos);
        if (p && (!path || p.length < path.length)) path = p;
      }
    }
    if (!path) {
      let best: Vec[] | null = null;
      for (const [k, t] of known) {
        if (t === "wall" || t === "hazard") continue;
        const p = k.split(",").map(Number) as Vec;
        const frontier = DIRS.some((d) => !known.has(key([p[0] + DIR_DELTA[d][0], p[1] + DIR_DELTA[d][1]])));
        if (!frontier) continue;
        const r = bfs(size, passable, me, p);
        if (r && r.length > 1 && (!best || r.length < best.length)) best = r;
      }
      path = best;
    }
    if (!path || path.length < 2) return { intent: "Nothing reachable, wait", plan: [{ type: "wait" }], stopOn: [] };
    const plan: Action[] = [];
    for (let i = 1; i < Math.min(path.length, 4); i++) {
      const dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1];
      const dir = DIRS.find((d) => DIR_DELTA[d][0] === dx && DIR_DELTA[d][1] === dy) as Dir;
      plan.push({ type: "move", args: { dir } });
    }
    void onTile;
    return { intent: target ? "Head to the altar" : "Explore the frontier", plan, stopOn: ["new_entity", "blocked", "hazard_detected", "goal_visible"] };
  };
}

const llm = useFake ? createFakeLlm(mode === "keymaster" ? keymasterDemoDecision : makeScriptedDecider()) : createXaiClient({ apiKey: process.env.XAI_API_KEY!, model: process.env.XAI_MODEL });
const messages: RunnerMessage[] = [];
const sink = {
  async push(msg: RunnerMessage) {
    messages.push(msg);
    if (msg.kind === "decision") console.log(`  [${msg.record.tick}] ${msg.record.intent}${msg.record.error ? "  !! " + msg.record.error : ""} (${msg.record.latencyMs}ms)`);
    if (msg.kind === "level_start") console.log(`\n== ${msg.levelId} seed=${msg.seed}`);
    if (msg.kind === "level_end") console.log(`   -> ${msg.result.verdict.passed ? "PASS" : "FAIL"} ticks=${msg.result.ticks} calls=${msg.result.llmCalls} score=${msg.result.levelScore} :: ${msg.result.verdict.reasons.join("; ")}`);
    if (msg.kind === "error") console.log("ERROR", msg.message);
  },
};

const rng = createRng((Date.now() & 0x7fffffff) >>> 0);
const pickSeed = args.has("random")
  ? (spec: LevelSpec) => {
      const p = pickApprovedSeed(spec, rng);
      console.log(`  seed for ${spec.id}: ${p.seed} (approved=${p.approval.ok}, tries=${p.tries})`);
      return p.seed;
    }
  : undefined;
console.log(`mode=${mode} tier=${tierNo} llm=${useFake ? "scripted" : process.env.XAI_MODEL ?? "grok-4-fast"} charter(${charter.length})="${charter}"`);
const maxTier = listTiers(mode).length;
let t = tierNo;
let total = 0, totalLevels = 0, score = 0;
for (;;) {
  const spec = getTier(mode, t)!;
  const summary = await runTier({ runId: `local-${Date.now()}`, tier: spec, charter, llm, sink, pickSeed });
  total += summary.passedLevels; totalLevels += summary.totalLevels; score += summary.score;
  console.log(`\nTIER ${t}: ${summary.passedLevels}/${summary.totalLevels} passed, score=${summary.score}${summary.tierUnlocked ? " — tier unlocked" : ""}`);
  if (!args.has("ladder") || !summary.tierUnlocked || t >= maxTier) break;
  t++;
}
console.log(`\nRESULT: ${total}/${totalLevels} levels, score=${score}, reached tier ${t}`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ mode, tier: tierNo, reachedTier: t, charter, recordedAt: new Date().toISOString(), messages }));
  console.log(`wrote ${out} (${messages.length} messages)`);
}
