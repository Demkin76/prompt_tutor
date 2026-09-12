import { useEffect, useMemo, useState } from "react";
import type { ModeId } from "@core/types";
import { BACKEND, golemApi } from "../api";
import { assetUrl } from "../assets";
import { CharterLocked } from "../components/CharterPanel";
import { GolemLog } from "../components/GolemLog";
import { IndicatorSettings } from "../components/IndicatorSettings";
import { LevelCard } from "../components/LevelCard";
import { MarketChart } from "../components/MarketChart";
import { StatusBox } from "../components/StatusBox";
import { WorldCanvas } from "../components/WorldCanvas";
import { buildLog, traceOf } from "../log";
import { markersFromEvents } from "../marketChartModel";

const FRAME_MS = 250;
const MARKET_FRAME_MS = 30;
const TRACE_MS = 120;

interface Props {
  runId: string;
  mode: ModeId;
  tier: number;
  charter: string;
  onFinished: () => void;
  onAbort: () => void;
}

export function Run({ runId, mode, tier, charter, onFinished, onAbort }: Props) {
  const tiers = golemApi.useTiers(mode);
  const run = golemApi.useRun(runId);
  const levelRuns = golemApi.useLevelRuns(runId);
  const sorted = useMemo(() => [...(levelRuns ?? [])].sort((a, b) => a.order - b.order), [levelRuns]);
  const current = sorted.find((lr) => !lr.result) ?? sorted[sorted.length - 1] ?? null;
  const levelId = current?.levelId ?? null;
  const frames = golemApi.useFrames(runId, levelId);
  const decisions = golemApi.useDecisions(runId, levelId);
  const market = mode === "runetrading";
  // Ladder: the tier being played advances while every level of a tier is passed.
  const playingTier = current?.spec?.tier ?? run?.currentTier ?? tier;
  const tierSpec = tiers?.find((t) => t.tier === playingTier);
  const tierLevelRuns = useMemo(() => sorted.filter((lr) => lr.spec?.tier === playingTier), [sorted, playingTier]);

  // Animate through frames as they arrive: `cursor` = number of frames shown.
  const [cursor, setCursor] = useState(0);
  const [cursorLevel, setCursorLevel] = useState<string | null>(null);
  useEffect(() => {
    if (levelId !== cursorLevel) {
      setCursorLevel(levelId);
      setCursor(0);
    }
  }, [levelId, cursorLevel]);

  const total = frames?.length ?? 0;
  const shownFrame = cursor > 0 && frames ? frames[Math.min(cursor, total) - 1] : null;
  const trace = useMemo(() => traceOf(shownFrame?.frame), [shownFrame]);

  useEffect(() => {
    if (cursor >= total) return;
    const delay = trace ? trace.trace.length * TRACE_MS + 300 : market ? MARKET_FRAME_MS : FRAME_MS;
    const t = window.setTimeout(() => setCursor((c) => c + 1), delay);
    return () => window.clearTimeout(t);
  }, [cursor, total, trace, market]);

  const state = cursor >= total && current?.replay ? current.replay.finalState : shownFrame?.frame.state ?? current?.initialState ?? null;
  const uptoTick = shownFrame?.tick ?? 0;
  const lines = useMemo(() => buildLog(decisions ?? [], frames ?? [], uptoTick), [decisions, frames, uptoTick]);
  // Strategy ticks are mechanical applications of the compiled charter, not LLM calls.
  const llmCalls = (decisions ?? []).filter((d) => d.tick <= uptoTick && d.record.source !== "strategy").length;
  const lastIntent = [...(decisions ?? [])].filter((d) => d.tick <= uptoTick).pop()?.record.intent;
  const indicators = run?.settings?.indicators ?? current?.spec?.env.params.indicators ?? [];
  const markers = useMemo(() => (market ? markersFromEvents((frames ?? []).slice(0, cursor).map((row) => ({ tick: row.tick, events: row.frame.events }))) : []), [market, frames, cursor]);

  const finished = run?.status === "finished";
  const errored = run?.status === "error";
  const allShown = cursor >= total;

  // Hold the end-of-level banner until any trace animation on the last frame has played out.
  const [bannerReady, setBannerReady] = useState(false);
  useEffect(() => {
    setBannerReady(false);
    if (!allShown || total === 0) return;
    const t = window.setTimeout(() => setBannerReady(true), trace ? trace.trace.length * TRACE_MS + 300 : 0);
    return () => window.clearTimeout(t);
  }, [allShown, total, trace, levelId]);

  if (run === null) return <div className="error">Run not found.</div>;
  if (!run || !tierSpec) return <div className="loading">summoning the golem</div>;

  const levelIndex = current?.spec?.index ?? 1;
  const ladder = run.summary?.tiers ?? run.ladder ?? [];
  const radius = current?.spec?.observation.radius ?? 2;
  const pnl = state?.market ? (state.market.finalPnl ?? state.market.balance - state.market.startingBalance) : 0;
  const banner =
    state?.status === "won"
      ? { cls: "won", text: mode === "towerdefense" ? "BASE DEFENDED" : market ? `RUNE PROFIT +${pnl.toFixed(2)}` : "ALTAR REACHED" }
      : state?.status === "lost"
        ? { cls: "lost", text: market ? `RUNE LOSS ${pnl.toFixed(2)}` : "GOLEM DESTROYED" }
        : state?.status === "out_of_budget"
          ? { cls: "lost", text: "OUT OF BUDGET" }
          : null;

  return (
    <div className="layout">
      <div className="col">
        <LevelCard tier={tierSpec} activeLevelId={levelId} levelRuns={tierLevelRuns} />
        {ladder.length > 0 && (
          <div className="panel ladder">
            <h3>Ladder</h3>
            <ul>
              {ladder.map((t) => (
                <li key={t.tier}>
                  Tier {t.tier}: {t.passedLevels}/{t.totalLevels} {t.unlocked ? "— climbing" : "— stopped"}
                </li>
              ))}
              {run.status === "running" && <li>Tier {playingTier}: playing...</li>}
            </ul>
          </div>
        )}
      </div>
      <div className="col">
        <div className={`stage ${market ? "trade-stage" : ""}`} style={market ? { ["--trade-bg" as string]: `url(${assetUrl("trade.bg.sanctum")})` } : undefined}>
          {market && state?.market ? (
            <MarketChart
              candles={state.market.candles}
              candlesTotal={state.market.candlesTotal}
              indicators={indicators}
              markers={markers}
              label={(current?.spec?.title ?? "RUNE MARKET").toUpperCase()}
            />
          ) : market ? (
            <div className="market-hidden">
              <img src={assetUrl("trade.panel.chart.preview")} alt="" />
              <span>WAITING FOR THE FIRST CANDLE</span>
            </div>
          ) : (
            <WorldCanvas state={state} size={tierSpec.levels[0].env.size} radius={radius} showFog={!state?.td} trace={trace} />
          )}
          {banner && allShown && bannerReady && (
            <div className={`banner ${banner.cls}`}>
              {market && <img className="banner-rune" src={assetUrl(banner.cls === "won" ? "trade.fx.profit" : "trade.fx.loss")} alt="" />}
              {banner.text}
            </div>
          )}
          {!banner && run.status === "queued" && <div className="banner wait">QUEUED — waiting for a runner</div>}
          {!banner && run.status === "running" && !current && <div className="banner wait">RUNNING — preparing level 1</div>}
          <div className="caption">
            {current ? (
              <>
                TIER {playingTier} · LEVEL {levelIndex}/3 — {current.spec.title.toUpperCase()}
                <br />
              </>
            ) : null}
            {lastIntent ? <span className="intent">"{lastIntent}"</span> : <span style={{ opacity: 0.6 }}>{market ? "the golem is reading the runes..." : "the golem is thinking..."}</span>}
          </div>
          {BACKEND !== "convex" && (
            <div className="error" style={{ marginTop: 8 }}>
              DEMO RUN · This sample strategy shows how the engine works. Your charter is not being evaluated.
            </div>
          )}
          {errored && <div className="error">Run failed: {run.error ?? "unknown error"}</div>}
          {(finished || errored) && (
            <div className="btn-row">
              <button className="btn primary" onClick={onFinished}>
                See results
              </button>
            </div>
          )}
          {!finished && !errored && (
            <div className="btn-row">
              <button className="btn ghost small" onClick={onAbort}>
                Leave (run continues)
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="col">
        {market && <IndicatorSettings value={indicators} onChange={() => {}} locked />}
        <CharterLocked value={charter} budget={tierSpec.levels[0].promptBudget} />
        <GolemLog lines={lines} />
        <StatusBox state={state} llmCalls={llmCalls} levelIndex={levelIndex} levelsTotal={3} tier={playingTier} />
      </div>
    </div>
  );
}
