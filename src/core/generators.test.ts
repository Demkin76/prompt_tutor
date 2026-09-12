import { describe, expect, it } from "vitest";
import { ALL_LEVELS, TIERS, getLevel, getTier, listTiers, MODES } from "./levels";
import { generateLevel } from "./generators/index";
import { enemyRoute } from "./generators/towerdefense";
import { bfs, floodFill, idx, minCostPath, tileAt } from "./grid";
import type { Vec, WorldState } from "./types";

function altarPos(s: WorldState): Vec {
  const i = s.tiles.indexOf("altar");
  return [i % s.size[0], Math.floor(i / s.size[0])];
}

describe("level catalogue", () => {
  it("preserves 27 existing levels and adds three Keymaster worlds", () => {
    expect(TIERS.length).toBe(10);
    expect(ALL_LEVELS.length).toBe(30);
    for (const t of TIERS) expect(t.levels.length).toBe(3);
    expect(new Set(ALL_LEVELS.map((l) => l.id)).size).toBe(30);
    expect(new Set(ALL_LEVELS.map((l) => l.seed)).size).toBe(30);
    for (const m of MODES) expect(listTiers(m.id).length).toBe(m.id === "keymaster" ? 1 : 3);
    expect(getTier("maze", 2)?.levels[0].id).toBe("maze-t2-l1");
    expect(getLevel("redfloor-t3-l3")?.tier).toBe(3);
  });

  it("budgets and limits escalate per tier", () => {
    for (const l of ALL_LEVELS.filter(l => l.mode !== "keymaster")) {
      expect(l.promptBudget).toBe([200, 300, 400][l.tier - 1]);
      expect(l.limits.ticks).toBe([80, 140, 200][l.tier - 1]);
      expect(l.limits.llmCalls).toBe([15, 25, 40][l.tier - 1]);
      if (l.mode === "towerdefense") expect(l.opponent?.charter.length).toBeGreaterThan(20);
    }
  });
});

describe("generateLevel", () => {
  it("is deterministic (same seed -> deep-equal)", () => {
    for (const l of ALL_LEVELS) {
      expect(generateLevel(l)).toEqual(generateLevel(l));
    }
  });

  it("changes with the seed", () => {
    const l = getLevel("redfloor-t2-l1")!;
    const a = generateLevel(l);
    const b = generateLevel({ ...l, seed: l.seed + 1 });
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("gives every entity an assetKey and includes the golem", () => {
    for (const l of ALL_LEVELS) {
      const s = generateLevel(l);
      const golem = s.entities.find((e) => e.id === "golem");
      expect(golem?.visual.assetKey).toBe("unit.golem");
      expect(golem?.pos).toEqual(s.agent.pos);
      for (const e of s.entities) expect(e.visual.assetKey).toMatch(/^(unit|item|obj|td)\./);
      expect(s.seen.length).toBeGreaterThan(0);
      expect(s.seen).toContain(idx(s.size, s.agent.pos));
      expect(s.status).toBe("running");
      expect(s.tick).toBe(0);
    }
  });

  it("maze: start [1,1], altar at far corner, BFS path exists", () => {
    for (const l of ALL_LEVELS.filter((x) => x.mode === "maze")) {
      const s = generateLevel(l);
      expect(s.agent.pos).toEqual([1, 1]);
      expect(altarPos(s)).toEqual([s.size[0] - 2, s.size[1] - 2]);
      const path = bfs(s.size, (p) => tileAt(s, p) !== "wall", s.agent.pos, altarPos(s));
      expect(path).not.toBeNull();
      expect(s.tiles.filter((t) => t === "hazard").length).toBe(0);
    }
  });

  it("redfloor: guarantee holds (safe path or planks suffice; tools reachable safely)", () => {
    for (const l of ALL_LEVELS.filter((x) => x.mode === "redfloor")) {
      const s = generateLevel(l);
      const planks = l.env.params.planks ?? 0;
      const crateAt = (p: Vec) => s.entities.some((e) => e.kind === "crate" && e.pos[0] === p[0] && e.pos[1] === p[1]);
      const passable = (p: Vec) => tileAt(s, p) !== "wall" && !crateAt(p);
      const safe = (p: Vec) => passable(p) && tileAt(s, p) !== "hazard";
      const need = minCostPath(s.size, passable, (p) => tileAt(s, p) === "hazard", s.agent.pos, altarPos(s));
      expect(need).toBeLessThanOrEqual(planks);
      if (planks === 0) expect(bfs(s.size, safe, s.agent.pos, altarPos(s))).not.toBeNull();
      const R = floodFill(s.size, safe, s.agent.pos);
      for (const e of s.entities) {
        if (e.kind === "plank" || e.kind === "key" || e.kind === "lever") expect(R.has(idx(s.size, e.pos))).toBe(true);
      }
      expect(s.entities.filter((e) => e.kind === "plank").length).toBe(planks);
      expect(s.entities.filter((e) => e.kind === "key").length).toBe(Math.min(1, l.env.params.keys ?? 0));
      expect(s.entities.filter((e) => e.kind === "lever").length).toBe(Math.min(1, l.env.params.levers ?? 0));
      expect(s.entities.filter((e) => e.kind === "crate").length).toBe(l.env.params.crates ?? 0);
      if (l.tier >= 2) expect(s.tiles.filter((t) => t === "hazard").length).toBeGreaterThan(5);
    }
  });

  it("redfloor: key door is locked and lever door is lever-controlled", () => {
    const s = generateLevel(getLevel("redfloor-t3-l2")!);
    const doors = s.entities.filter((e) => e.kind === "door");
    expect(doors.length).toBe(2);
    expect(doors[0].props.locked).toBe(true);
    expect(doors[1].props.locked).toBe(false);
    expect(doors[1].props.controlledBy).toBe("lever-1");
    const lever = s.entities.find((e) => e.kind === "lever")!;
    expect(lever.props.targetId).toBe(doors[1].id);
  });

  it("towerdefense: route spawn -> base, buildable slots >= towerLimit, base entity, td state", () => {
    for (const l of ALL_LEVELS.filter((x) => x.mode === "towerdefense")) {
      const s = generateLevel(l);
      const route = enemyRoute(s);
      expect(route.length).toBeGreaterThan(12);
      expect(tileAt(s, route[0])).toBe("spawn");
      expect(tileAt(s, route[route.length - 1])).toBe("base");
      expect(s.tiles.filter((t) => t === "buildable").length).toBeGreaterThanOrEqual(l.env.params.towerLimit!);
      expect(s.entities.find((e) => e.kind === "base")?.visual.assetKey).toBe("td.base");
      expect(s.td).toMatchObject({ phase: "build", waveIndex: 0, wavesTotal: l.opponent!.waves.length, towersLeft: l.env.params.towerLimit });
      expect(tileAt(s, s.agent.pos)).toBe("floor");
      expect(s.seen.length).toBe(s.tiles.length);
    }
  });
});
