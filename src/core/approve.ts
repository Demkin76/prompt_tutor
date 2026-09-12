/**
 * Level approval: a full-knowledge scripted solver executed through the real
 * `generateLevel` + `step`. A level is "approved" only if the solver actually
 * reaches status "won" within `spec.limits.ticks`, so a randomly seeded level
 * is proven passable before it is handed to the agent.
 */
import type { Action, Dir, Entity, LevelSpec, SimEvent, TierSpec, Vec, WorldState } from "./types";
import { bfs, dirTo, entityById, fromIdx, idx, isSafeWalkable, manhattan, neighbors, samePos, tileAt } from "./grid";
import { generateLevel } from "./generators/index";
import { enemyRoute } from "./generators/towerdefense";
import { marketSeriesFor } from "./generators/market";
import { step } from "./sim";

export interface Approval {
  ok: boolean;
  reason: string;
  /** The winning (or attempted) action list, replayable through `step`. */
  actions: Action[];
  ticks: number;
}

class SolveError extends Error {}

/** Executes actions through the real sim and turns any blocked/invalid outcome into a failure. */
class Runner {
  state: WorldState;
  readonly actions: Action[] = [];
  constructor(
    readonly spec: LevelSpec,
    state: WorldState,
  ) {
    this.state = state;
  }
  get done(): boolean {
    return this.state.status !== "running";
  }
  do(action: Action): SimEvent[] {
    if (this.done) throw new SolveError(`level already ${this.state.status} at tick ${this.state.tick}`);
    const r = step(this.spec, this.state, action);
    this.state = r.state;
    this.actions.push(action);
    for (const e of r.events) {
      if (e.type === "blocked" || e.type === "invalid_action" || e.type === "door_locked" || e.type === "hazard_entered") {
        throw new SolveError(`${e.type} on ${action.type} at tick ${r.state.tick}: ${JSON.stringify(e.data ?? {})}`);
      }
    }
    return r.events;
  }
}

// ───────────────────────── helpers ─────────────────────────

function fmt(p: Vec): string {
  return `[${p[0]},${p[1]}]`;
}

function findTile(s: WorldState, tile: WorldState["tiles"][number]): Vec | null {
  const i = s.tiles.indexOf(tile);
  return i < 0 ? null : fromIdx(s.size, i);
}

function doorAt(s: WorldState, p: Vec): Entity | undefined {
  return s.entities.find((e) => e.kind === "door" && samePos(e.pos, p));
}

function crateAt(s: WorldState, p: Vec): boolean {
  return s.entities.some((e) => e.kind === "crate" && samePos(e.pos, p));
}

function carriedPlanks(s: WorldState): number {
  return s.agent.inventory.filter((k) => k === "plank").length;
}

/** Walk a path of adjacent safe tiles (path[0] must be the agent's position). */
function walkPath(r: Runner, path: Vec[]): void {
  for (let i = 1; i < path.length; i++) {
    if (r.done) return;
    const dir = dirTo(path[i - 1], path[i]);
    if (!dir) throw new SolveError(`path tiles ${fmt(path[i - 1])} -> ${fmt(path[i])} are not adjacent`);
    r.do({ type: "move", args: { dir } });
  }
}

function safePathTo(s: WorldState, to: Vec): Vec[] | null {
  return bfs(s.size, (p) => isSafeWalkable(s, p), s.agent.pos, to);
}

/**
 * Dijkstra over the whole map with full knowledge: walls and crates block,
 * hazards cost a plank (1000), closed doors cost a little (they will be opened),
 * everything else costs 1 per step. Minimises planks first, then length.
 */
function planRoute(s: WorldState, from: Vec, to: Vec): Vec[] | null {
  const [w, h] = s.size;
  const n = w * h;
  const cost = (p: Vec): number => {
    const t = tileAt(s, p);
    if (!t || t === "wall" || crateAt(s, p)) return Infinity;
    let c = 1;
    if (t === "hazard") c += 1000;
    const d = doorAt(s, p);
    if (d && !d.props.open) c += 2;
    return c;
  };
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const start = idx(s.size, from);
  const goal = idx(s.size, to);
  dist[start] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < n; i++) {
      if (!settled[i] && dist[i] < Infinity && (cur < 0 || dist[i] < dist[cur])) cur = i;
    }
    if (cur < 0) return null;
    if (cur === goal) break;
    settled[cur] = 1;
    for (const nb of neighbors(s.size, fromIdx(s.size, cur))) {
      const ni = idx(s.size, nb);
      if (settled[ni]) continue;
      const c = cost(nb);
      if (!isFinite(c)) continue;
      if (dist[cur] + c < dist[ni]) {
        dist[ni] = dist[cur] + c;
        prev[ni] = cur;
      }
    }
  }
  const path: Vec[] = [];
  for (let at = goal; at !== start; at = prev[at]) path.push(fromIdx(s.size, at));
  path.push(from);
  path.reverse();
  return path;
}

/** Shortest safe path from the agent to any of `targets`; ties resolved by target order. */
function nearestSafe(s: WorldState, targets: Vec[]): Vec[] | null {
  let best: Vec[] | null = null;
  for (const t of targets) {
    const p = safePathTo(s, t);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}

/** Walk to the nearest reachable item of `kind` and pick it up, up to `count` times. Returns how many were picked up. */
function fetchItems(r: Runner, kind: "plank" | "key", count: number): number {
  let got = 0;
  while (got < count) {
    const s = r.state;
    const items = s.entities.filter((e) => e.kind === kind).map((e) => e.pos);
    const path = nearestSafe(s, items);
    if (!path) break;
    walkPath(r, path);
    if (r.done) break;
    r.do({ type: "pickup" });
    got++;
  }
  return got;
}

/** Walk to a safe tile adjacent to `target` and return the direction facing it. */
function goAdjacent(r: Runner, target: Vec): Dir {
  const s = r.state;
  const cands = neighbors(s.size, target).filter((p) => isSafeWalkable(s, p));
  const path = nearestSafe(s, cands);
  if (!path) throw new SolveError(`no safe tile adjacent to ${fmt(target)} is reachable`);
  walkPath(r, path);
  const dir = dirTo(r.state.agent.pos, target);
  if (!dir) throw new SolveError(`not adjacent to ${fmt(target)} after walking`);
  return dir;
}

// ───────────────────────── maze ─────────────────────────

function solveMaze(r: Runner): void {
  const s = r.state;
  const goal = findTile(s, "altar");
  if (!goal) throw new SolveError("no altar tile");
  const path = bfs(s.size, (p) => tileAt(s, p) !== "wall", s.agent.pos, goal);
  if (!path) throw new SolveError("altar unreachable by BFS");
  walkPath(r, path);
}

// ───────────────────────── red floor ─────────────────────────

/**
 * Iterative full-knowledge planner:
 *   1. safe path to the altar? walk it.
 *   2. plan the min-plank route (crates as walls, doors passable).
 *   3. pre-fetch what the route needs and is reachable now (planks up to
 *      maxCarry, the key for a locked door on the route).
 *   4. resolve the first obstacle on the route: place a plank on a hazard,
 *      unlock a door with the key, pull the lever of a lever door, or open a
 *      plain door by hand — then re-plan.
 * Crates are never required by the generator's guarantee, so they are treated
 * as walls; a crate blocking the route makes the level unapproved.
 */
function solveRedFloor(r: Runner): void {
  const MAX_ITER = 400;
  const maxCarry = r.spec.env.params.maxCarry ?? 1;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (r.done) return;
    const s = r.state;
    const goal = findTile(s, "altar");
    if (!goal) throw new SolveError("no altar tile");

    const safe = safePathTo(s, goal);
    if (safe) {
      walkPath(r, safe);
      return;
    }

    const route = planRoute(s, s.agent.pos, goal);
    if (!route) throw new SolveError("altar unreachable even with planks and doors (crates treated as walls)");

    const hazards = route.filter((p) => tileAt(s, p) === "hazard").length;
    const carried = carriedPlanks(s);
    const want = Math.min(hazards, maxCarry);
    if (carried < want && fetchItems(r, "plank", want - carried) > 0) continue;

    const needsKey = route.some((p) => {
      const d = doorAt(s, p);
      return d && d.props.locked && !d.props.open;
    });
    if (needsKey && !s.agent.inventory.includes("key") && fetchItems(r, "key", 1) > 0) continue;

    let k = 1;
    while (k < route.length && isSafeWalkable(s, route[k])) k++;
    if (k >= route.length) {
      walkPath(r, route);
      return;
    }
    const obstacle = route[k];
    const before = route[k - 1];
    const tile = tileAt(s, obstacle);
    const door = doorAt(s, obstacle);

    if (tile === "hazard") {
      if (carried === 0) throw new SolveError(`hazard ${fmt(obstacle)} on route but no plank carried or reachable (${hazards} needed)`);
      walkPath(r, route.slice(0, k));
      if (r.done) return;
      r.do({ type: "place", args: { dir: dirTo(before, obstacle)! } });
      continue;
    }
    if (door) {
      if (door.props.locked) {
        if (!s.agent.inventory.includes("key")) throw new SolveError(`locked door ${door.id} at ${fmt(obstacle)} and no key reachable`);
        walkPath(r, route.slice(0, k));
        if (r.done) return;
        r.do({ type: "interact", args: { dir: dirTo(before, obstacle)! } });
        continue;
      }
      if (door.props.controlledBy) {
        const lever =
          (typeof door.props.controlledBy === "string" ? entityById(s, door.props.controlledBy) : undefined) ??
          s.entities.find((e) => e.kind === "lever" && e.props.targetId === door.id);
        if (!lever) throw new SolveError(`door ${door.id} needs lever ${String(door.props.controlledBy)} which does not exist`);
        const dir = goAdjacent(r, lever.pos);
        if (r.done) return;
        r.do({ type: "interact", args: { dir } });
        continue;
      }
      walkPath(r, route.slice(0, k));
      if (r.done) return;
      r.do({ type: "interact", args: { dir: dirTo(before, obstacle)! } });
      continue;
    }
    throw new SolveError(`unexpected obstacle ${String(tile)} at ${fmt(obstacle)}`);
  }
  throw new SolveError("planner iteration cap reached");
}

// ───────────────────────── tower defense ─────────────────────────

interface Placement {
  pos: Vec;
  towerType: string;
}

/**
 * Candidate greedy placements: score every (slot, type) by
 * covered-route-tiles × damage, then take the best `towersLeft` slots. One plan
 * mixes types freely, plus one plan per single type; the first plan that wins
 * through the real wave sim is used.
 */
function tdPlans(spec: LevelSpec, s: WorldState): Placement[][] {
  const route = enemyRoute(s);
  const types = spec.env.params.towerTypes ?? [];
  const limit = s.td?.towersLeft ?? 0;
  const slots: Vec[] = [];
  for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === "buildable") slots.push(fromIdx(s.size, i));
  const cover = (slot: Vec, range: number) => route.filter((p) => manhattan(p, slot) <= range).length;

  const rank = (allowed: typeof types): Placement[] => {
    const scored = slots.map((pos, i) => {
      let best = { towerType: "", score: -1 };
      for (const t of allowed) {
        const score = cover(pos, t.range) * t.damage;
        if (score > best.score) best = { towerType: t.id, score };
      }
      return { pos, i, ...best };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.slice(0, limit).map(({ pos, towerType }) => ({ pos, towerType }));
  };

  const plans: Placement[][] = [];
  const seen = new Set<string>();
  const push = (plan: Placement[]) => {
    const key = JSON.stringify(plan);
    if (plan.length && !seen.has(key)) {
      seen.add(key);
      plans.push(plan);
    }
  };
  push(rank(types));
  for (const t of types) push(rank([t]));
  return plans;
}

function solveTowerDefense(spec: LevelSpec, initial: WorldState): Runner {
  const plans = tdPlans(spec, initial);
  if (!plans.length) throw new SolveError("no buildable slots or tower types");
  let last: Runner | null = null;
  let lastReason = "";
  for (const plan of plans) {
    const r = new Runner(spec, initial);
    try {
      for (const p of plan) r.do({ type: "place_tower", args: { pos: p.pos, towerType: p.towerType } });
      while (!r.done) r.do({ type: "start_wave" });
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
    }
    if (r.state.status === "won") return r;
    last = r;
    if (!lastReason) lastReason = `status ${r.state.status}, base hp ${r.state.td?.baseHp ?? "?"} after wave ${r.state.td?.waveIndex ?? "?"}`;
  }
  throw Object.assign(new SolveError(`no greedy placement wins: ${lastReason}`), { runner: last });
}

/**
 * Rune trading (full knowledge): find the single most profitable trade in the series and
 * execute it through the real sim. Approved iff that trade still wins after fees, i.e. the
 * level is completable with positive net P&L.
 */
function solveRuneTrading(r: Runner): void {
  const candles = marketSeriesFor(r.spec);
  let best: { side: "long" | "short"; open: number; close: number; profit: number } | null = null;
  for (let open = 0; open < candles.length - 1; open++) {
    for (let close = open + 1; close < candles.length; close++) {
      const longProfit = candles[close].close - candles[open].close;
      const side = longProfit >= 0 ? "long" : "short";
      const profit = Math.abs(longProfit);
      if (!best || profit > best.profit) best = { side, open, close, profit };
    }
  }
  if (!best) throw new SolveError("rune-trading series has no trade opportunity");
  for (let index = 0; index < candles.length && !r.done; index++) {
    if (index === best.open) r.do({ type: best.side });
    else if (index === best.close) r.do({ type: "close" });
    else r.do({ type: "hold" });
  }
}

// ───────────────────────── public API ─────────────────────────

/** Approve an already generated initial state (same contract as `approveLevel`). */
export function approveState(spec: LevelSpec, initial: WorldState): Approval {
  let runner = new Runner(spec, initial);
  try {
    switch (spec.mode) {
      case "maze":
        solveMaze(runner);
        break;
      case "redfloor":
        solveRedFloor(runner);
        break;
      case "towerdefense":
        runner = solveTowerDefense(spec, initial);
        break;
      case "runetrading":
        solveRuneTrading(runner);
        break;
      default:
        return { ok: false, reason: `unknown mode ${String(spec.mode)}`, actions: [], ticks: 0 };
    }
  } catch (e) {
    if (e instanceof SolveError) {
      const failed = (e as SolveError & { runner?: Runner }).runner ?? runner;
      return { ok: false, reason: e.message, actions: failed.actions, ticks: failed.state.tick };
    }
    throw e;
  }
  const s = runner.state;
  if (s.status === "won") return { ok: true, reason: "won", actions: runner.actions, ticks: s.tick };
  return { ok: false, reason: `solver finished with status ${s.status} at tick ${s.tick}`, actions: runner.actions, ticks: s.tick };
}

/**
 * Generate the level for `spec` (including its seed) and prove it passable with
 * the scripted solver through the real simulation. `ok` iff the final status is
 * "won"; `actions` is the winning action list (usable as a demo replay).
 */
export function approveLevel(spec: LevelSpec): Approval {
  let initial: WorldState;
  try {
    initial = generateLevel(spec);
  } catch (e) {
    return { ok: false, reason: `generate_failed: ${e instanceof Error ? e.message : String(e)}`, actions: [], ticks: 0 };
  }
  return approveState(spec, initial);
}

export type SeedRng = { int(n: number): number } | (() => number);

/** Positive 31-bit seed in [1, 2^31 - 1]. */
export function randomSeed(rng: SeedRng): number {
  const span = 0x7ffffffe;
  const v = typeof rng === "function" ? Math.floor(rng() * span) : rng.int(span);
  return (Math.min(Math.max(v, 0), span - 1) | 0) + 1;
}

/**
 * Try random seeds until one is approved. If none is within `maxTries`, returns
 * the last seed whose generation did not throw, with `approval.ok === false`
 * (the caller decides what to do). If every seed threw, `approval.reason`
 * starts with "generate_failed".
 */
export function pickApprovedSeed(
  spec: LevelSpec,
  rng: SeedRng,
  maxTries = 40,
): { seed: number; approval: Approval; tries: number } {
  let fallback: { seed: number; approval: Approval } | null = null;
  let lastThrown: { seed: number; approval: Approval } | null = null;
  let tries = 0;
  for (; tries < maxTries; ) {
    const seed = randomSeed(rng);
    tries++;
    const candidate: LevelSpec = { ...spec, seed };
    let initial: WorldState;
    try {
      initial = generateLevel(candidate);
    } catch (e) {
      lastThrown = { seed, approval: { ok: false, reason: `generate_failed: ${e instanceof Error ? e.message : String(e)}`, actions: [], ticks: 0 } };
      continue;
    }
    const approval = approveState(candidate, initial);
    if (approval.ok) return { seed, approval, tries };
    fallback = { seed, approval };
  }
  const out = fallback ?? lastThrown ?? { seed: spec.seed, approval: { ok: false, reason: "no seeds tried", actions: [], ticks: 0 } };
  return { ...out, tries };
}

/** Copy of `tier` with `levels[i].seed = seeds[i]` (levels without a given seed keep theirs). */
export function withSeeds(tier: TierSpec, seeds: number[]): TierSpec {
  return {
    ...tier,
    levels: tier.levels.map((lvl, i) => (i < seeds.length && seeds[i] !== undefined ? { ...lvl, seed: seeds[i] } : { ...lvl })),
  };
}
