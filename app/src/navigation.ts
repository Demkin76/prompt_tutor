import type { ModeId } from "@core/types";

const aliases: Record<string, ModeId> = { red: "redfloor", redfloor: "redfloor", maze: "maze", tower: "towerdefense", towerdefense: "towerdefense" };
export function readLaunchLink(hash: string): { mode: ModeId | null; runId?: string } {
  const value = hash.replace(/^#/, "");
  if (value.startsWith("run/")) {
    const runId = value.slice(4);
    if (/^[a-zA-Z0-9_-]{1,160}$/.test(runId)) return { mode: null, runId };
  }
  if (value === "all") return { mode: null };
  return { mode: aliases[value] ?? "redfloor" };
}
export function modeHash(mode: ModeId): string {
  return mode === "redfloor" ? "#red" : `#${mode}`;
}
