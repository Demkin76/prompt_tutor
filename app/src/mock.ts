/**
 * In-memory mock backend. Hand-built worlds + scripted frames so every screen works without Convex.
 */
import type {
  Action,
  DecisionRecord,
  Dir,
  Entity,
  Frame,
  LevelRunResult,
  LevelSpec,
  ModeId,
  RunSummary,
  SimEvent,
  TierSpec,
  TileType,
  Vec,
  WorldState,
} from "@core/types";
import type { DecisionRow, FrameRow, LevelRunDoc, ModeInfo, RunDoc, SessionDoc } from "./api";
import type { RunnerMessage } from "@core/types";
import { listTiers } from "@core/index";

// ───────────────────────── helpers ─────────────────────────
const W = 12, H = 12;
const idx = (x: number, y: number) => y * W + x;

function grid(fill: TileType = "floor"): TileType[] {
  const t: TileType[] = new Array(W * H).fill(fill);
  for (let x = 0; x < W; x++) {
    t[idx(x, 0)] = "wall";
    t[idx(x, H - 1)] = "wall";
  }
  for (let y = 0; y < H; y++) {
    t[idx(0, y)] = "wall";
    t[idx(W - 1, y)] = "wall";
  }
  return t;
}

function seenAround(prev: number[], pos: Vec, radius: number): number[] {
  const set = new Set(prev);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = pos[0] + dx, y = pos[1] + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) set.add(idx(x, y));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function ent(id: string, kind: Entity["kind"], pos: Vec, assetKey: string, props: Entity["props"] = {}): Entity {
  return { id, kind, pos, props, visual: { assetKey, animation: "idle", facing: "south" } };
}

const RADIUS = 2;

// ───────────────────────── Red floor world ─────────────────────────
export function buildRedFloorWorld(): WorldState {
  const tiles = grid();
  for (const y of [1, 2, 3]) tiles[idx(4, y)] = "wall";
  for (let x = 1; x <= 10; x++) tiles[idx(x, 6)] = "hazard";
  tiles[idx(8, 2)] = "hazard";
  tiles[idx(9, 3)] = "hazard";
  tiles[idx(7, 9)] = "hazard";
  tiles[idx(4, 8)] = "wall";
  tiles[idx(5, 8)] = "wall";
  tiles[idx(5, 9)] = "altar";
  const start: Vec = [1, 1];
  return {
    tick: 0,
    size: [W, H],
    tiles,
    entities: [ent("plank-1", "plank", [2, 4], "item.plank"), ent("plank-2", "plank", [8, 4], "item.plank")],
    agent: { pos: start, facing: "east", inventory: [], alive: true },
    status: "running",
    rngState: 12345,
    seen: seenAround([], start, RADIUS),
  };
}

type Step = { action: Action; events: (t: number) => SimEvent[]; mutate?: (s: WorldState) => void };

const mv = (dir: Dir): Action => ({ type: "move", args: { dir } });
const DELTA: Record<Dir, Vec> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function moveStep(dir: Dir, blocked = false): Step {
  return {
    action: mv(dir),
    events: (t) => (blocked ? [{ tick: t, type: "blocked", data: { dir } }] : [{ tick: t, type: "moved", data: { dir } }]),
    mutate: (s) => {
      s.agent.facing = dir;
      if (!blocked) s.agent.pos = [s.agent.pos[0] + DELTA[dir][0], s.agent.pos[1] + DELTA[dir][1]];
    },
  };
}

function runScript(initial: WorldState, steps: Step[], levelId: string): Frame[] {
  const frames: Frame[] = [];
  let state: WorldState = JSON.parse(JSON.stringify(initial));
  steps.forEach((step, i) => {
    const tick = i + 1;
    state = JSON.parse(JSON.stringify(state));
    state.tick = tick;
    step.mutate?.(state);
    const events = step.events(tick);
    state.seen = seenAround(state.seen, state.agent.pos, RADIUS);
    frames.push({ levelId, tick, action: step.action, events, state });
  });
  return frames;
}

/** Success script: walks east, bumps a wall, detours, picks a plank, bridges the red floor, reaches the altar. */
function redFloorSuccess(levelId: string): Frame[] {
  const steps: Step[] = [
    moveStep("east"),
    moveStep("east"),
    moveStep("east", true),
    moveStep("south"),
    moveStep("south"),
    moveStep("south"),
    moveStep("west"),
    {
      action: { type: "pickup" },
      events: (t) => [{ tick: t, type: "picked_up", data: { item: "plank" } }],
      mutate: (s) => {
        s.entities = s.entities.filter((e) => e.id !== "plank-1");
        s.agent.inventory.push("plank");
      },
    },
    moveStep("south"),
    {
      action: { type: "place", args: { dir: "south" } },
      events: (t) => [{ tick: t, type: "placed", data: { pos: [2, 6] } }],
      mutate: (s) => {
        s.agent.facing = "south";
        s.tiles[idx(2, 6)] = "bridge";
        s.agent.inventory = [];
      },
    },
    moveStep("south"),
    moveStep("south"),
    moveStep("south"),
    moveStep("south"),
    moveStep("east"),
    moveStep("east"),
    {
      action: mv("east"),
      events: (t) => [
        { tick: t, type: "moved", data: { dir: "east" } },
        { tick: t, type: "goal_reached", data: { pos: [5, 9] } },
      ],
      mutate: (s) => {
        s.agent.facing = "east";
        s.agent.pos = [5, 9];
        s.status = "won";
      },
    },
  ];
  return runScript(buildRedFloorWorld(), steps, levelId);
}

/** Failure script: charges south straight into the red floor. */
function redFloorFail(levelId: string): Frame[] {
  const steps: Step[] = [
    moveStep("east"),
    moveStep("east"),
    moveStep("south"),
    moveStep("south"),
    moveStep("south"),
    moveStep("south"),
    {
      action: mv("south"),
      events: (t) => [
        { tick: t, type: "moved", data: { dir: "south" } },
        { tick: t, type: "hazard_entered", data: { pos: [3, 6] } },
      ],
      mutate: (s) => {
        s.agent.facing = "south";
        s.agent.pos = [3, 6];
        s.agent.alive = false;
        s.status = "lost";
      },
    },
  ];
  return runScript(buildRedFloorWorld(), steps, levelId);
}

const redFloorDecisions = (fail: boolean): DecisionRecord[] =>
  fail
    ? [
        { tick: 0, intent: "Head east, then push south toward the altar.", plan: [mv("east"), mv("east")], stopOn: ["blocked", "hazard_detected"], latencyMs: 820 },
        { tick: 2, intent: "Keep going south, the altar must be below.", plan: [mv("south"), mv("south"), mv("south"), mv("south"), mv("south")], stopOn: ["blocked"], latencyMs: 640 },
      ]
    : [
        { tick: 0, intent: "Explore east along the top corridor.", plan: [mv("east"), mv("east"), mv("east")], stopOn: ["blocked", "item_visible"], latencyMs: 910 },
        { tick: 3, intent: "Wall ahead. Go south and look for a way around.", plan: [mv("south"), mv("south"), mv("south")], stopOn: ["item_visible", "hazard_detected"], latencyMs: 770 },
        { tick: 6, intent: "A plank! Grab it.", plan: [mv("west"), { type: "pickup" }], stopOn: ["plan_done"], latencyMs: 690 },
        { tick: 8, intent: "Red floor below. Bridge it with the plank and cross.", plan: [mv("south"), { type: "place", args: { dir: "south" } }, mv("south"), mv("south")], stopOn: ["blocked"], latencyMs: 1010 },
        { tick: 12, intent: "Altar is south-east. Walk to it.", plan: [mv("south"), mv("south"), mv("east"), mv("east"), mv("east")], stopOn: ["goal_visible", "blocked"], latencyMs: 580 },
      ];

// ───────────────────────── Tower defense world ─────────────────────────
export const TD_PATH: Vec[] = [
  [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [5, 6], [5, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8],
];

export function buildTowerDefenseWorld(): WorldState {
  const tiles = grid();
  for (const [x, y] of TD_PATH) tiles[idx(x, y)] = "path";
  tiles[idx(0, 5)] = "spawn";
  tiles[idx(11, 8)] = "base";
  const slots: Vec[] = [[2, 4], [3, 4], [4, 4], [2, 6], [3, 6], [4, 7], [6, 6], [6, 7], [7, 7], [8, 7], [9, 7], [7, 9], [9, 9]];
  for (const [x, y] of slots) tiles[idx(x, y)] = "buildable";
  const all: number[] = [];
  for (let i = 0; i < W * H; i++) all.push(i);
  return {
    tick: 0,
    size: [W, H],
    tiles,
    entities: [ent("base", "base", [11, 8], "td.base", { hp: 10 })],
    agent: { pos: [1, 10], facing: "east", inventory: [], alive: true },
    td: { phase: "build", waveIndex: 0, wavesTotal: 2, baseHp: 10, baseHpMax: 10, towersLeft: 2 },
    status: "running",
    rngState: 777,
    seen: all,
  };
}

function towerAt(id: string, pos: Vec, towerType: string): Entity {
  return ent(id, "tower", pos, "td.tower", { towerType, range: 2, damage: 2 });
}

/** Builds a sub-tick trace of enemies walking the path, taking damage near towers. */
function waveTrace(count: number, hp: number, towers: Vec[], leakOne: boolean): { trace: { subTick: number; enemies: { id: string; pos: Vec; hp: number }[] }[]; killed: number; leaked: number } {
  const enemies = Array.from({ length: count }, (_, i) => ({ id: `e${i}`, hp, offset: i * 2, dead: false, leaked: false }));
  const trace: { subTick: number; enemies: { id: string; pos: Vec; hp: number }[] }[] = [];
  const maxSub = TD_PATH.length + count * 2 + 1;
  for (let sub = 0; sub < maxSub; sub++) {
    const snapshot: { id: string; pos: Vec; hp: number }[] = [];
    for (const en of enemies) {
      const pi = sub - en.offset;
      if (pi < 0 || en.dead || en.leaked) continue;
      if (pi >= TD_PATH.length) {
        en.leaked = true;
        continue;
      }
      const pos = TD_PATH[pi];
      for (const t of towers) {
        const inRange = Math.abs(t[0] - pos[0]) <= 2 && Math.abs(t[1] - pos[1]) <= 2;
        const spare = leakOne && en.id === `e${count - 1}`;
        if (inRange && !spare) en.hp -= 2;
      }
      if (en.hp <= 0) {
        en.dead = true;
        continue;
      }
      snapshot.push({ id: en.id, pos, hp: en.hp });
    }
    trace.push({ subTick: sub, enemies: snapshot });
    if (enemies.every((e) => e.dead || e.leaked)) break;
  }
  return { trace, killed: enemies.filter((e) => e.dead).length, leaked: enemies.filter((e) => e.leaked).length };
}

function towerDefenseScript(levelId: string): Frame[] {
  const towers: Vec[] = [[3, 4], [6, 7]];
  const w1 = waveTrace(3, 6, towers, false);
  const w2 = waveTrace(4, 8, towers, true);
  const steps: Step[] = [
    {
      action: { type: "place_tower", args: { pos: towers[0], towerType: "arrow" } },
      events: (t) => [{ tick: t, type: "tower_placed", data: { pos: towers[0], towerType: "arrow" } }],
      mutate: (s) => {
        s.entities.push(towerAt("tower-1", towers[0], "arrow"));
        s.td!.towersLeft = 1;
      },
    },
    {
      action: { type: "place_tower", args: { pos: towers[1], towerType: "arrow" } },
      events: (t) => [{ tick: t, type: "tower_placed", data: { pos: towers[1], towerType: "arrow" } }],
      mutate: (s) => {
        s.entities.push(towerAt("tower-2", towers[1], "arrow"));
        s.td!.towersLeft = 0;
      },
    },
    {
      action: { type: "start_wave" },
      events: (t) => [
        { tick: t, type: "wave_started", data: { wave: 1, count: 3 } },
        ...Array.from({ length: w1.killed }, (_, i) => ({ tick: t, type: "enemy_killed" as const, data: { id: `e${i}` } })),
        { tick: t, type: "wave_ended", data: { wave: 1, spawned: 3, killed: w1.killed, leaked: w1.leaked, hpMax: 6, trace: w1.trace } },
      ],
      mutate: (s) => {
        s.td!.waveIndex = 1;
        s.td!.lastWave = { spawned: 3, killed: w1.killed, leaked: w1.leaked };
      },
    },
    {
      action: { type: "start_wave" },
      events: (t) => [
        { tick: t, type: "wave_started", data: { wave: 2, count: 4 } },
        ...Array.from({ length: w2.killed }, (_, i) => ({ tick: t, type: "enemy_killed" as const, data: { id: `e${i}` } })),
        ...(w2.leaked ? [{ tick: t, type: "enemy_leaked" as const, data: { id: "e3", damage: 2 } }] : []),
        { tick: t, type: "wave_ended", data: { wave: 2, spawned: 4, killed: w2.killed, leaked: w2.leaked, hpMax: 8, trace: w2.trace } },
        { tick: t, type: "all_waves_cleared" },
      ],
      mutate: (s) => {
        s.td!.waveIndex = 2;
        s.td!.phase = "done";
        s.td!.baseHp = 10 - w2.leaked * 2;
        s.td!.lastWave = { spawned: 4, killed: w2.killed, leaked: w2.leaked };
        s.status = "won";
      },
    },
  ];
  return runScript(buildTowerDefenseWorld(), steps, levelId);
}

const tdDecisions: DecisionRecord[] = [
  { tick: 0, intent: "Cover both corners of the path with arrow towers.", plan: [{ type: "place_tower", args: { pos: [3, 4], towerType: "arrow" } }, { type: "place_tower", args: { pos: [6, 7], towerType: "arrow" } }], stopOn: ["plan_done"], latencyMs: 1200 },
  { tick: 2, intent: "Towers are set. Start the waves.", plan: [{ type: "start_wave" }, { type: "start_wave" }], stopOn: ["plan_done"], latencyMs: 700 },
];

// ───────────────────────── Specs ─────────────────────────
export const MODES: ModeInfo[] = [
  { id: "maze", title: "Maze", tagline: "Find the altar through winding stone corridors." },
  { id: "redfloor", title: "Red Floor", tagline: "The floor is lava. Bridge it or burn." },
  { id: "towerdefense", title: "Tower Defense", tagline: "Read the enemy's charter. Out-plan it." },
];

const MODE_TITLE: Record<ModeId, string> = { maze: "Maze", redfloor: "Red Floor", towerdefense: "Tower Defense" };

const ENEMY_CHARTER =
  "I send waves along the path from the spawn to the base.\n" +
  "Wave 1: 3 grunts (6 hp). Wave 2: 4 grunts (8 hp).\n" +
  "If a wave leaks at least one enemy, the next wave gets +2 grunts.\n" +
  "I never change the path. I never stop.";

function levelSpec(mode: ModeId, tier: number, index: number): LevelSpec {
  const base = {
    mode,
    tier,
    index,
    promptBudget: 200 + (tier - 1) * 150,
    agentKnows: [],
    observation: { radius: RADIUS, memoryTicks: 20 },
    limits: { ticks: 60, llmCalls: 12, wallClockMs: 120000 },
    scoring: { completion: 100, perTick: -0.5, perChar: -0.05, perLlmCall: -1 },
    seed: 1000 * tier + index,
  };
  if (mode === "towerdefense") {
    return {
      ...base,
      id: `towerdefense-t${tier}-l${index}`,
      title: ["First Line", "The Bend", "Long Road"][index - 1],
      brief: "Place towers on the green slots, then start the waves. Keep the base alive through every wave.",
      playerKnows: [
        "Enemies walk the sand path from the purple spawn to the blue base.",
        "Towers can only be built on green slots. Arrow tower: range 2, damage 2.",
        `Tower limit: 2 per level.`,
        "Each leaked enemy deals 2 damage to the base (10 hp).",
      ],
      env: { size: [W, H], generator: "towerdefense", params: { towerLimit: 2, baseHp: 10, towerTypes: [{ id: "arrow", range: 2, damage: 2, label: "Arrow" }] } },
      actions: ["place_tower", "start_wave", "wait", "say"],
      opponent: { charter: ENEMY_CHARTER, waves: [{ count: 3, enemyType: "grunt", hp: 6, speed: 1 }, { count: 4, enemyType: "grunt", hp: 8, speed: 1 }], rules: { onLeakBonus: 2 } },
    };
  }
  if (mode === "maze") {
    return {
      ...base,
      id: `maze-t${tier}-l${index}`,
      title: ["Stone Corridors", "The Fork", "Dead Ends"][index - 1],
      brief: "Reach the glowing altar. The golem sees only 2 tiles around itself.",
      playerKnows: [
        "Walls block movement. Bumping a wall wastes a tick.",
        "The golem remembers tiles it has seen.",
        "A plank can bridge a single red tile.",
        "Budget: 60 ticks, 12 LLM calls.",
      ],
      env: { size: [W, H], generator: "maze", params: { deadEndFactor: 0.3, planks: 1 } },
      actions: ["move", "wait", "pickup", "place", "say"],
    };
  }
  return {
    ...base,
    id: `redfloor-t${tier}-l${index}`,
    title: ["Ember Hall", "Crimson Crossing", "Ashen Vault"][index - 1],
    brief: "Reach the altar without stepping on red floor. Red floor destroys the golem instantly.",
    playerKnows: [
      "Red tiles are deadly. Stepping on one ends the level.",
      "Planks lie around the level; the golem carries at most one.",
      "Placing a plank on an adjacent red tile turns it into a bridge.",
      "Budget: 60 ticks, 12 LLM calls.",
    ],
    env: { size: [W, H], generator: "redfloor", params: { hazardDensity: 0.15, planks: 2, maxCarry: 1, guarantee: ["path_with_planks"] } },
    actions: ["move", "wait", "pickup", "place", "say"],
  };
}

/** Real catalogue from the engine with seeds hidden (same shape the Convex `levels.tiers` query returns). */
export function buildTiers(mode: ModeId): TierSpec[] {
  return listTiers(mode).map((t) => ({ ...t, levels: t.levels.map((l) => ({ ...l, seed: 0, agentKnows: [] })) }));
}

/** Hand-built catalogue kept for the scripted fallback worlds. */
export function buildScriptedTiers(mode: ModeId): TierSpec[] {
  const names = ["Apprentice", "Journeyman", "Master"];
  return [1, 2, 3].map((tier) => ({
    mode,
    tier,
    title: `${MODE_TITLE[mode]} — ${names[tier - 1]}`,
    levels: [1, 2, 3].map((i) => levelSpec(mode, tier, i)),
  }));
}

// ───────────────────────── Store ─────────────────────────
type Listener = () => void;

export class MockStore {
  version = 0;
  session: SessionDoc | null = null;
  runs = new Map<string, RunDoc>();
  levelRuns = new Map<string, LevelRunDoc[]>();
  frames = new Map<string, FrameRow[]>();
  decisions = new Map<string, DecisionRow[]>();
  private listeners = new Set<Listener>();
  private timers: number[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private key(runId: string, levelId: string): string {
    return `${runId}/${levelId}`;
  }

  ensureSession(sessionId: string): SessionDoc {
    if (!this.session || this.session.sessionId !== sessionId) {
      let saved: SessionDoc | null = null;
      try {
        const raw = localStorage.getItem("golem.mock.session");
        if (raw) saved = JSON.parse(raw) as SessionDoc;
      } catch {
        /* ignore */
      }
      this.session = saved?.sessionId === sessionId ? saved : { sessionId, progress: { maze: 1, redfloor: 1, towerdefense: 1 }, best: {} };
      this.bump();
    }
    return this.session;
  }

  private persistSession(): void {
    try {
      localStorage.setItem("golem.mock.session", JSON.stringify(this.session));
    } catch {
      /* ignore */
    }
  }

  getLevelRuns(runId: string): LevelRunDoc[] {
    return this.levelRuns.get(runId) ?? [];
  }

  getFrames(runId: string, levelId: string): FrameRow[] {
    return this.frames.get(this.key(runId, levelId)) ?? [];
  }

  getDecisions(runId: string, levelId: string): DecisionRow[] {
    return this.decisions.get(this.key(runId, levelId)) ?? [];
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  createRun(args: { sessionId: string; mode: ModeId; tier: number; charter: string }): string {
    const runId = "mock-" + Math.random().toString(36).slice(2, 10);
    const run: RunDoc = { runId, sessionId: args.sessionId, mode: args.mode, tier: args.tier, charter: args.charter, status: "queued", host: "mock" };
    this.runs.set(runId, run);
    this.levelRuns.set(runId, []);
    this.bump();
    // Prefer a pre-recorded run of the real engine (app/public/demo/<mode>-t<tier>.json); fall back to the hand-built script.
    fetch(`${import.meta.env.BASE_URL}demo/${args.mode}-t${args.tier}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rec: { messages: RunnerMessage[] }) => this.playRecorded(runId, run, rec.messages))
      .catch(() => this.playScripted(runId, run, args));
    return runId;
  }

  /** Mirrors convex/runs.ts `ingest` so recorded runner messages drive the same store. */
  private ingest(runId: string, run: RunDoc, message: RunnerMessage): void {
    switch (message.kind) {
      case "level_start": {
        const lrs = this.getLevelRuns(runId);
        const lr: LevelRunDoc = { levelId: message.levelId, seed: message.seed, spec: message.spec, initialState: message.initialState, order: lrs.length };
        this.levelRuns.set(runId, [...lrs, lr]);
        this.frames.set(this.key(runId, message.levelId), []);
        this.decisions.set(this.key(runId, message.levelId), []);
        this.runs.set(runId, { ...(this.runs.get(runId) ?? run), status: "running" });
        break;
      }
      case "decision": {
        const k = this.key(runId, message.levelId);
        this.decisions.set(k, [...(this.decisions.get(k) ?? []), { tick: message.record.tick, record: message.record }]);
        break;
      }
      case "frame": {
        const k = this.key(runId, message.frame.levelId);
        this.frames.set(k, [...(this.frames.get(k) ?? []), { tick: message.frame.tick, frame: message.frame }]);
        break;
      }
      case "level_end": {
        this.levelRuns.set(
          runId,
          this.getLevelRuns(runId).map((lr) => (lr.levelId === message.levelId ? { ...lr, result: message.result, replay: message.replay } : lr)),
        );
        break;
      }
      case "run_end": {
        const summary = message.summary;
        this.runs.set(runId, { ...(this.runs.get(runId) ?? run), status: "finished", summary });
        if (this.session) {
          const key = `${run.mode}-${run.tier}`;
          const prev = this.session.best[key];
          const best = { ...this.session.best };
          if (!prev || prev.passedLevels < summary.passedLevels || (prev.passedLevels === summary.passedLevels && prev.score < summary.score))
            best[key] = { score: summary.score, passedLevels: summary.passedLevels, charter: run.charter };
          const progress = { ...this.session.progress };
          if (summary.tierUnlocked && (progress[run.mode] ?? 1) < run.tier + 1 && run.tier < 3) progress[run.mode] = run.tier + 1;
          this.session = { ...this.session, best, progress };
          this.persistSession();
        }
        break;
      }
      case "error":
        this.runs.set(runId, { ...(this.runs.get(runId) ?? run), status: "error", error: message.message });
        break;
    }
    this.bump();
  }

  private playRecorded(runId: string, run: RunDoc, messages: RunnerMessage[]): void {
    let t = 300;
    for (const m of messages) {
      if (m.kind === "frame") {
        const trace = m.frame.events.find((e) => e.type === "wave_ended")?.data?.trace;
        t += Array.isArray(trace) ? trace.length * 120 + 500 : 250;
      } else if (m.kind === "decision") t += 350;
      else if (m.kind === "level_start") t += 600;
      else t += 200;
      this.later(t, () => this.ingest(runId, run, m));
    }
  }

  private playScripted(runId: string, run: RunDoc, args: { sessionId: string; mode: ModeId; tier: number; charter: string }): void {
    const tierSpec = buildTiers(args.mode)[args.tier - 1];

    const careful = /plank|bridge|careful|avoid/i.test(args.charter);
    const FRAME_MS = 400;

    // Plan each level's script.
    const plans = tierSpec.levels.map((spec, i) => {
      let frames: Frame[];
      let decisions: DecisionRecord[];
      if (args.mode === "towerdefense") {
        frames = towerDefenseScript(spec.id);
        decisions = tdDecisions;
      } else {
        const fail = i === 1 && !careful;
        frames = fail ? redFloorFail(spec.id) : redFloorSuccess(spec.id);
        decisions = redFloorDecisions(fail);
      }
      const initial = args.mode === "towerdefense" ? buildTowerDefenseWorld() : buildRedFloorWorld();
      return { spec, frames, decisions, initial };
    });

    let t = 300;
    this.later(t, () => {
      this.runs.set(runId, { ...run, status: "running" });
      this.bump();
    });

    const results: LevelRunResult[] = [];
    plans.forEach((plan, order) => {
      t += 600;
      this.later(t, () => {
        const lr: LevelRunDoc = { levelId: plan.spec.id, seed: plan.spec.seed, spec: plan.spec, initialState: plan.initial, order };
        this.levelRuns.set(runId, [...this.getLevelRuns(runId), lr]);
        this.frames.set(this.key(runId, plan.spec.id), []);
        this.decisions.set(this.key(runId, plan.spec.id), []);
        this.bump();
      });
      // decisions at tick 0 arrive before the first frame
      const pushDecision = (d: DecisionRecord) => {
        const k = this.key(runId, plan.spec.id);
        this.decisions.set(k, [...(this.decisions.get(k) ?? []), { tick: d.tick, record: d }]);
        this.bump();
      };
      for (const d of plan.decisions) {
        if (d.tick === 0) this.later(t + 200, () => pushDecision(d));
      }
      plan.frames.forEach((frame, fi) => {
        // Give the UI time to animate a wave trace before the next frame lands.
        const prev = plan.frames[fi - 1];
        const prevTrace = prev?.events.find((e) => e.type === "wave_ended")?.data?.trace;
        t += Array.isArray(prevTrace) ? prevTrace.length * 120 + 500 : FRAME_MS;
        const at = t;
        for (const d of plan.decisions) {
          if (d.tick === frame.tick) this.later(at - 150, () => pushDecision(d));
        }
        this.later(at, () => {
          const k = this.key(runId, plan.spec.id);
          this.frames.set(k, [...(this.frames.get(k) ?? []), { tick: frame.tick, frame }]);
          this.bump();
        });
        void fi;
      });
      const lastTrace = plan.frames[plan.frames.length - 1]?.events.find((e) => e.type === "wave_ended")?.data?.trace;
      t += Array.isArray(lastTrace) ? lastTrace.length * 120 + 800 : 500;
      this.later(t, () => {
        const last = plan.frames[plan.frames.length - 1];
        const passed = last.state.status === "won";
        const ticks = last.tick;
        const llmCalls = plan.decisions.length;
        const sc = plan.spec.scoring;
        const levelScore = passed ? Math.max(0, Math.round(sc.completion + ticks * sc.perTick + args.charter.length * sc.perChar + llmCalls * sc.perLlmCall)) : 0;
        const result: LevelRunResult = {
          levelId: plan.spec.id,
          seed: plan.spec.seed,
          verdict: {
            passed,
            score: passed ? 1 : 0,
            confidence: 0.95,
            reasons: passed
              ? [args.mode === "towerdefense" ? "All waves cleared; base survived." : "Golem reached the altar alive."]
              : ["Golem stepped on red floor and was destroyed.", "Charter never mentioned planks or avoiding red tiles."],
            evidence: passed
              ? [
                  { type: "event", value: args.mode === "towerdefense" ? "all_waves_cleared" : "goal_reached", note: `tick ${ticks}` },
                  { type: "position", value: last.state.agent.pos, note: "final position" },
                ]
              : [
                  { type: "event", value: "hazard_entered", note: `tick ${ticks}` },
                  { type: "state", value: { alive: false }, note: "agent destroyed" },
                ],
          },
          ticks,
          llmCalls,
          charterLength: args.charter.length,
          levelScore,
        };
        results.push(result);
        const lrs = this.getLevelRuns(runId).map((lr) =>
          lr.levelId === plan.spec.id
            ? {
                ...lr,
                result,
                replay: {
                  runId,
                  levelId: plan.spec.id,
                  seed: plan.spec.seed,
                  charter: args.charter,
                  initialState: plan.initial,
                  decisions: plan.decisions,
                  actions: plan.frames.map((f) => ({ tick: f.tick, action: f.action })),
                  events: plan.frames.flatMap((f) => f.events),
                  finalState: last.state,
                  verdict: result.verdict,
                },
              }
            : lr,
        );
        this.levelRuns.set(runId, lrs);
        this.bump();
      });
    });

    t += 400;
    this.later(t, () => {
      const passedLevels = results.filter((r) => r.verdict.passed).length;
      const tierUnlocked = passedLevels === 3;
      const summary: RunSummary = {
        passedLevels,
        totalLevels: 3,
        score: results.reduce((a, r) => a + r.levelScore, 0),
        tierUnlocked,
        levels: results,
      };
      this.runs.set(runId, { ...run, status: "finished", summary });
      if (this.session) {
        const key = `${args.mode}-${args.tier}`;
        const prev = this.session.best[key];
        const best = { ...this.session.best };
        if (!prev || prev.score < summary.score) best[key] = { score: summary.score, passedLevels, charter: args.charter };
        const progress = { ...this.session.progress };
        if (tierUnlocked && (progress[args.mode] ?? 1) < args.tier + 1 && args.tier < 3) progress[args.mode] = args.tier + 1;
        this.session = { ...this.session, best, progress };
        this.persistSession();
      }
      this.bump();
    });
  }
}

export const mockStore = new MockStore();
