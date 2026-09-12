import { query } from "./_generated/server";
import { v } from "convex/values";
import { MODES, listTiers } from "../src/core/index";
import type { LevelSpec, ModeId, TierSpec } from "../src/core/types";

/** What the player is allowed to see about a level before deploying. No seed, no agentKnows, no opponent waves/rules. */
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
> & { opponent?: { charter: string } };

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

export const tiers = query({
  args: { mode: v.string() },
  handler: async (_ctx, { mode }): Promise<PublicTierSpec[]> => {
    if (!MODES.some((m) => m.id === mode)) throw new Error(`Unknown mode: ${mode}`);
    return listTiers(mode as ModeId).map(toPublicTier);
  },
});

export const modes = query({
  args: {},
  handler: async () => MODES,
});
