import { DIRS, DIR_DELTA } from "./types";
import type { Dir, Entity, TileType, Vec, WorldState } from "./types";

export function idx(size: Vec, pos: Vec): number {
  return pos[1] * size[0] + pos[0];
}

export function fromIdx(size: Vec, i: number): Vec {
  return [i % size[0], Math.floor(i / size[0])];
}

export function inBounds(size: Vec, pos: Vec): boolean {
  return pos[0] >= 0 && pos[1] >= 0 && pos[0] < size[0] && pos[1] < size[1];
}

export function tileAt(state: { size: Vec; tiles: TileType[] }, pos: Vec): TileType | undefined {
  if (!inBounds(state.size, pos)) return undefined;
  return state.tiles[idx(state.size, pos)];
}

export function setTile(state: { size: Vec; tiles: TileType[] }, pos: Vec, tile: TileType): void {
  if (!inBounds(state.size, pos)) return;
  state.tiles[idx(state.size, pos)] = tile;
}

export function addVec(pos: Vec, delta: Vec): Vec {
  return [pos[0] + delta[0], pos[1] + delta[1]];
}

export function stepPos(pos: Vec, dir: Dir): Vec {
  return addVec(pos, DIR_DELTA[dir]);
}

export function samePos(a: Vec, b: Vec): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** 4-neighbours in bounds, in DIRS order. */
export function neighbors(size: Vec, pos: Vec): Vec[] {
  const out: Vec[] = [];
  for (const d of DIRS) {
    const n = stepPos(pos, d);
    if (inBounds(size, n)) out.push(n);
  }
  return out;
}

export function manhattan(a: Vec, b: Vec): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** Direction from `a` to an adjacent tile `b`, or undefined if not adjacent. */
export function dirTo(a: Vec, b: Vec): Dir | undefined {
  for (const d of DIRS) {
    if (samePos(stepPos(a, d), b)) return d;
  }
  return undefined;
}

/**
 * Breadth-first shortest path. Returns the list of positions from `from` to `to`
 * inclusive, or null if unreachable. `passable` is not consulted for `from`.
 */
export function bfs(size: Vec, passable: (pos: Vec) => boolean, from: Vec, to: Vec): Vec[] | null {
  if (!inBounds(size, from) || !inBounds(size, to)) return null;
  const start = idx(size, from);
  const goal = idx(size, to);
  if (start === goal) return [from];
  const prev = new Int32Array(size[0] * size[1]).fill(-1);
  prev[start] = start;
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cpos = fromIdx(size, cur);
    for (const n of neighbors(size, cpos)) {
      const ni = idx(size, n);
      if (prev[ni] !== -1) continue;
      if (!passable(n)) continue;
      prev[ni] = cur;
      if (ni === goal) {
        const path: Vec[] = [];
        let at = goal;
        while (at !== start) {
          path.push(fromIdx(size, at));
          at = prev[at];
        }
        path.push(from);
        path.reverse();
        return path;
      }
      queue.push(ni);
    }
  }
  return null;
}

/** All tile indices reachable from `from` (inclusive) through `passable` tiles. */
export function floodFill(size: Vec, passable: (pos: Vec) => boolean, from: Vec): Set<number> {
  const seen = new Set<number>();
  if (!inBounds(size, from)) return seen;
  const queue: Vec[] = [from];
  seen.add(idx(size, from));
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const n of neighbors(size, cur)) {
      const ni = idx(size, n);
      if (seen.has(ni) || !passable(n)) continue;
      seen.add(ni);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * 0-1 BFS: minimum number of "costly" tiles on any path from `from` to `to`
 * (e.g. hazards that each need a plank). Returns Infinity if unreachable.
 */
export function minCostPath(
  size: Vec,
  passable: (pos: Vec) => boolean,
  costly: (pos: Vec) => boolean,
  from: Vec,
  to: Vec,
): number {
  if (!inBounds(size, from) || !inBounds(size, to)) return Infinity;
  const n = size[0] * size[1];
  const dist = new Float64Array(n).fill(Infinity);
  const start = idx(size, from);
  const goal = idx(size, to);
  dist[start] = 0;
  const deque: number[] = [start];
  while (deque.length) {
    const cur = deque.shift()!;
    if (cur === goal) return dist[cur];
    const cpos = fromIdx(size, cur);
    for (const nb of neighbors(size, cpos)) {
      if (!passable(nb)) continue;
      const ni = idx(size, nb);
      const w = costly(nb) ? 1 : 0;
      if (dist[cur] + w < dist[ni]) {
        dist[ni] = dist[cur] + w;
        if (w === 0) deque.unshift(ni);
        else deque.push(ni);
      }
    }
  }
  return dist[goal];
}

/** First entity at `pos` (golem included). */
export function entityAt(state: { entities: Entity[] }, pos: Vec): Entity | undefined {
  return state.entities.find((e) => samePos(e.pos, pos));
}

export function entitiesAt(state: { entities: Entity[] }, pos: Vec): Entity[] {
  return state.entities.filter((e) => samePos(e.pos, pos));
}

export function entityById(state: { entities: Entity[] }, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

const WALKABLE_TILES: ReadonlySet<TileType> = new Set<TileType>([
  "floor",
  "bridge",
  "altar",
  "hazard",
  "buildable",
  "path",
  "spawn",
  "base",
]);

/** True if an entity of this kind blocks the agent from entering its tile. */
export function entityBlocks(e: Entity): boolean {
  if (e.kind === "door") return !e.props.open;
  return e.kind === "crate" || e.kind === "tower" || e.kind === "base" || e.kind === "enemy";
}

/**
 * Can the agent step onto `pos`? Walls and out-of-bounds never; closed doors,
 * crates, towers, bases block. Hazard IS walkable (but deadly) — use
 * `isSafeWalkable` for planning.
 */
export function isWalkable(state: WorldState, pos: Vec): boolean {
  const t = tileAt(state, pos);
  if (!t || !WALKABLE_TILES.has(t)) return false;
  for (const e of state.entities) {
    if (samePos(e.pos, pos) && entityBlocks(e)) return false;
  }
  return true;
}

/** Walkable and not a hazard. */
export function isSafeWalkable(state: WorldState, pos: Vec): boolean {
  return isWalkable(state, pos) && tileAt(state, pos) !== "hazard";
}

/** Indices of all in-bounds tiles within Chebyshev `radius` of `center`. */
export function tilesWithinRadius(size: Vec, center: Vec, radius: number): number[] {
  const out: number[] = [];
  for (let y = center[1] - radius; y <= center[1] + radius; y++) {
    for (let x = center[0] - radius; x <= center[0] + radius; x++) {
      const p: Vec = [x, y];
      if (inBounds(size, p)) out.push(idx(size, p));
    }
  }
  return out;
}

export function addSeen(state: WorldState, radius: number): void {
  const have = new Set(state.seen);
  for (const i of tilesWithinRadius(state.size, state.agent.pos, radius)) have.add(i);
  state.seen = Array.from(have).sort((a, b) => a - b);
}
