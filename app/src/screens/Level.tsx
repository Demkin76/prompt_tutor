import { useState } from "react";
import type { ModeId } from "@core/types";
import { BACKEND, golemApi } from "../api";
import { CharterEditor } from "../components/CharterPanel";
import { GolemLog } from "../components/GolemLog";
import { LevelCard } from "../components/LevelCard";
import { StatusBox } from "../components/StatusBox";
import { WorldCanvas } from "../components/WorldCanvas";
import { saveCharter } from "../session";

interface Props {
  sessionId: string;
  mode: ModeId;
  tier: number;
  charter: string;
  attempts: number;
  onCharterChange: (v: string) => void;
  onDeployed: (runId: string, charter: string) => void;
}

export function Level({ sessionId, mode, tier, charter, attempts, onCharterChange, onDeployed }: Props) {
  const tiers = golemApi.useTiers(mode);
  const createRun = golemApi.useCreateRun();
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tierSpec = tiers?.find((t) => t.tier === tier);
  if (!tierSpec) return <div className="loading">loading tier</div>;
  const first = tierSpec.levels[0];
  const budget = Math.min(...tierSpec.levels.map((l) => l.promptBudget));

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      saveCharter(mode, tier, charter);
      const runId = await createRun({ sessionId, mode, tier, charter });
      onDeployed(runId, charter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeploying(false);
    }
  };

  return (
    <div className="layout">
      <div className="col">
        <LevelCard tier={tierSpec} objectiveLevelId={first.id} />
      </div>
      <div className="col">
        <div className="stage">
          <WorldCanvas state={null} size={first.env.size} radius={first.observation.radius} showFog />
          <div className="caption">
            THE WORLDS ARE HIDDEN UNTIL YOU DEPLOY.
            <br />
            <span style={{ opacity: 0.7 }}>
              {first.env.size[0]}×{first.env.size[1]} · 3 LEVELS · {first.limits.ticks} TICKS · {first.limits.llmCalls} LLM CALLS EACH
            </span>
          </div>
        </div>
      </div>
      <div className="col">
        <CharterEditor keymaster={mode === "keymaster"} value={charter} budget={budget} onChange={onCharterChange} onDeploy={deploy} deploying={deploying} />
        {mode === "keymaster" && BACKEND === "mock" && <p className="hint">Демо без LLM: показан пример автономного планирования. Ваш устав не оценивается. Для проверки устава подключите Convex и модель.</p>}
        {attempts > 0 && mode === "keymaster" && <p className="hint">Подсказка: исследуй мир, подбери ключ, вернись к двери, открой её и продолжи к алтарю.</p>}
        {error && <div className="error">Deploy failed: {error}</div>}
        <GolemLog lines={[]} />
        <StatusBox state={null} llmCalls={0} levelIndex={1} levelsTotal={3} tier={tier} attempts={attempts} />
      </div>
    </div>
  );
}
