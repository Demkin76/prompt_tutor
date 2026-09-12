import type { LevelRunResult, LevelSpec, RunSummary, Verdict } from "./types";

/**
 * Points for one level. Only passed levels score; penalties (negative perTick /
 * perChar / perLlmCall in the spec) are applied and the result is clamped at 0.
 */
export function scoreLevel(spec: LevelSpec, verdict: Verdict, ticks: number, llmCalls: number, charterLength: number): number {
  if (!verdict.passed) return 0;
  const s = spec.scoring;
  const calls = spec.mode === "keymaster" ? Math.max(0, llmCalls - 1) : llmCalls;
  const bonus = spec.mode === "keymaster" ? verdict.evidence.filter(e => e.note === "bonus").reduce((n, e) => n + Number(e.value), 0) : 0;
  const raw = s.completion + s.perTick * ticks + s.perLlmCall * calls + s.perChar * charterLength + bonus;
  return Math.max(0, Math.round(raw * 100) / 100);
}

export function summarizeRun(results: LevelRunResult[]): RunSummary {
  const passedLevels = results.filter((r) => r.verdict.passed).length;
  const totalLevels = results.length;
  const score = Math.round(results.reduce((acc, r) => acc + r.levelScore, 0) * 100) / 100;
  return {
    passedLevels,
    totalLevels,
    score: score + (totalLevels === 3 && passedLevels === 3 && results.every(r => r.levelId.startsWith("keymaster-")) ? 100 : 0),
    tierUnlocked: totalLevels > 0 && passedLevels === totalLevels,
    levels: results,
  };
}

/**
 * Leaderboard ordering: negative when `a` ranks ahead of `b`.
 * More passed levels → shorter charter → fewer ticks → fewer LLM calls.
 */
export function compareRuns(a: RunSummary, b: RunSummary): number {
  if (a.passedLevels !== b.passedLevels) return b.passedLevels - a.passedLevels;
  const charter = (r: RunSummary) => (r.levels.length ? r.levels[0].charterLength : 0);
  if (charter(a) !== charter(b)) return charter(a) - charter(b);
  const ticks = (r: RunSummary) => r.levels.reduce((n, l) => n + l.ticks, 0);
  if (ticks(a) !== ticks(b)) return ticks(a) - ticks(b);
  const calls = (r: RunSummary) => r.levels.reduce((n, l) => n + l.llmCalls, 0);
  return calls(a) - calls(b);
}
