import type { WorldState } from "@core/types";

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
  return (
    <div className="panel dark status">
      <h2>Status</h2>
      <dl className="kv">
        <dt>Golem</dt>
        <dd>
          <span className={`hearts ${alive ? "" : "dead"}`}>{alive ? "♥" : "♡"}</span> {alive ? "alive" : "destroyed"}
        </dd>
        <dt>Steps</dt>
        <dd>{state?.tick ?? 0}</dd>
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
            <dd>{state.agent.inventory.join(", ")}</dd>
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
      </dl>
    </div>
  );
}
