import { query } from "./_generated/server";
import { v } from "convex/values";
import { MODES, listTiers, toPublicTier } from "../src/core/index";
import type { ModeId } from "../src/core/types";
import type { PublicTierSpec } from "../src/core/publicLevel";

/**
 * Public catalogue. The projection lives in src/core/publicLevel.ts: no seed, no agentKnows,
 * no opponent waves/rules; rune trading exposes the reference chart of level 1 only.
 */
export { toPublicLevel, toPublicTier } from "../src/core/publicLevel";
export type { PublicLevelSpec, PublicTierSpec } from "../src/core/publicLevel";

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
