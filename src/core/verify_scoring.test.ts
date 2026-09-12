import { describe, expect, it } from "vitest";
import { eventually, never, verify } from "./verify";
import { compareRuns, scoreLevel, summarizeRun } from "./scoring";
import { step } from "./sim";
import { stateFromAscii, testSpec } from "./testutil";
import type { LevelRunResult, SimEvent, Verdict } from "./types";

const spec = testSpec("redfloor");

describe("verify", () => {
  it("passes on goal without hazard", () => {
    const s = stateFromAscii(["@A"]);
    const r = step(spec, s, { type: "move", args: { dir: "east" } });
    const v = verify(spec, s, r.state, r.events);
    expect(v.passed).toBe(true);
    expect(v.score).toBe(1);
    expect(v.evidence[0]).toEqual({ type: "tick", value: 1, note: "goal_reached" });
    expect(never(r.events, "hazard_entered")).toBe(true);
    expect(eventually(r.events, "goal_reached")?.tick).toBe(1);
  });

  it("fails on hazard, on budget, on nothing", () => {
    const s = stateFromAscii(["R@A"]);
    const r = step(spec, s, { type: "move", args: { dir: "west" } });
    const v = verify(spec, s, r.state, r.events);
    expect(v.passed).toBe(false);
    expect(v.reasons[0]).toMatch(/hazard/);
    expect(v.evidence.find((e) => e.type === "event")).toBeDefined();
    const idle = verify(spec, s, { ...s, status: "out_of_budget", tick: 20 }, [{ tick: 20, type: "budget_exhausted" }]);
    expect(idle.passed).toBe(false);
    expect(idle.reasons[0]).toMatch(/budget/);
    expect(verify(spec, s, s, []).passed).toBe(false);
  });

  it("tower defense verdicts", () => {
    const td = testSpec("towerdefense");
    const base = stateFromAscii(["S~B"], { td: { phase: "done", waveIndex: 2, wavesTotal: 2, baseHp: 2, baseHpMax: 3, towersLeft: 0 } });
    const ok: SimEvent[] = [{ tick: 3, type: "all_waves_cleared" }];
    expect(verify(td, base, base, ok).passed).toBe(true);
    const dead = { ...base, td: { ...base.td!, baseHp: 0, waveIndex: 1 }, status: "lost" as const };
    const v = verify(td, base, dead, [{ tick: 2, type: "base_destroyed", data: { waveIndex: 0 } }]);
    expect(v.passed).toBe(false);
    expect(v.score).toBe(0.5);
    expect(v.reasons[0]).toMatch(/wave 1/);
  });
});

describe("scoring", () => {
  const pass: Verdict = { passed: true, score: 1, confidence: 1, reasons: [], evidence: [] };
  const fail: Verdict = { ...pass, passed: false, score: 0 };

  it("scores passed levels with penalties, clamps at 0, zero on fail", () => {
    expect(scoreLevel(spec, pass, 10, 2, 100)).toBe(100 - 10 - 4 - 10);
    expect(scoreLevel(spec, pass, 1000, 0, 0)).toBe(0);
    expect(scoreLevel(spec, fail, 1, 1, 1)).toBe(0);
  });

  const res = (passed: boolean, ticks: number, calls: number, charter: number, score: number): LevelRunResult => ({
    levelId: "x",
    seed: 1,
    verdict: passed ? pass : fail,
    ticks,
    llmCalls: calls,
    charterLength: charter,
    levelScore: score,
  });

  it("summarizes and unlocks only when all pass", () => {
    const all = summarizeRun([res(true, 5, 1, 50, 80), res(true, 6, 1, 50, 70), res(true, 7, 1, 50, 60)]);
    expect(all).toMatchObject({ passedLevels: 3, totalLevels: 3, score: 210, tierUnlocked: true });
    const some = summarizeRun([res(true, 5, 1, 50, 80), res(false, 6, 1, 50, 0)]);
    expect(some).toMatchObject({ passedLevels: 1, totalLevels: 2, score: 80, tierUnlocked: false });
    expect(summarizeRun([]).tierUnlocked).toBe(false);
  });

  it("orders runs: passed, charter length, ticks, llm calls", () => {
    const a = summarizeRun([res(true, 5, 1, 50, 1)]);
    const b = summarizeRun([res(false, 1, 1, 10, 0)]);
    const c = summarizeRun([res(true, 9, 1, 40, 1)]);
    const d = summarizeRun([res(true, 5, 3, 50, 1)]);
    const sorted = [d, b, a, c].sort(compareRuns);
    expect(sorted).toEqual([c, a, d, b]);
  });
});
