/**
 * Engine abstraction used by the agent runtime.
 *
 * The runtime never calls `@core` directly; it goes through this interface so tests can
 * inject a tiny hand-written engine. `coreEngine` binds the interface to the real engine
 * exported from `src/core/index.ts`.
 *
 * NOTE: `episode.ts` loads `coreEngine` lazily (dynamic import) so that the runtime and its
 * tests stay importable even while `src/core/index.ts` is still being written.
 */
import type {
  Action,
  AgentMemory,
  LevelRunResult,
  LevelSpec,
  Observation,
  RunSummary,
  SimEvent,
  StepResult,
  StopOn,
  Verdict,
  WorldState,
} from "@core/types";
import * as core from "@core/index";

export interface Budget {
  ticksLeft: number;
  callsLeft: number;
}

export interface Engine {
  generateLevel(spec: LevelSpec): WorldState;
  step(spec: LevelSpec, state: WorldState, action: Action): StepResult;
  buildObservation(
    spec: LevelSpec,
    state: WorldState,
    memory: AgentMemory,
    budget: Budget,
    runId: string,
  ): Observation;
  updateMemory(memory: AgentMemory, spec: LevelSpec, state: WorldState, events: SimEvent[]): AgentMemory;
  emptyMemory(): AgentMemory;
  detectTriggers(spec: LevelSpec, prev: WorldState, next: WorldState, events: SimEvent[]): StopOn[];
  verify(spec: LevelSpec, initialState: WorldState, finalState: WorldState, events: SimEvent[]): Verdict;
  scoreLevel(spec: LevelSpec, verdict: Verdict, ticks: number, llmCalls: number, charterLength: number): number;
  summarizeRun(results: LevelRunResult[]): RunSummary;
  isTerminal(state: WorldState): boolean;
  ASCII_LEGEND: string;
}

/** The real engine (src/core). */
export const coreEngine: Engine = {
  generateLevel: core.generateLevel,
  step: core.step,
  buildObservation: core.buildObservation,
  updateMemory: core.updateMemory,
  emptyMemory: core.emptyMemory,
  detectTriggers: core.detectTriggers,
  verify: core.verify,
  scoreLevel: core.scoreLevel,
  summarizeRun: core.summarizeRun,
  isTerminal: core.isTerminal,
  ASCII_LEGEND: core.ASCII_LEGEND,
};
