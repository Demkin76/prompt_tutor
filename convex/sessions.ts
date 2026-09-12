import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { MODES } from "../src/core/index";

export function defaultProgress(): Record<string, number> {
  const progress: Record<string, number> = {};
  for (const m of MODES) progress[m.id] = 1;
  return progress;
}

/** Load-or-create a session row. Shared by sessions.ensure and runs.* mutations. */
export async function ensureSession(ctx: MutationCtx, sessionId: string): Promise<Doc<"sessions">> {
  const existing = await ctx.db
    .query("sessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("sessions", {
    sessionId,
    progress: defaultProgress(),
    best: {},
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

export const ensure = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    if (!sessionId) throw new Error("sessionId is required");
    return await ensureSession(ctx, sessionId);
  },
});

export const get = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
  },
});
