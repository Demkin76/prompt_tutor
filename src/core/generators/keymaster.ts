import type { LevelSpec, Vec } from "../types";
import { idx } from "../grid";
import { filledTiles, finishState, makeEntity } from "./common";

/** Three bounded corridor/room layouts. A single gate is the only cut into the exit wing. */
export function generateKeymaster(spec: LevelSpec) {
  const size: Vec = [16, 16];
  const tiles = filledTiles(size, "wall");
  const carve = (a: Vec, b: Vec) => {
    let [x, y] = a;
    tiles[idx(size, [x, y])] = "floor";
    while (x !== b[0]) { x += Math.sign(b[0] - x); tiles[idx(size, [x, y])] = "floor"; }
    while (y !== b[1]) { y += Math.sign(b[1] - y); tiles[idx(size, [x, y])] = "floor"; }
  };
  const variant = ((spec.seed - 44001) % 3 + 3) % 3;
  const starts: Vec[] = [[7, 12], [9, 7], [3, 11]];
  const keys: Vec[] = [[2, 3], [2, 2], [2, 7]];
  const gate: Vec = [11, variant === 2 ? 3 : 7];
  // Main spine and branching chambers; x=11 remains a sealed wall except at the gate.
  carve([7, 2], [7, 13]);
  carve([2, 3], [7, 3]);
  carve([2, 2], [2, 5]);
  carve([1, 2], [3, 2]); carve([1, 4], [3, 4]);
  carve([2, 7], [9, 7]);
  carve([2, 7], [2, 9]); carve([1, 8], [3, 8]);
  carve([3, 11], [7, 11]);
  if (variant === 2) carve([3, 11], [3, 7]);
  carve([4, 11], [4, 13]);
  carve([7, 5], [9, 5]);
  carve([7, gate[1]], [13, gate[1]]);
  carve([13, 3], [13, 10]);
  carve([12, 3], [14, 3]); carve([12, 4], [14, 4]);
  const altar: Vec = variant === 2 ? [13, 10] : [13, 3];
  tiles[idx(size, altar)] = "altar";
  const door = makeEntity("door-1", "door", gate, { locked: true, open: false, description: "Heavy locked door. A keyhole is visible." });
  door.visual.assetKey = "obj.door.closed";
  const state = finishState(spec, size, tiles, [
    door,
    makeEntity("key-1", "key", keys[variant], { opens: "door-1", description: "A golden key lies on the floor. It can be picked up." }),
    makeEntity("crate-1", "crate", [9, 5]), makeEntity("crate-2", "crate", [4, 13]),
  ], starts[variant], spec.seed);
  state.keymaster = { key: "world", altar: "idle", recentStates: [] };
  return state;
}
