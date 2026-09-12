/**
 * Parse + validate an LLM reply into an AgentDecision.
 * Throws DecisionError with a human-readable reason (fed back to the model on retry).
 */
import type { Action, ActionType, AgentDecision, Dir, LevelSpec, StopOn } from "../core/types";
import { DIRS } from "../core/types";
import { STOP_ON_VALUES } from "./prompt";

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

export const DEFAULT_STOP_ON: StopOn[] = ["new_entity", "blocked", "hazard_detected", "goal_visible", "item_visible"];

export const MAX_INTENT_CHARS = 200;
export const MAX_SAY_CHARS = 120;
export const MAX_PLAN = 5;

/** Remove ``` fences and surrounding noise, keep the outermost {...} object. */
export function extractJsonText(text: string): string {
  let t = text.trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = fence.exec(t);
  if (m) t = m[1].trim();
  if (!t.startsWith("{")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  return t;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDir(v: unknown): v is Dir {
  return typeof v === "string" && (DIRS as string[]).includes(v);
}

/** Drop null/undefined args (the schema forces the model to emit unused args as null). */
function cleanArgs(raw: unknown, idx: number): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) throw new DecisionError(`plan[${idx}].args must be an object`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function validateAction(raw: unknown, idx: number, spec: LevelSpec): Action {
  if (!isRecord(raw)) throw new DecisionError(`plan[${idx}] must be an object`);
  const type = raw.type;
  if (typeof type !== "string") throw new DecisionError(`plan[${idx}].type must be a string`);
  if (!(spec.actions as string[]).includes(type)) {
    throw new DecisionError(`plan[${idx}].type "${type}" is not allowed; allowed: ${spec.actions.join(", ")}`);
  }
  const t = type as ActionType;
  const args = cleanArgs(raw.args, idx);

  switch (t) {
    case "move":
    case "place": {
      if (!isDir(args.dir)) throw new DecisionError(`plan[${idx}] (${t}) needs args.dir in ${DIRS.join("|")}`);
      return { type: t, args: { dir: args.dir } };
    }
    case "inspect":
    case "interact": {
      if (args.dir === undefined) return { type: t };
      if (!isDir(args.dir)) throw new DecisionError(`plan[${idx}] (interact) args.dir must be one of ${DIRS.join("|")}`);
      return { type: t, args: { dir: args.dir } };
    }
    case "wait":
      return { type: "wait" };
    case "pickup":
      return { type: "pickup" };
    case "start_wave":
      return { type: "start_wave" };
    case "say": {
      const text = args.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new DecisionError(`plan[${idx}] (say) needs a non-empty args.text`);
      }
      if (text.length > MAX_SAY_CHARS) {
        throw new DecisionError(`plan[${idx}] (say) args.text must be <= ${MAX_SAY_CHARS} chars`);
      }
      return { type: "say", args: { text } };
    }
    case "place_tower": {
      const pos = args.pos;
      if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => Number.isInteger(n))) {
        throw new DecisionError(`plan[${idx}] (place_tower) needs args.pos as [int, int]`);
      }
      const towerType = args.towerType;
      if (typeof towerType !== "string" || towerType.length === 0) {
        throw new DecisionError(`plan[${idx}] (place_tower) needs a non-empty args.towerType string`);
      }
      return { type: "place_tower", args: { pos: [pos[0] as number, pos[1] as number], towerType } };
    }
    default: {
      const never: never = t;
      throw new DecisionError(`unsupported action type ${String(never)}`);
    }
  }
}

function validateStopOn(raw: unknown): StopOn[] {
  if (raw === undefined || raw === null) return [...DEFAULT_STOP_ON];
  if (!Array.isArray(raw)) throw new DecisionError("stopOn must be an array");
  const out: StopOn[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !(STOP_ON_VALUES as string[]).includes(v)) {
      throw new DecisionError(
        `stopOn contains unknown trigger ${JSON.stringify(v)}; allowed: ${STOP_ON_VALUES.join(", ")}`,
      );
    }
    if (!out.includes(v as StopOn)) out.push(v as StopOn);
  }
  return out;
}

export function parseDecision(text: string, spec: LevelSpec): AgentDecision {
  if (typeof text !== "string" || text.trim().length === 0) throw new DecisionError("empty reply");
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (e) {
    throw new DecisionError(`reply is not valid JSON (${(e as Error).message})`);
  }
  if (!isRecord(parsed)) throw new DecisionError("reply must be a JSON object");

  const intentRaw = parsed.intent;
  if (typeof intentRaw !== "string") throw new DecisionError("intent must be a string");
  const intent = intentRaw.trim();
  if (intent.length > MAX_INTENT_CHARS) throw new DecisionError(`intent must be <= ${MAX_INTENT_CHARS} chars`);

  const planRaw = parsed.plan;
  if (!Array.isArray(planRaw)) throw new DecisionError("plan must be an array");
  if (planRaw.length < 1 || planRaw.length > MAX_PLAN) {
    throw new DecisionError(`plan must contain 1 to ${MAX_PLAN} actions (got ${planRaw.length})`);
  }
  const plan = planRaw.map((a, i) => validateAction(a, i, spec));

  const stopOn = validateStopOn(parsed.stopOn);
  return { intent, plan, stopOn };
}
