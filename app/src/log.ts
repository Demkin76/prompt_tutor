import { describeEvent as coreDescribeEvent } from "@core/observation";
import type { Action, Frame, SimEvent, Vec } from "@core/types";
import type { DecisionRow, FrameRow } from "./api";

export type LogKind = "intent" | "act" | "event" | "bad";

export interface LogLine {
  key: string;
  tick: number;
  kind: LogKind;
  text: string;
}

const fmtPos = (p: unknown): string => (Array.isArray(p) ? `(${(p as Vec)[0]},${(p as Vec)[1]})` : "");

export function describeAction(a: Action): string {
  switch (a.type) {
    case "move":
      return `moves ${a.args.dir}.`;
    case "wait":
      return "waits.";
    case "interact":
      return a.args?.dir ? `interacts ${a.args.dir}.` : "interacts.";
    case "pickup":
      return "picks up the item here.";
    case "place":
      return `places a plank ${a.args.dir}.`;
    case "say":
      return `says "${a.args.text}"`;
    case "place_tower":
      return `builds a ${a.args.towerType} tower at ${fmtPos(a.args.pos)}.`;
    case "start_wave":
      return "starts the wave.";
    default:
      return "acts.";
  }
}

const BAD_EVENTS = new Set(["hazard_entered", "base_destroyed", "budget_exhausted", "invalid_action", "door_locked", "tower_limit", "enemy_leaked"]);

export function describeEvent(e: SimEvent): string {
  const d = e.data ?? {};
  switch (e.type) {
    case "moved":
      return `Moved ${d.dir ?? ""}.`.replace("  ", " ");
    case "blocked":
      return `Blocked${d.dir ? ` going ${d.dir}` : ""}. The way is shut.`;
    case "hazard_entered":
      return "Stepped on red floor. The golem crumbles.";
    case "goal_reached":
      return "Reached the altar!";
    case "picked_up":
      return `Picked up ${d.kind ?? d.item ?? "an item"}.`;
    case "placed":
      return `Placed a plank at ${fmtPos(d.pos)}. Red floor bridged.`;
    case "door_opened":
      return "Door opened.";
    case "door_locked":
      return "The door is locked. No key.";
    case "lever_pulled":
      return "Lever pulled.";
    case "crate_pushed":
      return "Crate pushed.";
    case "invalid_action":
      return `Invalid action${d.reason ? `: ${d.reason}` : "."}`;
    case "say":
      return `"${d.text ?? ""}"`;
    case "tower_placed":
      return `Tower built at ${fmtPos(d.pos)}.`;
    case "tower_limit":
      return "Tower limit reached.";
    case "wave_started":
      return `Wave ${d.wave ?? ""} begins${d.count ? ` — ${d.count} enemies` : ""}.`;
    case "enemy_spawned":
      return "Enemy spawned.";
    case "enemy_killed":
      return `Enemy ${d.id ?? ""} destroyed.`;
    case "enemy_leaked":
      return `Enemy ${d.id ?? ""} reached the base!`;
    case "wave_ended":
      return `Wave ${d.wave ?? ""} over: ${d.killed ?? 0} killed, ${d.leaked ?? 0} leaked.`;
    case "base_destroyed":
      return "The base has fallen.";
    case "all_waves_cleared":
      return "All waves cleared!";
    case "budget_exhausted":
      return "Out of budget.";
    default:
      return coreDescribeEvent(e);
  }
}

/** Interleave decisions and frames into log lines, only including ticks <= `uptoTick`. */
export function buildLog(decisions: DecisionRow[], frames: FrameRow[], uptoTick: number): LogLine[] {
  const lines: LogLine[] = [];
  const decByTick = new Map<number, DecisionRow[]>();
  for (const d of decisions) {
    if (d.tick > uptoTick) continue;
    const arr = decByTick.get(d.tick) ?? [];
    arr.push(d);
    decByTick.set(d.tick, arr);
  }
  const pushDecisions = (tick: number) => {
    for (const d of decByTick.get(tick) ?? []) {
      lines.push({ key: `d${d.tick}-${lines.length}`, tick: d.tick, kind: d.record.error ? "bad" : "intent", text: d.record.error ? `LLM error: ${d.record.error} (fell back to wait)` : `Intends: ${d.record.intent}` });
    }
    decByTick.delete(tick);
  };
  pushDecisions(0);
  for (const f of frames) {
    if (f.tick > uptoTick) break;
    pushDecisions(f.tick);
    lines.push({ key: `a${f.tick}`, tick: f.tick, kind: "act", text: `Acts: ${describeAction(f.frame.action)}` });
    for (const e of f.frame.events) {
      if (e.type === "moved") continue; // implied by the action line
      lines.push({ key: `e${f.tick}-${lines.length}`, tick: f.tick, kind: BAD_EVENTS.has(e.type) ? "bad" : "event", text: `Event: ${describeEvent(e)}` });
    }
  }
  // decisions with ticks beyond the last frame but within uptoTick
  for (const t of [...decByTick.keys()].sort((a, b) => a - b)) pushDecisions(t);
  return lines;
}

export interface TraceStep {
  subTick: number;
  enemies: { id: string; pos: Vec; hp: number }[];
}

/** Extract a towerdefense wave trace from a frame's `wave_ended` event, if any. */
export function traceOf(frame: Frame | null | undefined): { trace: TraceStep[]; hpMax: number } | null {
  if (!frame) return null;
  for (const e of frame.events) {
    if (e.type === "wave_ended" && Array.isArray(e.data?.trace)) {
      return { trace: e.data!.trace as TraceStep[], hpMax: typeof e.data?.hpMax === "number" ? (e.data.hpMax as number) : 0 };
    }
  }
  return null;
}

export const pad = (n: number): string => String(n).padStart(2, "0");
