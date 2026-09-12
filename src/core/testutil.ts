/** Test-only helpers: build WorldStates and LevelSpecs from ASCII. Not exported from index.ts. */
import type { Entity, LevelSpec, ModeId, TileType, Vec, WorldState } from "./types";
import { makeEntity, makeGolem } from "./generators/common";
import { addSeen } from "./grid";

const TILE: Record<string, TileType> = {
  "#": "wall",
  ".": "floor",
  R: "hazard",
  "=": "bridge",
  A: "altar",
  S: "spawn",
  "~": "path",
  B: "base",
  _: "buildable",
};

/**
 * Chars: tiles as in the observation legend; entities sit on floor:
 * @ golem, p plank, k key, D locked door, d open door, U closed unlocked door,
 * V lever-controlled closed door (id door-1), L lever (targets door-1), C crate.
 */
export function stateFromAscii(rows: string[], opts: { radius?: number; td?: WorldState["td"] } = {}): WorldState {
  const h = rows.length;
  const w = rows[0].length;
  const size: Vec = [w, h];
  const tiles: TileType[] = [];
  const entities: Entity[] = [];
  let golem: Vec = [0, 0];
  let doorN = 0;
  let plankN = 0;
  let keyN = 0;
  let crateN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const pos: Vec = [x, y];
      if (TILE[c]) {
        tiles.push(TILE[c]);
        if (c === "B") entities.push(makeEntity("base", "base", pos, { hp: 3 }));
        continue;
      }
      tiles.push("floor");
      switch (c) {
        case "@":
          golem = pos;
          break;
        case "p":
          entities.push(makeEntity(`plank-${++plankN}`, "plank", pos));
          break;
        case "k":
          entities.push(makeEntity(`key-${++keyN}`, "key", pos));
          break;
        case "D":
          entities.push(makeEntity(`door-${++doorN}`, "door", pos, { locked: true, open: false, controlledBy: null }));
          break;
        case "d":
          entities.push(makeEntity(`door-${++doorN}`, "door", pos, { locked: false, open: true, controlledBy: null }));
          break;
        case "U":
          entities.push(makeEntity(`door-${++doorN}`, "door", pos, { locked: false, open: false, controlledBy: null }));
          break;
        case "V":
          entities.push(makeEntity(`door-${++doorN}`, "door", pos, { locked: false, open: false, controlledBy: "lever-1" }));
          break;
        case "L":
          entities.push(makeEntity("lever-1", "lever", pos, { on: false, targetId: "door-1" }));
          break;
        case "C":
          entities.push(makeEntity(`crate-${++crateN}`, "crate", pos));
          break;
        default:
          throw new Error(`unknown char ${c}`);
      }
    }
  }
  const state: WorldState = {
    tick: 0,
    size,
    tiles,
    entities: [makeGolem(golem), ...entities],
    agent: { pos: golem, facing: "east", inventory: [], alive: true },
    status: "running",
    rngState: 1,
    seen: [],
  };
  if (opts.td) state.td = opts.td;
  addSeen(state, opts.radius ?? 2);
  return state;
}

export function testSpec(mode: ModeId, overrides: Partial<LevelSpec> = {}): LevelSpec {
  const base: LevelSpec = {
    id: `${mode}-test`,
    mode,
    tier: 1,
    index: 1,
    title: "test",
    brief: "",
    playerKnows: [],
    agentKnows: [],
    promptBudget: 200,
    env: { size: [5, 5], generator: mode, params: {} },
    observation: { radius: 2, memoryTicks: 5 },
    limits: { ticks: 20, llmCalls: 5, wallClockMs: 1000 },
    actions:
      mode === "towerdefense" ? ["place_tower", "start_wave", "wait", "say"] : ["move", "wait", "pickup", "place", "interact", "say"],
    scoring: { completion: 100, perTick: -1, perChar: -0.1, perLlmCall: -2 },
    seed: 1,
  };
  return { ...base, ...overrides };
}
