import { describe, expect, it } from "vitest";
import { applyRunSettings, defaultRunSettings, validateRunSettings } from "./runSettings";
import { getTier } from "./levels";

describe("validateRunSettings", () => {
  it("accepts the default rune-trading indicator set and undefined", () => {
    expect(() => validateRunSettings(defaultRunSettings())).not.toThrow();
    expect(() => validateRunSettings(undefined)).not.toThrow();
    expect(defaultRunSettings().indicators.map((i) => i.id)).toEqual(["sma", "ema", "rsi"]);
  });

  it("rejects out-of-range periods and deviations", () => {
    expect(() => validateRunSettings({ indicators: [{ id: "sma", enabled: true, period: 1 }] })).toThrow(/2 to 200/);
    expect(() => validateRunSettings({ indicators: [{ id: "bollinger", enabled: true, period: 20, deviations: 0 }] })).toThrow(/deviations/);
    expect(() => validateRunSettings({ indicators: [{ id: "macd", enabled: true, fastPeriod: 26, slowPeriod: 12, signalPeriod: 9 }] })).toThrow(/fastPeriod/);
  });

  it("rejects duplicates, unknown ids and more than six indicators", () => {
    expect(() =>
      validateRunSettings({
        indicators: [
          { id: "sma", enabled: true, period: 20 },
          { id: "sma", enabled: true, period: 10 },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() => validateRunSettings({ indicators: [{ id: "vwap" as never, enabled: true }] })).toThrow(/Unknown indicator/);
    expect(() =>
      validateRunSettings({
        indicators: [
          { id: "sma", enabled: true, period: 20 },
          { id: "ema", enabled: true, period: 20 },
          { id: "rsi", enabled: true, period: 14 },
          { id: "macd", enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
          { id: "bollinger", enabled: true, period: 20, deviations: 2 },
          { id: "atr", enabled: true, period: 14 },
          { id: "sma", enabled: true, period: 10 },
        ],
      }),
    ).toThrow(/six/);
  });
});

describe("applyRunSettings", () => {
  it("replaces the indicator set of every market level and leaves other modes alone", () => {
    const tier = getTier("runetrading", 2)!;
    const out = applyRunSettings(tier, { indicators: [{ id: "rsi", enabled: true, period: 7 }] });
    expect(out).not.toBe(tier);
    for (const level of out.levels) expect(level.env.params.indicators).toEqual([{ id: "rsi", enabled: true, period: 7 }]);
    expect(tier.levels[0].env.params.indicators?.map((i) => i.id)).toEqual(["sma", "ema", "rsi"]);
    const maze = getTier("maze", 1)!;
    expect(applyRunSettings(maze, { indicators: [] })).toBe(maze);
    expect(applyRunSettings(tier, undefined)).toBe(tier);
  });
});
