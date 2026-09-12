/**
 * Rune-trading level generator: a deterministic OHLC series shaped by the tier's market regime
 * (bull / bear / flat / double-bottom) plus seeded noise. The initial WorldState reveals only
 * the first candle; `sim.ts` regenerates the same series from `spec.seed` to reveal the rest.
 */
import { createRng } from "../rng";
import { createMarketState } from "../marketSim";
import type { ChartClass, LevelSpec, Ohlc, WorldState } from "../types";
import { finishState } from "./common";

export interface MarketSeriesOptions {
  seed: number;
  chartClass: ChartClass;
  candleCount: number;
}

export const DEFAULT_CANDLE_COUNT = 120;
export const DEFAULT_FEE_BPS = 10;
export const DEFAULT_STARTING_BALANCE = 10_000;

function gaussian(x: number, center: number, width: number): number {
  return Math.exp(-((x - center) ** 2) / (2 * width ** 2));
}

function regimeShape(chartClass: ChartClass, t: number): number {
  switch (chartClass) {
    case "bull":
      return 0.2 * t + 0.012 * Math.sin(t * Math.PI * 8);
    case "bear":
      return -0.2 * t + 0.012 * Math.sin(t * Math.PI * 8);
    case "flat":
      return 0.018 * Math.sin(t * Math.PI * 7) + 0.006 * Math.sin(t * Math.PI * 17);
    case "double-bottom":
      return (
        0.03 * t -
        0.13 * gaussian(t, 0.31, 0.075) -
        0.13 * gaussian(t, 0.64, 0.075) +
        0.16 * Math.max(0, (t - 0.72) / 0.28)
      );
  }
}

export function generateMarketSeries({ seed, chartClass, candleCount }: MarketSeriesOptions): Ohlc[] {
  if (!Number.isInteger(candleCount) || candleCount < 30 || candleCount > 500) {
    throw new Error(`candleCount must be an integer from 30 to 500 (got ${candleCount})`);
  }
  const rng = createRng(seed);
  const start = 90 + rng.next() * 20;
  const candles: Ohlc[] = [];
  let previousClose = start;
  let noise = 0;
  for (let index = 0; index < candleCount; index++) {
    const t = index / (candleCount - 1);
    noise = noise * 0.72 + (rng.next() - 0.5) * 0.007;
    const close = Math.max(1, start * (1 + regimeShape(chartClass, t) + noise));
    const open = index === 0 ? start : previousClose;
    const wick = start * (0.0025 + rng.next() * 0.0045);
    const high = Math.max(open, close) + wick * (0.5 + rng.next());
    const low = Math.max(0.01, Math.min(open, close) - wick * (0.5 + rng.next()));
    candles.push({ open, high, low, close });
    previousClose = close;
  }
  return candles;
}

/** The full series of a level (what the sim reveals candle by candle). */
export function marketSeriesFor(spec: LevelSpec): Ohlc[] {
  const chartClass = spec.env.params.chartClass;
  if (!chartClass) throw new Error(`Rune-trading level ${spec.id} is missing chartClass`);
  return generateMarketSeries({ seed: spec.seed, chartClass, candleCount: spec.env.params.candleCount ?? DEFAULT_CANDLE_COUNT });
}

export function generateMarketLevel(spec: LevelSpec): WorldState {
  const series = marketSeriesFor(spec);
  // rngState stays 0: the market never consumes randomness after generation, and the seed must not leak through state.
  const state = finishState(spec, [1, 1], ["floor"], [], [0, 0], 0);
  state.market = createMarketState(series[0], spec.env.params.startingBalance ?? DEFAULT_STARTING_BALANCE, {
    chartClass: spec.env.params.chartClass,
    candlesTotal: series.length,
  });
  return state;
}
