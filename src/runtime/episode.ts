/**
 * Episode loop: runs one level (runLevel) or a whole tier (runTier) with an LLM agent
 * acting under the player's charter, streaming RunnerMessages through a Sink.
 *
 * Tick conventions:
 *  - DecisionRecord.tick  = state.tick at the moment the LLM was asked (pre-action).
 *  - Replay.actions[].tick = state.tick at which the action was applied (pre-action).
 *  - Frame.tick           = post-action state.tick (equals frame.state.tick).
 *
 * llmCalls counts every completion request, including the single retry after an invalid reply.
 */
import type {
  Action,
  AgentDecision,
  DecisionRecord,
  IndicatorConfig,
  LevelRunResult,
  LevelSpec,
  LlmClient,
  MarketStrategy,
  Replay,
  RunSettings,
  RunSummary,
  SimEvent,
  Sink,
  StopOn,
  TierSpec,
} from "../core/types";
import type { Engine } from "./engine";
import { DecisionError, parseDecision } from "./decision";
import { DECISION_JSON_SCHEMA, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { compileMarketStrategy } from "./marketCompiler";
import { evaluateMarketStrategy } from "../core/marketStrategy";
import { applyRunSettings } from "../core/runSettings";

export interface RunLevelOptions {
  runId: string;
  spec: LevelSpec;
  charter: string;
  llm: LlmClient;
  sink: Sink;
  /** Defaults to the real engine (src/core), loaded lazily. */
  engine?: Engine;
  now?: () => number;
  /** Optional progress logger (single line per event). */
  log?: (line: string) => void;
}

export interface RunLevelOutput {
  result: LevelRunResult;
  replay: Replay;
}

export interface RunTierOptions {
  runId: string;
  tier: TierSpec;
  charter: string;
  llm: LlmClient;
  sink: Sink;
  engine?: Engine;
  now?: () => number;
  log?: (line: string) => void;
  /**
   * Replace each catalogue seed with a fresh one (e.g. pickApprovedSeed) so worlds differ per run.
   * Rune trading keeps the catalogue seed of level 1 (its chart is the public reference).
   */
  pickSeed?: (spec: LevelSpec) => number;
  /** Rune trading: the player's indicator set, applied to every level of the tier. */
  settings?: RunSettings;
}

let defaultEnginePromise: Promise<Engine> | undefined;
async function resolveEngine(engine?: Engine): Promise<Engine> {
  if (engine) return engine;
  defaultEnginePromise ??= import("./engine").then((m) => m.coreEngine);
  return defaultEnginePromise;
}

const FALLBACK_PLAN: Action[] = [{ type: "wait" }];

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Ask the LLM for a decision; retry once with the validation error appended; fall back to `wait`. */
async function decide(
  llm: LlmClient,
  spec: LevelSpec,
  system: string,
  user: string,
  tick: number,
  now: () => number,
  remainingCalls: number,
  deadline: number,
): Promise<{ record: DecisionRecord; decision: AgentDecision; calls: number }> {
  let latencyMs = 0;
  let calls = 0;
  let lastError = "";
  let prompt = user;
  for (let attempt = 0; attempt < Math.min(2, remainingCalls) && now() < deadline; attempt++) {
    const started = now();
    calls++;
    try {
      const res = await llm.complete({ system, user: prompt, jsonSchema: DECISION_JSON_SCHEMA, timeoutMs: Math.max(1, deadline - now()) });
      latencyMs += Math.max(res.latencyMs, now() - started);
      const decision = parseDecision(res.text, spec);
      return {
        decision,
        calls,
        record: { tick, intent: decision.intent, plan: decision.plan, stopOn: decision.stopOn, latencyMs },
      };
    } catch (e) {
      latencyMs += now() - started;
      lastError = e instanceof DecisionError ? `invalid decision: ${e.message}` : `llm error: ${errorMessage(e)}`;
      prompt = `${user}\n\nYour previous reply was invalid: ${lastError}. Reply with valid JSON only.`;
    }
  }
  const decision: AgentDecision = { intent: "(fallback) wait", plan: [...FALLBACK_PLAN], stopOn: [] };
  return {
    decision,
    calls,
    record: { tick, intent: decision.intent, plan: decision.plan, stopOn: decision.stopOn, latencyMs, error: lastError },
  };
}

export async function runLevel(opts: RunLevelOptions): Promise<RunLevelOutput> {
  const { runId, spec, charter, llm, sink } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const engine = await resolveEngine(opts.engine);
  const { limits } = spec;

  const startedAt = now();
  let state = engine.generateLevel(spec);
  const initialState = state;
  await sink.push({ kind: "level_start", levelId: spec.id, seed: spec.seed, initialState, spec });
  log(JSON.stringify({ event: "level_start", levelId: spec.id }));

  let memory = engine.updateMemory(engine.emptyMemory(), spec, state, []);
  let llmCalls = 0;
  const decisions: DecisionRecord[] = [];
  const actions: Replay["actions"] = [];
  const events: SimEvent[] = [];
  let queue: Action[] = [];
  let stopOn: StopOn[] = [];
  let outOfBudget = false;

  const system = buildSystemPrompt(spec, engine.ASCII_LEGEND);

  while (!engine.isTerminal(state) && state.tick < limits.ticks && now() - startedAt < limits.wallClockMs) {
    if (queue.length === 0) {
      if (llmCalls >= limits.llmCalls) {
        outOfBudget = true;
        break;
      }
      const obs = engine.buildObservation(
        spec,
        state,
        memory,
        { ticksLeft: limits.ticks - state.tick, callsLeft: limits.llmCalls - llmCalls },
        runId,
      );
      const user = buildUserPrompt(charter, obs);
      const { record, decision, calls } = await decide(llm, spec, system, user, state.tick, now, limits.llmCalls - llmCalls, startedAt + limits.wallClockMs);
      llmCalls += calls;
      decisions.push(record);
      await sink.push({ kind: "decision", levelId: spec.id, record });
      log(JSON.stringify({ event: "decision", levelId: spec.id, tick: record.tick, intent: record.intent, error: record.error }));
      queue = [...decision.plan];
      stopOn = decision.stopOn;
    }

    if (now() - startedAt >= limits.wallClockMs) break;
    const action = queue.shift() as Action;
    const prev = state;
    const res = engine.step(spec, prev, action);
    state = res.state;
    actions.push({ tick: prev.tick, action });
    events.push(...res.events);
    await sink.push({ kind: "frame", frame: { levelId: spec.id, tick: state.tick, action, events: res.events, state } });

    memory = engine.updateMemory(memory, spec, state, res.events);
    const triggers = engine.detectTriggers(spec, prev, state, res.events);
    const interrupted =
      triggers.some((t) => stopOn.includes(t)) || res.events.some((e) => e.type === "blocked" || e.type === "invalid_action");
    if (interrupted) queue = [];
  }

  if (state.status === "running" && (outOfBudget || !engine.isTerminal(state))) {
    // Ran out of LLM calls, ticks or wall clock without the engine settling the level.
    state = { ...state, status: "out_of_budget" };
  }

  const verdict = engine.verify(spec, initialState, state, events);
  const ticks = state.tick;
  const levelScore = engine.scoreLevel(spec, verdict, ticks, llmCalls, charter.length);
  const result: LevelRunResult = {
    levelId: spec.id,
    seed: spec.seed,
    verdict,
    ticks,
    llmCalls,
    charterLength: charter.length,
    levelScore,
  };
  const replay: Replay = {
    runId,
    levelId: spec.id,
    seed: spec.seed,
    charter,
    initialState,
    decisions,
    actions,
    events,
    finalState: state,
    verdict,
  };
  await sink.push({ kind: "level_end", levelId: spec.id, result, replay });
  log(JSON.stringify({ event: "level_end", levelId: spec.id, passed: verdict.passed, ticks, llmCalls, levelScore }));
  return { result, replay };
}

/**
 * Rune trading: the charter is compiled ONCE per level (one LLM call), then every candle is
 * decided deterministically by the strategy. Emits the same message sequence as runLevel;
 * the compiler call is recorded as a `source: "compiler"` decision at tick 0.
 */
export async function runMarketLevel(
  opts: RunLevelOptions & { compiled?: { strategy: MarketStrategy; latencyMs: number } },
): Promise<RunLevelOutput> {
  const { runId, spec, charter, llm, sink } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const engine = await resolveEngine(opts.engine);
  const { limits } = spec;
  const indicators: IndicatorConfig[] = spec.env.params.indicators ?? [];

  const startedAt = now();
  let state = engine.generateLevel(spec);
  const initialState = state;
  await sink.push({ kind: "level_start", levelId: spec.id, seed: spec.seed, initialState, spec });
  log(JSON.stringify({ event: "level_start", levelId: spec.id }));

  const decisions: DecisionRecord[] = [];
  const actions: Replay["actions"] = [];
  const events: SimEvent[] = [];
  let llmCalls = 0;
  let strategy: MarketStrategy | undefined;
  let compileError: string | undefined;

  if (opts.compiled) {
    strategy = opts.compiled.strategy;
    llmCalls = 0;
  } else {
    llmCalls = 1;
    const compileStarted = now();
    try {
      const compiled = await compileMarketStrategy(llm, charter, indicators, { timeoutMs: Math.max(1, limits.wallClockMs) });
      strategy = compiled.strategy;
      const record: DecisionRecord = {
        tick: 0,
        intent: `Compiled charter into ${compiled.strategy.rules.length} rule(s)`,
        plan: [],
        stopOn: [],
        latencyMs: Math.max(compiled.latencyMs, now() - compileStarted),
        source: "compiler",
      };
      decisions.push(record);
      await sink.push({ kind: "decision", levelId: spec.id, record });
      log(JSON.stringify({ event: "decision", levelId: spec.id, tick: 0, intent: record.intent, source: "compiler" }));
    } catch (e) {
      compileError = `strategy compile failed: ${errorMessage(e)}`;
      const record: DecisionRecord = { tick: 0, intent: "(fallback) hold", plan: [], stopOn: [], latencyMs: now() - compileStarted, source: "compiler", error: compileError };
      decisions.push(record);
      await sink.push({ kind: "decision", levelId: spec.id, record });
      log(JSON.stringify({ event: "decision", levelId: spec.id, tick: 0, intent: record.intent, error: compileError }));
    }
  }

  while (!engine.isTerminal(state) && state.tick < limits.ticks && now() - startedAt < limits.wallClockMs) {
    if (!state.market) throw new Error(`Rune-trading state missing for ${spec.id}`);
    const type = strategy ? evaluateMarketStrategy(strategy, state.market.candles, indicators) : "hold";
    const action: Action = { type };
    const record: DecisionRecord = {
      tick: state.tick,
      intent: `Strategy selected ${type}`,
      plan: [action],
      stopOn: [],
      latencyMs: 0,
      source: "strategy",
      ...(compileError ? { error: compileError } : {}),
    };
    decisions.push(record);
    await sink.push({ kind: "decision", levelId: spec.id, record });
    const prev = state;
    const res = engine.step(spec, prev, action);
    state = res.state;
    actions.push({ tick: prev.tick, action });
    events.push(...res.events);
    await sink.push({ kind: "frame", frame: { levelId: spec.id, tick: state.tick, action, events: res.events, state } });
  }

  if (state.status === "running") state = { ...state, status: "out_of_budget" };

  const verdict = engine.verify(spec, initialState, state, events);
  const ticks = state.tick;
  const levelScore = engine.scoreLevel(spec, verdict, ticks, llmCalls, charter.length);
  const result: LevelRunResult = { levelId: spec.id, seed: spec.seed, verdict, ticks, llmCalls, charterLength: charter.length, levelScore };
  const replay: Replay = { runId, levelId: spec.id, seed: spec.seed, charter, initialState, decisions, actions, events, finalState: state, verdict };
  await sink.push({ kind: "level_end", levelId: spec.id, result, replay });
  log(JSON.stringify({ event: "level_end", levelId: spec.id, passed: verdict.passed, ticks, llmCalls, levelScore }));
  return { result, replay };
}

export async function runTier(opts: RunTierOptions): Promise<RunSummary> {
  const { runId, charter, llm, sink } = opts;
  const tier = applyRunSettings(opts.tier, opts.settings);
  try {
    const engine = await resolveEngine(opts.engine);
    const results: LevelRunResult[] = [];
    if (tier.mode === "runetrading") {
      // Level 1 keeps its catalogue seed (public reference chart); hidden trials get fresh approved seeds.
      const levels = opts.pickSeed ? tier.levels.map((l) => (l.index === 1 ? l : { ...l, seed: opts.pickSeed!(l) })) : tier.levels;
      for (const spec of levels) {
        const { result } = await runMarketLevel({ runId, spec, charter, llm, sink, engine, now: opts.now, log: opts.log });
        results.push(result);
      }
      const summary = engine.summarizeRun(results);
      await sink.push({ kind: "run_end", summary });
      opts.log?.(JSON.stringify({ event: "run_end", passedLevels: summary.passedLevels, score: summary.score }));
      return summary;
    }
    // Hidden seeds: the caller may replace catalogue seeds with fresh approved ones per level.
    const levels = opts.pickSeed ? tier.levels.map((l) => ({ ...l, seed: opts.pickSeed!(l) })) : tier.levels;
    // Always run every level so the player sees all three results.
    for (const spec of levels) {
      const { result } = await runLevel({ runId, spec, charter, llm, sink, engine, now: opts.now, log: opts.log });
      results.push(result);
    }
    const summary = engine.summarizeRun(results);
    await sink.push({ kind: "run_end", summary });
    opts.log?.(JSON.stringify({ event: "run_end", passedLevels: summary.passedLevels, score: summary.score }));
    return summary;
  } catch (e) {
    const message = errorMessage(e);
    try {
      await sink.push({ kind: "error", message });
    } catch {
      // the sink itself may be the failing part; the original error is what matters
    }
    throw e;
  }
}
