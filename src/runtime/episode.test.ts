import { describe, expect, it } from "vitest";
import type { AgentDecision, LlmClient, LlmRequest, RunnerMessage, Sink, TierSpec } from "@core/types";
import { runLevel, runTier } from "./episode";
import { createFakeLlm } from "./llm";
import { createArraySink } from "./sink";
import { makeCorridorEngine, makeSpec } from "./testkit";
import { getTier } from "../core/levels";
import { MARKET_STRATEGY_JSON_SCHEMA } from "./marketCompiler";

const eastx3: AgentDecision = {
  intent: "March east",
  plan: [
    { type: "move", args: { dir: "east" } },
    { type: "move", args: { dir: "east" } },
    { type: "move", args: { dir: "east" } },
  ],
  stopOn: ["plan_done"],
};

function kinds(msgs: RunnerMessage[]): string[] {
  return msgs.map((m) => m.kind);
}

/** LLM that replies with a scripted sequence of raw texts, then repeats the last one. */
function scriptedLlm(texts: string[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      const i = Math.min(requests.length - 1, texts.length - 1);
      return { text: texts[i], latencyMs: 7 };
    },
  };
}

describe("runLevel", () => {
  it("streams level_start, decision, frames, level_end and wins the corridor", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    let llmCalls = 0;
    const llm = createFakeLlm(() => {
      llmCalls++;
      return eastx3;
    });
    const spec = makeSpec();
    const { result, replay } = await runLevel({ runId: "run-1", spec, charter: "Go east until you reach the altar.", llm, sink, engine });

    // 3 moves -> x=3, plan done; 1 more move -> x=4 altar -> won.
    expect(llmCalls).toBe(2);
    expect(result.llmCalls).toBe(2);
    expect(result.ticks).toBe(4);
    expect(result.verdict.passed).toBe(true);
    expect(result.levelScore).toBeGreaterThan(0);
    expect(result.levelId).toBe(spec.id);
    expect(result.charterLength).toBe("Go east until you reach the altar.".length);

    expect(kinds(sink.messages)).toEqual([
      "level_start",
      "decision",
      "frame",
      "frame",
      "frame",
      "decision",
      "frame",
      "level_end",
    ]);

    // replay consistency
    expect(replay.actions.length).toBe(4);
    expect(replay.actions.length).toBe(sink.messages.filter((m) => m.kind === "frame").length);
    expect(replay.decisions.length).toBe(2);
    expect(replay.decisions.map((d) => d.tick)).toEqual([0, 3]);
    expect(replay.actions.map((a) => a.tick)).toEqual([0, 1, 2, 3]);
    expect(replay.initialState.agent.pos).toEqual([0, 0]);
    expect(replay.finalState.agent.pos).toEqual([4, 0]);
    expect(replay.finalState.status).toBe("won");
    expect(replay.events.map((e) => e.type)).toEqual(["moved", "moved", "moved", "moved", "goal_reached"]);
    expect(replay.charter).toBe("Go east until you reach the altar.");

    const first = sink.messages[0];
    expect(first.kind === "level_start" && first.initialState).toEqual(replay.initialState);
    const last = sink.messages[sink.messages.length - 1];
    expect(last.kind === "level_end" && last.replay.verdict.passed).toBe(true);
    const frames = sink.messages.filter((m) => m.kind === "frame");
    expect(frames.map((f) => f.kind === "frame" && f.frame.tick)).toEqual([1, 2, 3, 4]);
    expect(frames[0].kind === "frame" && frames[0].frame.state.tick).toBe(1);
  });

  it("passes the charter and observation to the LLM and honours budget counters", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const seen: { charter: string; tick: number; callsLeft: number; ticksLeft: number }[] = [];
    const llm = createFakeLlm((obs, charter) => {
      seen.push({ charter, tick: obs.tick, callsLeft: obs.budget.callsLeft, ticksLeft: obs.budget.ticksLeft });
      return eastx3;
    });
    const spec = makeSpec({ limits: { ticks: 20, llmCalls: 5, wallClockMs: 60_000 } });
    await runLevel({ runId: "r", spec, charter: "Hurry.", llm, sink, engine });
    expect(seen).toEqual([
      { charter: "Hurry.", tick: 0, callsLeft: 5, ticksLeft: 20 },
      { charter: "Hurry.", tick: 3, callsLeft: 4, ticksLeft: 17 },
    ]);
  });

  it("interrupts the plan on stopOn triggers (goal_visible) and on blocked events", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const llm = createFakeLlm(() => ({ ...eastx3, stopOn: ["goal_visible"] }));
    // radius 1: the altar (x=4) becomes visible when the agent reaches x=3.
    await runLevel({ runId: "r", spec: makeSpec(), charter: "", llm, sink, engine });
    // Same frame count as before (x=3 is also the end of the plan) — now use a plan of 5 to see the cut.
    const engine2 = makeCorridorEngine();
    const sink2 = createArraySink();
    const five: AgentDecision = { intent: "5 east", plan: Array(5).fill({ type: "move", args: { dir: "east" } }), stopOn: ["goal_visible"] };
    const { replay } = await runLevel({ runId: "r", spec: makeSpec(), charter: "", llm: createFakeLlm(() => five), sink: sink2, engine: engine2 });
    // decision 1: moves to 1,2,3 -> goal_visible -> interrupted; decision 2: move to 4 -> won.
    expect(replay.decisions.map((d) => d.tick)).toEqual([0, 3]);
    expect(replay.actions.length).toBe(4);

    // blocked: walk west from x=0 with a 3-step plan; each blocked move clears the queue.
    const engine3 = makeCorridorEngine();
    const sink3 = createArraySink();
    const west: AgentDecision = { intent: "west", plan: Array(3).fill({ type: "move", args: { dir: "west" } }), stopOn: [] };
    const spec3 = makeSpec({ limits: { ticks: 20, llmCalls: 2, wallClockMs: 60_000 } });
    const out = await runLevel({ runId: "r", spec: spec3, charter: "", llm: createFakeLlm(() => west), sink: sink3, engine: engine3 });
    expect(out.replay.actions.length).toBe(2); // 2 calls, each plan cut after its first blocked move
    expect(out.replay.events.map((e) => e.type)).toEqual(["blocked", "blocked"]);
    expect(out.result.verdict.passed).toBe(false);
  });

  it("retries once on an invalid reply, then falls back to wait with error recorded", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const valid = JSON.stringify(eastx3);
    const llm = scriptedLlm(["this is not json", '{"intent":"bad","plan":[{"type":"fly"}]}', valid, valid]);
    const { result, replay } = await runLevel({ runId: "r", spec: makeSpec(), charter: "c", llm, sink, engine });

    // call 1 invalid, call 2 (retry) invalid -> wait; call 3 east x3; call 4 east -> win.
    expect(llm.requests.length).toBe(4);
    expect(result.llmCalls).toBe(4);
    expect(llm.requests[1].user).toContain("Your previous reply was invalid: invalid decision: reply is not valid JSON");
    expect(llm.requests[1].user).toContain("Reply with valid JSON only.");
    expect(llm.requests[1].user.startsWith(llm.requests[0].user)).toBe(true);
    expect(llm.requests[2].user).not.toContain("Your previous reply was invalid");

    expect(replay.decisions.length).toBe(3);
    expect(replay.decisions[0].error).toMatch(/"fly" is not allowed/);
    expect(replay.decisions[0].plan).toEqual([{ type: "wait" }]);
    expect(replay.decisions[0].latencyMs).toBeGreaterThanOrEqual(14);
    expect(replay.decisions[1].error).toBeUndefined();
    expect(replay.actions[0].action).toEqual({ type: "wait" });
    expect(replay.actions.length).toBe(5);
    expect(result.ticks).toBe(5);
    expect(result.verdict.passed).toBe(true);

    const decisionMsgs = sink.messages.filter((m) => m.kind === "decision");
    expect(decisionMsgs.length).toBe(3);
    expect(decisionMsgs[0].kind === "decision" && decisionMsgs[0].record.error).toBeDefined();
  });

  it("treats an LLM transport error like an invalid reply (retry, then wait)", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    let n = 0;
    const llm: LlmClient = {
      async complete() {
        n++;
        if (n <= 2) throw new Error("boom");
        return { text: JSON.stringify(eastx3), latencyMs: 1 };
      },
    };
    const { replay } = await runLevel({ runId: "r", spec: makeSpec(), charter: "", llm, sink, engine });
    expect(replay.decisions[0].error).toBe("llm error: boom");
    expect(replay.decisions[0].plan).toEqual([{ type: "wait" }]);
    expect(replay.finalState.status).toBe("won");
  });

  it("stops with out_of_budget when LLM calls are exhausted", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const one: AgentDecision = { intent: "one step", plan: [{ type: "move", args: { dir: "east" } }], stopOn: [] };
    const spec = makeSpec({ limits: { ticks: 20, llmCalls: 2, wallClockMs: 60_000 } });
    const { result, replay } = await runLevel({ runId: "r", spec, charter: "", llm: createFakeLlm(() => one), sink, engine });
    expect(result.llmCalls).toBe(2);
    expect(replay.actions.length).toBe(2);
    expect(replay.finalState.status).toBe("out_of_budget");
    expect(replay.finalState.agent.pos).toEqual([2, 0]);
    expect(result.verdict.passed).toBe(false);
    expect(result.levelScore).toBe(0);
    expect(kinds(sink.messages)).toEqual(["level_start", "decision", "frame", "decision", "frame", "level_end"]);
  });

  it("does not retry past the remaining LLM call budget", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const spec = makeSpec({ limits: { ticks: 20, llmCalls: 1, wallClockMs: 60000 } });
    const { result } = await runLevel({ runId: "r", spec, charter: "", engine, sink,
      llm: { async complete() { return { text: "invalid", latencyMs: 0 }; } },
    });
    expect(result.llmCalls).toBe(1);
    expect(result.verdict.passed).toBe(false);
  });

  it("stops at the tick limit", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const waits: AgentDecision = { intent: "idle", plan: Array(5).fill({ type: "wait" }), stopOn: [] };
    const spec = makeSpec({ limits: { ticks: 7, llmCalls: 10, wallClockMs: 60_000 } });
    const { result, replay } = await runLevel({ runId: "r", spec, charter: "", llm: createFakeLlm(() => waits), sink, engine });
    expect(result.ticks).toBe(7);
    expect(result.llmCalls).toBe(2);
    expect(replay.finalState.status).toBe("out_of_budget");
  });

  it("stops at the wall clock limit", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    let t = 0;
    const now = () => t;
    const waits: AgentDecision = { intent: "idle", plan: [{ type: "wait" }], stopOn: [] };
    const spec = makeSpec({ limits: { ticks: 100, llmCalls: 100, wallClockMs: 5000 } });
    const { result, replay } = await runLevel({ runId: "r", spec, charter: "", llm: createFakeLlm(() => { t += 2000; return waits; }), sink, engine, now });
    expect(result.ticks).toBe(2);
    expect(result.llmCalls).toBe(3);
    expect(replay.finalState.status).toBe("out_of_budget");
  });
});

describe("runTier: rune trading", () => {
  const buyAndHold = JSON.stringify({
    version: 1,
    rules: [{ when: { op: "gt", left: { kind: "metric", name: "price.return", offset: null }, right: { kind: "number", value: -1 } }, action: "long" }],
    fallback: "hold",
  });

  it("compiles the charter once per level and decides every candle deterministically", async () => {
    const requests: LlmRequest[] = [];
    const llm: LlmClient = {
      async complete(req) {
        requests.push(req);
        return { text: buyAndHold, latencyMs: 3 };
      },
    };
    const sink = createArraySink();
    const summary = await runTier({
      runId: "market-run",
      tier: getTier("runetrading", 1)!,
      charter: "Follow positive relative returns and stay long.",
      llm,
      sink,
      settings: { indicators: [{ id: "rsi", enabled: true, period: 14 }] },
    });
    expect(requests).toHaveLength(3);
    for (const req of requests) {
      expect(req.jsonSchema).toBe(MARKET_STRATEGY_JSON_SCHEMA);
      expect(req.user).toBe("Follow positive relative returns and stay long.");
      expect(req.system).toContain('"id":"rsi"');
    }
    expect(summary.totalLevels).toBe(3);
    expect(summary.passedLevels).toBe(3);
    expect(summary.levels.every((l) => l.llmCalls === 1 && l.ticks === 120)).toBe(true);

    const starts = sink.messages.filter((m) => m.kind === "level_start");
    expect(starts.map((m) => m.kind === "level_start" && m.spec.env.params.indicators?.map((i) => i.id))).toEqual([["rsi"], ["rsi"], ["rsi"]]);
    const decisions = sink.messages.filter((m) => m.kind === "decision");
    expect(decisions.filter((m) => m.kind === "decision" && m.record.source === "compiler")).toHaveLength(3);
    expect(decisions.filter((m) => m.kind === "decision" && m.record.source === "strategy")).toHaveLength(360);
    const frames = sink.messages.filter((m) => m.kind === "frame");
    expect(frames).toHaveLength(360);
    expect(frames.every((m) => m.kind === "frame" && m.frame.state.rngState === 0)).toBe(true);
    const ends = sink.messages.filter((m) => m.kind === "level_end");
    expect(ends.every((m) => m.kind === "level_end" && m.replay.decisions.length === 121 && m.replay.actions.length === 120)).toBe(true);
    expect(sink.messages.at(-1)?.kind).toBe("run_end");
  });

  it("keeps the catalogue seed of level 1 and picks fresh seeds for the hidden trials", async () => {
    const llm: LlmClient = { async complete() { return { text: buyAndHold, latencyMs: 0 }; } };
    const sink = createArraySink();
    const tier = getTier("runetrading", 2)!;
    await runTier({ runId: "r", tier, charter: "Trend.", llm, sink, pickSeed: (spec) => spec.seed + 1000 });
    const seeds = sink.messages.filter((m) => m.kind === "level_start").map((m) => (m.kind === "level_start" ? m.seed : 0));
    expect(seeds).toEqual([tier.levels[0].seed, tier.levels[1].seed + 1000, tier.levels[2].seed + 1000]);
  });

  it("falls back to hold-only (and records the error) when the compiler rejects the charter", async () => {
    const llm: LlmClient = { async complete() { return { text: "{}", latencyMs: 0 }; } };
    const sink = createArraySink();
    const summary = await runTier({ runId: "r", tier: getTier("runetrading", 1)!, charter: "Do things.", llm, sink });
    expect(summary.passedLevels).toBe(0);
    const compiler = sink.messages.find((m) => m.kind === "decision" && m.record.source === "compiler");
    expect(compiler?.kind === "decision" && compiler.record.error).toMatch(/strategy compile failed/);
    const ends = sink.messages.filter((m) => m.kind === "level_end");
    expect(ends.every((m) => m.kind === "level_end" && m.result.verdict.passed === false && m.replay.finalState.market?.finalPnl === 0)).toBe(true);
  });

  it("works with the fake LLM (default buy-and-hold strategy)", async () => {
    const sink = createArraySink();
    const summary = await runTier({ runId: "r", tier: getTier("runetrading", 1)!, charter: "Ride the trend.", llm: createFakeLlm(() => eastx3), sink });
    expect(summary.passedLevels).toBe(3);
  });
});

describe("runTier", () => {
  function tier(): TierSpec {
    return {
      mode: "maze",
      tier: 1,
      title: "Corridors",
      levels: [
        makeSpec({ id: "c-1", index: 1 }),
        makeSpec({ id: "c-2", index: 2, limits: { ticks: 20, llmCalls: 1, wallClockMs: 60_000 } }),
        makeSpec({ id: "c-3", index: 3 }),
      ],
    };
  }

  it("runs all three levels even if one fails, then pushes run_end", async () => {
    const engine = makeCorridorEngine();
    const sink = createArraySink();
    const summary = await runTier({ runId: "r", tier: tier(), charter: "east", llm: createFakeLlm(() => eastx3), sink, engine });
    expect(summary.totalLevels).toBe(3);
    expect(summary.passedLevels).toBe(2); // c-2 has only 1 LLM call -> out of budget
    expect(summary.tierUnlocked).toBe(false);
    expect(summary.levels.map((l) => l.levelId)).toEqual(["c-1", "c-2", "c-3"]);
    const k = kinds(sink.messages);
    expect(k.filter((x) => x === "level_start")).toHaveLength(3);
    expect(k.filter((x) => x === "level_end")).toHaveLength(3);
    expect(k.at(-1)).toBe("run_end");
    expect(k).not.toContain("error");
    const last = sink.messages[sink.messages.length - 1];
    expect(last.kind === "run_end" && last.summary).toEqual(summary);
  });

  it("pushes an error message and rethrows when something explodes", async () => {
    const engine = makeCorridorEngine();
    engine.step = () => {
      throw new Error("engine exploded");
    };
    const sink = createArraySink();
    await expect(
      runTier({ runId: "r", tier: tier(), charter: "", llm: createFakeLlm(() => eastx3), sink, engine }),
    ).rejects.toThrow("engine exploded");
    const last = sink.messages[sink.messages.length - 1];
    expect(last.kind).toBe("error");
    expect(last.kind === "error" && last.message).toBe("engine exploded");
  });

  it("rethrows the original error even if the sink is broken", async () => {
    const engine = makeCorridorEngine();
    const sink: Sink = {
      async push() {
        throw new Error("sink down");
      },
    };
    await expect(
      runTier({ runId: "r", tier: tier(), charter: "", llm: createFakeLlm(() => eastx3), sink, engine }),
    ).rejects.toThrow("sink down");
  });
});
