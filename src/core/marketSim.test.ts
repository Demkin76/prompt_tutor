import { describe, expect, it } from "vitest";
import { createMarketState, stepMarket } from "./marketSim";
import type { Ohlc } from "./types";
import { getLevel } from "./levels";
import { generateLevel } from "./generators/index";
import { step } from "./sim";

const candle = (close: number): Ohlc => ({ open: close, high: close + 1, low: close - 1, close });

describe("market simulation", () => {
  it("opens one full-balance long and closes it net of 0.1% fees", () => {
    let state = createMarketState(candle(100), 10_000);
    state = stepMarket(state, "long", candle(110), 10).state;
    expect(state.position?.side).toBe("long");
    expect(state.feesPaid).toBeCloseTo(10);
    expect(state.unrealizedPnl).toBeCloseTo(1_000);
    state = stepMarket(state, "close", undefined, 10).state;
    expect(state.position).toBeNull();
    expect(state.realizedPnl).toBeCloseTo(1_000);
    expect(state.balance).toBeCloseTo(10_979);
    expect(state.finalPnl).toBeCloseTo(979);
    expect(state.status).toBe("won");
  });

  it("flips a position with close and open commissions, then force closes", () => {
    let state = createMarketState(candle(100), 10_000);
    state = stepMarket(state, "long", candle(105), 10).state;
    const flipped = stepMarket(state, "short", candle(95), 10);
    state = flipped.state;
    expect(flipped.events.map((event) => event.type)).toEqual([
      "position_closed",
      "fee_charged",
      "position_opened",
      "fee_charged",
      "candle_revealed",
    ]);
    const ended = stepMarket(state, "hold", undefined, 10);
    expect(ended.events.some((event) => event.type === "forced_close")).toBe(true);
    expect(ended.state.position).toBeNull();
    expect(ended.state.status).toBe("won");
  });

  it("hold-only ends with zero P&L and is lost; a terminal state ignores actions", () => {
    let state = createMarketState(candle(100), 10_000);
    state = stepMarket(state, "hold", candle(101), 10).state;
    const ended = stepMarket(state, "hold", undefined, 10);
    expect(ended.state.finalPnl).toBe(0);
    expect(ended.state.status).toBe("lost");
    expect(stepMarket(ended.state, "long", candle(1), 10).events).toEqual([]);
  });

  it("liquidates a short when equity reaches zero (a long without leverage never can)", () => {
    let state = createMarketState(candle(100), 10_000);
    const survived = stepMarket(state, "long", candle(0.5), 10).state;
    expect(survived.status).toBe("running");
    const r = stepMarket(state, "short", candle(250), 10);
    state = r.state;
    expect(r.events.map((e) => e.type)).toEqual(["position_opened", "fee_charged", "candle_revealed", "liquidated"]);
    expect(state.status).toBe("lost");
    expect(state.balance).toBe(0);
    expect(state.position).toBeNull();
    expect(state.finalPnl).toBe(-10_000);
  });

  it("does not mutate its input", () => {
    const state = createMarketState(candle(100), 10_000);
    const before = structuredClone(state);
    stepMarket(state, "long", candle(101), 10);
    expect(state).toEqual(before);
  });

  it("integrates with the core step contract without revealing future candles", () => {
    const spec = getLevel("runetrading-t1-l1")!;
    let state = generateLevel(spec);
    expect(state.market?.candles).toHaveLength(1);
    expect(state.rngState).toBe(0);
    for (let index = 0; index < 120; index++) {
      const r = step(spec, state, { type: index === 0 ? "long" : "hold" });
      state = r.state;
      if (index < 119) {
        expect(state.market?.candles).toHaveLength(index + 2);
        expect(state.status).toBe("running");
      }
      if (index === 0) expect(state.entities[0].visual.animation).toBe("buy");
    }
    expect(state.status).toBe("won");
    expect(state.tick).toBe(120);
    expect(state.market?.position).toBeNull();
    expect(state.market?.finalPnl).toBeGreaterThan(0);
    expect(state.entities[0].visual.animation).toBe("success");
    expect(step(spec, state, { type: "long" }).events).toEqual([]);
  });

  it("treats a non-market action as hold and flags it", () => {
    const spec = getLevel("runetrading-t1-l1")!;
    const r = step(spec, generateLevel(spec), { type: "wait" });
    expect(r.events.map((e) => e.type)).toEqual(["invalid_action", "candle_revealed"]);
    expect(r.state.market?.position).toBeNull();
  });
});
