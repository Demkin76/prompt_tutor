/**
 * Charter -> MarketStrategy compiler (rune trading). ONE structured-output LLM call per level
 * turns the player's charter into a declarative strategy; the strategy is then evaluated
 * deterministically for every candle by `core/marketStrategy.ts`. The LLM never sees a candle.
 */
import type { IndicatorConfig, LlmClient, MarketStrategy } from "../core/types";
import { validateMarketCharter } from "../core/charter";
import { MARKET_METRIC_NAMES, parseMarketStrategy } from "../core/marketStrategy";
import { extractJsonText } from "./decision";

const metricOperand = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "name", "offset"],
  properties: {
    kind: { type: "string", enum: ["metric"] },
    name: { type: "string", enum: MARKET_METRIC_NAMES },
    offset: { type: ["integer", "null"], minimum: -200, maximum: 0 },
  },
};

const numberOperand = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "value"],
  properties: { kind: { type: "string", enum: ["number"] }, value: { type: "number" } },
};

const comparisonCondition = {
  type: "object",
  additionalProperties: false,
  required: ["op", "left", "right"],
  properties: {
    op: { type: "string", enum: ["gt", "gte", "lt", "lte"] },
    left: { anyOf: [metricOperand, numberOperand] },
    right: { anyOf: [metricOperand, numberOperand] },
  },
};

const crossCondition = {
  type: "object",
  additionalProperties: false,
  required: ["op", "left", "right"],
  properties: {
    op: { type: "string", enum: ["crossesAbove", "crossesBelow"] },
    left: metricOperand,
    right: metricOperand,
  },
};

const leafCondition = { anyOf: [comparisonCondition, crossCondition] };

/** and / or over leaves (one nesting level keeps the schema strict-mode friendly). */
const compoundCondition = {
  type: "object",
  additionalProperties: false,
  required: ["op", "conditions"],
  properties: {
    op: { type: "string", enum: ["and", "or"] },
    conditions: { type: "array", minItems: 1, maxItems: 8, items: leafCondition },
  },
};

export const MARKET_STRATEGY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["version", "rules", "fallback"],
  properties: {
    version: { type: "integer", enum: [1] },
    rules: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["when", "action"],
        properties: {
          when: { anyOf: [comparisonCondition, crossCondition, compoundCondition] },
          action: { type: "string", enum: ["long", "short", "close", "hold"] },
        },
      },
    },
    fallback: { type: "string", enum: ["hold"] },
  },
};

export const MARKET_COMPILER_MAX_TOKENS = 1200;

export function marketCompilerPrompt(charter: string, indicators: IndicatorConfig[]): { system: string; user: string } {
  const enabled = indicators.filter((item) => item.enabled);
  const metrics = enabled.flatMap((item) => {
    if (item.id === "macd") return ["macd.line", "macd.signal", "macd.histogram"];
    if (item.id === "bollinger") return ["bollinger.upper", "bollinger.middle", "bollinger.lower"];
    return [item.id];
  });
  return {
    system: [
      "Compile a player's trading charter into a declarative JSON strategy.",
      "Rules are checked in order at every candle close; the first matching rule decides the action (long, short, close, hold). If none matches, the strategy holds.",
      "long/short open (or keep) a full-balance position, flipping the other side if needed; close flattens; hold changes nothing.",
      "Available metrics: price.close, price.return (close/previous close - 1), candle.bodyRatio (|close-open| / (high-low)), plus the enabled indicators below.",
      `Enabled indicator metrics: ${metrics.length ? metrics.join(", ") : "(none)"}. Do not reference any other indicator.`,
      "Never compare price.close with a numeric constant: absolute price thresholds are forbidden. Compare price.close only with other metrics.",
      "Numeric constants are allowed for price.return (e.g. 0.02 = +2%), candle.bodyRatio, rsi (0..100), atr, macd.* and any indicator-vs-number threshold.",
      "crossesAbove / crossesBelow need two metric operands. A metric may carry an offset (0 or negative) to look back N candles. Use null when no offset is needed.",
      `Enabled indicator settings: ${JSON.stringify(enabled)}`,
      "Return JSON only. Do not emit code or prose.",
    ].join("\n"),
    user: charter,
  };
}

export interface CompiledMarketStrategy {
  strategy: MarketStrategy;
  latencyMs: number;
}

export async function compileMarketStrategy(
  llm: LlmClient,
  charter: string,
  indicators: IndicatorConfig[],
  options: { timeoutMs?: number } = {},
): Promise<CompiledMarketStrategy> {
  const charterErrors = validateMarketCharter(charter);
  if (charterErrors.length) throw new Error(charterErrors.join(" "));
  const prompt = marketCompilerPrompt(charter, indicators);
  const response = await llm.complete({
    system: prompt.system,
    user: prompt.user,
    jsonSchema: MARKET_STRATEGY_JSON_SCHEMA,
    maxTokens: MARKET_COMPILER_MAX_TOKENS,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(response.text));
  } catch (error) {
    throw new Error(`Compiled strategy is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { strategy: parseMarketStrategy(parsed, indicators), latencyMs: response.latencyMs };
}
