/**
 * Declarative trading-strategy DSL. The LLM compiles a charter into a MarketStrategy once per
 * level; every candle is then decided here, deterministically, from revealed candles only.
 * `validateMarketStrategy` enforces the safety rules (no absolute price thresholds, only enabled
 * indicators, bounded nesting); `parseMarketStrategy` turns untrusted JSON into a validated strategy.
 */
import { computeIndicators } from "./indicators";
import type {
  IndicatorConfig,
  MarketCondition,
  MarketMetricName,
  MarketOperand,
  MarketStrategy,
  Ohlc,
  TradeActionType,
} from "./types";

const PRICE_METRICS = new Set<MarketMetricName>(["price.close"]);
const BASE_METRICS = new Set<MarketMetricName>(["price.close", "price.return", "candle.bodyRatio"]);
export const MARKET_METRIC_NAMES: MarketMetricName[] = [
  "price.close",
  "price.return",
  "candle.bodyRatio",
  "sma",
  "ema",
  "rsi",
  "atr",
  "macd.line",
  "macd.signal",
  "macd.histogram",
  "bollinger.upper",
  "bollinger.middle",
  "bollinger.lower",
];
const METRIC_NAMES = new Set<string>(MARKET_METRIC_NAMES);
const ACTIONS = new Set<TradeActionType>(["long", "short", "close", "hold"]);

function indicatorForMetric(name: MarketMetricName): IndicatorConfig["id"] | null {
  if (BASE_METRICS.has(name)) return null;
  if (name.startsWith("macd.")) return "macd";
  if (name.startsWith("bollinger.")) return "bollinger";
  return name as IndicatorConfig["id"];
}

function inspectCondition(condition: MarketCondition, enabled: Set<string>, errors: string[], depth: number): void {
  if (depth > 8) {
    errors.push("Strategy condition nesting exceeds 8 levels.");
    return;
  }
  if ("conditions" in condition) {
    if (condition.conditions.length < 1 || condition.conditions.length > 8) errors.push(`${condition.op} must contain 1 to 8 conditions.`);
    for (const child of condition.conditions) inspectCondition(child, enabled, errors, depth + 1);
    return;
  }
  if ("condition" in condition) {
    inspectCondition(condition.condition, enabled, errors, depth + 1);
    return;
  }
  const operands: MarketOperand[] = [condition.left, condition.right];
  for (const operand of operands) {
    if (operand.kind === "number") {
      if (!Number.isFinite(operand.value)) errors.push("Numeric operands must be finite.");
      continue;
    }
    if (!METRIC_NAMES.has(operand.name)) {
      errors.push(`Unknown metric ${String(operand.name)}.`);
      continue;
    }
    const indicator = indicatorForMetric(operand.name);
    if (indicator && !enabled.has(indicator)) errors.push(`${indicator} is not enabled.`);
    if (operand.offset !== undefined && (!Number.isInteger(operand.offset) || operand.offset > 0 || operand.offset < -200)) {
      errors.push(`Metric offset for ${operand.name} must be an integer from -200 to 0.`);
    }
  }
  const hasRawPrice = operands.some((operand) => operand.kind === "metric" && PRICE_METRICS.has(operand.name));
  const hasNumber = operands.some((operand) => operand.kind === "number");
  if (hasRawPrice && hasNumber) errors.push("Absolute price thresholds are not allowed.");
}

export function validateMarketStrategy(strategy: MarketStrategy, indicators: IndicatorConfig[]): string[] {
  const errors: string[] = [];
  if (strategy.version !== 1) errors.push("Strategy version must be 1.");
  if (strategy.fallback !== "hold") errors.push("Strategy fallback must be hold.");
  if (!Array.isArray(strategy.rules) || strategy.rules.length < 1 || strategy.rules.length > 20) errors.push("Strategy must contain 1 to 20 rules.");
  const enabled = new Set(indicators.filter((item) => item.enabled).map((item) => item.id));
  for (const rule of strategy.rules ?? []) {
    if (!ACTIONS.has(rule.action)) errors.push(`Unknown trade action ${String(rule.action)}.`);
    inspectCondition(rule.when, enabled, errors, 0);
  }
  return [...new Set(errors)];
}

function metricValue(
  operand: Extract<MarketOperand, { kind: "metric" }>,
  candles: Ohlc[],
  indicators: ReturnType<typeof computeIndicators>,
  index: number,
): number | null {
  const at = index + (operand.offset ?? 0);
  if (at < 0 || at >= candles.length) return null;
  const candle = candles[at];
  switch (operand.name) {
    case "price.close":
      return candle.close;
    case "price.return":
      return at === 0 ? null : candle.close / candles[at - 1].close - 1;
    case "candle.bodyRatio": {
      const range = candle.high - candle.low;
      return range === 0 ? 0 : Math.abs(candle.close - candle.open) / range;
    }
    default:
      return indicators[operand.name]?.[at] ?? null;
  }
}

function operandValue(
  operand: MarketOperand,
  candles: Ohlc[],
  indicators: ReturnType<typeof computeIndicators>,
  index: number,
): number | null {
  return operand.kind === "number" ? operand.value : metricValue(operand, candles, indicators, index);
}

function evaluateCondition(
  condition: MarketCondition,
  candles: Ohlc[],
  indicators: ReturnType<typeof computeIndicators>,
  index: number,
): boolean {
  if ("conditions" in condition) {
    return condition.op === "and"
      ? condition.conditions.every((child) => evaluateCondition(child, candles, indicators, index))
      : condition.conditions.some((child) => evaluateCondition(child, candles, indicators, index));
  }
  if ("condition" in condition) return !evaluateCondition(condition.condition, candles, indicators, index);
  const left = operandValue(condition.left, candles, indicators, index);
  const right = operandValue(condition.right, candles, indicators, index);
  if (left === null || right === null) return false;
  if (condition.op === "gt") return left > right;
  if (condition.op === "gte") return left >= right;
  if (condition.op === "lt") return left < right;
  if (condition.op === "lte") return left <= right;
  if (condition.left.kind !== "metric" || condition.right.kind !== "metric") return false;
  const previousLeft = metricValue(condition.left, candles, indicators, index - 1);
  const previousRight = metricValue(condition.right, candles, indicators, index - 1);
  if (previousLeft === null || previousRight === null) return false;
  return condition.op === "crossesAbove"
    ? previousLeft <= previousRight && left > right
    : previousLeft >= previousRight && left < right;
}

/** Decide the action for the latest candle. First matching rule wins; otherwise the fallback (hold). */
export function evaluateMarketStrategy(
  strategy: MarketStrategy,
  candles: Ohlc[],
  configs: IndicatorConfig[],
): TradeActionType {
  const errors = validateMarketStrategy(strategy, configs);
  if (errors.length) throw new Error(errors.join(" "));
  const indicators = computeIndicators(candles, configs);
  const index = candles.length - 1;
  return strategy.rules.find((rule) => evaluateCondition(rule.when, candles, indicators, index))?.action ?? strategy.fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperand(value: unknown): MarketOperand {
  if (!isRecord(value)) throw new Error("Strategy operand must be an object.");
  if (value.kind === "number" && typeof value.value === "number") return { kind: "number", value: value.value };
  if (value.kind === "metric" && typeof value.name === "string") {
    const offset = value.offset;
    return {
      kind: "metric",
      name: value.name as MarketMetricName,
      ...(typeof offset === "number" ? { offset } : {}),
    };
  }
  throw new Error("Invalid strategy operand.");
}

function parseCondition(value: unknown): MarketCondition {
  if (!isRecord(value) || typeof value.op !== "string") throw new Error("Strategy condition must be an object.");
  if ((value.op === "and" || value.op === "or") && Array.isArray(value.conditions)) {
    return { op: value.op, conditions: value.conditions.map(parseCondition) };
  }
  if (value.op === "not") return { op: "not", condition: parseCondition(value.condition) };
  if (value.op === "crossesAbove" || value.op === "crossesBelow") {
    const left = parseOperand(value.left);
    const right = parseOperand(value.right);
    if (left.kind !== "metric" || right.kind !== "metric") throw new Error(`${value.op} requires metric operands.`);
    return { op: value.op, left, right };
  }
  if (value.op === "gt" || value.op === "gte" || value.op === "lt" || value.op === "lte") {
    return { op: value.op, left: parseOperand(value.left), right: parseOperand(value.right) };
  }
  throw new Error(`Unknown strategy condition ${String(value.op)}.`);
}

/** Untrusted JSON (LLM output) -> validated MarketStrategy. Throws on any structural or rule violation. */
export function parseMarketStrategy(value: unknown, indicators: IndicatorConfig[]): MarketStrategy {
  if (!isRecord(value) || value.version !== 1 || value.fallback !== "hold" || !Array.isArray(value.rules)) {
    throw new Error("Invalid market strategy envelope.");
  }
  const rules = value.rules.map((raw) => {
    if (!isRecord(raw) || typeof raw.action !== "string" || !ACTIONS.has(raw.action as TradeActionType)) {
      throw new Error("Invalid market strategy rule.");
    }
    return { when: parseCondition(raw.when), action: raw.action as TradeActionType };
  });
  const strategy: MarketStrategy = { version: 1, rules, fallback: "hold" };
  const errors = validateMarketStrategy(strategy, indicators);
  if (errors.length) throw new Error(errors.join(" "));
  return strategy;
}
