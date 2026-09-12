import { describe, expect, it } from "vitest";
import { enabledOscillatorPanes, markersFromEvents, marketBounds, oscillatorBounds, valueToY } from "./marketChartModel";
import type { Ohlc } from "@core/types";

describe("market chart geometry", () => {
  it("includes candle and indicator extremes with padding", () => {
    const candles: Ohlc[] = [{ open: 10, high: 12, low: 8, close: 11 }];
    const bounds = marketBounds(candles, { sma: [15], rsi: [80] });
    expect(bounds.min).toBeLessThan(8);
    expect(bounds.max).toBeGreaterThan(15);
    expect(bounds.max).toBeLessThan(80);
  });

  it("maps higher prices toward the top of the viewport", () => {
    expect(valueToY(20, { min: 10, max: 20 }, 100)).toBe(0);
    expect(valueToY(10, { min: 10, max: 20 }, 100)).toBe(100);
  });

  it("opens oscillator panes only for enabled indicators", () => {
    expect(
      enabledOscillatorPanes([
        { id: "sma", enabled: true },
        { id: "rsi", enabled: true },
        { id: "macd", enabled: false },
        { id: "atr", enabled: true },
      ]),
    ).toEqual(["rsi", "atr"]);
  });

  it("keeps RSI on a fixed 0-100 scale", () => {
    expect(oscillatorBounds("rsi", { rsi: [12, 88] })).toEqual({ min: 0, max: 100 });
  });

  it("derives trade markers from position events on the acting candle", () => {
    const markers = markersFromEvents([
      { tick: 5, events: [{ type: "position_opened", data: { side: "short" } }, { type: "fee_charged" }] },
      { tick: 9, events: [{ type: "position_closed" }, { type: "position_opened", data: { side: "long" } }] },
    ]);
    expect(markers).toEqual([
      { index: 4, side: "short" },
      { index: 8, side: "close" },
      { index: 8, side: "long" },
    ]);
  });
});
