import { describe, expect, it } from "vitest";
import { ALL_LEVELS, TIERS } from "./levels";
import { generateLevel } from "./generators/index";
import { createRng } from "./rng";
import { step } from "./sim";
import { approveLevel, pickApprovedSeed, randomSeed, withSeeds } from "./approve";
import type { LevelSpec } from "./types";

/** Replay an approval's actions through the sim from scratch and return the final state. */
function replay(spec: LevelSpec, actions: ReturnType<typeof approveLevel>["actions"]) {
  let cur = generateLevel(spec);
  for (const a of actions) cur = step(spec, cur, a).state;
  return cur;
}

describe("approveLevel", () => {
  it("approves every catalogue level and the returned actions replay to a win", () => {
    for (const lvl of ALL_LEVELS) {
      const a = approveLevel(lvl);
      expect(a.ok, `${lvl.id}: ${a.reason}`).toBe(true);
      expect(a.ticks).toBeLessThanOrEqual(lvl.limits.ticks);
      const final = replay(lvl, a.actions);
      expect(final.status, `${lvl.id} replay`).toBe("won");
      expect(final.tick).toBe(a.ticks);
    }
  });

  it("is deterministic: same spec gives identical action lists", () => {
    for (const lvl of ALL_LEVELS) {
      const a = approveLevel(lvl);
      const b = approveLevel(lvl);
      expect(b.actions).toEqual(a.actions);
      expect(b.ticks).toBe(a.ticks);
      expect(b.ok).toBe(a.ok);
    }
  });

  it("rejects an unwinnable spec instead of throwing", () => {
    const td = ALL_LEVELS.find((l) => l.mode === "towerdefense" && l.tier === 3)!;
    const hopeless: LevelSpec = { ...td, env: { ...td.env, params: { ...td.env.params, towerLimit: 1, baseHp: 1 } } };
    const a = approveLevel(hopeless);
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/no greedy placement wins/);
    expect(a.actions.length).toBeGreaterThan(0);

    const red = ALL_LEVELS.find((l) => l.mode === "redfloor" && l.tier === 2)!;
    const tight: LevelSpec = { ...red, limits: { ...red.limits, ticks: 3 } };
    const b = approveLevel(tight);
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/out_of_budget/);
    expect(b.ticks).toBe(3);
  });
});

describe("fuzz: random seeds per tier", () => {
  const SEEDS = 30;
  const rng = createRng(12345);
  const rates: string[] = [];

  for (const tier of TIERS) {
    it(`${tier.mode} tier ${tier.tier}: generation never throws, approval rate is acceptable`, () => {
      const seeds = Array.from({ length: SEEDS }, () => randomSeed(rng));
      let approved = 0;
      let total = 0;
      const perLevel: string[] = [];
      const reasons = new Map<string, number>();
      let maxTicks = 0;
      for (const lvl of tier.levels) {
        let okLevel = 0;
        for (const seed of seeds) {
          const spec = { ...lvl, seed };
          expect(() => generateLevel(spec), `${lvl.id} seed ${seed} threw`).not.toThrow();
          const a = approveLevel(spec);
          total++;
          if (a.ok) {
            approved++;
            okLevel++;
            maxTicks = Math.max(maxTicks, a.ticks);
          } else {
            const key = a.reason.replace(/\[.*?\]|\d+/g, "#").slice(0, 60);
            reasons.set(key, (reasons.get(key) ?? 0) + 1);
          }
        }
        perLevel.push(`${lvl.index}:${okLevel}/${seeds.length}`);
      }
      const rate = approved / total;
      const line = `${tier.mode} t${tier.tier}: ${(rate * 100).toFixed(1)}% (${approved}/${total}) per level ${perLevel.join(" ")} maxTicks ${maxTicks}/${tier.levels[0].limits.ticks}${
        reasons.size ? ` failures: ${[...reasons].map(([r, n]) => `${n}x ${r}`).join("; ")}` : ""
      }`;
      rates.push(line);
      console.log(line);
      if (tier.tier <= 2) expect(rate, line).toBeGreaterThanOrEqual(0.6);
      else expect(rate, line).toBeGreaterThan(0);
    });
  }
});

describe("pickApprovedSeed", () => {
  it("finds an approved seed for every tier within 40 tries", () => {
    const rng = createRng(777);
    for (const tier of TIERS) {
      for (const lvl of tier.levels) {
        const r = pickApprovedSeed(lvl, rng, 40);
        expect(r.approval.ok, `${lvl.id}: ${r.approval.reason} after ${r.tries} tries`).toBe(true);
        expect(r.tries).toBeLessThanOrEqual(40);
        expect(r.seed).toBeGreaterThan(0);
        expect(approveLevel({ ...lvl, seed: r.seed }).ok).toBe(true);
      }
    }
  });

  it("accepts a plain () => number rng and returns a positive 31-bit seed", () => {
    const f = createRng(1);
    for (let i = 0; i < 100; i++) {
      const s = randomSeed(() => f.next());
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(0x7fffffff);
      expect(Number.isInteger(s)).toBe(true);
    }
    expect(randomSeed(() => 0)).toBe(1);
    expect(randomSeed(() => 0.9999999999)).toBeLessThanOrEqual(0x7fffffff);
  });

  it("returns the last non-throwing seed with ok=false when nothing is approved", () => {
    const td = ALL_LEVELS.find((l) => l.mode === "towerdefense")!;
    const hopeless: LevelSpec = { ...td, env: { ...td.env, params: { ...td.env.params, towerLimit: 0 } } };
    const r = pickApprovedSeed(hopeless, createRng(3), 5);
    expect(r.approval.ok).toBe(false);
    expect(r.tries).toBe(5);
    expect(r.seed).toBeGreaterThan(0);
  });
});

describe("withSeeds", () => {
  it("copies the tier with per-level seeds and leaves the original untouched", () => {
    const tier = TIERS[3];
    const before = tier.levels.map((l) => l.seed);
    const out = withSeeds(tier, [1, 2, 3]);
    expect(out.levels.map((l) => l.seed)).toEqual([1, 2, 3]);
    expect(tier.levels.map((l) => l.seed)).toEqual(before);
    expect(out).not.toBe(tier);
    expect(out.levels[0]).not.toBe(tier.levels[0]);
    expect(out.levels[0].id).toBe(tier.levels[0].id);
    const partial = withSeeds(tier, [9]);
    expect(partial.levels.map((l) => l.seed)).toEqual([9, before[1], before[2]]);
  });
});
