import { readLaunchLink, modeHash } from "./navigation";
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

function RestoreRun({ runId, onRestore, onHome }: { runId: string; onRestore: (run: NonNullable<ReturnType<typeof golemApi.useRun>>) => void; onHome: () => void }) {
  const run = golemApi.useRun(runId);
  useEffect(() => { if (run) onRestore(run); }, [run]);
  return <div className="restore-run" role="status">{run === null ? <><h1>Run unavailable</h1><p>This run may be from an earlier demo session.</p><button className="btn primary" onClick={onHome}>Open the facility</button></> : "Restoring the run…"}</div>;
}

export function App() {
  const sessionId = useMemo(getSessionId, []);
  const ensure = golemApi.useEnsureSession();
  const session = golemApi.useSession(sessionId);
  const [resumeId, setResumeId] = useState(() => readLaunchLink(location.hash).runId);
  const [route, setCurrentRoute] = useState<Route>(() => {
    const { mode } = readLaunchLink(location.hash);
    return mode ? { s: "level", mode, tier: 1, charter: loadCharter(mode, 1), attempts: 0 } : { s: "home" };
  });
  const setRoute = (next: Route) => {
    setCurrentRoute(next);
    const hash = next.s === "home" ? "#all" : "runId" in next ? `#run/${next.runId}` : modeHash(next.mode);
    history.replaceState(null, "", hash);
  };
  useEffect(() => {
    const followLink = () => {
      const { mode, runId } = readLaunchLink(location.hash);
      setResumeId(runId);
      if (!runId) setCurrentRoute(mode ? { s: "level", mode, tier: 1, charter: loadCharter(mode, 1), attempts: 0 } : { s: "home" });
    };
    window.addEventListener("hashchange", followLink);
    return () => window.removeEventListener("hashchange", followLink);
  }, []);

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
      <a className="skip-link" href="#facility" onClick={e => { e.preventDefault(); document.getElementById("facility")?.focus(); }}>Skip to game</a>
      <nav className="site-nav" aria-label="Main navigation">
        <a className="site-brand" href="index.html"><span className="site-mark" aria-hidden>▣</span> GOLEM</a>
        <div className="site-links"><a href="index.html">Home</a><a href="levels.html">Levels</a><a href="technology.html">Technology</a><a href="world.html">World</a></div>
        <span className={`connection ${BACKEND}`}><i />{BACKEND === "convex" ? "LIVE AGENT" : "OFFLINE DEMO"}</span>
      </nav>
      <header className="facility-header" id="facility" tabIndex={-1}>
        <div><div className="facility-kicker">THE TESTING FACILITY / {route.s === "home" ? "SELECT A WORLD" : crumbs.join(" / ")}</div><h1>Write the law. <span>Observe the outcome.</span></h1></div>
        <div className="mode-tabs" aria-label="Game modes">
          {(["redfloor", "keymaster"] as ModeId[]).map(mode => <button key={mode} className={route.s !== "home" && route.mode === mode ? "active" : ""} disabled={route.s === "run" || !!resumeId} onClick={() => setRoute({ s: "level", mode, tier: 1, charter: loadCharter(mode, 1), attempts: 0 })}>{mode === "redfloor" ? "01" : "02"} / {MODE_TITLE[mode]}</button>)}
          <button disabled={route.s === "run" || !!resumeId} onClick={() => setRoute({ s: "home" })}>All modes ↗</button>
        </div>
      </header>
      {BACKEND === "mock" && <p className="demo-notice" role="note">Offline demonstration · A sample strategy plays the real simulation. Your charter is not evaluated by an AI model.</p>}
      {resumeId ? <RestoreRun runId={resumeId} onHome={() => { setResumeId(undefined); setRoute({ s: "home" }); }} onRestore={run => { setResumeId(undefined); setRoute({ s: run.status === "finished" || run.status === "error" ? "result" : "run", runId: run.runId, mode: run.mode, tier: run.tier, charter: run.charter, attempts: 1 }); }} /> : <>

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
      </>}
      <footer className="facility-footer"><span>GOLEM / Write. Lock. Observe.</span><a href="technology.html">How the runtime works ↗</a></footer>
    </div>
  );
}
