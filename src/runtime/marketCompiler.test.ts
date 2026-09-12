import { describe, expect, it } from "vitest";
import { MARKET_STRATEGY_JSON_SCHEMA, compileMarketStrategy, marketCompilerPrompt } from "./marketCompiler";
import { createFakeLlm, FAKE_MARKET_STRATEGY, isMarketStrategyRequest } from "./llm";
import type { IndicatorConfig, LlmClient, LlmRequest } from "../core/types";

const strategyText = JSON.stringify({
  version: 1,
  rules: [
    {
      when: {
        op: "lt",
        left: { kind: "metric", name: "rsi", offset: null },
        right: { kind: "number", value: 30 },
      },
      action: "long",
    },
  ],
  fallback: "hold",
});

describe("compileMarketStrategy", () => {
  it("uses one structured-output call and validates the compiled strategy", async () => {
    const requests: LlmRequest[] = [];
    const llm: LlmClient = {
      async complete(req) {
        requests.push(req);
        return { text: strategyText, latencyMs: 5 };
      },
    };
    const indicators: IndicatorConfig[] = [{ id: "rsi", enabled: true, period: 14 }];
    const result = await compileMarketStrategy(llm, "Buy when RSI is below 30.", indicators);
    expect(requests).toHaveLength(1);
    expect(requests[0].jsonSchema).toBe(MARKET_STRATEGY_JSON_SCHEMA);
    expect(requests[0].user).toBe("Buy when RSI is below 30.");
    expect(requests[0].system).toContain("rsi");
    expect(result.strategy.rules[0].action).toBe("long");
    expect(result.strategy.rules[0].when).toEqual({ op: "lt", left: { kind: "metric", name: "rsi" }, right: { kind: "number", value: 30 } });
    expect(result.latencyMs).toBe(5);
  });

  it("rejects absolute-price charters before calling the LLM and invalid replies after", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async complete() {
        calls += 1;
        return { text: "```json\n{\"version\":1,\"rules\":[],\"fallback\":\"hold\"}\n```", latencyMs: 1 };
      },
    };
    await expect(compileMarketStrategy(llm, "Buy at 100", [])).rejects.toThrow(/absolute price/i);
    expect(calls).toBe(0);
    await expect(compileMarketStrategy(llm, "Buy dips", [])).rejects.toThrow(/1 to 20 rules/);
    expect(calls).toBe(1);
    const disabled: LlmClient = { async complete() { return { text: strategyText, latencyMs: 1 }; } };
    await expect(compileMarketStrategy(disabled, "Buy when RSI is low", [{ id: "sma", enabled: true, period: 20 }])).rejects.toThrow(/rsi is not enabled/);
    const garbage: LlmClient = { async complete() { return { text: "not json", latencyMs: 1 }; } };
    await expect(compileMarketStrategy(garbage, "Buy dips", [])).rejects.toThrow(/not valid JSON/);
  });

  it("lists only enabled indicator metrics in the prompt", () => {
    const { system, user } = marketCompilerPrompt("Follow MACD.", [
      { id: "macd", enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      { id: "sma", enabled: false, period: 20 },
    ]);
    expect(user).toBe("Follow MACD.");
    expect(system).toContain("macd.line, macd.signal, macd.histogram");
    expect(system).not.toContain('"id":"sma"');
  });

  it("is answered by the fake LLM with a valid default strategy", async () => {
    const fake = createFakeLlm(() => ({ intent: "n/a", plan: [{ type: "wait" }], stopOn: [] }));
    const result = await compileMarketStrategy(fake, "Ride the trend.", []);
    expect(result.strategy).toEqual(FAKE_MARKET_STRATEGY);
    expect(isMarketStrategyRequest({ system: "", user: "", jsonSchema: MARKET_STRATEGY_JSON_SCHEMA })).toBe(true);
    expect(isMarketStrategyRequest({ system: "", user: "", jsonSchema: { properties: { intent: {} } } })).toBe(false);
  });
});
