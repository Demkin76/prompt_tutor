import type { IndicatorConfig, IndicatorId } from "@core/types";
import { assetUrl } from "../assets";

const LABELS: Record<IndicatorId, string> = {
  sma: "SMA",
  ema: "EMA",
  rsi: "RSI",
  macd: "MACD",
  bollinger: "Bollinger Bands",
  atr: "ATR",
};

const HINTS: Record<IndicatorId, string> = {
  sma: "simple moving average of closes",
  ema: "exponential moving average",
  rsi: "momentum, 0–100 (30 / 70 bands)",
  macd: "fast − slow EMA, with signal line",
  bollinger: "SMA ± σ standard deviations",
  atr: "average true range (volatility)",
};

interface Props {
  value: IndicatorConfig[];
  onChange: (value: IndicatorConfig[]) => void;
  /** Run / replay: settings are frozen with the charter. */
  locked?: boolean;
}

function bounded(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(2, Math.min(200, Math.round(parsed))) : fallback;
}

export function IndicatorSettings({ value, onChange, locked = false }: Props) {
  const update = (id: IndicatorId, patch: Partial<IndicatorConfig>) =>
    onChange(value.map((config) => (config.id === id ? { ...config, ...patch } : config)));
  return (
    <div className={`panel indicator-settings ${locked ? "locked" : ""}`}>
      <h2>{locked ? <span className="lock"><span aria-hidden>{"🔒"}</span> Rune Indicators</span> : "Rune Indicators"}</h2>
      <p className="hint">{locked ? "Frozen with the charter for this run." : "Only enabled indicators are computed for the golem and drawn on the chart."}</p>
      {value.map((config) => (
        <div className={`indicator-row ${config.enabled ? "enabled" : ""}`} key={config.id}>
          <label title={HINTS[config.id]}>
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={locked}
              onChange={(event) => update(config.id, { enabled: event.target.checked })}
            />
            <img src={assetUrl(`trade.indicator.${config.id}`)} alt="" />
            <strong>{LABELS[config.id]}</strong>
            {config.color && <i className="swatch" style={{ background: config.color }} aria-hidden />}
          </label>
          {config.id === "macd" ? (
            <div className="indicator-fields">
              {(["fastPeriod", "slowPeriod", "signalPeriod"] as const).map((field) => (
                <label key={field}>
                  {field.replace("Period", "")}
                  <input
                    type="number"
                    min={2}
                    max={200}
                    value={config[field] ?? 2}
                    disabled={locked}
                    onChange={(event) => update(config.id, { [field]: bounded(event.target.value, config[field] ?? 2) })}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="indicator-fields">
              <label>
                period
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={config.period ?? 14}
                  disabled={locked}
                  onChange={(event) => update(config.id, { period: bounded(event.target.value, config.period ?? 14) })}
                />
              </label>
              {config.id === "bollinger" && (
                <label>
                  σ
                  <input
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={config.deviations ?? 2}
                    disabled={locked}
                    onChange={(event) => update(config.id, { deviations: Math.max(0.1, Math.min(10, Number(event.target.value) || 2)) })}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
