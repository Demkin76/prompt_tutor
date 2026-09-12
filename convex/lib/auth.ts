import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";
import type { Id } from "../_generated/dataModel";

export async function requireUserId(ctx: { auth: Auth }): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}
