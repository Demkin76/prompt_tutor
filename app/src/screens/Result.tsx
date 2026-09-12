import { useMemo } from "react";
import type { LevelRunResult, MarketState, ModeId } from "@core/types";
import { golemApi } from "../api";
import { assetUrl } from "../assets";

interface Props {
  runId: string;
  mode: ModeId;
  tier: number;
  onRetry: (tier: number) => void;
  onReplay: (levelId: string) => void;
  onHome: () => void;
}

function evidenceText(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

interface MarketOutcome {
  finalPnl: number;
  finalBalance: number;
  feesPaid: number;
  startingBalance?: number;
}

/** The verifier records the market outcome as evidence noted "rune trading result"; the replay's final state is the fallback. */
function marketOutcome(result: LevelRunResult, finalMarket: MarketState | undefined): MarketOutcome | null {
  const fromEvidence = result.verdict.evidence.find((item) => item.note === "rune trading result")?.value;
  if (fromEvidence && typeof fromEvidence === "object") {
    const v = fromEvidence as Partial<MarketOutcome>;
    if (typeof v.finalPnl === "number") return { finalPnl: v.finalPnl, finalBalance: v.finalBalance ?? 0, feesPaid: v.feesPaid ?? 0, startingBalance: v.startingBalance };
  }
  if (finalMarket) {
    return {
      finalPnl: finalMarket.finalPnl ?? finalMarket.balance - finalMarket.startingBalance,
      finalBalance: finalMarket.balance,
      feesPaid: finalMarket.feesPaid,
      startingBalance: finalMarket.startingBalance,
    };
  }
  return null;
}

const signed = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;

function ResultCard({
  index,
  title,
  result,
  onReplay,
  market,
  finalMarket,
}: {
  index: number;
  title: string;
  result?: LevelRunResult;
  onReplay?: () => void;
  market?: boolean;
  finalMarket?: MarketState;
}) {
  if (!result) {
    return (
      <div className="panel result-card fail">
        <div className="verdict">L{index} — NOT PLAYED</div>
        <p>{title}</p>
        <p className="muted">The run ended before this level started.</p>
      </div>
    );
  }
  const passed = result.verdict.passed;
  const outcome = market ? marketOutcome(result, finalMarket) : null;
  return (
    <div className={`panel result-card ${passed ? "pass" : "fail"} ${market ? "market" : ""}`}>
      <div className="verdict">
        L{index} — {passed ? "PASS" : "FAIL"}
      </div>
      {market && <img className="result-rune" src={assetUrl(passed ? "trade.result.profit" : outcome && outcome.finalPnl === 0 ? "trade.result.breakeven" : "trade.result.loss")} alt="" />}
      <p>
        <strong>{title}</strong>
      </p>
      {outcome && (
        <div className={`market-outcome ${outcome.finalPnl > 0 ? "profit" : outcome.finalPnl < 0 ? "loss" : ""}`}>
          <span className="label">NET P&amp;L</span>
          <span className="value">{signed(outcome.finalPnl)}</span>
          <span className="pct">
            {outcome.startingBalance ? `${signed((outcome.finalPnl / outcome.startingBalance) * 100)}%` : ""}
          </span>
        </div>
      )}
      <dl className="kv">
        {outcome ? (
          <>
            <dt>Final balance</dt>
            <dd>{outcome.finalBalance.toFixed(2)}</dd>
            <dt>Fees paid</dt>
            <dd>{outcome.feesPaid.toFixed(2)}</dd>
            <dt>Candles</dt>
            <dd>{result.ticks}</dd>
          </>
        ) : (
          <>
            <dt>Ticks</dt>
            <dd>{result.ticks}</dd>
          </>
        )}
        <dt>LLM calls</dt>
        <dd>{result.llmCalls}</dd>
        <dt>Score</dt>
        <dd>{result.levelScore} pts</dd>
        <dt>Confidence</dt>
        <dd>{Math.round(result.verdict.confidence * 100)}%</dd>
      </dl>
      <h3>Why</h3>
      <ul>
        {result.verdict.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {result.verdict.evidence.length > 0 && (
        <details className="proof-details">
          <summary>Proof &amp; event trace</summary>
          <ul className="evidence">
            {result.verdict.evidence.map((e, i) => (
              <li key={i}>
                {e.type}: {evidenceText(e.value)}
                {e.note ? ` — ${e.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {onReplay && (
        <button className="btn small" onClick={onReplay}>
          {market ? `Replay chart ${index}` : `Replay level ${index}`}
        </button>
      )}
    </div>
  );
}

export function Result({ runId, mode, tier, onRetry, onReplay, onHome }: Props) {
  const run = golemApi.useRun(runId);
  const levelRuns = golemApi.useLevelRuns(runId);
  const tiers = golemApi.useTiers(mode);
  const sorted = useMemo(() => [...(levelRuns ?? [])].sort((a, b) => a.order - b.order), [levelRuns]);

  if (run === null) return <div className="error">Run not found.</div>;
  if (!run || !tiers) return <div className="loading">tallying the verdicts</div>;
  const summary = run.summary;
  const maxTier = tiers.length;
  const played = summary?.tiers ?? run.ladder ?? [];
  const reached = summary?.reachedTier ?? run.currentTier ?? tier;
  const clearedAll = played.length > 0 && played[played.length - 1].unlocked && reached >= maxTier;
  const nextTier = Math.min(maxTier, clearedAll ? maxTier : summary?.tierUnlocked ? reached + 1 : reached);
  const tiersToShow = played.length > 0 ? played.map((t) => t.tier) : [tier];
  const market = mode === "runetrading";
  const totalPnl = market
    ? sorted.reduce((sum, lr) => {
        const outcome = lr.result ? marketOutcome(lr.result, lr.replay?.finalState.market) : null;
        return sum + (outcome?.finalPnl ?? 0);
      }, 0)
    : 0;

  return (
    <>
      <div className="summary">
        <div className="score">{summary ? `${summary.score} PTS` : run.status === "error" ? "RUN FAILED" : "PENDING"}</div>
        <div className="passed">{summary ? `${summary.passedLevels}/${summary.totalLevels} LEVELS PASSED · REACHED TIER ${reached}` : ""}</div>
        {market && summary && (
          <div className={`passed market-total ${totalPnl > 0 ? "profit" : totalPnl < 0 ? "loss" : ""}`}>
            TOTAL NET P&amp;L {signed(totalPnl)}
          </div>
        )}
        <div className="passed" style={{ opacity: 0.7 }}>
          STARTED AT TIER {tier} · {charterSummary(run.charter)}
          {market && run.settings ? ` · ${run.settings.indicators.filter((i) => i.enabled).map((i) => i.id.toUpperCase()).join(" ") || "NO INDICATORS"}` : ""}
        </div>
      </div>
      {clearedAll && <div className="unlock">ALL TIERS CLEARED</div>}
      {!clearedAll && summary?.tierUnlocked && reached < maxTier && <div className="unlock">TIER {reached + 1} UNLOCKED</div>}
      {run.status === "error" && <div className="error">{run.error ?? "The run failed."}</div>}
      {tiersToShow.map((tn) => {
        const tierSpec = tiers.find((t) => t.tier === tn);
        if (!tierSpec) return null;
        const tr = played.find((t) => t.tier === tn);
        return (
          <div key={tn} className="tier-block">
            <h2 className="tier-heading">
              TIER {tn} — {tierSpec.title.replace(/^.*— /, "")}
              {tr ? ` · ${tr.passedLevels}/${tr.totalLevels}` : ""}
            </h2>
            <div className="results">
              {tierSpec.levels.map((l, i) => {
                const lr = sorted.find((r) => r.levelId === l.id);
                const result = lr?.result ?? summary?.levels.find((r) => r.levelId === l.id);
                return (
                  <div key={l.id}>
                    <ResultCard
                      index={i + 1}
                      title={l.title}
                      result={result}
                      market={market}
                      finalMarket={lr?.replay?.finalState.market}
                      onReplay={lr ? () => onReplay(l.id) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="btn-row">
        <button className="btn primary" onClick={() => onRetry(nextTier)}>
          {nextTier > tier ? `Continue at tier ${nextTier} (edit charter)` : "Retry (edit charter)"}
        </button>
        <button className="btn ghost" onClick={onHome}>
          Home
        </button>
      </div>
    </>
  );
}

function charterSummary(c: string): string {
  return `${c.length} CHARS`;
}
