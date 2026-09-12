import type { Entity, LevelSpec, TileType, Vec, WorldState } from "../types";
import { createRng } from "../rng";
import { bfs, idx, inBounds, neighbors, tileAt } from "../grid";
import { filledTiles, finishState, makeEntity } from "./common";

/**
 * Tower Defense arena: a winding corridor of "path" tiles from a "spawn" tile on
 * the west edge to a "base" tile on the east edge. Tiles 4-adjacent to the path
 * are "buildable"; everything else is wall except one "floor" tile where the
 * golem stands (it never moves in this mode).
 *
 * The path is built from alternating east runs (≥2) and vertical runs, so it
 * never touches itself and BFS over path tiles recovers it exactly.
 */
export function generateTowerDefense(spec: LevelSpec): WorldState {
  const size = spec.env.size;
  const [w, h] = size;
  const rng = createRng(spec.seed);
  const tiles: TileType[] = filledTiles(size, "wall");
  const set = (q: Vec, t: TileType) => (tiles[idx(size, q)] = t);

  // Carve the path.
  const path: Vec[] = [];
  let y = 2 + rng.int(Math.max(1, h - 4));
  let x = 0;
  path.push([x, y]);
  while (x < w - 1) {
    const run = Math.min(2 + rng.int(2), w - 1 - x);
    for (let i = 0; i < run; i++) {
      x++;
      path.push([x, y]);
    }
    if (x >= w - 1) break;
    const dir = rng.next() < 0.5 ? -1 : 1;
    const maxLen = dir < 0 ? y - 1 : h - 2 - y;
    const len = Math.min(1 + rng.int(4), maxLen);
    for (let i = 0; i < len; i++) {
      y += dir;
      path.push([x, y]);
    }
  }
  for (const q of path) set(q, "path");
  const spawn = path[0];
  const base = path[path.length - 1];
  set(spawn, "spawn");
  set(base, "base");

  // Buildable slots next to the path.
  for (const q of path) {
    for (const n of neighbors(size, q)) {
      if (tiles[idx(size, n)] === "wall") set(n, "buildable");
    }
  }

  // Golem standing tile: first wall tile not adjacent to the path, scanning from the top-left.
  let golemPos: Vec | null = null;
  for (let yy = 0; yy < h && !golemPos; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const q: Vec = [xx, yy];
      if (tiles[idx(size, q)] === "wall") {
        golemPos = q;
        break;
      }
    }
  }
  if (!golemPos) golemPos = [0, 0];
  set(golemPos, "floor");

  const baseHp = spec.env.params.baseHp ?? 3;
  const entities: Entity[] = [makeEntity("base", "base", base, { hp: baseHp })];

  // Sanity: the path is recoverable by BFS over path/spawn/base tiles.
  const recovered = bfs(size, (q) => isPathTile(tileAt({ size, tiles }, q)), spawn, base);
  if (!recovered || recovered.length !== path.length) {
    throw new Error(`towerdefense path generation failed for ${spec.id}`);
  }

  const td: WorldState["td"] = {
    phase: "build",
    waveIndex: 0,
    wavesTotal: spec.opponent?.waves.length ?? 0,
    baseHp,
    baseHpMax: baseHp,
    towersLeft: spec.env.params.towerLimit ?? 3,
  };
  const state = finishState(spec, size, tiles, entities, golemPos, rng.state, td);
  // The golem sees the whole arena.
  state.seen = Array.from({ length: w * h }, (_, i) => i);
  return state;
}

export function isPathTile(t: TileType | undefined): boolean {
  return t === "path" || t === "spawn" || t === "base";
}

/** Ordered enemy route from spawn to base, recovered from the tile layer. */
export function enemyRoute(state: WorldState): Vec[] {
  let spawn: Vec | null = null;
  let base: Vec | null = null;
  for (let i = 0; i < state.tiles.length; i++) {
    const q: Vec = [i % state.size[0], Math.floor(i / state.size[0])];
    if (state.tiles[i] === "spawn") spawn = q;
    if (state.tiles[i] === "base") base = q;
  }
  if (!spawn || !base) return [];
  return bfs(state.size, (q) => inBounds(state.size, q) && isPathTile(tileAt(state, q)), spawn, base) ?? [];
}
