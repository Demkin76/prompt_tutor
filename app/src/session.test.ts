import { describe, expect, it } from "vitest";
import { mergeIndicatorSettings } from "./session";

describe("mergeIndicatorSettings", () => {
  const defaults = [
    { id: "sma", enabled: true, period: 20 },
    { id: "rsi", enabled: true, period: 14 },
  ];

  it("restores saved periods per mode/tier defaults", () => {
    expect(mergeIndicatorSettings([{ id: "sma", period: 8, enabled: false }], defaults)).toEqual([
      { id: "sma", enabled: false, period: 8 },
      { id: "rsi", enabled: true, period: 14 },
    ]);
  });

  it("ignores malformed storage", () => {
    expect(mergeIndicatorSettings("nope", defaults)).toEqual(defaults);
    expect(mergeIndicatorSettings([{ period: 3 }, null, "sma"], defaults)).toEqual(defaults);
  });

  it("never lets storage rename an indicator", () => {
    expect(mergeIndicatorSettings([{ id: "sma", period: 5 }, { id: "ema", period: 9 }], defaults)[0]).toEqual({ id: "sma", enabled: true, period: 5 });
  });
});
