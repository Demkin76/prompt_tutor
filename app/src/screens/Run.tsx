import { useEffect, useMemo, useState } from "react";
import type { ModeId } from "@core/types";
import { golemApi } from "../api";
import { CharterLocked } from "../components/CharterPanel";
import { GolemLog } from "../components/GolemLog";
import { LevelCard } from "../components/LevelCard";
import { StatusBox } from "../components/StatusBox";
import { WorldCanvas } from "../components/WorldCanvas";
import { buildLog, traceOf } from "../log";

const FRAME_MS = 250;
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
  const tierSpec = tiers?.find((t) => t.tier === tier);

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
    const delay = trace ? trace.trace.length * TRACE_MS + 300 : FRAME_MS;
    const t = window.setTimeout(() => setCursor((c) => c + 1), delay);
    return () => window.clearTimeout(t);
  }, [cursor, total, trace]);

  const state = shownFrame?.frame.state ?? current?.initialState ?? null;
  const uptoTick = shownFrame?.tick ?? 0;
  const lines = useMemo(() => buildLog(decisions ?? [], frames ?? [], uptoTick), [decisions, frames, uptoTick]);
  const llmCalls = (decisions ?? []).filter((d) => d.tick <= uptoTick).length;
  const lastIntent = [...(decisions ?? [])].filter((d) => d.tick <= uptoTick).pop()?.record.intent;

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

  const levelIndex = current ? current.order + 1 : 1;
  const radius = current?.spec.observation.radius ?? 2;
  const banner =
    state?.status === "won"
      ? { cls: "won", text: mode === "towerdefense" ? "BASE DEFENDED" : "ALTAR REACHED" }
      : state?.status === "lost"
        ? { cls: "lost", text: "GOLEM DESTROYED" }
        : state?.status === "out_of_budget"
          ? { cls: "lost", text: "OUT OF BUDGET" }
          : null;

  return (
    <div className="layout">
      <div className="col">
        <LevelCard tier={tierSpec} activeLevelId={levelId} levelRuns={sorted} />
      </div>
      <div className="col">
        <div className="stage">
          <WorldCanvas state={state} size={tierSpec.levels[0].env.size} radius={radius} showFog={!state?.td} trace={trace} />
          {banner && allShown && bannerReady && <div className={`banner ${banner.cls}`}>{banner.text}</div>}
          {!banner && run.status === "queued" && <div className="banner wait">QUEUED — waiting for a runner</div>}
          {!banner && run.status === "running" && !current && <div className="banner wait">RUNNING — preparing level 1</div>}
          <div className="caption">
            {current ? (
              <>
                LEVEL {levelIndex}/3 — {current.spec.title.toUpperCase()}
                <br />
              </>
            ) : null}
            {lastIntent ? <span className="intent">"{lastIntent}"</span> : <span style={{ opacity: 0.6 }}>the golem is thinking...</span>}
          </div>
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
        <CharterLocked value={charter} budget={tierSpec.levels[0].promptBudget} />
        <GolemLog lines={lines} />
        <StatusBox state={state} llmCalls={llmCalls} levelIndex={levelIndex} levelsTotal={3} tier={tier} />
      </div>
    </div>
  );
}
