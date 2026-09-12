import { useEffect, useMemo, useState } from "react";
import type { IndicatorConfig, ModeId, RunSettings } from "@core/types";
import { defaultRunSettings, validateMarketCharter, validateRunSettings } from "@core/index";
import { golemApi } from "../api";
import { assetUrl } from "../assets";
import { CharterEditor } from "../components/CharterPanel";
import { GolemLog } from "../components/GolemLog";
import { IndicatorSettings } from "../components/IndicatorSettings";
import { LevelCard } from "../components/LevelCard";
import { MarketChart } from "../components/MarketChart";
import { StatusBox } from "../components/StatusBox";
import { WorldCanvas } from "../components/WorldCanvas";
import { loadIndicators, saveCharter, saveIndicators } from "../session";

interface Props {
  sessionId: string;
  mode: ModeId;
  tier: number;
  charter: string;
  attempts: number;
  onCharterChange: (v: string) => void;
  onDeployed: (runId: string, charter: string) => void;
}

/** Indicator defaults: the level's own list when the catalogue carries one, else the engine's run-settings default. */
function defaultIndicators(fromLevel: IndicatorConfig[] | undefined): IndicatorConfig[] {
  return (fromLevel ?? defaultRunSettings().indicators).map((i) => ({ ...i }));
}

export function Level({ sessionId, mode, tier, charter, attempts, onCharterChange, onDeployed }: Props) {
  const tiers = golemApi.useTiers(mode);
  const createRun = golemApi.useCreateRun();
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tierSpec = tiers?.find((t) => t.tier === tier);
  const first = tierSpec?.levels[0];
  const market = mode === "runetrading";
  const levelIndicators = first?.env.params.indicators;

  const [indicators, setIndicators] = useState<IndicatorConfig[]>(() => loadIndicators(mode, tier, defaultIndicators(levelIndicators)));
  useEffect(() => {
    setIndicators(loadIndicators(mode, tier, defaultIndicators(levelIndicators)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tier, levelIndicators === undefined]);
  const settings = useMemo<RunSettings | undefined>(() => (market ? { indicators } : undefined), [market, indicators]);
  const charterErrors = useMemo(() => (market && charter.trim() ? validateMarketCharter(charter) : []), [market, charter]);

  if (!tierSpec || !first) return <div className="loading">loading tier</div>;
  const budget = Math.min(...tierSpec.levels.map((l) => l.promptBudget));

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      if (charterErrors.length) throw new Error(charterErrors.join(" "));
      if (settings) {
        const problems = validateRunSettings(settings) as unknown;
        if (Array.isArray(problems) && problems.length) throw new Error(problems.join(" "));
        saveIndicators(mode, tier, settings.indicators);
      }
      saveCharter(mode, tier, charter);
      const runId = await createRun({ sessionId, mode, tier, charter, ...(settings ? { settings } : {}) });
      onDeployed(runId, charter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeploying(false);
    }
  };

  const candleCount = first.env.params.candleCount ?? first.trainingPreview?.length ?? 120;
  const feePct = ((first.env.params.feeBps ?? 10) / 100).toFixed(2);

  return (
    <div className="layout">
      <div className="col">
        <LevelCard tier={tierSpec} objectiveLevelId={first.id} />
      </div>
      <div className="col">
        <div className={`stage ${market ? "trade-stage" : ""}`} style={market ? { ["--trade-bg" as string]: `url(${assetUrl("trade.bg.sanctum")})` } : undefined}>
          {market && first.trainingPreview ? (
            <MarketChart candles={first.trainingPreview} indicators={indicators} label={`${first.title.toUpperCase()} · TRAINING CHART`} />
          ) : market ? (
            <div className="market-hidden">
              <img src={assetUrl("trade.panel.chart.preview")} alt="" />
              <span>NO REFERENCE CHART FOR THIS TIER</span>
            </div>
          ) : (
            <WorldCanvas state={null} size={first.env.size} radius={first.observation.radius} showFog />
          )}
          <div className="caption">
            {market ? "LEVEL 1 IS THE REFERENCE CHART. LEVELS 2–3 STAY HIDDEN UNTIL YOU DEPLOY." : "THE WORLDS ARE HIDDEN UNTIL YOU DEPLOY."}
            <br />
            <span style={{ opacity: 0.7 }}>
              {market
                ? `${candleCount} CANDLES · ${feePct}% FEE PER OPEN/CLOSE · ${first.limits.llmCalls} LLM CALL — THE CHARTER IS COMPILED ONCE`
                : `${first.env.size[0]}×${first.env.size[1]} · 3 LEVELS · ${first.limits.ticks} TICKS · ${first.limits.llmCalls} LLM CALLS EACH`}
            </span>
          </div>
        </div>
      </div>
      <div className="col">
        {market && (
          <IndicatorSettings
            value={indicators}
            onChange={(value) => {
              setIndicators(value);
              saveIndicators(mode, tier, value);
            }}
          />
        )}
        <CharterEditor value={charter} budget={budget} onChange={onCharterChange} onDeploy={deploy} deploying={deploying} />
        {charterErrors.map((message) => (
          <div className="error" key={message}>
            {message}
          </div>
        ))}
        {error && <div className="error">Deploy failed: {error}</div>}
        <GolemLog lines={[]} />
        <StatusBox state={null} llmCalls={0} levelIndex={1} levelsTotal={3} tier={tier} attempts={attempts} />
      </div>
    </div>
  );
}
