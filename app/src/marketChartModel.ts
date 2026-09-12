import type { IndicatorConfig, Ohlc } from "@core/types";

export interface MarketBounds {
  min: number;
  max: number;
}

export type OscillatorPane = "rsi" | "macd" | "atr";

const PRICE_OVERLAYS = new Set(["sma", "ema", "bollinger.upper", "bollinger.middle", "bollinger.lower"]);

/** Series names drawn on top of the candles (same price scale). */
export function isPriceOverlay(name: string): boolean {
  return PRICE_OVERLAYS.has(name);
}

export function marketBounds(candles: Ohlc[], indicators: Record<string, (number | null)[]> = {}): MarketBounds {
  const values = candles.flatMap((candle) => [candle.low, candle.high]);
  for (const [name, series] of Object.entries(indicators)) {
    if (!PRICE_OVERLAYS.has(name)) continue;
    for (const value of series) if (value !== null && Number.isFinite(value)) values.push(value);
  }
  return padBounds(values, { min: 0, max: 1 });
}

export function valueToY(value: number, bounds: MarketBounds, height: number): number {
  const range = bounds.max - bounds.min || 1;
  return ((bounds.max - value) / range) * height;
}

export function enabledOscillatorPanes(indicators: IndicatorConfig[]): OscillatorPane[] {
  const order: OscillatorPane[] = ["rsi", "macd", "atr"];
  return order.filter((id) => indicators.some((indicator) => indicator.id === id && indicator.enabled));
}

export function seriesBounds(values: Array<number | null | undefined>, fallback: MarketBounds): MarketBounds {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return padBounds(finite, fallback);
}

export function oscillatorBounds(pane: OscillatorPane, indicators: Record<string, (number | null)[]>): MarketBounds {
  if (pane === "rsi") return { min: 0, max: 100 };
  if (pane === "macd") {
    return seriesBounds([...(indicators["macd.line"] ?? []), ...(indicators["macd.signal"] ?? []), ...(indicators["macd.histogram"] ?? [])], {
      min: -1,
      max: 1,
    });
  }
  return seriesBounds(indicators.atr ?? [], { min: 0, max: 1 });
}

/** Trade markers derived from frame events: the action at tick t was taken on candle t-1. */
export interface TradeMarker {
  index: number;
  side: "long" | "short" | "close";
}

export function markersFromEvents(rows: { tick: number; events: { type: string; data?: Record<string, unknown> }[] }[]): TradeMarker[] {
  const out: TradeMarker[] = [];
  for (const row of rows) {
    for (const event of row.events) {
      if (event.type === "position_opened") out.push({ index: Math.max(0, row.tick - 1), side: event.data?.side === "short" ? "short" : "long" });
      else if (event.type === "position_closed") out.push({ index: Math.max(0, row.tick - 1), side: "close" });
    }
  }
  return out;
}

function padBounds(values: number[], fallback: MarketBounds): MarketBounds {
  if (values.length === 0) return fallback;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.06, Math.abs(max || 1) * 0.002);
  return { min: min - padding, max: max + padding };
}
