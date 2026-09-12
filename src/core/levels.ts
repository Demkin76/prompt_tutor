import type { ActionType, ChartClass, LevelSpec, ModeId, OpponentSpec, TierSpec, TowerTypeSpec } from "./types";
import { DEFAULT_CANDLE_COUNT, DEFAULT_FEE_BPS, DEFAULT_STARTING_BALANCE, generateMarketSeries } from "./generators/market";
import { DEFAULT_MARKET_INDICATORS } from "./runSettings";

export const MODES: { id: ModeId; title: string; tagline: string }[] = [
  { id: "maze", title: "Maze", tagline: "Find the altar in a labyrinth with limited vision." },
  { id: "redfloor", title: "Red Floor", tagline: "The floor is lava. Planks, keys and levers are your friends." },
  { id: "runetrading", title: "Rune Trading", tagline: "Teach the golem a reusable indicator strategy, then face unseen markets." },
];

const NAV_ACTIONS: ActionType[] = ["move", "wait", "pickup", "place", "interact", "say"];
const TD_ACTIONS: ActionType[] = ["place_tower", "start_wave", "wait", "say"];
const MARKET_ACTIONS: ActionType[] = ["long", "short", "close", "hold"];

const PROMPT_BUDGET = [0, 200, 300, 400];
const LIMITS = [
  null,
  { ticks: 80, llmCalls: 15, wallClockMs: 90000 },
  { ticks: 140, llmCalls: 25, wallClockMs: 150000 },
  { ticks: 200, llmCalls: 40, wallClockMs: 180000 },
];
const SCORING = { completion: 100, perTick: -0.5, perChar: -0.05, perLlmCall: -1 };
/** Rune trading: one candle per tick, one LLM call (the charter is compiled once per level). */
const MARKET_PROMPT_BUDGET = [0, 250, 300, 350, 400];
const MARKET_LIMITS = { ticks: DEFAULT_CANDLE_COUNT, llmCalls: 1, wallClockMs: 90000 };
const MARKET_SCORING = { completion: 100, perTick: 0, perChar: -0.02, perLlmCall: -1 };

const TOWER_TYPES: Record<string, TowerTypeSpec> = {
  archer: { id: "archer", range: 3, damage: 1, label: "Archer (range 3, 1 dmg)" },
  cannon: { id: "cannon", range: 2, damage: 2, label: "Cannon (range 2, 2 dmg)" },
  ballista: { id: "ballista", range: 4, damage: 1, label: "Ballista (range 4, 1 dmg)" },
};

const GOLEM_FACTS = [
  "You are a stone golem. You see only a small window around you; unknown tiles show as '?'.",
  "Coordinates are [x,y]; x grows east, y grows south. north = y-1, south = y+1.",
  "Each action costs one tick. When the tick budget ends the level is lost.",
];

function makeLevel(
  mode: ModeId,
  tier: number,
  index: number,
  seed: number,
  title: string,
  brief: string,
  playerKnows: string[],
  agentKnows: string[],
  env: LevelSpec["env"],
  observation: LevelSpec["observation"],
  opponent?: OpponentSpec,
): LevelSpec {
  const spec: LevelSpec = {
    id: `${mode}-t${tier}-l${index}`,
    mode,
    tier,
    index,
    title,
    brief,
    playerKnows,
    agentKnows: [...(mode === "runetrading" ? [] : GOLEM_FACTS), ...agentKnows],
    promptBudget: mode === "runetrading" ? MARKET_PROMPT_BUDGET[tier] : PROMPT_BUDGET[tier],
    env,
    observation,
    limits: mode === "runetrading" ? MARKET_LIMITS : LIMITS[tier]!,
    actions: mode === "towerdefense" ? TD_ACTIONS : mode === "runetrading" ? MARKET_ACTIONS : NAV_ACTIONS,
    scoring: mode === "runetrading" ? MARKET_SCORING : SCORING,
    seed,
  };
  if (opponent) spec.opponent = opponent;
  return spec;
}

// ───────────────────────── Rune Trading ─────────────────────────

const MARKET_CLASSES: ChartClass[] = ["bull", "bear", "flat", "double-bottom"];
const MARKET_TITLES = ["Emerald Ascent", "Crimson Descent", "Silent Range", "Runic Trousers"];
const MARKET_KNOWS = [
  "A complete reference chart is visible for level 1. Levels 2 and 3 use unseen charts with the same market regime.",
  "One action is evaluated at each candle close. You may hold one long or short position without leverage.",
  "Every open and close pays a 0.1% fee. Any remaining position is closed after the final candle.",
  "Finish with net profit above zero. Absolute price thresholds are forbidden; use indicators and relative relationships.",
];
const MARKET_AGENT = [
  "Apply the compiled strategy mechanically to each newly revealed candle.",
  "Never use future candles. Only the revealed OHLC history and enabled indicators are available.",
];

function marketTier(tier: number): TierSpec {
  const chartClass = MARKET_CLASSES[tier - 1];
  const levels = [1, 2, 3].map((index) => {
    const seed = 44000 + tier * 100 + index * 7;
    const spec = makeLevel(
      "runetrading",
      tier,
      index,
      seed,
      index === 1 ? `${MARKET_TITLES[tier - 1]} — Reference` : `${MARKET_TITLES[tier - 1]} — Trial ${index - 1}`,
      `Trade ${DEFAULT_CANDLE_COUNT} candles from a fictional pair with a ${chartClass} regime and finish above the starting balance after fees.`,
      MARKET_KNOWS,
      MARKET_AGENT,
      {
        size: [1, 1],
        generator: "runetrading",
        params: {
          chartClass,
          candleCount: DEFAULT_CANDLE_COUNT,
          feeBps: DEFAULT_FEE_BPS,
          startingBalance: DEFAULT_STARTING_BALANCE,
          indicators: DEFAULT_MARKET_INDICATORS.map((indicator) => ({ ...indicator })),
          guarantee: ["valid_ohlc", "profitable_trade_exists"],
        },
      },
      { radius: 0, memoryTicks: DEFAULT_CANDLE_COUNT },
    );
    // Level 1 is the public reference chart: its catalogue seed is never replaced, so the preview matches the run.
    if (index === 1) spec.trainingPreview = generateMarketSeries({ seed, chartClass, candleCount: DEFAULT_CANDLE_COUNT });
    return spec;
  });
  return { mode: "runetrading", tier, title: MARKET_TITLES[tier - 1], levels };
}

// ───────────────────────── Maze ─────────────────────────

const MAZE_KNOWS = [
  "The altar (A) is somewhere in the maze; the golem starts in the top-left corner.",
  "Walls (#) block movement. There are no hazards in this mode.",
  "The maze is a perfect labyrinth on tier 1; later tiers add loops and shrink the vision window.",
];
const MAZE_AGENT = ["Reach the altar tile 'A'. Prefer unexplored directions; remember dead ends."];

function mazeTier(tier: number): TierSpec {
  const size = [9, 13, 17][tier - 1];
  const radius = [3, 3, 2][tier - 1];
  const deadEnd = [0, 0.3, 0.5][tier - 1];
  const titles = [
    ["First Steps", "Two Turns", "Little Labyrinth"],
    ["Crossroads", "Loops and Lies", "Long Way Round"],
    ["Dim Corridors", "Fog of Stone", "The Deep Maze"],
  ][tier - 1];
  const levels = titles.map((title, i) =>
    makeLevel(
      "maze",
      tier,
      i + 1,
      11000 + tier * 100 + (i + 1) * 7,
      title,
      `Guide the golem from the top-left corner to the altar. ${size}x${size} maze, vision radius ${radius}.`,
      MAZE_KNOWS,
      MAZE_AGENT,
      { size: [size, size], generator: "maze", params: { deadEndFactor: deadEnd, guarantee: ["bfs_path_exists"] } },
      { radius, memoryTicks: 12 },
    ),
  );
  return { mode: "maze", tier, title: ["Warm-up", "Branches", "Blindfold"][tier - 1], levels };
}

// ───────────────────────── Red Floor ─────────────────────────

const RED_KNOWS = [
  "Red tiles (R) destroy the golem instantly. Bridges (=) are safe.",
  "A plank (p) can be picked up (one at a time) and placed onto an adjacent red tile to make a bridge.",
  "Locked doors (D) need a key (k). Some doors only open from a lever (L). Crates (C) can be pushed; a crate pushed onto red floor becomes a bridge.",
  "The golem starts on the west side; the altar (A) is on the east side.",
];
const RED_AGENT = [
  "Never move onto 'R'. Bridges '=' are safe.",
  "'pickup' takes an item on your tile; 'place' puts a carried plank onto the adjacent hazard in a direction; 'interact' opens doors, pulls levers and pushes crates in a direction.",
];

function redTier(tier: number): TierSpec {
  const size = [10, 14, 16][tier - 1];
  const radius = [4, 3, 1][tier - 1];
  const memoryTicks = [10, 14, 20][tier - 1];
  const rows: {
    title: string;
    hazardDensity: number;
    planks: number;
    keys?: number;
    levers?: number;
    crates?: number;
    maxCarry?: number;
  }[][] = [
    [
      { title: "Hot Floor", hazardDensity: 0.05, planks: 0 },
      { title: "Scattered Embers", hazardDensity: 0.08, planks: 0 },
      { title: "Careful Now", hazardDensity: 0.12, planks: 0 },
    ],
    [
      { title: "One Plank", hazardDensity: 0.16, planks: 1 },
      { title: "Locked Away", hazardDensity: 0.16, planks: 2, keys: 1 },
      { title: "Pull the Lever", hazardDensity: 0.18, planks: 2, levers: 1, crates: 1 },
    ],
    [
      { title: "Narrow Sight", hazardDensity: 0.2, planks: 2, keys: 1, crates: 1 },
      { title: "Key and Lever", hazardDensity: 0.22, planks: 3, keys: 1, levers: 1, crates: 1, maxCarry: 2 },
      { title: "Molten Vault", hazardDensity: 0.24, planks: 3, keys: 1, levers: 1, crates: 2, maxCarry: 2 },
    ],
  ];
  const levels = rows[tier - 1].map((r, i) =>
    makeLevel(
      "redfloor",
      tier,
      i + 1,
      22000 + tier * 100 + (i + 1) * 7,
      r.title,
      `Cross the red floor to the altar. ${size}x${size} room, vision radius ${radius}${r.planks ? `, ${r.planks} plank(s) available` : ""}${r.keys ? ", a locked door" : ""}${r.levers ? ", a lever door" : ""}${r.crates ? ", crates" : ""}.`,
      RED_KNOWS,
      RED_AGENT,
      {
        size: [size, size],
        generator: "redfloor",
        params: {
          hazardDensity: r.hazardDensity,
          planks: r.planks,
          keys: r.keys ?? 0,
          levers: r.levers ?? 0,
          crates: r.crates ?? 0,
          maxCarry: r.maxCarry ?? 1,
          guarantee: ["safe_path_or_planks_suffice", "items_reachable_safely"],
        },
      },
      { radius, memoryTicks },
    ),
  );
  return { mode: "redfloor", tier, title: ["Embers", "Tools", "Narrow Vision"][tier - 1], levels };
}

// ───────────────────────── Tower Defense ─────────────────────────

const TD_KNOWS = [
  "Enemies walk the path (~) from the spawn (S) to your base (B). Each enemy that reaches the base costs 1 base HP.",
  "Towers go on buildable slots (_) next to the path. You have a limited number of towers per level.",
  "Waves start only when the golem calls start_wave. Read the enemy rules carefully: they react to what happened in the previous wave.",
];
const TD_AGENT = [
  "Place all towers before starting waves; a wave runs fully in one action.",
  "A tower hits the enemy closest to the base within its range once per sub-tick. Slots near path bends cover more tiles.",
  "Slots are listed in td.buildableSlots; the enemy rules are in td.opponentCharter.",
];

function tdTier(tier: number): TierSpec {
  const towerLimit = [3, 4, 5][tier - 1];
  const baseHp = [3, 3, 2][tier - 1];
  const towerTypes = [
    [TOWER_TYPES.archer],
    [TOWER_TYPES.archer, TOWER_TYPES.cannon],
    [TOWER_TYPES.archer, TOWER_TYPES.cannon, TOWER_TYPES.ballista],
  ][tier - 1];
  const grunt = (count: number, hp = 3) => ({ count, enemyType: "grunt", hp, speed: 1 });
  const runner = (count: number, hp = 2) => ({ count, enemyType: "runner", hp, speed: 2 });
  const brute = (count: number, hp = 6) => ({ count, enemyType: "brute", hp, speed: 1 });

  const opponents: { title: string; opponent: OpponentSpec }[][] = [
    [
      {
        title: "Grunt Parade",
        opponent: {
          charter:
            "Wave 1: 4 grunts (3 hp, speed 1). Wave 2: 5 grunts. Wave 3: 6 grunts. If any enemy reached your base, the next wave has +2 enemies.",
          waves: [grunt(4), grunt(5), grunt(6)],
          rules: { onLeakBonus: 2 },
        },
      },
      {
        title: "Runners Incoming",
        opponent: {
          charter:
            "Wave 1: 4 grunts. Wave 2: 6 grunts. Wave 3: 7 grunts. If any enemy reached your base, the next wave has +2 enemies. If nothing leaks, the next wave switches to fast runners (speed +1).",
          waves: [grunt(4), grunt(6), grunt(7)],
          rules: { onLeakBonus: 2, onNoLeakSwitch: true },
        },
      },
      {
        title: "Steady Pressure",
        opponent: {
          charter:
            "Wave 1: 5 grunts. Wave 2: 6 grunts. Wave 3: 8 grunts. If any enemy reached your base, the next wave has +3 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(5), grunt(6), grunt(8)],
          rules: { onLeakBonus: 3, onNoLeakSwitch: true },
        },
      },
    ],
    [
      {
        title: "Mixed Company",
        opponent: {
          charter:
            "Wave 1: 5 grunts. Wave 2: 6 runners (2 hp, speed 2). Wave 3: 8 grunts. Wave 4: 3 brutes (6 hp). If any enemy reached your base, the next wave has +2 enemies.",
          waves: [grunt(5), runner(6), grunt(8), brute(3)],
          rules: { onLeakBonus: 2 },
        },
      },
      {
        title: "Punish the Leak",
        opponent: {
          charter:
            "Wave 1: 6 grunts. Wave 2: 6 runners. Wave 3: 8 grunts. Wave 4: 4 brutes. If any enemy reached your base, the next wave has +3 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(6), runner(6), grunt(8), brute(4)],
          rules: { onLeakBonus: 3, onNoLeakSwitch: true },
        },
      },
      {
        title: "Brute Season",
        opponent: {
          charter:
            "Wave 1: 6 grunts. Wave 2: 8 grunts. Wave 3: 4 brutes (6 hp). Wave 4: 5 brutes. If any enemy reached your base, the next wave has +2 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(6), grunt(8), brute(4), brute(5)],
          rules: { onLeakBonus: 2, onNoLeakSwitch: true },
        },
      },
    ],
    [
      {
        title: "Five Waves",
        opponent: {
          charter:
            "Wave 1: 6 grunts. Wave 2: 8 runners. Wave 3: 10 grunts. Wave 4: 4 brutes. Wave 5: 6 brutes. If any enemy reached your base, the next wave has +3 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(6), runner(8), grunt(10), brute(4), brute(6)],
          rules: { onLeakBonus: 3, onNoLeakSwitch: true },
        },
      },
      {
        title: "Thin Walls",
        opponent: {
          charter:
            "Wave 1: 8 grunts. Wave 2: 8 runners. Wave 3: 10 grunts (4 hp). Wave 4: 5 brutes. Wave 5: 6 brutes (7 hp). If any enemy reached your base, the next wave has +3 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(8), runner(8), grunt(10, 4), brute(5), brute(6, 7)],
          rules: { onLeakBonus: 3, onNoLeakSwitch: true },
        },
      },
      {
        title: "Last Stand",
        opponent: {
          charter:
            "Wave 1: 8 grunts. Wave 2: 10 runners. Wave 3: 12 grunts (4 hp). Wave 4: 6 brutes. Wave 5: 8 brutes (7 hp). If any enemy reached your base, the next wave has +4 enemies. If nothing leaks, the next wave switches to fast runners.",
          waves: [grunt(8), runner(10), grunt(12, 4), brute(6), brute(8, 7)],
          rules: { onLeakBonus: 4, onNoLeakSwitch: true },
        },
      },
    ],
  ];

  const levels = opponents[tier - 1].map((o, i) =>
    makeLevel(
      "towerdefense",
      tier,
      i + 1,
      33000 + tier * 100 + (i + 1) * 7,
      o.title,
      `Defend the base through ${o.opponent.waves.length} waves with ${towerLimit} towers. Base HP ${baseHp}.`,
      TD_KNOWS,
      TD_AGENT,
      {
        size: [12, 12],
        generator: "towerdefense",
        params: { towerTypes, towerLimit, baseHp, guarantee: ["path_spawn_to_base"] },
      },
      { radius: 12, memoryTicks: 10 },
      o.opponent,
    ),
  );
  return { mode: "towerdefense", tier, title: ["Grunts", "Mixed Waves", "Siege"][tier - 1], levels };
}

// ───────────────────────── Catalogue ─────────────────────────

export const TIERS: TierSpec[] = [
  mazeTier(1),
  mazeTier(2),
  mazeTier(3),
  redTier(1),
  redTier(2),
  redTier(3),
  marketTier(1),
  marketTier(2),
  marketTier(3),
  marketTier(4),
];

/** Tower defense is not part of the product any more; its tiers stay only for the engine tests. */
export const TD_TIERS: TierSpec[] = [tdTier(1), tdTier(2), tdTier(3)];

export const ALL_LEVELS: LevelSpec[] = TIERS.flatMap((t) => t.levels);

export function listTiers(mode: ModeId): TierSpec[] {
  return TIERS.filter((t) => t.mode === mode);
}

export function getTier(mode: ModeId, tier: number): TierSpec | undefined {
  return TIERS.find((t) => t.mode === mode && t.tier === tier);
}

export function getLevel(id: string): LevelSpec | undefined {
  return ALL_LEVELS.find((l) => l.id === id);
}
