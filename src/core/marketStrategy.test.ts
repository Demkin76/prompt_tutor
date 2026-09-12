import { describe, expect, it } from "vitest";
import { evaluateMarketStrategy, parseMarketStrategy, validateMarketStrategy } from "./marketStrategy";
import type { IndicatorConfig, MarketStrategy, Ohlc } from "./types";

const indicators: IndicatorConfig[] = [
  { id: "sma", enabled: true, period: 3 },
  { id: "rsi", enabled: true, period: 3 },
];

const candles: Ohlc[] = [100, 99, 98, 100].map((close) => ({
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
}));

describe("market strategy DSL", () => {
  it("evaluates the first matching rule and otherwise holds", () => {
    const strategy: MarketStrategy = {
      version: 1,
      rules: [
        {
          when: {
            op: "crossesAbove",
            left: { kind: "metric", name: "price.close" },
            right: { kind: "metric", name: "sma" },
          },
          action: "long",
        },
      ],
      fallback: "hold",
    };
    expect(validateMarketStrategy(strategy, indicators)).toEqual([]);
    expect(evaluateMarketStrategy(strategy, candles, indicators)).toBe("long");
    expect(evaluateMarketStrategy(strategy, candles.slice(0, 2), indicators)).toBe("hold");
  });

  it("supports and / or / not, offsets and relative returns", () => {
    const strategy: MarketStrategy = {
      version: 1,
      rules: [
        {
          when: {
            op: "and",
            conditions: [
              { op: "gt", left: { kind: "metric", name: "price.return" }, right: { kind: "number", value: 0.01 } },
              { op: "not", condition: { op: "lt", left: { kind: "metric", name: "price.close", offset: -1 }, right: { kind: "metric", name: "price.close", offset: -2 } } },
            ],
          },
          action: "short",
        },
        {
          when: { op: "or", conditions: [{ op: "gt", left: { kind: "metric", name: "price.return" }, right: { kind: "number", value: 0.01 } }] },
          action: "long",
        },
      ],
      fallback: "hold",
    };
    expect(validateMarketStrategy(strategy, indicators)).toEqual([]);
    // last return = 100/98 - 1 > 1%; close[-1]=98 < close[-2]=99, so the "not" fails -> second rule -> long
    expect(evaluateMarketStrategy(strategy, candles, indicators)).toBe("long");
  });

  it("rejects absolute price thresholds and disabled indicators", () => {
    const absolute: MarketStrategy = {
      version: 1,
      rules: [
        {
          when: {
            op: "gt",
            left: { kind: "metric", name: "price.close" },
            right: { kind: "number", value: 100 },
          },
          action: "long",
        },
      ],
      fallback: "hold",
    };
    expect(validateMarketStrategy(absolute, indicators).join(" ")).toMatch(/absolute price/i);
    const disabled = structuredClone(absolute);
    disabled.rules[0].when = {
      op: "lt",
      left: { kind: "metric", name: "ema" },
      right: { kind: "metric", name: "sma" },
    };
    expect(validateMarketStrategy(disabled, indicators).join(" ")).toMatch(/ema.*not enabled/i);
  });

  it("parses untrusted JSON strictly", () => {
    const raw = {
      version: 1,
      rules: [{ when: { op: "lt", left: { kind: "metric", name: "rsi", offset: null }, right: { kind: "number", value: 30 } }, action: "long" }],
      fallback: "hold",
    };
    const parsed = parseMarketStrategy(raw, indicators);
    expect(parsed.rules[0].when).toEqual({ op: "lt", left: { kind: "metric", name: "rsi" }, right: { kind: "number", value: 30 } });
    expect(() => parseMarketStrategy({ ...raw, fallback: "long" }, indicators)).toThrow(/envelope/);
    expect(() => parseMarketStrategy({ ...raw, rules: [{ when: { op: "maybe" }, action: "long" }] }, indicators)).toThrow(/Unknown strategy condition/);
    expect(() => parseMarketStrategy({ ...raw, rules: [{ when: raw.rules[0].when, action: "buy" }] }, indicators)).toThrow(/rule/);
    expect(() =>
      parseMarketStrategy({ ...raw, rules: [{ when: { op: "gt", left: { kind: "metric", name: "volume" }, right: { kind: "number", value: 1 } }, action: "long" }] }, indicators),
    ).toThrow(/Unknown metric/);
  });
});
