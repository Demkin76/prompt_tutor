import { assetUrl } from "./assets";
import { useEffect, useMemo, useState } from "react";
import type { ModeId } from "@core/types";
import { BACKEND, golemApi } from "./api";
import { Home } from "./screens/Home";
import { Level } from "./screens/Level";
import { Replay } from "./screens/Replay";
import { Result } from "./screens/Result";
import { Run } from "./screens/Run";
import { getSessionId, loadCharter } from "./session";

type Route =
  | { s: "home" }
  | { s: "level"; mode: ModeId; tier: number; charter: string; attempts: number }
  | { s: "run"; runId: string; mode: ModeId; tier: number; charter: string; attempts: number }
  | { s: "result"; runId: string; mode: ModeId; tier: number; charter: string; attempts: number }
  | { s: "replay"; runId: string; levelId: string; mode: ModeId; tier: number; charter: string; attempts: number };

const MODE_TITLE: Record<ModeId, string> = { keymaster: "Keymaster", maze: "Maze", redfloor: "Red Floor", towerdefense: "Tower Defense" };

export function App() {
  const sessionId = useMemo(getSessionId, []);
  const ensure = golemApi.useEnsureSession();
  const session = golemApi.useSession(sessionId);
  const [route, setRoute] = useState<Route>({ s: "home" });

  useEffect(() => {
    ensure(sessionId).catch((e) => console.error("sessions.ensure failed", e));
  }, [ensure, sessionId]);

  const crumbs: string[] = [];
  if (route.s !== "home") crumbs.push(MODE_TITLE[route.mode], route.mode === "keymaster" ? "Уровень 2" : `Tier ${route.tier}`);
  if (route.s === "run") crumbs.push("Run");
  if (route.s === "result") crumbs.push("Results");
  if (route.s === "replay") crumbs.push("Replay");

  return (
    <div className={`app ${route.s !== "home" && route.mode === "keymaster" ? "keymaster" : ""}`}>
      <div
        className="topbar"
        style={{
          backgroundImage: `linear-gradient(rgba(10, 10, 14, 0.55), rgba(10, 10, 14, 0.75)), url("${assetUrl("bg.dungeon_wall")}")`,
        }}
      >
        <div className="brand" onClick={() => { if (!(route.s === "run" && route.mode === "keymaster")) setRoute({ s: "home" }); }} title={route.s === "run" && route.mode === "keymaster" ? "Устав заблокирован до завершения попытки" : "Home"}>
          <img className="logo" src={assetUrl("ui.logo")} alt="GOLEM" />
          <span className="tag">write. animate. observe.</span>
        </div>
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">/ </span>}
              {c}
            </span>
          ))}
          <span className="backend" title="Backend in use">
            {BACKEND === "convex" ? "CONVEX" : "MOCK"}
          </span>
        </div>
      </div>

      {route.s === "home" && (
        <Home session={session} onPickTier={(mode, tier) => setRoute({ s: "level", mode, tier, charter: loadCharter(mode, tier), attempts: 0 })} />
      )}
      {route.s === "level" && (
        <Level
          sessionId={sessionId}
          mode={route.mode}
          tier={route.tier}
          charter={route.charter}
          attempts={route.attempts}
          onCharterChange={(charter) => setRoute({ ...route, charter })}
          onDeployed={(runId, charter) => setRoute({ s: "run", runId, mode: route.mode, tier: route.tier, charter, attempts: route.attempts + 1 })}
        />
      )}
      {route.s === "run" && (
        <Run
          runId={route.runId}
          mode={route.mode}
          tier={route.tier}
          charter={route.charter}
          onFinished={() => setRoute({ ...route, s: "result" })}
          onAbort={() => setRoute({ s: "level", mode: route.mode, tier: route.tier, charter: route.charter, attempts: route.attempts })}
        />
      )}
      {route.s === "result" && (
        <Result
          runId={route.runId}
          mode={route.mode}
          tier={route.tier}
          onRetry={(tier) => setRoute({ s: "level", mode: route.mode, tier, charter: route.charter, attempts: tier === route.tier ? route.attempts : 0 })}
          onReplay={(levelId) => setRoute({ ...route, s: "replay", levelId })}
          onHome={() => setRoute({ s: "home" })}
          onKeymaster={() => setRoute({ s: "level", mode: "keymaster", tier: 1, charter: loadCharter("keymaster", 1), attempts: 0 })}
        />
      )}
      {route.s === "replay" && (
        <Replay
          runId={route.runId}
          levelId={route.levelId}
          mode={route.mode}
          tier={route.tier}
          onBack={() => setRoute({ s: "result", runId: route.runId, mode: route.mode, tier: route.tier, charter: route.charter, attempts: route.attempts })}
          onHome={() => setRoute({ s: "home" })}
        />
      )}
    </div>
  );
}
