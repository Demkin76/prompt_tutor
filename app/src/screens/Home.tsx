import type { ModeId } from "@core/types";
import { golemApi, type ModeInfo, type SessionDoc } from "../api";

interface Props {
  session: SessionDoc | null | undefined;
  onPickTier: (mode: ModeId, tier: number) => void;
}

function ModeCard({ mode, session, onPickTier }: { mode: ModeInfo; session: SessionDoc | null | undefined; onPickTier: Props["onPickTier"] }) {
  const tiers = golemApi.useTiers(mode.id);
  const unlocked = session?.progress?.[mode.id] ?? 1;
  return (
    <div className="panel mode-card">
      <h2>{mode.title}</h2>
      <div className="tagline">{mode.tagline}</div>
      <div className="ladder">
        {(tiers ?? []).map((t) => {
          const locked = t.tier > unlocked;
          const best = session?.best?.[`${mode.id}-${t.tier}`];
          return (
            <button key={t.tier} className="tier-btn" disabled={locked} onClick={() => onPickTier(mode.id, t.tier)}>
              <span className="icon" aria-hidden>
                {locked ? "🔒" : best && best.passedLevels === 3 ? "🏆" : "▶"}
              </span>
              <span className="name">
                {mode.id === "keymaster" ? "УРОВЕНЬ 2" : `TIER ${t.tier}`}
                <br />
                <span style={{ opacity: 0.7 }}>{t.title.replace(/^.*— /, "")}</span>
              </span>
              <span className="best">
                {best ? (
                  <>
                    {best.passedLevels}/3 · {best.score} pts
                  </>
                ) : locked ? (
                  "locked"
                ) : (
                  "no attempt"
                )}
              </span>
            </button>
          );
        })}
        {!tiers && <div className="loading">loading tiers</div>}
      </div>
    </div>
  );
}

export function Home({ session, onPickTier }: Props) {
  const modes = golemApi.useModes();
  return (
    <>
      <div className="hero">
        <h1>GOLEM</h1>
        <div className="sub">WRITE. ANIMATE. OBSERVE.</div>
        <p className="lead">
          You never touch the golem. You write its charter — a few lines of plain language — and watch it play three levels by your words alone. Pass all three to unlock the
          next tier.
        </p>
      </div>
      {!modes && <div className="loading">summoning modes</div>}
      <div className="modes">
        {(modes ?? []).map((m) => (
          <ModeCard key={m.id} mode={m} session={session} onPickTier={onPickTier} />
        ))}
      </div>
    </>
  );
}
