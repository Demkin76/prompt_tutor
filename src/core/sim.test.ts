import { describe, expect, it } from "vitest";
import { isTerminal, step } from "./sim";
import { stateFromAscii, testSpec } from "./testutil";
import { tileAt } from "./grid";
import type { Action, SimEventType, WorldState } from "./types";

const spec = testSpec("redfloor");
const types = (r: { events: { type: SimEventType }[] }) => r.events.map((e) => e.type);
const run = (s: WorldState, actions: Action[], sp = spec) => {
  let cur = s;
  const all: SimEventType[] = [];
  for (const a of actions) {
    const r = step(sp, cur, a);
    cur = r.state;
    all.push(...r.events.map((e) => e.type));
  }
  return { state: cur, types: all };
};

describe("sim: movement", () => {
  it("moves, updates facing, seen and golem entity; does not mutate input", () => {
    const s = stateFromAscii(["#####", "#@..#", "#...#", "#####"], { radius: 1 });
    const before = structuredClone(s);
    const r = step(spec, s, { type: "move", args: { dir: "east" } });
    expect(s).toEqual(before);
    expect(r.state.tick).toBe(1);
    expect(r.state.agent.pos).toEqual([2, 1]);
    expect(r.state.agent.facing).toBe("east");
    expect(r.state.entities.find((e) => e.id === "golem")?.pos).toEqual([2, 1]);
    expect(types(r)).toEqual(["moved"]);
    expect(r.state.seen.length).toBeGreaterThan(s.seen.length);
  });

  it("is blocked by walls, edges, closed doors and crates", () => {
    const s = stateFromAscii(["#####", "#@D.#", "#C..#", "#####"], { radius: 1 });
    const west = step(spec, s, { type: "move", args: { dir: "west" } });
    expect(west.events[0]).toMatchObject({ type: "blocked", data: { by: "wall" } });
    expect(west.state.agent.facing).toBe("west");
    const east = step(spec, s, { type: "move", args: { dir: "east" } });
    expect(east.events[0]).toMatchObject({ type: "blocked", data: { by: "closed_door" } });
    const south = step(spec, s, { type: "move", args: { dir: "south" } });
    expect(south.events[0]).toMatchObject({ type: "blocked", data: { by: "crate" } });
    const edge = stateFromAscii(["@."]);
    expect(step(spec, edge, { type: "move", args: { dir: "north" } }).events[0]).toMatchObject({ type: "blocked", data: { by: "edge" } });
  });

  it("dies on hazard and wins on altar", () => {
    const s = stateFromAscii(["#####", "#R@A#", "#####"]);
    const dead = step(spec, s, { type: "move", args: { dir: "west" } });
    expect(types(dead)).toEqual(["moved", "hazard_entered"]);
    expect(dead.state.status).toBe("lost");
    expect(dead.state.agent.alive).toBe(false);
    expect(isTerminal(dead.state)).toBe(true);
    // terminal state ignores further actions
    const after = step(spec, dead.state, { type: "move", args: { dir: "east" } });
    expect(after.events).toEqual([]);
    expect(after.state).toBe(dead.state);

    const won = step(spec, s, { type: "move", args: { dir: "east" } });
    expect(types(won)).toEqual(["moved", "goal_reached"]);
    expect(won.state.status).toBe("won");
  });

  it("bridge is safe", () => {
    const s = stateFromAscii(["@=."]);
    const r = step(spec, s, { type: "move", args: { dir: "east" } });
    expect(types(r)).toEqual(["moved"]);
    expect(r.state.status).toBe("running");
  });

  it("exhausts the tick budget", () => {
    const s = stateFromAscii(["@...."]);
    const sp = testSpec("redfloor", { limits: { ticks: 3, llmCalls: 5, wallClockMs: 1 } });
    const r = run(s, [{ type: "wait" }, { type: "wait" }, { type: "wait" }, { type: "wait" }], sp);
    expect(r.state.status).toBe("out_of_budget");
    expect(r.state.tick).toBe(3);
    expect(r.types).toEqual(["budget_exhausted"]);
  });

  it("wait emits nothing; say emits say; disallowed action is invalid", () => {
    const s = stateFromAscii(["@."]);
    expect(step(spec, s, { type: "wait" }).events).toEqual([]);
    expect(step(spec, s, { type: "say", args: { text: "hi" } }).events[0]).toMatchObject({ type: "say", data: { text: "hi" } });
    expect(step(spec, s, { type: "start_wave" }).events[0]).toMatchObject({ type: "invalid_action" });
  });
});

describe("sim: items", () => {
  it("picks up planks up to maxCarry and keys", () => {
    const s = stateFromAscii(["@pk", "...", ".p."]);
    const r1 = step(spec, s, { type: "pickup" });
    expect(types(r1)).toEqual(["invalid_action"]);
    const r = run(s, [
      { type: "move", args: { dir: "east" } },
      { type: "pickup" },
      { type: "move", args: { dir: "east" } },
      { type: "pickup" },
    ]);
    expect(r.state.agent.inventory).toEqual(["plank", "key"]);
    expect(r.state.entities.filter((e) => e.kind === "plank").length).toBe(1);
    // carry limit 1 plank
    const r2 = run(r.state, [
      { type: "move", args: { dir: "south" } },
      { type: "move", args: { dir: "south" } },
      { type: "move", args: { dir: "west" } },
      { type: "pickup" },
    ]);
    expect(r2.types.at(-1)).toBe("invalid_action");
    expect(r2.state.agent.inventory).toEqual(["plank", "key"]);
  });

  it("places a plank on adjacent hazard -> bridge, then crosses", () => {
    const s = stateFromAscii(["#####", "#@pRA", "#####"]);
    const noPlank = step(spec, s, { type: "place", args: { dir: "east" } });
    expect(types(noPlank)).toEqual(["invalid_action"]);
    const r = run(s, [
      { type: "move", args: { dir: "east" } },
      { type: "pickup" },
      { type: "place", args: { dir: "west" } }, // floor, not hazard
      { type: "place", args: { dir: "east" } },
      { type: "move", args: { dir: "east" } },
      { type: "move", args: { dir: "east" } },
    ]);
    expect(r.types).toEqual(["moved", "picked_up", "invalid_action", "placed", "moved", "moved", "goal_reached"]);
    expect(tileAt(r.state, [3, 1])).toBe("bridge");
    expect(r.state.agent.inventory).toEqual([]);
    expect(r.state.status).toBe("won");
  });
});

describe("sim: doors, levers, crates", () => {
  it("locked door: door_locked without key, opens with key (consumed)", () => {
    const s = stateFromAscii(["@kD."]);
    const locked = step(spec, s, { type: "interact", args: { dir: "east" } });
    expect(types(locked)).toEqual(["invalid_action"]); // key tile, nothing to interact
    const r = run(s, [{ type: "move", args: { dir: "east" } }, { type: "interact" }]);
    expect(r.types.at(-1)).toBe("door_locked");
    const r2 = run(r.state, [{ type: "pickup" }, { type: "interact", args: { dir: "east" } }, { type: "move", args: { dir: "east" } }]);
    expect(r2.types).toEqual(["picked_up", "door_opened", "moved"]);
    expect(r2.state.agent.inventory).toEqual([]);
    const door = r2.state.entities.find((e) => e.kind === "door")!;
    expect(door.props).toMatchObject({ open: true, locked: false });
    expect(step(spec, r2.state, { type: "interact", args: { dir: "west" } }).events[0].type).toBe("invalid_action");
  });

  it("lever toggles its door; lever door cannot be opened by hand", () => {
    const s = stateFromAscii(["@LV."]);
    const hand = run(s, [{ type: "move", args: { dir: "east" } }]); // blocked by lever? no, lever is not blocking
    expect(hand.state.agent.pos).toEqual([1, 0]);
    const r = run(hand.state, [{ type: "interact", args: { dir: "east" } }]);
    expect(r.types).toEqual(["invalid_action"]); // door needs lever
    const pulled = run(s, [{ type: "interact", args: { dir: "east" } }]);
    expect(pulled.types).toEqual(["lever_pulled"]);
    const door = pulled.state.entities.find((e) => e.kind === "door")!;
    expect(door.props.open).toBe(true);
    const again = run(pulled.state, [{ type: "interact", args: { dir: "east" } }]);
    expect(again.state.entities.find((e) => e.kind === "door")!.props.open).toBe(false);
    expect(again.state.entities.find((e) => e.kind === "lever")!.props.on).toBe(false);
  });

  it("pushes crates; crate onto hazard becomes a bridge; stuck crate is invalid", () => {
    const s = stateFromAscii(["#######", "#@C.R.#", "#######"]);
    const r = run(s, [{ type: "interact", args: { dir: "east" } }]);
    expect(r.types).toEqual(["crate_pushed"]);
    expect(r.state.entities.find((e) => e.kind === "crate")!.pos).toEqual([3, 1]);
    const r2 = run(r.state, [{ type: "move", args: { dir: "east" } }, { type: "interact", args: { dir: "east" } }]);
    expect(r2.types).toEqual(["moved", "crate_pushed"]);
    expect(r2.state.entities.some((e) => e.kind === "crate")).toBe(false);
    expect(tileAt(r2.state, [4, 1])).toBe("bridge");
    const stuck = stateFromAscii(["@C#"]);
    expect(step(spec, stuck, { type: "interact", args: { dir: "east" } }).events[0]).toMatchObject({ type: "invalid_action", data: { reason: "crate_stuck" } });
  });
});
