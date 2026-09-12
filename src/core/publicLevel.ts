/**
 * Public projections of the level catalogue and of stored run rows.
 *
 * - toPublicLevel / toPublicTier: what the player may see before deploying (no seed, no agentKnows,
 *   no opponent internals). Rune trading additionally publishes the full reference chart of level 1.
 * - redactInProgressMarketLevel: while a rune-trading level is still running, the client must not be
 *   able to reconstruct future candles, so seeds and hidden previews are stripped from levelRun rows.
 * - redactMarketFrame: frames only ever carry revealed candles; the PRNG state is zeroed as well.
 */
import type { Frame, LevelSpec, ModeId, TierSpec } from "./types";

export type PublicLevelSpec = Pick<
  LevelSpec,
  | "id"
  | "mode"
  | "tier"
  | "index"
  | "title"
  | "brief"
  | "playerKnows"
  | "promptBudget"
  | "env"
  | "observation"
  | "limits"
  | "actions"
  | "scoring"
> & { opponent?: { charter: string }; trainingPreview?: LevelSpec["trainingPreview"] };

export type PublicTierSpec = Omit<TierSpec, "levels"> & { levels: PublicLevelSpec[] };

export function toPublicLevel(level: LevelSpec): PublicLevelSpec {
  const out: PublicLevelSpec = {
    id: level.id,
    mode: level.mode,
    tier: level.tier,
    index: level.index,
    title: level.title,
    brief: level.brief,
    playerKnows: level.playerKnows,
    promptBudget: level.promptBudget,
    env: level.env,
    observation: level.observation,
    limits: level.limits,
    actions: level.actions,
    scoring: level.scoring,
  };
  if (level.opponent) out.opponent = { charter: level.opponent.charter };
  if (level.mode === "runetrading" && level.index === 1 && level.trainingPreview) {
    out.trainingPreview = level.trainingPreview.map((candle) => ({ ...candle }));
  }
  return out;
}

export function toPublicTier(tier: TierSpec): PublicTierSpec {
  return {
    mode: tier.mode,
    tier: tier.tier,
    title: tier.title,
    levels: tier.levels.map(toPublicLevel),
  };
}

/**
 * Hide everything that would let a client regenerate the series of an unfinished rune-trading level:
 * the seed (row + spec), agentKnows and, for hidden trials (index > 1), the training preview.
 * Finished rows (`result` present) and other modes are returned untouched.
 */
export function redactInProgressMarketLevel<T extends { seed: number; spec: LevelSpec | null; result?: unknown }>(
  mode: ModeId | string | undefined,
  row: T,
): T {
  if (mode !== "runetrading" || row.result) return row;
  const spec = row.spec;
  if (!spec) return { ...row, seed: 0 };
  if (spec.index === 1) return { ...row, seed: 0, spec: { ...spec, seed: 0, agentKnows: [] } };
  const { trainingPreview: _preview, ...withoutPreview } = spec;
  return { ...row, seed: 0, spec: { ...withoutPreview, seed: 0, agentKnows: [] } };
}

/** Frames of rune-trading levels never expose the PRNG state (the market series is seed-derived). */
export function redactMarketFrame<T extends { frame: Frame }>(mode: ModeId | string | undefined, row: T): T {
  if (mode !== "runetrading" || !row.frame?.state) return row;
  return { ...row, frame: { ...row.frame, state: { ...row.frame.state, rngState: 0 } } };
}
