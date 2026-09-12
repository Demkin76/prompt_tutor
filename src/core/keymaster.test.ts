import { describe, expect, it } from "vitest";
import { pickApprovedSeed } from "./approve";
import { getTier } from "./levels";
import { generateLevel } from "./generators";
import { bfs, chebyshev, dirTo, isWalkable, manhattan, samePos, tileAt } from "./grid";
import { step } from "./sim";
import { verify } from "./verify";
import { buildObservation, emptyMemory, updateMemory } from "./observation";
import { stateFromAscii } from "./testutil";
import { runLevel, runTier } from "../runtime/episode";
import { createFakeLlm } from "../runtime/llm";
import { keymasterDemoDecision } from "../runtime/keymaster-demo";
import { parseDecision } from "../runtime/decision";
import type { Action, Replay, RunnerMessage, SimEvent, Vec, WorldState } from "./types";

const tier = getTier("keymaster", 1)!;
const spec = tier.levels[0];
const charter = "Исследуй окружение. Подбирай полезные предметы и используй их для устранения препятствий. После открытия пути двигайся к выходу.";
const sink = { async push(_m: RunnerMessage) {} };
function small(rows: string[]): WorldState {
  return { ...stateFromAscii(rows, { radius: 3 }), keymaster: { key: "world", altar: "idle", recentStates: [] } };
}
const east: Action = { type: "move", args: { dir: "east" } };
const interact: Action = { type: "interact", args: { dir: "east" } };

describe("Keymaster contracts", () => {
  it.each(tier.levels)("$id: key reachable, altar inaccessible until gate opens", l => {
    const s = generateLevel(l);
    const key = s.entities.find(e => e.kind === "key")!;
    const door = s.entities.find(e => e.kind === "door")!;
    const i = s.tiles.indexOf("altar");
    const altar: Vec = [i % 16, Math.floor(i / 16)];
    expect(s.size).toEqual([16, 16]);
    expect(manhattan(s.agent.pos, key.pos)).toBeGreaterThan(1);
    expect(bfs(s.size, p => isWalkable(s, p), s.agent.pos, key.pos)).not.toBeNull();
    expect(bfs(s.size, p => isWalkable(s, p), s.agent.pos, altar)).toBeNull();
    const open = structuredClone(s);
    open.entities.find(e => e.id === door.id)!.props.open = true;
    expect(bfs(open.size, p => isWalkable(open, p), open.agent.pos, altar)).not.toBeNull();
    expect(s.tiles).not.toContain("hazard");
  });

  it("keeps the three seeds distinct and exposes the door early only in B", () => {
    const states = tier.levels.map(generateLevel);
    expect(new Set(states.map(s => JSON.stringify([s.agent.pos, s.entities]))).size).toBe(3);
    expect(chebyshev(states[1].agent.pos, states[1].entities.find(e => e.kind === "door")!.pos)).toBeLessThanOrEqual(3);
    expect(chebyshev(states[0].agent.pos, states[0].entities.find(e => e.kind === "door")!.pos)).toBeGreaterThan(3);
  });

  it("requires explicit pickup, consumes the key once and changes collision/visuals", () => {
    const initial = small(["@kDA"]);
    let r = step(spec, initial, east);
    expect(r.state.agent.inventory).toEqual([]);
    expect(r.state.entities.some(e => e.kind === "key")).toBe(true);
    r = step(spec, r.state, east);
    expect(r.events[0].type).toBe("blocked");
    r = step(spec, r.state, interact);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "interaction_failed", data: { reason: "missing_key", id: "door-1" } }));
    r = step(spec, r.state, { type: "pickup" });
    expect(r.state.agent.inventory).toEqual(["key"]);
    expect(r.state.keymaster?.key).toBe("inventory");
    r = step(spec, r.state, interact);
    expect(r.events.map(e => e.type)).toEqual(["key_consumed", "door_unlocked", "door_opened"]);
    expect(r.state.agent.inventory).toEqual([]);
    expect(r.state.keymaster?.key).toBe("consumed");
    expect(r.state.entities.find(e => e.kind === "door")?.visual.assetKey).toBe("obj.door.open");
    r = step(spec, r.state, east);
    expect(r.state.agent.pos).toEqual([2, 0]);
    r = step(spec, r.state, east);
    expect(r.state.status).toBe("won");
    expect(r.state.keymaster?.altar).toBe("active");
    expect(initial.agent.pos).toEqual([0, 0]);
  });

  it("supports adjacent pickup and inspect without hidden information or state changes", () => {
    const initial = small(["@kDA"]);
    const inspected = step(spec, initial, { type: "inspect", args: { dir: "east" } });
    expect(inspected.events[0]).toMatchObject({ type: "inspected", data: { kind: "key" } });
    expect(inspected.state.agent.inventory).toEqual([]);
    const picked = step(spec, initial, { type: "pickup" });
    expect(picked.state.agent.inventory).toEqual(["key"]);
    expect(step(spec, picked.state, { type: "pickup" }).events[0].type).toBe("invalid_action");
    expect(parseDecision(JSON.stringify({ intent: "inspect", plan: [{ type: "inspect", args: { dir: "east" } }], stopOn: [] }), spec).plan[0].type).toBe("inspect");
  });

  it("remembers discovered door state, visited tiles and blocked routes beyond event history", () => {
    let state = small(["@D..........A", ".k..........."]);
    let memory = updateMemory(emptyMemory(), spec, state, []);
    const apply = (action: Action) => {
      const r = step(spec, state, action); state = r.state;
      memory = updateMemory(memory, spec, state, r.events);
    };
    apply(east);
    expect(memory.blockedRoutes).toContainEqual({ pos: [1, 0], by: "closed_door" });
    apply({ type: "move", args: { dir: "south" } }); apply({ type: "pickup" });
    apply({ type: "move", args: { dir: "north" } }); apply(interact);
    expect(memory.blockedRoutes).toEqual([]);
    for (let n = 0; n < 7; n++) apply(east);
    const obs = buildObservation(spec, state, memory, { ticksLeft: 100, callsLeft: 30 }, "test");
    expect(obs.visible.entities.some(e => e.kind === "door")).toBe(false);
    expect(memory.knownLandmarks.find(e => e.kind === "door")?.props?.open).toBe(true);
    expect(memory.visited).toContainEqual([0, 0]);
    expect(memory.recentEvents.length).toBeLessThanOrEqual(25);
    expect(memory.knownTiles!.length).toBeLessThanOrEqual(state.tiles.length);
  });

  it("ends repeated states deterministically, but allows legitimate backtracking", () => {
    let s = small(["@....A"]);
    for (let i = 0; i < 8; i++) s = step(spec, s, { type: "wait" }).state;
    expect(s.status).toBe("lost");
    expect(s.entities.find(e => e.kind === "golem")!.visual.animation).toBe("fail");
    expect(step(spec, s, east).state).toEqual(s);
  });

  it("enforces tick budget", () => {
    const r = step({ ...spec, limits: { ...spec.limits, ticks: 1 } }, small(["@....A"]), east);
    expect(r.state.status).toBe("out_of_budget");
    expect(r.events.some(e => e.type === "budget_exhausted")).toBe(true);
  });
});

describe("Keymaster full runtime", () => {
  it("random production seeds preserve all three layouts and still pass the runtime", async () => {
    for (const value of [0, 0.5, 0.9999999999]) {
      const initial: WorldState[] = [];
      const summary = await runTier({ runId: "random-km", tier, charter, sink,
        llm: createFakeLlm(keymasterDemoDecision),
        pickSeed: l => {
          const picked = pickApprovedSeed(l, () => value);
          expect(picked.approval.ok).toBe(true);
          expect(picked.seed).toBeGreaterThan(0);
          expect(picked.seed).toBeLessThanOrEqual(0x7fffffff);
          const state = generateLevel({ ...l, seed: picked.seed });
          expect(state.agent.pos).toEqual(generateLevel(l).agent.pos);
          initial.push(state);
          return picked.seed;
        },
      });
      expect(new Set(initial.map(s => JSON.stringify(s.agent.pos))).size).toBe(3);
      expect(summary.passedLevels).toBe(3);
    }
  });

  it("solves all hidden maps with one observation-only policy and replays every state/event exactly", async () => {
    const messages: RunnerMessage[] = [];
    const summary = await runTier({ runId: "km", tier, charter, llm: createFakeLlm((obs, actualCharter) => {
      expect(actualCharter).toBe(charter);
      expect(obs.visible.tiles.every(t => chebyshev(t.pos, obs.self.pos) <= 3)).toBe(true);
      return keymasterDemoDecision(obs);
    }), sink: { async push(m) { messages.push(m); } } });
    expect(summary.passedLevels).toBe(3);
    expect(summary.score).toBe(summary.levels.reduce((s, r) => s + r.levelScore, 0) + 100);
    for (const message of messages) {
      if (message.kind !== "level_end") continue;
      const replay = message.replay;
      const l = tier.levels.find(s => s.id === replay.levelId)!;
      let state = replay.initialState;
      const events: SimEvent[] = [];
      for (const recorded of replay.actions) {
        expect(state.tick).toBe(recorded.tick);
        const r = step(l, state, recorded.action); state = r.state; events.push(...r.events);
        const frame = messages.find(m => m.kind === "frame" && m.frame.levelId === l.id && m.frame.tick === state.tick);
        expect(frame && frame.kind === "frame" && frame.frame.state).toEqual(state);
      }
      expect(state).toEqual(replay.finalState);
      expect(events).toEqual(replay.events);
      expect(verify(l, replay.initialState, state, events)).toEqual(replay.verdict);
      expect(replay.verdict.confidence).toBe(1);
      expect(message.result.ticks).toBeLessThanOrEqual(120);
      expect(message.result.llmCalls).toBeLessThan(message.result.ticks);
      // Missing, reordered and forged completion evidence must never pass.
      expect(verify(l, replay.initialState, state, events.filter(e => e.type !== "item_collected")).passed).toBe(false);
      expect(verify(l, replay.initialState, { ...state, agent: { ...state.agent, pos: [0, 0] } }, events).passed).toBe(false);
      const reordered = events.map(e => e.type === "item_collected" ? { ...e, tick: state.tick + 1 } : e);
      expect(verify(l, replay.initialState, state, reordered).passed).toBe(false);
    }
  });

  it("a rigid route copied from seed A cannot pass all seeds", async () => {
    const reference = await runLevel({ runId: "ref", spec, charter, llm: createFakeLlm(keymasterDemoDecision), sink });
    let passed = 0;
    for (const l of tier.levels) {
      let state = generateLevel(l); const initial = state; const events: SimEvent[] = [];
      for (const { action } of reference.replay.actions) {
        const r = step(l, state, action); state = r.state; events.push(...r.events);
      }
      if (verify(l, initial, state, events).passed) passed++;
    }
    expect(passed).toBe(1);
  });

  it("exploration without pickup cannot complete the mission", async () => {
    const result = await runLevel({ runId: "bad", spec, charter: "Просто иди к выходу", sink,
      llm: createFakeLlm(obs => {
        const decision = keymasterDemoDecision(obs);
        return { ...decision, plan: decision.plan.map(a => a.type === "pickup" ? { type: "wait" } : a) };
      }),
    });
    expect(result.result.verdict.passed).toBe(false);
    expect(result.result.verdict.reasons.join(" ")).toContain("не подобрал ключ");
  });
});
