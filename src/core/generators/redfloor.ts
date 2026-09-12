import type { Entity, LevelSpec, TileType, Vec, WorldState } from "../types";
import { createRng, deriveSeed } from "../rng";
import { floodFill, idx, inBounds, minCostPath, samePos } from "../grid";
import { filledTiles, finishState, makeEntity } from "./common";

/**
 * Red Floor: an open room (walled border) with wall pillars and hazard tiles.
 * Start on the west side, altar on the east side, same row.
 *
 * Optional obstacles, laid out west → east:
 *   keys   → a full-height wall column with one locked door; its key lies on the
 *            start side of that wall.
 *   levers → another wall column with a closed (unlocked) door that only its
 *            lever opens; the lever lies just before that wall.
 *   crates → pushable crates on floor tiles (a crate pushed onto hazard bridges it).
 *   planks → pickable planks in the region before the first door.
 *
 * Guarantee (checked, regenerated with a derived seed until it holds):
 *   R = tiles reachable from start without touching hazard, with doors treated
 *       as open and crates as walls.
 *   • every plank, key and lever ∈ R
 *   • min #hazards on any start→altar path (0-1 BFS, crates as walls) ≤ planks
 *     (so planks == 0 means a hazard-free path exists)
 */
export function generateRedFloor(spec: LevelSpec): WorldState {
  const MAX_TRIES = 500;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const seed = attempt === 0 ? spec.seed : deriveSeed(spec.seed, attempt);
    const res = tryGenerate(spec, seed);
    if (res) return res;
  }
  throw new Error(`redfloor generation failed for ${spec.id} after ${MAX_TRIES} attempts`);
}

function tryGenerate(spec: LevelSpec, seed: number): WorldState | null {
  const size = spec.env.size;
  const [w, h] = size;
  const p = spec.env.params;
  const planks = p.planks ?? 0;
  const keys = Math.min(p.keys ?? 0, 1);
  const levers = Math.min(p.levers ?? 0, 1);
  const crates = p.crates ?? 0;
  const hazardDensity = p.hazardDensity ?? 0.1;
  const pillarDensity = 0.05;
  const rng = createRng(seed);

  const tiles: TileType[] = filledTiles(size, "floor");
  const entities: Entity[] = [];
  const at = (q: Vec) => tiles[idx(size, q)];
  const set = (q: Vec, t: TileType) => (tiles[idx(size, q)] = t);

  // Border walls.
  for (let x = 0; x < w; x++) {
    set([x, 0], "wall");
    set([x, h - 1], "wall");
  }
  for (let y = 0; y < h; y++) {
    set([0, y], "wall");
    set([w - 1, y], "wall");
  }

  const midY = Math.floor(h / 2);
  const start: Vec = [1, midY];
  const altar: Vec = [w - 2, midY];
  const reserved = new Set<number>([idx(size, start), idx(size, altar)]);

  // Door walls. Columns chosen so regions stay ≥ 3 tiles wide.
  const doorColumns: number[] = [];
  if (keys) doorColumns.push(Math.floor(w * 0.45));
  if (levers) doorColumns.push(Math.floor(w * 0.72));
  const doorTiles: Vec[] = [];
  doorColumns.forEach((dx, i) => {
    for (let y = 1; y < h - 1; y++) set([dx, y], "wall");
    const dy = 1 + rng.int(h - 2);
    const dpos: Vec = [dx, dy];
    set(dpos, "floor");
    doorTiles.push(dpos);
    reserved.add(idx(size, dpos));
    const isKeyDoor = keys > 0 && i === 0;
    entities.push(
      makeEntity(`door-${i + 1}`, "door", dpos, {
        locked: isKeyDoor,
        open: false,
        controlledBy: isKeyDoor ? null : `lever-1`,
      }),
    );
  });

  // Keep the tiles right next to doors, start and altar clear of hazards/pillars.
  const protect = new Set<number>(reserved);
  for (const q of [start, altar, ...doorTiles]) {
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as Vec[]) {
      const n: Vec = [q[0] + ox, q[1] + oy];
      if (inBounds(size, n) && at(n) === "floor") protect.add(idx(size, n));
    }
  }

  // Pillars and hazards on interior floor.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const q: Vec = [x, y];
      const i = idx(size, q);
      if (at(q) !== "floor" || protect.has(i)) continue;
      const r = rng.next();
      if (r < pillarDensity) set(q, "wall");
      else if (r < pillarDensity + hazardDensity) set(q, "hazard");
    }
  }
  set(altar, "altar");

  // Regions by x for item placement.
  const firstDoorX = doorColumns.length ? doorColumns[0] : w - 1;
  const region = (x0: number, x1: number): Vec[] => {
    const out: Vec[] = [];
    for (let y = 1; y < h - 1; y++)
      for (let x = x0; x < x1; x++) {
        const q: Vec = [x, y];
        if (at(q) === "floor" && !reserved.has(idx(size, q)) && !entities.some((e) => samePos(e.pos, q)))
          out.push(q);
      }
    return out;
  };
  const pick = (cands: Vec[]): Vec | null => (cands.length ? cands[rng.int(cands.length)] : null);

  // Key: start side of the first door wall.
  if (keys) {
    const q = pick(region(1, doorColumns[0]));
    if (!q) return null;
    entities.push(makeEntity("key-1", "key", q, { opens: "door-1" }));
  }
  // Lever: in the region right before its wall.
  if (levers) {
    const leverWallX = doorColumns[doorColumns.length - 1];
    const prevX = doorColumns.length > 1 ? doorColumns[0] + 1 : 1;
    const q = pick(region(prevX, leverWallX));
    if (!q) return null;
    const doorId = `door-${doorColumns.length}`;
    entities.push(makeEntity("lever-1", "lever", q, { on: false, targetId: doorId }));
  }
  // Planks: before the first door, at most `maxCarry` matters for the agent, not here.
  for (let i = 0; i < planks; i++) {
    const q = pick(region(1, firstDoorX));
    if (!q) return null;
    entities.push(makeEntity(`plank-${i + 1}`, "plank", q));
  }
  // Crates: anywhere on floor, never adjacent to start (so the agent is never boxed in).
  for (let i = 0; i < crates; i++) {
    const q = pick(region(3, w - 2));
    if (!q) return null;
    entities.push(makeEntity(`crate-${i + 1}`, "crate", q));
  }

  // ── Guarantee checks ──
  const crateAt = (q: Vec) => entities.some((e) => e.kind === "crate" && samePos(e.pos, q));
  const passable = (q: Vec) => at(q) !== "wall" && !crateAt(q);
  const safe = (q: Vec) => passable(q) && at(q) !== "hazard";
  const R = floodFill(size, safe, start);
  for (const e of entities) {
    if (e.kind === "plank" || e.kind === "key" || e.kind === "lever") {
      if (!R.has(idx(size, e.pos))) return null;
    }
  }
  const need = minCostPath(size, passable, (q) => at(q) === "hazard", start, altar);
  if (need > planks) return null;
  // Tier 1 flavour: nearly straight — the shortest safe path must be short.
  if (spec.tier === 1 && planks === 0) {
    const best = minCostPath(size, safe, () => false, start, altar);
    if (!isFinite(best)) return null;
  }

  return finishState(spec, size, tiles, entities, start, rng.state);
}
