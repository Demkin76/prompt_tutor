import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { MODES } from "../src/core/index";
import schema from "./schema";
import { requireUserId } from "./lib/auth";

export function defaultProgress(): Record<string, number> {
  const progress: Record<string, number> = {};
  for (const m of MODES) progress[m.id] = 1;
  return progress;
}

/** Load-or-create the current user's game profile. */
export async function ensureSession(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"sessions">> {
  const existing = await ctx.db
    .query("sessions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("sessions", {
    userId,
    sessionId: userId,
    progress: defaultProgress(),
    best: {},
    updatedAt: Date.now(),
  });
  const session = await ctx.db.get("sessions", id);
  if (!session) throw new Error("Failed to create user profile");
  return session;
}

export const ensure = mutation({
  args: {},
  returns: schema.doc("sessions"),
  handler: async (ctx) => {
    return await ensureSession(ctx, await requireUserId(ctx));
  },
});

export const get = query({
  args: {},
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});
