/**
 * GOLEM — single source of truth for data contracts.
 * Pure types only. No runtime imports. Everything here must stay JSON-serializable
 * because it crosses process boundaries (Daytona runner -> Convex -> browser).
 */

// ───────────────────────── Geometry ─────────────────────────
export type Vec = [number, number]; // [x, y], x = column, y = row, origin top-left
export type Dir = "north" | "south" | "east" | "west";
export const DIRS: Dir[] = ["north", "south", "east", "west"];
export const DIR_DELTA: Record<Dir, Vec> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

// ───────────────────────── Modes & tiles ─────────────────────────
export type ModeId = "maze" | "redfloor" | "keymaster" | "towerdefense";

/** Static tile layer. Entities (items, doors, towers, enemies) live in `entities`, not here. */
export type TileType =
  | "floor" // walkable
  | "wall" // blocked
  | "hazard" // red floor: stepping on it destroys the golem (unless a plank was placed -> tile becomes "bridge")
  | "bridge" // hazard covered by a plank, walkable
  | "altar" // goal for maze / redfloor
  | "path" // towerdefense: enemy route, not buildable
  | "buildable" // towerdefense: tower slot
  | "spawn" // towerdefense: enemy entry
  | "base"; // towerdefense: what enemies attack

export type EntityKind =
  | "golem"
  | "plank" // pickable; agent carries at most `maxCarry` planks
  | "key" // pickable; opens a door
  | "door" // props.locked: boolean; props.open: boolean
  | "lever" // props.on: boolean; props.targetId: door id; toggling opens/closes that door
  | "crate" // pushable one tile in the given direction if the tile behind is walkable; a crate pushed onto hazard turns it into "bridge"
  | "tower" // towerdefense; props.towerType, props.range, props.damage
  | "enemy" // towerdefense; props.enemyType, props.hp, props.speed, props.pathIndex
  | "base";

export type AnimationState = "idle" | "walk" | "interact" | "fail" | "success";

export interface Visual {
  assetKey: string; // e.g. "unit.golem", "tile.hazard", "item.plank" — resolved by the renderer, never a file path
  animation: AnimationState;
  facing: Dir;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  pos: Vec;
  props: Record<string, string | number | boolean | null>;
  visual: Visual;
}

// ───────────────────────── World state ─────────────────────────
export interface AgentState {
  pos: Vec;
  facing: Dir;
  inventory: string[]; // item kinds carried, e.g. ["plank", "key"]
  alive: boolean;
}

export interface TowerDefenseState {
  phase: "build" | "done";
  waveIndex: number; // next wave to run (0-based)
  wavesTotal: number;
  baseHp: number;
  baseHpMax: number;
  towersLeft: number; // remaining placements allowed
  lastWave?: { spawned: number; killed: number; leaked: number };
}

export interface WorldState {
  tick: number;
  size: Vec; // [width, height]
  tiles: TileType[]; // row-major, index = y * width + x
  entities: Entity[];
  agent: AgentState;
  td?: TowerDefenseState; // present only in towerdefense
  status: "running" | "won" | "lost" | "out_of_budget";
  keymaster?: { key: "world" | "inventory" | "consumed"; altar: "idle" | "active"; recentStates: string[] };
  rngState: number; // deterministic PRNG state carried across steps
  /** Tile indices the agent has ever seen, for the renderer's fog memory. */
  seen: number[];
}

// ───────────────────────── Actions ─────────────────────────
export type ActionType =
  | "move"
  | "wait"
  | "inspect"
  | "interact" // opens door with key / pulls lever / pushes crate in facing (or given) dir
  | "pickup" // picks item on current tile
  | "place" // places a carried plank on the adjacent tile in `dir` (only meaningful on hazard)
  | "say"
  | "place_tower" // towerdefense
  | "start_wave"; // towerdefense

export type Action =
  | { type: "move"; args: { dir: Dir } }
  | { type: "wait"; args?: Record<string, never> }
  | { type: "inspect"; args?: { dir?: Dir } }
  | { type: "interact"; args?: { dir?: Dir } }
  | { type: "pickup"; args?: Record<string, never> }
  | { type: "place"; args: { dir: Dir } }
  | { type: "say"; args: { text: string } }
  | { type: "place_tower"; args: { pos: Vec; towerType: string } }
  | { type: "start_wave"; args?: Record<string, never> };

// ───────────────────────── Events (sim output, verifier input) ─────────────────────────
export type SimEventType =
  | "inspected"
  | "item_collected"
  | "key_consumed"
  | "door_unlocked"
  | "interaction_failed"
  | "altar_reached"
  | "door_discovered"
  | "key_discovered"
  | "agent_stuck"
  | "moved"
  | "blocked"
  | "hazard_entered" // agent stepped on hazard -> agent.alive=false, status=lost
  | "goal_reached"
  | "picked_up"
  | "placed"
  | "door_opened"
  | "door_locked" // tried to open without key
  | "lever_pulled"
  | "crate_pushed"
  | "invalid_action" // schema-valid but impossible in current state (no plank to place, not TD, etc.)
  | "say"
  | "tower_placed"
  | "tower_limit"
  | "wave_started"
  | "enemy_spawned"
  | "enemy_killed"
  | "enemy_leaked" // reached base, base takes damage
  | "wave_ended"
  | "base_destroyed"
  | "all_waves_cleared"
  | "budget_exhausted";

export interface SimEvent {
  tick: number;
  type: SimEventType;
  data?: Record<string, unknown>;
}

export interface StepResult {
  state: WorldState;
  events: SimEvent[];
}

// ───────────────────────── Level spec ─────────────────────────
export interface WaveSpec {
  count: number;
  enemyType: string; // "grunt" | "runner" | "brute"
  hp: number;
  speed: number; // tiles per wave-tick
}

export interface OpponentSpec {
  /** Shown to the player verbatim before they write their charter. */
  charter: string;
  waves: WaveSpec[];
  /** Deterministic reactive rules, e.g. { onLeakBonus: 2 } -> if previous wave leaked >=1, next wave count += 2 */
  rules: Record<string, number | boolean>;
}

export interface TowerTypeSpec {
  id: string;
  range: number;
  damage: number;
  label: string;
}

export interface EnvSpec {
  size: Vec;
  generator: "maze" | "redfloor" | "keymaster" | "towerdefense";
  params: {
    hazardDensity?: number; // redfloor
    planks?: number; // redfloor: planks scattered
    keys?: number; // doors+keys pairs
    levers?: number;
    crates?: number;
    maxCarry?: number; // default 1
    deadEndFactor?: number; // maze: 0..1 extra branching
    /** guaranteed: BFS path exists that avoids hazards (possibly via planks/crates). */
    guarantee?: string[];
    towerTypes?: TowerTypeSpec[];
    towerLimit?: number;
    baseHp?: number;
  };
}

export interface LevelSpec {
  id: string; // e.g. "redfloor-t2-l3"
  mode: ModeId;
  tier: number; // difficulty tier, 1-based
  index: number; // 1..3 within tier
  title: string;
  brief: string; // shown to player
  playerKnows: string[]; // rules shown in the "Rules" panel
  agentKnows: string[]; // facts injected into the system prompt
  promptBudget: number; // max charter characters (grows with tier)
  env: EnvSpec;
  observation: { radius: number; memoryTicks: number }; // radius shrinks on hard tiers
  limits: { ticks: number; llmCalls: number; wallClockMs: number };
  actions: ActionType[];
  opponent?: OpponentSpec; // towerdefense only
  scoring: { completion: number; perTick: number; perChar: number; perLlmCall: number };
  seed: number; // fixed per level (hidden from player until deploy)
}

export interface TierSpec {
  mode: ModeId;
  tier: number;
  title: string;
  levels: LevelSpec[]; // exactly 3
}

// ───────────────────────── Observation (what the LLM sees) ─────────────────────────
export interface VisibleTile {
  pos: Vec;
  tile: TileType;
}

export interface VisibleEntity {
  id: string;
  kind: EntityKind;
  pos: Vec;
  props: Record<string, string | number | boolean | null>;
}

export interface AgentMemory {
  knownLandmarks: { kind: string; pos: Vec; props?: Entity["props"] }[]; // altar, doors, levers, items seen so far
  recentEvents: string[]; // last N human-readable event lines
  marks: { pos: Vec; note: string }[]; // agent notes (from `say` with "mark:" prefix) — optional
  visitedCount: number;
  visited?: Vec[];
  knownTiles?: VisibleTile[];
  blockedRoutes?: { pos: Vec; by: string }[];
}

export interface Observation {
  runId: string;
  levelId: string;
  tick: number;
  objective: string;
  self: { pos: Vec; facing: Dir; inventory: string[] };
  visible: { tiles: VisibleTile[]; entities: VisibleEntity[] };
  /** Compact ASCII map of the visible window (rows top to bottom). Legend in system prompt. */
  asciiView: string;
  memory: AgentMemory;
  td?: TowerDefenseState & { buildableSlots: Vec[]; towerTypes: TowerTypeSpec[]; opponentCharter: string };
  budget: { ticksLeft: number; callsLeft: number };
}

// ───────────────────────── Agent decision (LLM output) ─────────────────────────
export type StopOn = "new_entity" | "blocked" | "hazard_detected" | "goal_visible" | "item_visible" | "plan_done" | "state_changed";

export interface AgentDecision {
  intent: string; // short, shown in UI; never chain-of-thought
  plan: Action[]; // 1..5 primitive actions
  stopOn: StopOn[];
}

// ───────────────────────── Verifier ─────────────────────────
export interface Evidence {
  type: "tick" | "position" | "event" | "state";
  value: unknown;
  note?: string;
}

export interface Verdict {
  passed: boolean;
  score: number; // 0..1 completion quality for this level
  confidence: number;
  reasons: string[];
  evidence: Evidence[];
}

// ───────────────────────── Run / replay ─────────────────────────
export interface DecisionRecord {
  tick: number;
  intent: string;
  plan: Action[];
  stopOn: StopOn[];
  latencyMs: number;
  error?: string; // schema failure / timeout -> runtime fell back to `wait`
}

export interface LevelRunResult {
  levelId: string;
  seed: number;
  verdict: Verdict;
  ticks: number;
  llmCalls: number;
  charterLength: number;
  levelScore: number; // points after penalties
}

export interface Replay {
  runId: string;
  levelId: string;
  seed: number;
  charter: string;
  initialState: WorldState;
  decisions: DecisionRecord[];
  actions: { tick: number; action: Action }[]; // validated actions actually applied
  events: SimEvent[];
  finalState: WorldState;
  verdict: Verdict;
}

export type RunStatus = "queued" | "running" | "finished" | "error";

export interface RunSummary {
  passedLevels: number; // 0..3
  totalLevels: number;
  score: number;
  tierUnlocked: boolean;
  levels: LevelRunResult[];
}

// ───────────────────────── Streaming frames (runner -> Convex -> UI) ─────────────────────────
/** One frame per applied action. `state` is the full post-action state (grids are small), simplest for live rendering. */
export interface Frame {
  levelId: string;
  tick: number;
  action: Action;
  events: SimEvent[];
  state: WorldState;
}

export type RunnerMessage =
  | { kind: "level_start"; levelId: string; seed: number; initialState: WorldState; spec: LevelSpec }
  | { kind: "decision"; levelId: string; record: DecisionRecord }
  | { kind: "frame"; frame: Frame }
  | { kind: "level_end"; levelId: string; result: LevelRunResult; replay: Replay }
  | { kind: "run_end"; summary: RunSummary }
  | { kind: "error"; message: string };

/** The runtime pushes messages through a sink. Implementations: Convex HTTP (Daytona), ctx.runMutation (in-process), array (tests). */
export interface Sink {
  push(msg: RunnerMessage): Promise<void>;
}

// ───────────────────────── LLM abstraction ─────────────────────────
export interface LlmRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string; // raw JSON text
  latencyMs: number;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
