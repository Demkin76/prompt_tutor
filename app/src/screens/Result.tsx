import { useMemo } from "react";
import type { LevelRunResult, ModeId } from "@core/types";
import { BACKEND, golemApi } from "../api";

interface Props {
  runId: string;
  mode: ModeId;
  tier: number;
  onRetry: (tier: number) => void;
  onReplay: (levelId: string) => void;
  onHome: () => void;
  onKeymaster?: () => void;
}

function evidenceText(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function ResultCard({ index, title, result, onReplay }: { index: number; title: string; result?: LevelRunResult; onReplay?: () => void }) {
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
  return (
    <div className={`panel result-card ${passed ? "pass" : "fail"}`}>
      <div className="verdict">
        L{index} — {passed ? "PASS" : "FAIL"}
      </div>
      <p>
        <strong>{title}</strong>
      </p>
      <dl className="kv">
        <dt>Ticks</dt>
        <dd>{result.ticks}</dd>
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
        <>
          <h3>Evidence</h3>
          <ul className="evidence">
            {result.verdict.evidence.map((e, i) => (
              <li key={i}>
                {e.type}: {evidenceText(e.value)}
                {e.note ? ` — ${e.note}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {onReplay && (
        <button className="btn small" onClick={onReplay}>
          Replay level {index}
        </button>
      )}
    </div>
  );
}

export function Result({ runId, mode, tier, onRetry, onReplay, onHome, onKeymaster }: Props) {
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

  return (
    <>
      {mode === "keymaster" && BACKEND === "mock" && <p className="hint">Результат демонстрационной стратегии. Текст вашего устава не оценивался; прогресс не сохранён.</p>}
      <div className="summary">
        <div className="score">{summary ? `${summary.score} PTS` : run.status === "error" ? "RUN FAILED" : "PENDING"}</div>
        <div className="passed">{summary ? `${summary.passedLevels}/${summary.totalLevels} LEVELS PASSED · REACHED TIER ${reached}` : ""}</div>
        <div className="passed" style={{ opacity: 0.7 }}>
          STARTED AT TIER {tier} · {charterSummary(run.charter)}
        </div>
      </div>
      {mode === "keymaster" && summary?.tierUnlocked && (
        <div className="unlock keymaster-lesson">
          <h2>KEYMASTER COMPLETE</h2>
          <p>Не каждая цель достижима напрямую.</p>
          <p>Хороший устав описывает не только цель, но и то, как действовать, когда путь к ней закрыт.</p>
        </div>
      )}
      {mode !== "keymaster" && clearedAll && <div className="unlock">ALL TIERS CLEARED</div>}
      {mode === "redfloor" && played.some(t => t.unlocked) && onKeymaster && (
        <div className="btn-row"><button className="btn primary" onClick={onKeymaster}>Следующий уровень: Keymaster →</button></div>
      )}
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
                    <ResultCard index={i + 1} title={l.title} result={result} onReplay={lr ? () => onReplay(l.id) : undefined} />
                    {mode === "keymaster" && result && !result.verdict.passed && lr?.replay?.decisions.length ? (
                      <p>Последнее решение: «{lr.replay.decisions.at(-1)?.intent}»</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="btn-row">
        <button className="btn primary" onClick={() => onRetry(nextTier)}>
          {mode === "keymaster" ? "Изменить устав" : nextTier > tier ? `Continue at tier ${nextTier} (edit charter)` : "Retry (edit charter)"}
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
