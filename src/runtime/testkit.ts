/**
 * Test fixtures for the runtime: a tiny hand-written engine (1-D corridor) and a level spec.
 * Not a test file; imported by *.test.ts.
 *
 * Corridor: 5 tiles in a row, agent starts at x=0, altar at x=4. `move east` advances,
 * reaching the altar wins; moving off the corridor is `blocked`; unknown actions are `invalid_action`.
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
import type { Engine } from "./engine";

export const CORRIDOR_LEN = 5;

export function makeSpec(overrides: Partial<LevelSpec> = {}): LevelSpec {
  return {
    id: "test-corridor-l1",
    mode: "maze",
    tier: 1,
    index: 1,
    title: "Corridor",
    brief: "Reach the altar at the east end.",
    playerKnows: ["The altar is east."],
    agentKnows: ["The corridor is 5 tiles long.", "The altar is at the east end."],
    promptBudget: 200,
    env: { size: [CORRIDOR_LEN, 1], generator: "maze", params: {} },
    observation: { radius: 1, memoryTicks: 5 },
    limits: { ticks: 20, llmCalls: 5, wallClockMs: 60_000 },
    actions: ["move", "wait", "say"],
    scoring: { completion: 100, perTick: 1, perChar: 0.1, perLlmCall: 2 },
    seed: 42,
    ...overrides,
  };
}

export function makeCorridorEngine(): Engine & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);

  const generateLevel = (spec: LevelSpec): WorldState => {
    count("generateLevel");
    const tiles = Array.from({ length: CORRIDOR_LEN }, (_, i) => (i === CORRIDOR_LEN - 1 ? "altar" : "floor")) as WorldState["tiles"];
    return {
      tick: 0,
      size: spec.env.size,
      tiles,
      entities: [
        { id: "golem", kind: "golem", pos: [0, 0], props: {}, visual: { assetKey: "unit.golem", animation: "idle", facing: "east" } },
      ],
      agent: { pos: [0, 0], facing: "east", inventory: [], alive: true },
      status: "running",
      rngState: spec.seed,
      seen: [0],
    };
  };

  const step = (_spec: LevelSpec, state: WorldState, action: Action): StepResult => {
    count("step");
    const tick = state.tick + 1;
    const events: SimEvent[] = [];
    let agent = { ...state.agent };
    let status = state.status;
    if (action.type === "move") {
      const dir = action.args.dir;
      const dx = dir === "east" ? 1 : dir === "west" ? -1 : 0;
      const nx = agent.pos[0] + dx;
      if (dx === 0 || nx < 0 || nx >= CORRIDOR_LEN) {
        events.push({ tick, type: "blocked", data: { dir } });
      } else {
        agent = { ...agent, pos: [nx, 0], facing: dir };
        events.push({ tick, type: "moved", data: { pos: agent.pos } });
        if (nx === CORRIDOR_LEN - 1) {
          events.push({ tick, type: "goal_reached" });
          status = "won";
        }
      }
    } else if (action.type === "wait") {
      // nothing
    } else if (action.type === "say") {
      events.push({ tick, type: "say", data: { text: action.args.text } });
    } else {
      events.push({ tick, type: "invalid_action", data: { type: action.type } });
    }
    const seen = Array.from(new Set([...state.seen, agent.pos[0]]));
    return {
      state: {
        ...state,
        tick,
        agent,
        status,
        seen,
        entities: state.entities.map((e) => (e.kind === "golem" ? { ...e, pos: agent.pos } : e)),
      },
      events,
    };
  };

  const emptyMemory = (): AgentMemory => {
    count("emptyMemory");
    return { knownLandmarks: [], recentEvents: [], marks: [], visitedCount: 0 };
  };

  const updateMemory = (memory: AgentMemory, spec: LevelSpec, _state: WorldState, events: SimEvent[]): AgentMemory => {
    count("updateMemory");
    const lines = [...memory.recentEvents, ...events.map((e) => `${e.tick}:${e.type}`)];
    return { ...memory, recentEvents: lines.slice(-spec.observation.memoryTicks), visitedCount: memory.visitedCount + 1 };
  };

  const buildObservation = (
    spec: LevelSpec,
    state: WorldState,
    memory: AgentMemory,
    budget: { ticksLeft: number; callsLeft: number },
    runId: string,
  ): Observation => {
    count("buildObservation");
    const x = state.agent.pos[0];
    const tiles = [];
    for (let i = Math.max(0, x - spec.observation.radius); i <= Math.min(CORRIDOR_LEN - 1, x + spec.observation.radius); i++) {
      tiles.push({ pos: [i, 0] as [number, number], tile: state.tiles[i] });
    }
    const ascii = state.tiles.map((t, i) => (i === x ? "@" : t === "altar" ? "A" : ".")).join("");
    return {
      runId,
      levelId: spec.id,
      tick: state.tick,
      objective: spec.brief,
      self: { pos: state.agent.pos, facing: state.agent.facing, inventory: state.agent.inventory },
      visible: { tiles, entities: [] },
      asciiView: ascii,
      memory,
      budget,
    };
  };

  const detectTriggers = (spec: LevelSpec, prev: WorldState, next: WorldState, events: SimEvent[]): StopOn[] => {
    count("detectTriggers");
    const out: StopOn[] = [];
    const sees = (s: WorldState) => s.agent.pos[0] + spec.observation.radius >= CORRIDOR_LEN - 1;
    if (!sees(prev) && sees(next)) out.push("goal_visible");
    if (events.some((e) => e.type === "blocked")) out.push("blocked");
    return out;
  };

  const verify = (_spec: LevelSpec, _initial: WorldState, final: WorldState, events: SimEvent[]): Verdict => {
    count("verify");
    const passed = final.status === "won" && events.some((e) => e.type === "goal_reached");
    return {
      passed,
      score: passed ? 1 : 0,
      confidence: 1,
      reasons: [passed ? "altar reached" : `final status ${final.status}`],
      evidence: [{ type: "state", value: final.status }],
    };
  };

  const scoreLevel = (spec: LevelSpec, verdict: Verdict, ticks: number, llmCalls: number, charterLength: number): number => {
    count("scoreLevel");
    if (!verdict.passed) return 0;
    const s = spec.scoring;
    return Math.max(0, s.completion - ticks * s.perTick - llmCalls * s.perLlmCall - charterLength * s.perChar);
  };

  const summarizeRun = (results: LevelRunResult[]): RunSummary => {
    count("summarizeRun");
    const passedLevels = results.filter((r) => r.verdict.passed).length;
    return {
      passedLevels,
      totalLevels: results.length,
      score: results.reduce((a, r) => a + r.levelScore, 0),
      tierUnlocked: results.length > 0 && passedLevels === results.length,
      levels: results,
    };
  };

  const isTerminal = (state: WorldState): boolean => state.status !== "running";

  return {
    calls,
    generateLevel,
    step,
    buildObservation,
    updateMemory,
    emptyMemory,
    detectTriggers,
    verify,
    scoreLevel,
    summarizeRun,
    isTerminal,
    ASCII_LEGEND: "@ golem  . floor  A altar  # wall",
  };
}
