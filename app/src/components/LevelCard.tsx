import type { TierSpec } from "@core/types";
import type { LevelRunDoc } from "../api";
import { Legend } from "./Legend";

const MODE_TITLE = { maze: "Maze", redfloor: "Red Floor", towerdefense: "Tower Defense", runetrading: "Rune Trading" } as const;

interface Props {
  tier: TierSpec;
  activeLevelId?: string | null;
  levelRuns?: LevelRunDoc[];
  objectiveLevelId?: string | null; // whose brief to show; defaults to the active or first level
}

export function LevelCard({ tier, activeLevelId, levelRuns, objectiveLevelId }: Props) {
  const objLevel = tier.levels.find((l) => l.id === (objectiveLevelId ?? activeLevelId)) ?? tier.levels[0];
  const opponent = objLevel.opponent ?? tier.levels[0].opponent;
  return (
    <>
      <div className="panel level-card">
        <h2 className="mode-title">{MODE_TITLE[tier.mode]}</h2>
        <div className="tier-line">
          {`TIER ${tier.tier} — ${tier.title.replace(/^.*— /, "")}`}
        </div>
        <ul className="level-list">
          {tier.levels.map((l, i) => {
            const lr = levelRuns?.find((r) => r.levelId === l.id);
            const status = lr?.result ? (lr.result.verdict.passed ? "pass" : "fail") : lr ? "run" : null;
            return (
              <li key={l.id} className={l.id === activeLevelId ? "active" : ""}>
                <span className="n">L{i + 1}</span>
                <span>{l.title}</span>
                {status && <span className={`pill ${status}`}>{status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "LIVE"}</span>}
              </li>
            );
          })}
        </ul>
        <h3>Objective</h3>
        <p>{objLevel.brief}</p>
        <h3>Rules</h3>
        <ul className="rules">
          {objLevel.playerKnows.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          <li>
            Charter budget: {objLevel.promptBudget} characters.
            {tier.mode === "runetrading" ? (
              <>
                {" "}
                {objLevel.env.params.candleCount ?? 120} candles · {((objLevel.env.params.feeBps ?? 10) / 100).toFixed(2)}% fee · starting balance{" "}
                {objLevel.env.params.startingBalance ?? 10000}.
              </>
            ) : (
              <> Sight radius: {objLevel.observation.radius}.</>
            )}
          </li>
        </ul>
        <h3>{tier.mode === "runetrading" ? "Trading tools" : "Tiles"}</h3>
        <Legend mode={tier.mode} />
      </div>
      {opponent && (
        <div className="panel enemy-charter">
          <h2>Enemy's Charter</h2>
          <pre>{opponent.charter}</pre>
        </div>
      )}
    </>
  );
}
