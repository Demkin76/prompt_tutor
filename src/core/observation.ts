import type {
  AgentMemory,
  Entity,
  LevelSpec,
  Observation,
  SimEvent,
  StopOn,
  TileType,
  Vec,
  VisibleEntity,
  VisibleTile,
  WorldState,
} from "./types";
import { chebyshev, idx, inBounds, manhattan, neighbors, tileAt } from "./grid";

export const ASCII_LEGEND = [
  "# wall  . floor  R red hazard (deadly)  = bridge (safe)  A altar (goal)",
  "@ you (golem)  p plank  k key  D closed door  d open door  L lever  C crate",
  "? unknown / out of view",
  "Tower defense: S spawn  ~ enemy path  B base  _ empty buildable slot  T tower",
].join("\n");

const TILE_CHAR: Record<TileType, string> = {
  floor: ".",
  wall: "#",
  hazard: "R",
  bridge: "=",
  altar: "A",
  path: "~",
  buildable: "_",
  spawn: "S",
  base: "B",
};

function entityChar(e: Entity): string {
  switch (e.kind) {
    case "golem":
      return "@";
    case "plank":
      return "p";
    case "key":
      return "k";
    case "door":
      return e.props.open ? "d" : "D";
    case "lever":
      return "L";
    case "crate":
      return "C";
    case "tower":
      return "T";
    case "base":
      return "B";
    case "enemy":
      return "e";
  }
}

export function objectiveFor(spec: LevelSpec): string {
  switch (spec.mode) {
    case "maze":
      return "Reach the altar (A). Walls block you; explore until you find it.";
    case "redfloor":
      return "Reach the altar (A) without ever stepping on red hazard (R). Planks (p) placed on hazard turn it into a safe bridge (=).";
    case "towerdefense":
      return "Place towers on buildable slots (_) then start waves. Survive every wave with base HP > 0.";
  }
}

/** Entities inside the Chebyshev radius, excluding the golem itself. */
export function visibleEntities(spec: LevelSpec, state: WorldState): Entity[] {
  if (spec.mode === "towerdefense") return state.entities.filter((e) => e.kind !== "golem");
  const r = spec.observation.radius;
  return state.entities.filter((e) => e.kind !== "golem" && chebyshev(e.pos, state.agent.pos) <= r);
}

export function visibleTiles(spec: LevelSpec, state: WorldState): VisibleTile[] {
  const out: VisibleTile[] = [];
  const full = spec.mode === "towerdefense";
  const r = spec.observation.radius;
  const c = state.agent.pos;
  const y0 = full ? 0 : c[1] - r;
  const y1 = full ? state.size[1] - 1 : c[1] + r;
  const x0 = full ? 0 : c[0] - r;
  const x1 = full ? state.size[0] - 1 : c[0] + r;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p: Vec = [x, y];
      if (inBounds(state.size, p)) out.push({ pos: p, tile: state.tiles[idx(state.size, p)] });
    }
  return out;
}

/**
 * ASCII window. Nav modes: (2r+1)² window centred on the golem, `?` outside the
 * grid. Tower defense: the whole arena (the golem never moves there).
 */
export function asciiView(spec: LevelSpec, state: WorldState): string {
  const full = spec.mode === "towerdefense";
  const r = spec.observation.radius;
  const c = state.agent.pos;
  const y0 = full ? 0 : c[1] - r;
  const y1 = full ? state.size[1] - 1 : c[1] + r;
  const x0 = full ? 0 : c[0] - r;
  const x1 = full ? state.size[0] - 1 : c[0] + r;
  const byPos = new Map<number, Entity>();
  for (const e of state.entities) {
    const i = idx(state.size, e.pos);
    const prev = byPos.get(i);
    if (!prev || e.kind === "golem") byPos.set(i, e);
  }
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) {
      const p: Vec = [x, y];
      if (!inBounds(state.size, p)) {
        row += "?";
        continue;
      }
      const e = byPos.get(idx(state.size, p));
      row += e ? entityChar(e) : TILE_CHAR[state.tiles[idx(state.size, p)]];
    }
    rows.push(row);
  }
  return rows.join("\n");
}

/** Whole-level ASCII map of everything the agent has ever seen (`?` = never seen). Entities shown only where currently visible. */
export function knownMapView(spec: LevelSpec, state: WorldState): string {
  const [w, h] = state.size;
  const seen = new Set(state.seen);
  const r = spec.observation.radius;
  const c = state.agent.pos;
  const byPos = new Map<number, Entity>();
  for (const e of state.entities) {
    const i = idx(state.size, e.pos);
    const visibleNow = spec.mode === "towerdefense" || (Math.abs(e.pos[0] - c[0]) <= r && Math.abs(e.pos[1] - c[1]) <= r);
    if (e.kind === "golem" || visibleNow) {
      const prev = byPos.get(i);
      if (!prev || e.kind === "golem") byPos.set(i, e);
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = byPos.get(i);
      if (e) row += entityChar(e);
      else if (seen.has(i)) row += TILE_CHAR[state.tiles[i]];
      else row += "?";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export function buildObservation(
  spec: LevelSpec,
  state: WorldState,
  memory: AgentMemory,
  budget: { ticksLeft: number; callsLeft: number },
  runId: string,
): Observation {
  const ents: VisibleEntity[] = visibleEntities(spec, state).map((e) => ({ id: e.id, kind: e.kind, pos: e.pos, props: { ...e.props } }));
  const obs: Observation = {
    runId,
    levelId: spec.id,
    tick: state.tick,
    objective: objectiveFor(spec),
    self: { pos: state.agent.pos, facing: state.agent.facing, inventory: [...state.agent.inventory] },
    visible: { tiles: visibleTiles(spec, state), entities: ents },
    asciiView: asciiView(spec, state),
    knownMap: knownMapView(spec, state),
    memory,
    budget,
  };
  if (spec.mode === "towerdefense" && state.td) {
    const occupied = new Set(state.entities.map((e) => idx(state.size, e.pos)));
    const buildableSlots: Vec[] = [];
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === "buildable" && !occupied.has(i)) buildableSlots.push([i % state.size[0], Math.floor(i / state.size[0])]);
    }
    obs.td = {
      ...state.td,
      buildableSlots,
      towerTypes: spec.env.params.towerTypes ?? [],
      opponentCharter: spec.opponent?.charter ?? "",
    };
  }
  return obs;
}

// ───────────────────────── Memory ─────────────────────────

export function emptyMemory(): AgentMemory {
  return { knownLandmarks: [], recentEvents: [], marks: [], visitedCount: 0, recentPositions: [] };
}

const LANDMARK_KINDS = new Set(["plank", "key", "door", "lever", "crate", "base", "tower"]);

export function describeEvent(e: SimEvent): string {
  const d = e.data ?? {};
  const t = `t${e.tick}`;
  switch (e.type) {
    case "inspected": return `${t} inspected ${d.kind}: ${d.description ?? ""}`;
    case "item_collected": return `${t} ключ подобран; инвентарь: key`;
    case "key_consumed": return `${t} ключ использован; инвентарь пуст`;
    case "door_unlocked": return `${t} замок открыт`;
    case "interaction_failed": return `${t} действие не удалось: ${d.reason}`;
    case "altar_reached": return `${t} алтарь достигнут`;
    case "door_discovered": return `${t} обнаружена запертая дверь ${fmt(d.pos as Vec)}`;
    case "key_discovered": return `${t} обнаружен ключ ${fmt(d.pos as Vec)}`;
    case "agent_stuck": return `${t} голем застрял: повторяет действия без прогресса`;
    case "moved":
      return `${t} moved ${d.dir} to ${fmt(d.to as Vec)}`;
    case "blocked":
      return `${t} blocked ${d.dir} by ${d.by}`;
    case "hazard_entered":
      return `${t} stepped on hazard at ${fmt(d.pos as Vec)} — destroyed`;
    case "goal_reached":
      return `${t} reached altar`;
    case "picked_up":
      return `${t} picked up ${d.kind}`;
    case "placed":
      return `${t} placed plank ${d.dir}`;
    case "door_opened":
      return `${t} opened door ${d.id}`;
    case "door_locked":
      return `${t} door ${d.id} is locked (need key)`;
    case "lever_pulled":
      return `${t} pulled lever ${d.id}; door ${d.doorId} ${d.doorOpen ? "open" : "closed"}`;
    case "crate_pushed":
      return `${t} pushed crate to ${fmt(d.to as Vec)}${d.bridged ? " (bridged hazard)" : ""}`;
    case "invalid_action":
      return `${t} invalid ${d.action}: ${d.reason}`;
    case "say":
      return `${t} said "${d.text}"`;
    case "tower_placed":
      return `${t} placed ${d.towerType} tower at ${fmt(d.pos as Vec)} (${d.towersLeft} left)`;
    case "tower_limit":
      return `${t} tower limit reached`;
    case "wave_started":
      return `${t} wave ${Number(d.waveIndex) + 1} started: ${d.count} ${d.enemyType}`;
    case "wave_ended":
      return `${t} wave ${Number(d.waveIndex) + 1} ended: killed ${d.killed}, leaked ${d.leaked}, base hp ${d.baseHp}`;
    case "base_destroyed":
      return `${t} base destroyed`;
    case "all_waves_cleared":
      return `${t} all waves cleared`;
    case "budget_exhausted":
      return `${t} tick budget exhausted`;
    case "enemy_spawned":
    case "enemy_killed":
    case "enemy_leaked":
      return `${t} ${e.type.replace("_", " ")} ${d.id}`;
  }
}

function fmt(p: Vec | undefined): string {
  return p ? `[${p[0]},${p[1]}]` : "?";
}

/** Fold the latest step into memory: landmarks seen, recent event lines, marks, visited count. */
export function updateMemory(memory: AgentMemory, spec: LevelSpec, state: WorldState, events: SimEvent[]): AgentMemory {
  const next: AgentMemory = {
    knownLandmarks: memory.knownLandmarks.map((l) => ({ ...l, pos: [l.pos[0], l.pos[1]] as Vec })),
    recentEvents: [...memory.recentEvents],
    marks: memory.marks.map((m) => ({ pos: [m.pos[0], m.pos[1]] as Vec, note: m.note })),
    visitedCount: memory.visitedCount,
    recentPositions: [...(memory.recentPositions ?? []), [state.agent.pos[0], state.agent.pos[1]] as Vec].slice(-12),
  };
  const key = (kind: string, p: Vec) => `${kind}@${p[0]},${p[1]}`;
  const have = new Set(next.knownLandmarks.map((l) => key(l.kind, l.pos)));

  const tiles = visibleTiles(spec, state);
  const visibleIdx = new Set(tiles.map((t) => idx(state.size, t.pos)));
  for (const t of tiles) {
    if (t.tile === "altar" && !have.has(key("altar", t.pos))) {
      next.knownLandmarks.push({ kind: "altar", pos: t.pos });
      have.add(key("altar", t.pos));
    }
  }
  const ents = visibleEntities(spec, state);
  for (const e of ents) {
    if (!LANDMARK_KINDS.has(e.kind)) continue;
    const existing = next.knownLandmarks.find(l => key(l.kind, l.pos) === key(e.kind, e.pos));
    if (existing) continue;
    next.knownLandmarks.push({ kind: e.kind, pos: e.pos });
    have.add(key(e.kind, e.pos));
  }
  // Forget items that are visibly gone (picked up / crate moved).
  next.knownLandmarks = next.knownLandmarks.filter((l) => {
    if (!(l.kind === "plank" || l.kind === "key" || l.kind === "crate")) return true;
    if (!visibleIdx.has(idx(state.size, l.pos))) return true;
    return state.entities.some((e) => e.kind === l.kind && e.pos[0] === l.pos[0] && e.pos[1] === l.pos[1]);
  });

  // Event lines. Skip the noisy per-enemy TD events.
  for (const e of events) {
    if (e.type === "enemy_spawned" || e.type === "enemy_killed" || e.type === "enemy_leaked") continue;
    next.recentEvents.push(describeEvent(e));
    if (e.type === "moved") next.visitedCount += 1;
    if (e.type === "say") {
      const text = String(e.data?.text ?? "");
      if (text.toLowerCase().startsWith("mark:")) next.marks.push({ pos: state.agent.pos, note: text.slice(5).trim() });
    }
  }
  const keep = Math.max(1, spec.observation.memoryTicks);
  if (next.recentEvents.length > keep) next.recentEvents = next.recentEvents.slice(-keep);
  return next;
}

// ───────────────────────── Stop triggers ─────────────────────────

/**
 * Which `stopOn` triggers fired going from `prev` to `next` (order matches StopOn):
 *   new_entity      an entity id not visible before is visible now
 *   blocked         a "blocked" event occurred
 *   hazard_detected a hazard tile came into view that was not visible before
 *   goal_visible    the altar came into view
 *   item_visible    a plank/key came into view
 * `plan_done` is decided by the runtime, never here.
 */
export function detectTriggers(spec: LevelSpec, prev: WorldState, next: WorldState, events: SimEvent[]): StopOn[] {
  const fired: StopOn[] = [];
  const prevEnts = new Set(visibleEntities(spec, prev).map((e) => e.id));
  const nextEnts = visibleEntities(spec, next);
  if (nextEnts.some((e) => !prevEnts.has(e.id))) fired.push("new_entity");
  if (events.some((e) => e.type === "blocked")) fired.push("blocked");
  const prevTiles = visibleTiles(spec, prev);
  const nextTiles = visibleTiles(spec, next);
  const prevHazard = new Set(prevTiles.filter((t) => t.tile === "hazard").map((t) => idx(prev.size, t.pos)));
  if (nextTiles.some((t) => t.tile === "hazard" && !prevHazard.has(idx(next.size, t.pos)))) fired.push("hazard_detected");
  const prevAltar = prevTiles.some((t) => t.tile === "altar");
  const nextAltar = nextTiles.some((t) => t.tile === "altar");
  if (nextAltar && !prevAltar) fired.push("goal_visible");
  const isItem = (e: Entity) => e.kind === "plank" || e.kind === "key";
  const prevItems = new Set(visibleEntities(spec, prev).filter(isItem).map((e) => e.id));
  if (nextEnts.some((e) => isItem(e) && !prevItems.has(e.id))) fired.push("item_visible");
  if (events.some(e => ["item_collected", "door_opened", "interaction_failed"].includes(e.type))) fired.push("state_changed");
  return fired;
}

/** Number of 4-adjacent hazard tiles around the agent (prompt / UI helper). */
export function adjacentHazards(state: WorldState): number {
  let n = 0;
  for (const p of neighbors(state.size, state.agent.pos)) if (tileAt(state, p) === "hazard") n++;
  return n;
}

/** Nearest known landmark of a kind (helper for prompts / UI). */
export function nearestLandmark(memory: AgentMemory, kind: string, from: Vec): Vec | undefined {
  let best: Vec | undefined;
  let bd = Infinity;
  for (const l of memory.knownLandmarks) {
    if (l.kind !== kind) continue;
    const d = manhattan(l.pos, from);
    if (d < bd) {
      bd = d;
      best = l.pos;
    }
  }
  return best;
}
