import type { WorldState } from "@core/types";
import { assetUrl } from "../assets";

interface Props {
  state: WorldState | null;
  llmCalls: number;
  levelIndex: number; // 1-based
  levelsTotal: number;
  tier: number;
  attempts?: number;
}

export function StatusBox({ state, llmCalls, levelIndex, levelsTotal, tier, attempts }: Props) {
  const alive = state ? state.agent.alive : true;
  const td = state?.td;
  const market = state?.market;
  const netPnl = market ? (market.finalPnl ?? market.balance + market.unrealizedPnl - market.startingBalance) : 0;
  const mascotFrame = market ? (market.status === "lost" ? 2 : market.status === "won" ? 1 : 0) : alive ? (state?.status === "won" ? 1 : 0) : 2;
  return (
    <div className="panel dark status">
      <h2>Status</h2>
      <img className="mascot" src={assetUrl("ui.mascot", mascotFrame)} alt="" />
      <dl className="kv">
        <dt>Golem</dt>
        <dd>
          {market ? (
            <>
              <img className="icon" src={assetUrl(market.status === "lost" ? "ui.icon.heart.empty" : "ui.icon.heart")} alt="" />{" "}
              {market.status === "running" ? "trading" : market.status === "won" ? "in profit" : "in loss"}
            </>
          ) : (
            <>
              <img className="icon" src={assetUrl(alive ? "ui.icon.heart" : "ui.icon.heart.empty")} alt="" /> {alive ? "alive" : "destroyed"}
            </>
          )}
        </dd>
        <dt>{market ? "Candle" : "Steps"}</dt>
        <dd>{market ? `${Math.min(market.candleIndex + 1, market.candlesTotal)}/${market.candlesTotal}` : (state?.tick ?? 0)}</dd>
        <dt>LLM calls</dt>
        <dd>{llmCalls}</dd>
        <dt>Level</dt>
        <dd>
          {levelIndex}/{levelsTotal}
        </dd>
        <dt>Tier</dt>
        <dd>{tier}</dd>
        {typeof attempts === "number" && (
          <>
            <dt>Attempts</dt>
            <dd>{attempts}</dd>
          </>
        )}
        {state && state.agent.inventory.length > 0 && (
          <>
            <dt>Carrying</dt>
            <dd>{state.agent.inventory.map(i => i === "key" ? "🔑 ×1" : i).join(", ")}</dd>
          </>
        )}
        {td && (
          <>
            <dt>Base HP</dt>
            <dd>
              {td.baseHp}/{td.baseHpMax}
            </dd>
            <dt>Wave</dt>
            <dd>
              {Math.min(td.waveIndex, td.wavesTotal)}/{td.wavesTotal} {td.phase === "done" ? "(done)" : ""}
            </dd>
            <dt>Towers left</dt>
            <dd>{td.towersLeft}</dd>
          </>
        )}
        {market && (
          <>
            <dt>Balance</dt>
            <dd>
              <img className="icon" src={assetUrl("trade.icon.balance")} alt="" /> {market.balance.toFixed(2)}
            </dd>
            <dt>Position</dt>
            <dd>
              {market.position ? (
                <>
                  <img className="icon" src={assetUrl(market.position.side === "long" ? "trade.icon.long" : "trade.icon.short")} alt="" /> {market.position.side} @{" "}
                  {market.position.entryPrice.toFixed(2)}
                </>
              ) : (
                "flat"
              )}
            </dd>
            <dt>Net P&amp;L</dt>
            <dd className={netPnl > 0 ? "profit" : netPnl < 0 ? "loss" : ""}>
              {netPnl > 0 ? "+" : ""}
              {netPnl.toFixed(2)}
              {market.position && market.finalPnl === null ? <span className="muted"> (open {market.unrealizedPnl >= 0 ? "+" : ""}{market.unrealizedPnl.toFixed(2)})</span> : null}
            </dd>
            <dt>Fees</dt>
            <dd>{market.feesPaid.toFixed(2)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
