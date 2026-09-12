/**
 * Per-run settings (rune trading): which indicators are enabled and with what periods.
 * Chosen by the player before deploy, frozen for the run, and applied to every level of the tier.
 */
import type { IndicatorConfig, IndicatorId, RunSettings, TierSpec } from "./types";

export const INDICATOR_IDS: IndicatorId[] = ["sma", "ema", "rsi", "macd", "bollinger", "atr"];

export const MAX_INDICATORS = 6;

export const DEFAULT_MARKET_INDICATORS: IndicatorConfig[] = [
  { id: "sma", enabled: true, period: 20, color: "#4da3ff" },
  { id: "ema", enabled: true, period: 50, color: "#ff9f43" },
  { id: "rsi", enabled: true, period: 14, color: "#c77dff" },
];

export function defaultRunSettings(): RunSettings {
  return { indicators: DEFAULT_MARKET_INDICATORS.map((indicator) => ({ ...indicator })) };
}

/** Throws with a human-readable message when the settings are unusable. `undefined` is valid (defaults apply). */
export function validateRunSettings(settings: RunSettings | undefined): void {
  if (!settings) return;
  if (!Array.isArray(settings.indicators)) throw new Error("Run settings must contain an indicators array");
  if (settings.indicators.length > MAX_INDICATORS) throw new Error("At most six indicators can be enabled");
  const ids = new Set<string>();
  for (const indicator of settings.indicators) {
    if (!INDICATOR_IDS.includes(indicator.id)) throw new Error(`Unknown indicator: ${String(indicator.id)}`);
    if (ids.has(indicator.id)) throw new Error(`Duplicate indicator: ${indicator.id}`);
    ids.add(indicator.id);
    const periods = [indicator.period, indicator.fastPeriod, indicator.slowPeriod, indicator.signalPeriod].filter(
      (value): value is number => value !== undefined,
    );
    if (periods.some((value) => !Number.isInteger(value) || value < 2 || value > 200)) {
      throw new Error("Indicator periods must be integers from 2 to 200");
    }
    if (indicator.id === "macd" && indicator.fastPeriod !== undefined && indicator.slowPeriod !== undefined && indicator.fastPeriod >= indicator.slowPeriod) {
      throw new Error("MACD fastPeriod must be less than slowPeriod");
    }
    if (indicator.deviations !== undefined && !(indicator.deviations > 0 && indicator.deviations <= 10)) {
      throw new Error("Bollinger deviations must be in (0, 10]");
    }
  }
}

/** Copy of a rune-trading tier whose levels use the run's indicator set. Other modes are returned as-is. */
export function applyRunSettings(tier: TierSpec, settings: RunSettings | undefined): TierSpec {
  if (!settings || tier.mode !== "runetrading") return tier;
  return {
    ...tier,
    levels: tier.levels.map((level) => ({
      ...level,
      env: { ...level.env, params: { ...level.env.params, indicators: settings.indicators.map((indicator) => ({ ...indicator })) } },
    })),
  };
}
