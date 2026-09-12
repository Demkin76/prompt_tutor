import { describe, expect, it } from "vitest";
import { step } from "./sim";
import { effectiveWave } from "./wave";
import { stateFromAscii, testSpec } from "./testutil";
import { enemyRoute } from "./generators/towerdefense";
import type { Action, LevelSpec, SimEvent, WorldState } from "./types";

// Straight 8-tile route, slots above and below.
const ROWS = ["........", "________", "S~~~~~~B", "________", "........"];
const archer = { id: "archer", range: 2, damage: 1, label: "archer" };
const cannon = { id: "cannon", range: 1, damage: 3, label: "cannon" };

function tdSpec(waves: LevelSpec["opponent"] extends infer O ? (O extends { waves: infer W } ? W : never) : never, rules: Record<string, number | boolean> = {}, towerLimit = 2): LevelSpec {
  return testSpec("towerdefense", {
    env: { size: [8, 5], generator: "towerdefense", params: { towerTypes: [archer, cannon], towerLimit, baseHp: 3 } },
    opponent: { charter: "test", waves, rules },
    limits: { ticks: 30, llmCalls: 5, wallClockMs: 1 },
  });
}

function tdState(spec: LevelSpec): WorldState {
  return stateFromAscii(ROWS, {
    radius: 12,
    td: { phase: "build", waveIndex: 0, wavesTotal: spec.opponent!.waves.length, baseHp: 3, baseHpMax: 3, towersLeft: spec.env.params.towerLimit! },
  });
}

function run(spec: LevelSpec, s: WorldState, actions: Action[]) {
  let cur = s;
  const events: SimEvent[] = [];
  for (const a of actions) {
    const r = step(spec, cur, a);
    cur = r.state;
    events.push(...r.events);
  }
  return { state: cur, events, types: events.map((e) => e.type) };
}

describe("towerdefense", () => {
  it("recovers the route and rejects moves", () => {
    const spec = tdSpec([{ count: 1, enemyType: "grunt", hp: 1, speed: 1 }]);
    const s = tdState(spec);
    expect(enemyRoute(s).length).toBe(8);
    const r = step({ ...spec, actions: ["move", "place_tower", "start_wave", "wait", "say"] }, s, { type: "move", args: { dir: "east" } });
    expect(r.events[0].type).toBe("invalid_action");
    expect(r.state.agent.pos).toEqual(s.agent.pos);
  });

  it("place_tower validates slot, type, occupancy and limit", () => {
    const spec = tdSpec([{ count: 1, enemyType: "grunt", hp: 1, speed: 1 }], {}, 1);
    const s = tdState(spec);
    expect(step(spec, s, { type: "place_tower", args: { pos: [3, 2], towerType: "archer" } }).events[0]).toMatchObject({ type: "invalid_action", data: { reason: "not_buildable" } });
    expect(step(spec, s, { type: "place_tower", args: { pos: [3, 1], towerType: "laser" } }).events[0]).toMatchObject({ type: "invalid_action", data: { reason: "unknown_tower_type" } });
    const ok = step(spec, s, { type: "place_tower", args: { pos: [3, 1], towerType: "archer" } });
    expect(ok.events[0]).toMatchObject({ type: "tower_placed", data: { towersLeft: 0 } });
    const t = ok.state.entities.find((e) => e.kind === "tower")!;
    expect(t.visual.assetKey).toBe("td.tower.archer");
    expect(t.props).toMatchObject({ range: 2, damage: 1 });
    expect(step(spec, ok.state, { type: "place_tower", args: { pos: [3, 1], towerType: "archer" } }).events[0]).toMatchObject({ type: "invalid_action", data: { reason: "slot_occupied" } });
    expect(step(spec, ok.state, { type: "place_tower", args: { pos: [4, 1], towerType: "archer" } }).events[0].type).toBe("tower_limit");
  });

  it("no towers: every enemy leaks, base is destroyed, status lost", () => {
    const spec = tdSpec([{ count: 3, enemyType: "grunt", hp: 1, speed: 1 }]);
    const r = run(spec, tdState(spec), [{ type: "start_wave" }]);
    expect(r.types.filter((t) => t === "enemy_leaked").length).toBe(3);
    expect(r.types).toContain("base_destroyed");
    expect(r.state.status).toBe("lost");
    expect(r.state.td!.baseHp).toBe(0);
    expect(r.state.entities.some((e) => e.kind === "enemy")).toBe(false);
    const ended = r.events.find((e) => e.type === "wave_ended")!;
    expect(ended.data).toMatchObject({ spawned: 3, killed: 0, leaked: 3 });
    const trace = ended.data!.trace as { subTick: number; enemies: { id: string; pos: number[]; hp: number }[] }[];
    expect(trace.length).toBeGreaterThan(3);
    expect(trace[0].enemies[0].pos).toEqual([0, 2]);
  });

  it("towers kill enemies; all waves cleared -> won", () => {
    const spec = tdSpec(
      [
        { count: 2, enemyType: "grunt", hp: 2, speed: 1 },
        { count: 2, enemyType: "grunt", hp: 2, speed: 1 },
      ],
      {},
      2,
    );
    const r = run(spec, tdState(spec), [
      { type: "place_tower", args: { pos: [2, 1], towerType: "cannon" } },
      { type: "place_tower", args: { pos: [4, 3], towerType: "archer" } },
      { type: "start_wave" },
      { type: "start_wave" },
    ]);
    expect(r.types.filter((t) => t === "enemy_killed").length).toBe(4);
    expect(r.types.filter((t) => t === "enemy_leaked").length).toBe(0);
    expect(r.types).toContain("all_waves_cleared");
    expect(r.state.status).toBe("won");
    expect(r.state.td).toMatchObject({ phase: "done", waveIndex: 2, baseHp: 3, lastWave: { spawned: 2, killed: 2, leaked: 0 } });
    expect(step(spec, r.state, { type: "start_wave" }).events).toEqual([]);
  });

  it("a partial defence leaks some and keeps going", () => {
    const spec = tdSpec([{ count: 4, enemyType: "grunt", hp: 2, speed: 1 }, { count: 1, enemyType: "grunt", hp: 1, speed: 1 }]);
    const r = run(spec, tdState(spec), [{ type: "place_tower", args: { pos: [6, 1], towerType: "archer" } }, { type: "start_wave" }]);
    const ended = r.events.find((e) => e.type === "wave_ended")!.data!;
    expect(Number(ended.killed) + Number(ended.leaked)).toBe(4);
    expect(Number(ended.leaked)).toBeGreaterThan(0);
    expect(r.state.td!.baseHp).toBe(3 - Number(ended.leaked));
    expect(r.state.status).toBe(r.state.td!.baseHp > 0 ? "running" : "lost");
  });

  it("rules: onLeakBonus adds enemies after a leak; onNoLeakSwitch makes runners after a clean wave", () => {
    const waves = [
      { count: 1, enemyType: "grunt", hp: 1, speed: 1 },
      { count: 2, enemyType: "grunt", hp: 1, speed: 1 },
    ];
    const spec = tdSpec(waves, { onLeakBonus: 2, onNoLeakSwitch: true });
    const s = tdState(spec);
    expect(effectiveWave(spec, s.td!)).toEqual(waves[0]);
    expect(effectiveWave(spec, { ...s.td!, waveIndex: 1, lastWave: { spawned: 1, killed: 0, leaked: 1 } })).toEqual({ ...waves[1], count: 4 });
    expect(effectiveWave(spec, { ...s.td!, waveIndex: 1, lastWave: { spawned: 1, killed: 1, leaked: 0 } })).toEqual({ ...waves[1], enemyType: "runner", speed: 2 });

    // Integration: leak on wave 1 -> wave 2 spawns 4.
    const leaked = run(spec, s, [{ type: "start_wave" }, { type: "start_wave" }]);
    const w2 = leaked.events.filter((e) => e.type === "wave_started")[1];
    expect(w2.data).toMatchObject({ count: 4, enemyType: "grunt" });
    // Clean wave 1 -> runners with speed 2.
    const clean = run(spec, s, [{ type: "place_tower", args: { pos: [1, 1], towerType: "cannon" } }, { type: "start_wave" }, { type: "start_wave" }]);
    const w2c = clean.events.filter((e) => e.type === "wave_started")[1];
    expect(w2c.data).toMatchObject({ count: 2, enemyType: "runner", speed: 2 });
  });
});
