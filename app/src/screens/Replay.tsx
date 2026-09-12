import { useEffect, useMemo, useState } from "react";
import type { ModeId, WorldState } from "@core/types";
import { golemApi } from "../api";
import { CharterLocked } from "../components/CharterPanel";
import { GolemLog } from "../components/GolemLog";
import { LevelCard } from "../components/LevelCard";
import { StatusBox } from "../components/StatusBox";
import { WorldCanvas } from "../components/WorldCanvas";
import { buildLog, traceOf } from "../log";

const STEP_MS = 300;
const TRACE_MS = 120;

interface Props {
  runId: string;
  levelId: string;
  mode: ModeId;
  tier: number;
  onBack: () => void;
  onHome: () => void;
}

export function Replay({ runId, levelId, mode, tier, onBack, onHome }: Props) {
  const tiers = golemApi.useTiers(mode);
  const run = golemApi.useRun(runId);
  const levelRuns = golemApi.useLevelRuns(runId);
  const frames = golemApi.useFrames(runId, levelId);
  const lr = levelRuns?.find((r) => r.levelId === levelId);
  const playingTier = lr?.spec?.tier ?? tier;
  const tierSpec = tiers?.find((t) => t.tier === playingTier);

  const initial: WorldState | null = lr?.replay?.initialState ?? lr?.initialState ?? null;
  const decisions = useMemo(() => (lr?.replay?.decisions ?? []).map((d) => ({ tick: d.tick, record: d })), [lr]);
  const total = frames?.length ?? 0;

  const [pos, setPos] = useState(0); // 0 = initial state, k = after frame k
  const [playing, setPlaying] = useState(true);
  const [fogOverride, setFogOverride] = useState<boolean | null>(null);
  const showFog = fogOverride ?? !initial?.td;
  const setShowFog = (f: (v: boolean) => boolean) => setFogOverride(f(showFog));

  const frame = pos > 0 && frames ? frames[pos - 1] : null;
  const trace = useMemo(() => traceOf(frame?.frame), [frame]);

  useEffect(() => {
    if (!playing) return;
    if (pos >= total) {
      setPlaying(false);
      return;
    }
    const delay = trace ? trace.trace.length * TRACE_MS + 300 : STEP_MS;
    const t = window.setTimeout(() => setPos((p) => Math.min(total, p + 1)), delay);
    return () => window.clearTimeout(t);
  }, [playing, pos, total, trace]);

  if (run === null) return <div className="error">Run not found.</div>;
  if (!run || !tierSpec || !lr || !frames) return <div className="loading">rewinding the tape</div>;

  const state = pos === total && lr.replay ? lr.replay.finalState : frame?.frame.state ?? initial;
  const tick = frame?.tick ?? 0;
  const lines = buildLog(decisions, frames, tick);
  const intent = [...decisions].filter((d) => d.tick <= tick).pop()?.record.intent;
  const radius = lr.spec.observation.radius;

  return (
    <div className="layout">
      <div className="col">
        <LevelCard tier={tierSpec} activeLevelId={levelId} levelRuns={levelRuns?.filter(r => r.spec?.tier === playingTier)} />
      </div>
      <div className="col">
        <div className="stage">
          <WorldCanvas state={state} radius={radius} showFog={showFog} trace={playing ? trace : null} />
          <div className="caption">
            REPLAY — LEVEL {lr.spec.index}/3 — {lr.spec.title.toUpperCase()}
            <br />
            {intent ? <span className="intent">"{intent}"</span> : <span style={{ opacity: 0.6 }}>initial state</span>}
          </div>
          <div className="replay-controls">
            <button className="btn small" onClick={() => { setPlaying(false); setPos((p) => Math.max(0, p - 1)); }} disabled={pos === 0}>
              ◀ Step
            </button>
            <button
              className="btn small primary"
              onClick={() => {
                if (!playing && pos >= total) setPos(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "❚❚ Pause" : pos >= total ? "↺ Restart" : "▶ Play"}
            </button>
            <button className="btn small" onClick={() => { setPlaying(false); setPos((p) => Math.min(total, p + 1)); }} disabled={pos >= total}>
              Step ▶
            </button>
            <input
              type="range"
              aria-label="Replay position"
              min={0}
              max={total}
              value={pos}
              onChange={(e) => {
                setPlaying(false);
                setPos(Number(e.target.value));
              }}
            />
            <span className="pos">
              {pos}/{total}
            </span>
            <button className="btn small ghost" onClick={() => setShowFog((f) => !f)}>
              {showFog ? "Fog: on" : "Fog: off"}
            </button>
          </div>
          <div className="btn-row">
            <button className="btn ghost small" onClick={onBack}>
              Back to results
            </button>
            <button className="btn ghost small" onClick={onHome}>
              Home
            </button>
          </div>
        </div>
      </div>
      <div className="col">
        <CharterLocked value={lr.replay?.charter ?? run.charter} />
        <GolemLog lines={lines} emptyText="Press play." />
        <StatusBox state={state} llmCalls={decisions.filter((d) => d.tick <= tick).length} levelIndex={lr.spec.index} levelsTotal={3} tier={playingTier} />
      </div>
    </div>
  );
}
