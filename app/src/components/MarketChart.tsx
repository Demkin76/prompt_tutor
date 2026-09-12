import { useMemo } from "react";
import type { IndicatorConfig, Ohlc } from "@core/types";
import { computeIndicators } from "@core/indicators";
import { enabledOscillatorPanes, isPriceOverlay, marketBounds, oscillatorBounds, valueToY, type OscillatorPane, type TradeMarker } from "../marketChartModel";

export type { TradeMarker } from "../marketChartModel";

interface Props {
  candles: Ohlc[];
  indicators: IndicatorConfig[];
  markers?: TradeMarker[];
  label?: string;
  /** Width of the x axis in candles; defaults to `candles.length`. Pass the level's candle count so a live run does not stretch as candles arrive. */
  candlesTotal?: number;
}

const COLORS: Record<string, string> = {
  sma: "#4da3ff",
  ema: "#ff9f43",
  "bollinger.upper": "#b780ff",
  "bollinger.middle": "#8e62cc",
  "bollinger.lower": "#b780ff",
  rsi: "#c77dff",
  "macd.line": "#5fe1c3",
  "macd.signal": "#ff9f43",
  "macd.histogram": "#8fb6ff",
  atr: "#ffd36b",
};

const WIDTH = 900;
const PRICE_HEIGHT = 280;
const PANE_HEIGHT = 72;
const PANE_GAP = 10;
const PLOT_TOP = 16;
const AXIS_WIDTH = 56;

function latest(values: Array<number | null> | undefined): number | undefined {
  return values?.slice().reverse().find((value) => value !== null) ?? undefined;
}

function colorFor(name: string, indicators: IndicatorConfig[]): string {
  const id = name.split(".")[0];
  return indicators.find((indicator) => indicator.id === id)?.color ?? COLORS[name] ?? "#9aa6b8";
}

export function MarketChart({ candles, indicators, markers = [], label = "FICTIONAL RUNE PAIR", candlesTotal }: Props) {
  const computed = useMemo(() => computeIndicators(candles, indicators), [candles, indicators]);
  const bounds = useMemo(() => marketBounds(candles, computed), [candles, computed]);
  const panes = useMemo(() => enabledOscillatorPanes(indicators), [indicators]);
  const height = PLOT_TOP + PRICE_HEIGHT + panes.length * (PANE_HEIGHT + PANE_GAP) + 8;
  const plotWidth = WIDTH - AXIS_WIDTH;
  const slots = Math.max(1, candlesTotal ?? candles.length, candles.length);
  const step = plotWidth / slots;
  const candleWidth = Math.max(1.5, Math.min(7, step * 0.62));
  const x = (index: number) => step * index + step / 2;
  const y = (value: number) => PLOT_TOP + valueToY(value, bounds, PRICE_HEIGHT);
  const overlays = Object.entries(computed).filter(([name]) => isPriceOverlay(name));
  const last = candles[candles.length - 1];
  const ticks = Array.from({ length: 6 }, (_, index) => bounds.max - ((bounds.max - bounds.min) * index) / 5);

  return (
    <div className="market-chart" aria-label={label}>
      <div className="market-chart-title">
        <span>{label}</span>
        <span>
          {candles.length}
          {candlesTotal ? `/${candlesTotal}` : ""} CANDLES{last ? ` · LAST ${last.close.toFixed(2)}` : ""}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`${label}, ${candles.length} candles`}>
        <rect width={WIDTH} height={height} fill="#101722" />
        {ticks.map((value, index) => {
          const yy = PLOT_TOP + (PRICE_HEIGHT * index) / 5;
          return (
            <g key={`h${index}`}>
              <line x1={0} x2={plotWidth} y1={yy} y2={yy} stroke="#273142" strokeWidth={1} />
              <text x={WIDTH - 6} y={yy + 4} textAnchor="end" fontSize={10} fill="#6f7c92">
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
        {candles.map((candle, index) => {
          const rising = candle.close >= candle.open;
          const color = rising ? "#43d66e" : "#ef4e4e";
          const top = y(Math.max(candle.open, candle.close));
          const bottom = y(Math.min(candle.open, candle.close));
          return (
            <g key={index}>
              <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth={1.5} />
              <rect x={x(index) - candleWidth / 2} y={top} width={candleWidth} height={Math.max(1.5, bottom - top)} fill={color} />
            </g>
          );
        })}
        {overlays.map(([name, values]) => {
          const points = values
            .map((value, index) => (value === null ? null : `${x(index)},${y(value)}`))
            .filter((value): value is string => value !== null)
            .join(" ");
          return (
            <polyline
              key={name}
              points={points}
              fill="none"
              stroke={colorFor(name, indicators)}
              strokeWidth={name === "bollinger.middle" ? 1 : 2}
              strokeDasharray={name === "bollinger.middle" ? "3 3" : undefined}
              opacity={0.9}
            />
          );
        })}
        {markers.map((marker, index) => {
          const candle = candles[marker.index];
          if (!candle) return null;
          const color = marker.side === "long" ? "#5dff79" : marker.side === "short" ? "#ff5656" : "#ffd36b";
          const yy = marker.side === "long" ? y(candle.low) + 14 : y(candle.high) - 14;
          return (
            <g key={`${marker.index}-${marker.side}-${index}`}>
              <circle cx={x(marker.index)} cy={yy} r={7} fill={color} stroke="#07090d" strokeWidth={2} />
              <text x={x(marker.index)} y={yy + 3} textAnchor="middle" fontSize={8} fill="#101014">
                {marker.side === "long" ? "L" : marker.side === "short" ? "S" : "×"}
              </text>
            </g>
          );
        })}
        {overlays.length > 0 && (
          <g className="market-legend">
            {overlays.map(([name], index) => (
              <text key={name} x={8 + index * 92} y={PLOT_TOP - 4} fontSize={10} fill={colorFor(name, indicators)}>
                {name.toUpperCase()}
              </text>
            ))}
          </g>
        )}
        {panes.map((pane, paneIndex) => (
          <OscillatorPaneView
            key={pane}
            pane={pane}
            top={PLOT_TOP + PRICE_HEIGHT + PANE_GAP + paneIndex * (PANE_HEIGHT + PANE_GAP)}
            height={PANE_HEIGHT}
            width={plotWidth}
            computed={computed}
            x={x}
          />
        ))}
      </svg>
    </div>
  );
}

function OscillatorPaneView({
  pane,
  top,
  height,
  width,
  computed,
  x,
}: {
  pane: OscillatorPane;
  top: number;
  height: number;
  width: number;
  computed: Record<string, Array<number | null>>;
  x: (index: number) => number;
}) {
  const bounds = oscillatorBounds(pane, computed);
  const yAt = (value: number) => top + valueToY(value, bounds, height);
  const line = (name: string, color: string) => {
    const points = (computed[name] ?? [])
      .map((value, index) => (value === null ? null : `${x(index)},${yAt(value)}`))
      .filter((value): value is string => value !== null)
      .join(" ");
    return <polyline points={points} fill="none" stroke={color} strokeWidth={1.6} />;
  };
  const caption =
    pane === "rsi"
      ? `RSI ${latest(computed.rsi)?.toFixed(1) ?? "—"}`
      : pane === "macd"
        ? `MACD ${latest(computed["macd.histogram"])?.toFixed(3) ?? "—"}`
        : `ATR ${latest(computed.atr)?.toFixed(3) ?? "—"}`;

  return (
    <g className={`market-pane market-pane-${pane}`}>
      <rect x={0} y={top} width={WIDTH} height={height} fill="#0d121b" />
      <line x1={0} x2={WIDTH} y1={top} y2={top} stroke="#3b4659" strokeWidth={1} />
      {pane === "rsi" && (
        <>
          <line x1={0} x2={width} y1={yAt(70)} y2={yAt(70)} stroke="#3b4659" strokeDasharray="4 4" />
          <line x1={0} x2={width} y1={yAt(30)} y2={yAt(30)} stroke="#3b4659" strokeDasharray="4 4" />
          <text x={WIDTH - 6} y={yAt(70) + 3} textAnchor="end" fontSize={9} fill="#6f7c92">70</text>
          <text x={WIDTH - 6} y={yAt(30) + 3} textAnchor="end" fontSize={9} fill="#6f7c92">30</text>
          {line("rsi", COLORS.rsi)}
        </>
      )}
      {pane === "macd" && (
        <>
          {(computed["macd.histogram"] ?? []).map((value, index) =>
            value === null ? null : (
              <rect
                key={index}
                x={x(index) - 1.2}
                y={value >= 0 ? yAt(value) : yAt(0)}
                width={2.4}
                height={Math.max(1, Math.abs(yAt(value) - yAt(0)))}
                fill={value >= 0 ? "#43d66e" : "#ef4e4e"}
                opacity={0.75}
              />
            ),
          )}
          {line("macd.line", COLORS["macd.line"])}
          {line("macd.signal", COLORS["macd.signal"])}
        </>
      )}
      {pane === "atr" && line("atr", COLORS.atr)}
      <text x={10} y={top + 14} fill="#9aa6b8" fontSize={11}>
        {caption}
      </text>
    </g>
  );
}
