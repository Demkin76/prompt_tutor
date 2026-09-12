import type { Dir, Entity, EntityKind, LevelSpec, TileType, Vec, WorldState } from "../types";
import { addSeen } from "../grid";

/** Asset key convention used by every generator and the sim. */
export function assetKeyFor(kind: EntityKind, subtype?: string): string {
  switch (kind) {
    case "golem":
      return "unit.golem";
    case "fly":
      return "unit.fly";
    case "plank":
      return "item.plank";
    case "key":
      return "item.key";
    case "door":
      return "obj.door";
    case "lever":
      return "obj.lever";
    case "crate":
      return "obj.crate";
    case "tower":
      return `td.tower.${subtype ?? "basic"}`;
    case "enemy":
      return `td.enemy.${subtype ?? "grunt"}`;
    case "base":
      return "td.base";
  }
}

export function makeEntity(
  id: string,
  kind: EntityKind,
  pos: Vec,
  props: Entity["props"] = {},
  facing: Dir = "east",
  subtype?: string,
): Entity {
  return {
    id,
    kind,
    pos,
    props,
    visual: { assetKey: assetKeyFor(kind, subtype), animation: "idle", facing },
  };
}

export function makeGolem(pos: Vec, facing: Dir = "east"): Entity {
  return makeEntity("golem", "golem", pos, {}, facing);
}

/** Assemble a WorldState with the golem placed and `seen` initialised from the spec radius. */
export function finishState(
  spec: LevelSpec,
  size: Vec,
  tiles: TileType[],
  entities: Entity[],
  start: Vec,
  rngState: number,
  td?: WorldState["td"],
): WorldState {
  const state: WorldState = {
    tick: 0,
    size,
    tiles,
    entities: [makeGolem(start), ...entities],
    agent: { pos: start, facing: "east", inventory: [], alive: true },
    status: "running",
    rngState,
    seen: [],
  };
  if (td) state.td = td;
  addSeen(state, spec.observation.radius);
  return state;
}

export function filledTiles(size: Vec, tile: TileType): TileType[] {
  return new Array<TileType>(size[0] * size[1]).fill(tile);
}
