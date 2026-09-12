import { describe, expect, it } from "vitest";
import { atr, bollingerBands, computeIndicators, ema, macd, rsi, sma } from "./indicators";
import type { Ohlc } from "./types";

const candles = (closes: number[]): Ohlc[] =>
  closes.map((close, index) => ({
    open: index === 0 ? close : closes[index - 1],
    high: close + 1,
    low: close - 1,
    close,
  }));

describe("market indicators", () => {
  it("aligns SMA and EMA warm-up values without future data", () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
    expect(ema([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("computes RSI, MACD, Bollinger Bands and ATR with aligned output", () => {
    const series = candles([1, 2, 3, 4, 5, 6]);
    expect(rsi(series.map((c) => c.close), 3)).toEqual([null, null, null, 100, 100, 100]);
    expect(macd(series.map((c) => c.close), 2, 3, 2).line).toHaveLength(series.length);
    expect(bollingerBands(series.map((c) => c.close), 3, 2).middle[2]).toBe(2);
    expect(atr(series, 3)).toHaveLength(series.length);
    expect(atr(series, 3).slice(0, 2)).toEqual([null, null]);
  });

  it("is causal: prefix of the series gives a prefix of the indicator", () => {
    const closes = [10, 11, 10.5, 12, 11.5, 13, 12.5, 14, 13, 15, 14.5, 16];
    const full = computeIndicators(candles(closes), [
      { id: "sma", enabled: true, period: 3 },
      { id: "ema", enabled: true, period: 3 },
      { id: "rsi", enabled: true, period: 3 },
      { id: "macd", enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
      { id: "bollinger", enabled: true, period: 3, deviations: 2 },
      { id: "atr", enabled: true, period: 3 },
    ]);
    const prefix = computeIndicators(candles(closes.slice(0, 8)), [
      { id: "sma", enabled: true, period: 3 },
      { id: "ema", enabled: true, period: 3 },
      { id: "rsi", enabled: true, period: 3 },
      { id: "macd", enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
      { id: "bollinger", enabled: true, period: 3, deviations: 2 },
      { id: "atr", enabled: true, period: 3 },
    ]);
    for (const key of Object.keys(full)) expect(full[key].slice(0, 8), key).toEqual(prefix[key]);
  });

  it("skips disabled indicators and rejects bad periods", () => {
    const out = computeIndicators(candles([1, 2, 3]), [{ id: "sma", enabled: false, period: 2 }]);
    expect(out).toEqual({});
    expect(() => sma([1, 2, 3], 1)).toThrow(/2 to 200/);
    expect(() => macd([1, 2, 3], 5, 3, 2)).toThrow(/fastPeriod/);
  });
});
