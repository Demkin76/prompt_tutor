/**
 * Deterministic market simulation for rune trading. One `stepMarket` = one action applied at
 * the current candle close, then the next candle is revealed. A position always uses the
 * full balance (no leverage); every open and close pays `feeBps`. The last step (no next
 * candle) force-closes and settles: won iff net P&L after fees is strictly positive.
 */
import type { ChartClass, MarketPosition, MarketState, Ohlc, SimEventType, TradeActionType } from "./types";

export interface MarketSimEvent {
  type: SimEventType;
  data?: Record<string, string | number | boolean | null>;
}

function roundMoney(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function createMarketState(
  firstCandle: Ohlc,
  startingBalance: number,
  options: { chartClass?: ChartClass; candlesTotal?: number } = {},
): MarketState {
  if (!(startingBalance > 0)) throw new Error("startingBalance must be positive");
  return {
    chartClass: options.chartClass ?? "flat",
    candles: [firstCandle],
    candleIndex: 0,
    candlesTotal: options.candlesTotal ?? 1,
    startingBalance,
    balance: startingBalance,
    position: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    finalPnl: null,
    status: "running",
  };
}

function positionPnl(position: MarketPosition, price: number): number {
  const delta = position.side === "long" ? price - position.entryPrice : position.entryPrice - price;
  return delta * position.quantity;
}

function chargeFee(state: MarketState, notional: number, feeBps: number, events: MarketSimEvent[]): void {
  const fee = Math.abs(notional) * (feeBps / 10_000);
  state.balance = roundMoney(state.balance - fee);
  state.feesPaid = roundMoney(state.feesPaid + fee);
  events.push({ type: "fee_charged", data: { fee: roundMoney(fee), feeBps } });
}

function closePosition(state: MarketState, price: number, feeBps: number, events: MarketSimEvent[]): void {
  const position = state.position;
  if (!position) return;
  const pnl = positionPnl(position, price);
  state.realizedPnl = roundMoney(state.realizedPnl + pnl);
  state.balance = roundMoney(state.balance + pnl);
  state.position = null;
  events.push({ type: "position_closed", data: { side: position.side, price, pnl: roundMoney(pnl) } });
  chargeFee(state, position.quantity * price, feeBps, events);
}

function openPosition(
  state: MarketState,
  side: MarketPosition["side"],
  price: number,
  feeBps: number,
  events: MarketSimEvent[],
): void {
  if (state.balance <= 0) return;
  const quantity = state.balance / price;
  state.position = { side, entryPrice: price, quantity };
  events.push({ type: "position_opened", data: { side, price, quantity } });
  chargeFee(state, quantity * price, feeBps, events);
}

/** Pure: returns a new state; `nextCandle === undefined` means the series is over (settle). */
export function stepMarket(
  input: MarketState,
  action: TradeActionType,
  nextCandle: Ohlc | undefined,
  feeBps: number,
): { state: MarketState; events: MarketSimEvent[] } {
  if (input.status !== "running") return { state: input, events: [] };
  if (!(feeBps >= 0 && feeBps <= 1_000)) throw new Error("feeBps must be in [0, 1000]");
  const state = structuredClone(input);
  const events: MarketSimEvent[] = [];
  const price = state.candles.at(-1)?.close;
  if (price === undefined) throw new Error("market state has no current candle");

  if (action === "close") {
    closePosition(state, price, feeBps, events);
  } else if (action === "long" || action === "short") {
    if (state.position?.side !== action) {
      closePosition(state, price, feeBps, events);
      openPosition(state, action, price, feeBps, events);
    }
  }

  if (nextCandle) {
    state.candles.push(nextCandle);
    state.candleIndex += 1;
    state.unrealizedPnl = state.position ? roundMoney(positionPnl(state.position, nextCandle.close)) : 0;
    events.push({ type: "candle_revealed", data: { candleIndex: state.candleIndex, close: nextCandle.close } });
    if (state.balance + state.unrealizedPnl <= 0) {
      state.position = null;
      state.balance = 0;
      state.unrealizedPnl = 0;
      state.finalPnl = -state.startingBalance;
      state.status = "lost";
      events.push({ type: "liquidated" });
    }
    return { state, events };
  }

  if (state.position) {
    events.push({ type: "forced_close", data: { candleIndex: state.candleIndex } });
    closePosition(state, price, feeBps, events);
  }
  state.unrealizedPnl = 0;
  state.finalPnl = roundMoney(state.balance - state.startingBalance);
  state.status = state.finalPnl > 0 ? "won" : "lost";
  events.push({ type: "market_complete", data: { finalPnl: state.finalPnl, balance: state.balance } });
  return { state, events };
}
