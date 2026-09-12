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

const MODE_TITLE: Record<ModeId, string> = { maze: "Maze", redfloor: "Red Floor", towerdefense: "Tower Defense" };

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const sessionId = useMemo(getSessionId, []);
  const ensure = golemApi.useEnsureSession();
  const session = golemApi.useSession(sessionId);
  const [route, setRoute] = useState<Route>({ s: "home" });

  useEffect(() => {
    ensure(sessionId).catch((e) => console.error("sessions.ensure failed", e));
  }, [ensure, sessionId]);

  const crumbs: string[] = [];
  if (route.s !== "home") crumbs.push(MODE_TITLE[route.mode], `Tier ${route.tier}`);
  if (route.s === "run") crumbs.push("Run");
  if (route.s === "result") crumbs.push("Results");
  if (route.s === "replay") crumbs.push("Replay");

  return (
    <div className="app">
      <div
        className="topbar"
        style={{
          backgroundImage: `linear-gradient(rgba(10, 10, 14, 0.55), rgba(10, 10, 14, 0.75)), url("${assetUrl("bg.dungeon_wall")}")`,
        }}
      >
        <div className="brand" onClick={() => setRoute({ s: "home" })} title="Home">
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
          {onSignOut && (
            <button className="btn ghost small" type="button" onClick={onSignOut}>
              SIGN OUT
            </button>
          )}
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
