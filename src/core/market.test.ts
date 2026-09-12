import { describe, expect, it } from "vitest";
import { generateMarketSeries, marketSeriesFor } from "./generators/market";
import { getLevel } from "./levels";
import type { ChartClass } from "./types";

const classes: ChartClass[] = ["bull", "bear", "flat", "double-bottom"];

describe("generateMarketSeries", () => {
  it("is deterministic and emits valid OHLC candles", () => {
    for (const chartClass of classes) {
      const a = generateMarketSeries({ seed: 42, chartClass, candleCount: 120 });
      const b = generateMarketSeries({ seed: 42, chartClass, candleCount: 120 });
      expect(a).toEqual(b);
      expect(a).toHaveLength(120);
      for (const candle of a) {
        expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
        expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
        expect(candle.low).toBeGreaterThan(0);
      }
      expect(generateMarketSeries({ seed: 43, chartClass, candleCount: 120 })).not.toEqual(a);
    }
    expect(() => generateMarketSeries({ seed: 1, chartClass: "bull", candleCount: 10 })).toThrow(/30 to 500/);
  });

  it("produces recognisable market regimes", () => {
    const firstLast = (chartClass: ChartClass) => {
      const series = generateMarketSeries({ seed: 7, chartClass, candleCount: 120 });
      return { series, first: series[0].close, last: series.at(-1)!.close };
    };
    const bull = firstLast("bull");
    const bear = firstLast("bear");
    const flat = firstLast("flat");
    const pants = firstLast("double-bottom");
    expect(bull.last).toBeGreaterThan(bull.first * 1.08);
    expect(bear.last).toBeLessThan(bear.first * 0.92);
    expect(Math.abs(flat.last / flat.first - 1)).toBeLessThan(0.05);
    const closes = pants.series.map((c) => c.close);
    const firstLow = Math.min(...closes.slice(20, 50));
    const secondLow = Math.min(...closes.slice(55, 85));
    expect(Math.abs(firstLow / secondLow - 1)).toBeLessThan(0.08);
    expect(pants.last).toBeGreaterThan(Math.max(firstLow, secondLow) * 1.08);
  });

  it("level 1 of every market tier publishes exactly the series the sim will reveal", () => {
    for (const tier of [1, 2, 3, 4]) {
      const spec = getLevel(`runetrading-t${tier}-l1`)!;
      expect(spec.trainingPreview).toEqual(marketSeriesFor(spec));
      expect(getLevel(`runetrading-t${tier}-l2`)!.trainingPreview).toBeUndefined();
    }
  });
});
