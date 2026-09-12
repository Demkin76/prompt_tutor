import { describe, expect, it } from "vitest";
import { getLevel, getTier } from "./levels";
import { generateLevel } from "./generators/index";
import { step } from "./sim";
import { redactInProgressMarketLevel, redactMarketFrame, toPublicLevel, toPublicTier } from "./publicLevel";
import type { Frame } from "./types";

describe("public level catalogue", () => {
  it("publishes the training chart only for rune-trading level 1", () => {
    const first = getLevel("runetrading-t1-l1")!;
    const hidden = getLevel("runetrading-t1-l2")!;
    expect(toPublicLevel(first).trainingPreview?.length).toBe(120);
    expect(toPublicLevel(hidden).trainingPreview).toBeUndefined();
    expect("seed" in toPublicLevel(first)).toBe(false);
    expect("agentKnows" in toPublicLevel(first)).toBe(false);
  });

  it("strips hidden fields from every public tier", () => {
    const publicTier = toPublicTier(getTier("runetrading", 2)!);
    expect(publicTier.levels).toHaveLength(3);
    expect(publicTier.levels[0].trainingPreview?.length).toBe(120);
    expect(publicTier.levels[1].trainingPreview).toBeUndefined();
    expect(publicTier.levels[2].trainingPreview).toBeUndefined();
    const maze = toPublicTier(getTier("maze", 1)!);
    expect(maze.levels[0]).not.toHaveProperty("seed");
    expect(maze.levels[0]).not.toHaveProperty("trainingPreview");
  });
});

describe("in-progress market redaction", () => {
  it("keeps the level-1 reference chart but hides seeds until the level ends", () => {
    const spec = getLevel("runetrading-t1-l1")!;
    const redacted = redactInProgressMarketLevel("runetrading", { seed: spec.seed, spec });
    expect(redacted.seed).toBe(0);
    expect(redacted.spec?.seed).toBe(0);
    expect(redacted.spec?.agentKnows).toEqual([]);
    expect(redacted.spec?.trainingPreview?.length).toBe(120);
  });

  it("drops future charts for unfinished hidden tests", () => {
    const spec = getLevel("runetrading-t1-l2")!;
    const redacted = redactInProgressMarketLevel("runetrading", { seed: spec.seed, spec: { ...spec, trainingPreview: spec.trainingPreview ?? [] } });
    expect(redacted.spec?.trainingPreview).toBeUndefined();
    expect(redacted.spec?.seed).toBe(0);
    expect(redactInProgressMarketLevel("runetrading", { seed: 5, spec: null }).seed).toBe(0);
  });

  it("leaves finished rows and other modes untouched", () => {
    const spec = getLevel("runetrading-t1-l2")!;
    const row = { seed: spec.seed, spec, result: { passed: true } };
    expect(redactInProgressMarketLevel("runetrading", row)).toBe(row);
    const maze = getLevel("maze-t1-l1")!;
    const raw = { seed: maze.seed, spec: maze };
    expect(redactInProgressMarketLevel("maze", raw)).toBe(raw);
  });

  it("frames of market levels never carry a PRNG state or unrevealed candles", () => {
    const spec = getLevel("runetrading-t1-l2")!;
    const initial = generateLevel(spec);
    const r = step(spec, initial, { type: "long" });
    const frame: Frame = { levelId: spec.id, tick: r.state.tick, action: { type: "long" }, events: r.events, state: r.state };
    const row = redactMarketFrame("runetrading", { runId: "r", levelId: spec.id, tick: 1, frame });
    expect(row.frame.state.rngState).toBe(0);
    expect(row.frame.state.market?.candles).toHaveLength(2);
    const other = { runId: "r", levelId: "maze-t1-l1", tick: 1, frame };
    expect(redactMarketFrame("maze", other)).toBe(other);
  });
});
