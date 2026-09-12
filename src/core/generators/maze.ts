import type { LevelSpec, Vec, WorldState } from "../types";
import { createRng } from "../rng";
import { bfs, idx, inBounds } from "../grid";
import { filledTiles, finishState } from "./common";

/**
 * Perfect maze via recursive backtracker on an odd grid (cells at odd coords).
 * Start [1,1], altar at the far corner [w-2,h-2].
 *
 * `deadEndFactor` (0..1): probability of knocking out an extra wall between two
 * already-carved cells, adding loops / branch choices. 0 = perfect maze.
 */
export function generateMaze(spec: LevelSpec): WorldState {
  const w = spec.env.size[0] | 1; // force odd
  const h = spec.env.size[1] | 1;
  const size: Vec = [w, h];
  const rng = createRng(spec.seed);
  const tiles = filledTiles(size, "wall");

  const carve = (p: Vec) => (tiles[idx(size, p)] = "floor");
  const isCell = (p: Vec) => inBounds(size, p) && p[0] % 2 === 1 && p[1] % 2 === 1;

  const start: Vec = [1, 1];
  const goal: Vec = [w - 2, h - 2];
  const visited = new Set<number>();
  const stack: Vec[] = [start];
  visited.add(idx(size, start));
  carve(start);

  const jumps: Vec[] = [
    [0, -2],
    [0, 2],
    [2, 0],
    [-2, 0],
  ];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options: Vec[] = [];
    for (const j of jumps) {
      const n: Vec = [cur[0] + j[0], cur[1] + j[1]];
      if (isCell(n) && !visited.has(idx(size, n))) options.push(n);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[rng.int(options.length)];
    carve([(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2]);
    carve(next);
    visited.add(idx(size, next));
    stack.push(next);
  }

  // Extra loops: knock down interior walls that separate two carved cells.
  const factor = Math.max(0, Math.min(1, spec.env.params.deadEndFactor ?? 0));
  if (factor > 0) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p: Vec = [x, y];
        if (tiles[idx(size, p)] !== "wall") continue;
        const horizontal = x % 2 === 0 && y % 2 === 1;
        const vertical = x % 2 === 1 && y % 2 === 0;
        if (!horizontal && !vertical) continue;
        if (rng.next() < factor * 0.25) carve(p);
      }
    }
  }

  tiles[idx(size, goal)] = "altar";

  // Guarantee (holds by construction for a perfect maze; verified anyway).
  const path = bfs(size, (p) => tiles[idx(size, p)] !== "wall", start, goal);
  if (!path) throw new Error(`maze generation failed for ${spec.id}`);

  return finishState(spec, size, tiles, [], start, rng.state);
}
