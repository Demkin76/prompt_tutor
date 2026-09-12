import { DIR_DELTA } from "./types";
import type { Action, Dir, Entity, LevelSpec, SimEvent, SimEventType, StepResult, Vec, WorldState } from "./types";
import { addSeen, entitiesAt, entityAt, entityById, inBounds, isWalkable, samePos, tileAt } from "./grid";
import { makeEntity } from "./generators/common";
import { runWave } from "./wave";

export function isTerminal(state: WorldState): boolean {
  return state.status !== "running";
}

/**
 * Pure step: returns a NEW state. Never mutates the input.
 * A terminal state ignores every action (no tick, no events).
 */
export function step(spec: LevelSpec, state: WorldState, action: Action): StepResult {
  if (isTerminal(state)) return { state, events: [] };

  const next: WorldState = structuredClone(state);
  next.tick += 1;
  const events: SimEvent[] = [];
  const emit = (type: SimEventType, data?: Record<string, unknown>) => {
    events.push(data ? { tick: next.tick, type, data } : { tick: next.tick, type });
  };
  const invalid = (reason: string, extra?: Record<string, unknown>) =>
    emit("invalid_action", { action: action.type, reason, ...extra });

  const isTd = spec.mode === "towerdefense";
  if (!spec.actions.includes(action.type)) {
    invalid("action_not_allowed_in_level");
  } else {
    switch (action.type) {
      case "move":
        if (isTd) invalid("golem_does_not_move_in_towerdefense");
        else doMove(spec, next, action.args.dir, emit);
        break;
      case "wait":
        break;
      case "say":
        emit("say", { text: String(action.args?.text ?? "") });
        break;
      case "pickup":
        doPickup(spec, next, emit, invalid);
        break;
      case "place":
        doPlace(next, action.args.dir, emit, invalid);
        break;
      case "inspect": {
        const dir = action.args?.dir ?? next.agent.facing;
        const pos: Vec = [next.agent.pos[0] + DIR_DELTA[dir][0], next.agent.pos[1] + DIR_DELTA[dir][1]];
        const target = entitiesAt(next, pos).find(e => e.kind !== "golem");
        emit("inspected", { pos, kind: target?.kind ?? tileAt(next, pos) ?? "edge", ...target?.props });
        break;
      }
      case "interact":
        doInteract(next, action.args?.dir ?? next.agent.facing, emit, invalid);
        break;
      case "place_tower":
        doPlaceTower(spec, next, action.args.pos, action.args.towerType, emit, invalid);
        break;
      case "start_wave":
        doStartWave(spec, next, emit, invalid);
        break;
    }
  }

  if (next.status === "running" && next.tick >= spec.limits.ticks) {
    next.status = "out_of_budget";
    emit("budget_exhausted", { ticks: next.tick });
  }

  syncGolemVisual(next, events);
  return { state: next, events };
}

type Emit = (type: SimEventType, data?: Record<string, unknown>) => void;
type Invalid = (reason: string, extra?: Record<string, unknown>) => void;

function doMove(spec: LevelSpec, s: WorldState, dir: Dir, emit: Emit): void {
  const from = s.agent.pos;
  const to: Vec = [from[0] + DIR_DELTA[dir][0], from[1] + DIR_DELTA[dir][1]];
  s.agent.facing = dir;
  if (!inBounds(s.size, to)) return void emit("blocked", { dir, by: "edge", pos: to });
  if (!isWalkable(s, to)) {
    const t = tileAt(s, to);
    const e = entitiesAt(s, to).find((x) => x.kind !== "golem");
    const by = t === "wall" ? "wall" : e ? (e.kind === "door" ? "closed_door" : e.kind) : String(t);
    return void emit("blocked", { dir, by, pos: to });
  }
  s.agent.pos = to;
  const golem = entityById(s, "golem");
  if (golem) golem.pos = to;
  addSeen(s, spec.observation.radius);
  emit("moved", { dir, from, to });
  const tile = tileAt(s, to);
  if (tile === "hazard") {
    s.agent.alive = false;
    s.status = "lost";
    emit("hazard_entered", { pos: to });
  } else if (tile === "altar") {
    s.status = "won";
    emit("goal_reached", { pos: to });
  }
}

function doPickup(spec: LevelSpec, s: WorldState, emit: Emit, invalid: Invalid): void {
  const item = s.entities.find(e => (e.kind === "plank" || e.kind === "key") && samePos(e.pos, s.agent.pos));
  if (!item) return invalid("nothing_to_pick_up");
  if (item.kind === "plank") {
    const maxCarry = spec.env.params.maxCarry ?? 1;
    const carried = s.agent.inventory.filter((k) => k === "plank").length;
    if (carried >= maxCarry) return invalid("carry_limit", { maxCarry });
  }
  s.entities = s.entities.filter((e) => e.id !== item.id);
  s.agent.inventory.push(item.kind);
  emit("picked_up", { kind: item.kind, id: item.id, pos: item.pos });
}

function doPlace(s: WorldState, dir: Dir, emit: Emit, invalid: Invalid): void {
  s.agent.facing = dir;
  const i = s.agent.inventory.indexOf("plank");
  if (i < 0) return invalid("no_plank");
  const target: Vec = [s.agent.pos[0] + DIR_DELTA[dir][0], s.agent.pos[1] + DIR_DELTA[dir][1]];
  if (tileAt(s, target) !== "hazard") return invalid("target_not_hazard", { pos: target });
  s.tiles[target[1] * s.size[0] + target[0]] = "bridge";
  s.agent.inventory.splice(i, 1);
  emit("placed", { pos: target, dir });
}

function doInteract(s: WorldState, dir: Dir, emit: Emit, invalid: Invalid): void {
  s.agent.facing = dir;
  const target: Vec = [s.agent.pos[0] + DIR_DELTA[dir][0], s.agent.pos[1] + DIR_DELTA[dir][1]];
  const e = entitiesAt(s, target).find((x) => x.kind === "door" || x.kind === "lever" || x.kind === "crate");
  if (!e) return invalid("nothing_to_interact", { pos: target });

  if (e.kind === "door") {
    if (e.props.open) return invalid("door_already_open", { id: e.id });
    if (e.props.locked) {
      const k = s.agent.inventory.indexOf("key");
      if (k < 0) {
        emit("door_locked", { id: e.id, pos: target });
        return;
      }
      s.agent.inventory.splice(k, 1);
      e.visual.assetKey = "obj.door.open";
      e.props.description = "Open door. The path is clear.";
      e.props.locked = false;
      e.props.open = true;
      return void emit("door_opened", { id: e.id, pos: target, with: "key" });
    }
    if (e.props.controlledBy) return invalid("door_needs_lever", { id: e.id, lever: e.props.controlledBy });
    e.props.open = true;
    return void emit("door_opened", { id: e.id, pos: target, with: "hand" });
  }

  if (e.kind === "lever") {
    e.props.on = !e.props.on;
    const door = typeof e.props.targetId === "string" ? entityById(s, e.props.targetId) : undefined;
    if (door && door.kind === "door") {
      door.props.open = !door.props.open;
      door.props.locked = false;
    }
    return void emit("lever_pulled", { id: e.id, on: e.props.on, doorId: door?.id ?? null, doorOpen: door?.props.open ?? null });
  }

  // crate
  const beyond: Vec = [target[0] + DIR_DELTA[dir][0], target[1] + DIR_DELTA[dir][1]];
  const bt = tileAt(s, beyond);
  const pushable = (bt === "floor" || bt === "hazard" || bt === "bridge") && !entityAt(s, beyond);
  if (!pushable) return invalid("crate_stuck", { id: e.id, beyond });
  let bridged = false;
  if (bt === "hazard") {
    s.tiles[beyond[1] * s.size[0] + beyond[0]] = "bridge";
    s.entities = s.entities.filter((x) => x.id !== e.id);
    bridged = true;
  } else {
    e.pos = beyond;
  }
  emit("crate_pushed", { id: e.id, from: target, to: beyond, bridged });
}

function doPlaceTower(spec: LevelSpec, s: WorldState, pos: Vec, towerType: string, emit: Emit, invalid: Invalid): void {
  if (!s.td) return invalid("not_towerdefense");
  if (s.td.phase !== "build") return invalid("wrong_phase");
  const tt = (spec.env.params.towerTypes ?? []).find((t) => t.id === towerType);
  if (!tt) return invalid("unknown_tower_type", { towerType });
  if (!Array.isArray(pos) || pos.length !== 2 || tileAt(s, pos) !== "buildable") return invalid("not_buildable", { pos });
  if (entityAt(s, pos)) return invalid("slot_occupied", { pos });
  if (s.td.towersLeft <= 0) return void emit("tower_limit", { limit: spec.env.params.towerLimit ?? 0 });
  const id = `tower-${s.entities.filter((e) => e.kind === "tower").length + 1}`;
  const tower: Entity = makeEntity(id, "tower", [pos[0], pos[1]], { towerType: tt.id, range: tt.range, damage: tt.damage }, "east", tt.id);
  s.entities.push(tower);
  s.td.towersLeft -= 1;
  emit("tower_placed", { id, pos: tower.pos, towerType: tt.id, towersLeft: s.td.towersLeft });
}

function doStartWave(spec: LevelSpec, s: WorldState, emit: Emit, invalid: Invalid): void {
  if (!s.td || !spec.opponent) return invalid("not_towerdefense");
  if (s.td.phase !== "build" || s.td.waveIndex >= s.td.wavesTotal) return invalid("no_waves_left");
  runWave(spec, s, emit);
}

/** Keep the golem entity's visual in sync with the agent (facing + animation). */
function syncGolemVisual(s: WorldState, events: SimEvent[]): void {
  const golem = entityById(s, "golem");
  if (!golem) return;
  golem.visual.facing = s.agent.facing;
  if (!samePos(golem.pos, s.agent.pos)) golem.pos = s.agent.pos;
  const types = new Set(events.map((e) => e.type));
  if (types.has("goal_reached") || types.has("all_waves_cleared")) golem.visual.animation = "success";
  else if (types.has("hazard_entered") || types.has("base_destroyed") || s.status === "out_of_budget" || types.has("agent_stuck")) golem.visual.animation = "fail";
  else if (types.has("moved")) golem.visual.animation = "walk";
  else if (types.has("door_opened") || types.has("lever_pulled") || types.has("crate_pushed") || types.has("picked_up") || types.has("placed") || types.has("tower_placed")) golem.visual.animation = "interact";
  else golem.visual.animation = "idle";
}
