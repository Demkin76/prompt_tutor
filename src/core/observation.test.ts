import { describe, expect, it } from "vitest";
import { ASCII_LEGEND, buildObservation, detectTriggers, emptyMemory, updateMemory } from "./observation";
import { step } from "./sim";
import { stateFromAscii, testSpec } from "./testutil";
import { generateLevel } from "./generators/index";
import { getLevel } from "./levels";

describe("observation", () => {
  const spec = testSpec("redfloor", { observation: { radius: 1, memoryTicks: 3 } });

  it("shows only tiles within the radius, agent centred, ? outside the grid", () => {
    const s = stateFromAscii(["@pR", "..A", "#.."], { radius: 1 });
    const obs = buildObservation(spec, s, emptyMemory(), { ticksLeft: 5, callsLeft: 2 }, "run1");
    expect(obs.asciiView).toBe("???\n?@p\n?..");
    expect(obs.visible.tiles.length).toBe(4);
    expect(obs.visible.entities.map((e) => e.kind)).toEqual(["plank"]);
    expect(obs.self).toEqual({ pos: [0, 0], facing: "east", inventory: [] });
    expect(obs.budget).toEqual({ ticksLeft: 5, callsLeft: 2 });
    expect(obs.levelId).toBe(spec.id);
    expect(obs.td).toBeUndefined();
    expect(ASCII_LEGEND).toContain("R red hazard");
  });

  it("renders every glyph", () => {
    const s = stateFromAscii(["#.R=A", "@pkDd", "LC..."], { radius: 5 });
    const wide = testSpec("redfloor", { observation: { radius: 2, memoryTicks: 3 } });
    const obs = buildObservation(wide, { ...s, agent: { ...s.agent, pos: [2, 1] } }, emptyMemory(), { ticksLeft: 1, callsLeft: 1 }, "r");
    expect(obs.asciiView.split("\n")).toEqual(["?????", "#.R=A", "@pkDd", "LC...", "?????"]);
  });

  it("tower defense shows the full arena and the td block", () => {
    const lvl = getLevel("towerdefense-t1-l1")!;
    const s = generateLevel(lvl);
    const obs = buildObservation(lvl, s, emptyMemory(), { ticksLeft: 9, callsLeft: 9 }, "r");
    expect(obs.asciiView.split("\n").length).toBe(12);
    expect(obs.asciiView).toContain("S");
    expect(obs.asciiView).toContain("B");
    expect(obs.td!.buildableSlots.length).toBe(s.tiles.filter((t) => t === "buildable").length);
    expect(obs.td!.towerTypes.map((t) => t.id)).toEqual(["archer"]);
    expect(obs.td!.opponentCharter).toBe(lvl.opponent!.charter);
    expect(obs.visible.tiles.length).toBe(144);
  });

  it("memory accumulates landmarks, recent events (bounded), marks and visitedCount", () => {
    const s = stateFromAscii(["@..p", "....", "...A"], { radius: 1 });
    let mem = updateMemory(emptyMemory(), spec, s, []);
    expect(mem.knownLandmarks).toEqual([]);
    let cur = s;
    const acts = ["east", "east", "east"] as const;
    for (const d of acts) {
      const r = step(spec, cur, { type: "move", args: { dir: d } });
      cur = r.state;
      mem = updateMemory(mem, spec, cur, r.events);
    }
    expect(mem.knownLandmarks).toContainEqual({ kind: "plank", pos: [3, 0] });
    expect(mem.visitedCount).toBe(3);
    expect(mem.recentEvents.length).toBe(3);
    expect(mem.recentEvents[0]).toBe("t1 moved east to [1,0]");
    const r = step(spec, cur, { type: "say", args: { text: "mark: plank here" } });
    mem = updateMemory(mem, spec, r.state, r.events);
    expect(mem.marks).toEqual([{ pos: [3, 0], note: "plank here" }]);
    expect(mem.recentEvents.length).toBe(3);
    const pick = step(spec, r.state, { type: "pickup" });
    mem = updateMemory(mem, spec, pick.state, pick.events);
    expect(mem.knownLandmarks.some((l) => l.kind === "plank")).toBe(false);
    // altar becomes a landmark when it comes into view
    const down = step(spec, pick.state, { type: "move", args: { dir: "south" } });
    mem = updateMemory(mem, spec, down.state, down.events);
    expect(mem.knownLandmarks).toContainEqual({ kind: "altar", pos: [3, 2] });
  });

  it("detectTriggers fires on new entity, blocked, hazard, goal and item", () => {
    const s = stateFromAscii(["@..k.", "...R.", "....A"], { radius: 1 });
    const r1 = step(spec, s, { type: "move", args: { dir: "east" } });
    expect(detectTriggers(spec, s, r1.state, r1.events)).toEqual([]);
    const r2 = step(spec, r1.state, { type: "move", args: { dir: "east" } });
    expect(detectTriggers(spec, r1.state, r2.state, r2.events)).toEqual(["new_entity", "hazard_detected", "item_visible"]);
    const r3 = step(spec, r2.state, { type: "move", args: { dir: "north" } });
    expect(detectTriggers(spec, r2.state, r3.state, r3.events)).toEqual(["blocked"]);
    const r4 = step(spec, r2.state, { type: "move", args: { dir: "east" } });
    const r5 = step(spec, r4.state, { type: "move", args: { dir: "east" } });
    const r6 = step(spec, r5.state, { type: "move", args: { dir: "south" } });
    expect(detectTriggers(spec, r5.state, r6.state, r6.events)).toEqual(["goal_visible"]);
  });
});
