import { describe, expect, it } from "vitest";
import { ALL_LEVELS, getLevel } from "./levels";
import { generateLevel } from "./generators/index";
import { step } from "./sim";
import { verify } from "./verify";
import { bfs, dirTo, isSafeWalkable, manhattan, minCostPath, tileAt } from "./grid";
import { enemyRoute } from "./generators/towerdefense";
import type { Action, LevelSpec, SimEvent, Vec, WorldState } from "./types";

function altarPos(s: WorldState): Vec {
  const i = s.tiles.indexOf("altar");
  return [i % s.size[0], Math.floor(i / s.size[0])];
}

/** Walk the BFS path over safe tiles through the real sim and return the trace. */
function walk(spec: LevelSpec, s: WorldState) {
  const path = bfs(s.size, (p) => isSafeWalkable(s, p), s.agent.pos, altarPos(s));
  expect(path, `${spec.id}: no safe path`).not.toBeNull();
  let cur = s;
  const events: SimEvent[] = [];
  for (let i = 1; i < path!.length; i++) {
    const dir = dirTo(path![i - 1], path![i])!;
    const r = step(spec, cur, { type: "move", args: { dir } });
    cur = r.state;
    events.push(...r.events);
  }
  return { state: cur, events, path: path! };
}

describe("scripted solver", () => {
  it("solves every tier-1 nav level (maze + redfloor) with a BFS over safe tiles inside the tick budget", () => {
    for (const lvl of ALL_LEVELS.filter((l) => l.mode !== "towerdefense" && l.tier === 1)) {
      const s = generateLevel(lvl);
      const { state, events, path } = walk(lvl, s);
      expect(path.length - 1, `${lvl.id} path ${path.length - 1} > ticks ${lvl.limits.ticks}`).toBeLessThanOrEqual(lvl.limits.ticks);
      expect(state.status, lvl.id).toBe("won");
      const v = verify(lvl, s, state, events);
      expect(v.passed, lvl.id).toBe(true);
    }
  });

  it("solves every maze tier (no items needed) within the tick budget", () => {
    for (const lvl of ALL_LEVELS.filter((l) => l.mode === "maze")) {
      const s = generateLevel(lvl);
      const { state, path } = walk(lvl, s);
      expect(path.length - 1, lvl.id).toBeLessThanOrEqual(lvl.limits.ticks);
      expect(state.status, lvl.id).toBe("won");
    }
  });

  it("redfloor tiers 2-3: minimal hazard crossings fit the planks and the route fits the tick budget", () => {
    for (const lvl of ALL_LEVELS.filter((l) => l.mode === "redfloor" && l.tier >= 2)) {
      const s = generateLevel(lvl);
      const crateAt = (p: Vec) => s.entities.some((e) => e.kind === "crate" && e.pos[0] === p[0] && e.pos[1] === p[1]);
      const passable = (p: Vec) => tileAt(s, p) !== "wall" && !crateAt(p);
      const need = minCostPath(s.size, passable, (p) => tileAt(s, p) === "hazard", s.agent.pos, altarPos(s));
      expect(need, lvl.id).toBeLessThanOrEqual(lvl.env.params.planks ?? 0);
      // Rough budget sanity: manhattan distance plus room for detours fits the ticks.
      expect(manhattan(s.agent.pos, altarPos(s)) * 3, lvl.id).toBeLessThanOrEqual(lvl.limits.ticks);
    }
  });

  it("tower defense tier 1 is winnable with a greedy coverage placement", () => {
    const lvl = getLevel("towerdefense-t1-l1")!;
    const s = generateLevel(lvl);
    const route = enemyRoute(s);
    const tower = lvl.env.params.towerTypes![0];
    // Rank buildable slots by how many route tiles they cover.
    const slots: { pos: Vec; cover: number }[] = [];
    for (let i = 0; i < s.tiles.length; i++) {
      if (s.tiles[i] !== "buildable") continue;
      const pos: Vec = [i % s.size[0], Math.floor(i / s.size[0])];
      slots.push({ pos, cover: route.filter((r) => manhattan(r, pos) <= tower.range).length });
    }
    slots.sort((a, b) => b.cover - a.cover);
    const actions: Action[] = slots.slice(0, lvl.env.params.towerLimit!).map((sl) => ({ type: "place_tower", args: { pos: sl.pos, towerType: tower.id } }));
    for (let i = 0; i < lvl.opponent!.waves.length; i++) actions.push({ type: "start_wave" });
    let cur = s;
    const events: SimEvent[] = [];
    for (const a of actions) {
      const r = step(lvl, cur, a);
      cur = r.state;
      events.push(...r.events);
    }
    expect(cur.status).toBe("won");
    expect(verify(lvl, s, cur, events).passed).toBe(true);
  });
});
