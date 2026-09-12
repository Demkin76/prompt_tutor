/**
 * Technical indicators over a candle series. Every function returns an array aligned
 * with its input (index i uses only candles 0..i); warm-up slots are `null`.
 */
import type { IndicatorConfig, Ohlc } from "./types";

export type IndicatorValue = number | null;

function validPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 2 || period > 200) {
    throw new Error(`Indicator period must be an integer from 2 to 200 (got ${period})`);
  }
}

export function sma(values: number[], period: number): IndicatorValue[] {
  validPeriod(period);
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index < period - 1 ? null : sum / period;
  });
}

export function ema(values: number[], period: number): IndicatorValue[] {
  validPeriod(period);
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    current = (values[index] - current) * multiplier + current;
    out[index] = current;
  }
  return out;
}

export function rsi(values: number[], period: number): IndicatorValue[] {
  validPeriod(period);
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const delta = values[index] - values[index - 1];
    gains += Math.max(0, delta);
    losses += Math.max(0, -delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const value = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = value();
  for (let index = period + 1; index < values.length; index++) {
    const delta = values[index] - values[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
    out[index] = value();
  }
  return out;
}

export function bollingerBands(
  values: number[],
  period: number,
  deviations: number,
): { upper: IndicatorValue[]; middle: IndicatorValue[]; lower: IndicatorValue[] } {
  validPeriod(period);
  if (!(deviations > 0 && deviations <= 10)) throw new Error("Bollinger deviations must be in (0, 10]");
  const middle = sma(values, period);
  const upper: IndicatorValue[] = [];
  const lower: IndicatorValue[] = [];
  for (let index = 0; index < values.length; index++) {
    if (middle[index] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const window = values.slice(index - period + 1, index + 1);
    const mean = middle[index] as number;
    const deviation = Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
    upper.push(mean + deviation * deviations);
    lower.push(mean - deviation * deviations);
  }
  return { upper, middle, lower };
}

export function atr(candles: Ohlc[], period: number): IndicatorValue[] {
  validPeriod(period);
  const trueRanges = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return sma(trueRanges, period);
}

function emaAligned(values: IndicatorValue[], period: number): IndicatorValue[] {
  const start = values.findIndex((value) => value !== null);
  if (start < 0) return new Array(values.length).fill(null);
  const compact = values.slice(start).map((value) => value ?? 0);
  return [...new Array<IndicatorValue>(start).fill(null), ...ema(compact, period)];
}

export function macd(
  values: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): { line: IndicatorValue[]; signal: IndicatorValue[]; histogram: IndicatorValue[] } {
  if (fastPeriod >= slowPeriod) throw new Error("MACD fastPeriod must be less than slowPeriod");
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line = values.map((_, index) => (fast[index] === null || slow[index] === null ? null : (fast[index] as number) - (slow[index] as number)));
  const signal = emaAligned(line, signalPeriod);
  const histogram = line.map((value, index) => (value === null || signal[index] === null ? null : value - (signal[index] as number)));
  return { line, signal, histogram };
}

/** Keyed by MarketMetricName ("sma", "macd.line", "bollinger.upper", ...). */
export type ComputedIndicators = Record<string, IndicatorValue[]>;

export function computeIndicators(candles: Ohlc[], configs: IndicatorConfig[]): ComputedIndicators {
  const closes = candles.map((candle) => candle.close);
  const out: ComputedIndicators = {};
  for (const config of configs.filter((item) => item.enabled)) {
    switch (config.id) {
      case "sma":
        out.sma = sma(closes, config.period ?? 20);
        break;
      case "ema":
        out.ema = ema(closes, config.period ?? 20);
        break;
      case "rsi":
        out.rsi = rsi(closes, config.period ?? 14);
        break;
      case "atr":
        out.atr = atr(candles, config.period ?? 14);
        break;
      case "bollinger": {
        const bands = bollingerBands(closes, config.period ?? 20, config.deviations ?? 2);
        out["bollinger.upper"] = bands.upper;
        out["bollinger.middle"] = bands.middle;
        out["bollinger.lower"] = bands.lower;
        break;
      }
      case "macd": {
        const values = macd(closes, config.fastPeriod ?? 12, config.slowPeriod ?? 26, config.signalPeriod ?? 9);
        out["macd.line"] = values.line;
        out["macd.signal"] = values.signal;
        out["macd.histogram"] = values.histogram;
        break;
      }
    }
  }
  return out;
}
