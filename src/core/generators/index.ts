import type { LevelSpec, WorldState } from "../types";
import { generateMaze } from "./maze";
import { generateRedFloor } from "./redfloor";
import { generateTowerDefense } from "./towerdefense";

/** Deterministic: same spec (incl. seed) → deep-equal WorldState. */
export function generateLevel(spec: LevelSpec): WorldState {
  switch (spec.env.generator) {
    case "maze":
      return generateMaze(spec);
    case "redfloor":
      return generateRedFloor(spec);
    case "towerdefense":
      return generateTowerDefense(spec);
  }
}

export { generateMaze, generateRedFloor, generateTowerDefense };
export { enemyRoute, isPathTile } from "./towerdefense";
export { assetKeyFor, makeEntity, makeGolem } from "./common";
