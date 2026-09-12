import type { Evidence, LevelSpec, SimEvent, SimEventType, Verdict, WorldState } from "./types";

/** Trace rule: the event type never occurred. */
export function never(events: SimEvent[], type: SimEventType): boolean {
  return !events.some((e) => e.type === type);
}

/** Trace rule: the event type occurred at least once. Returns the first occurrence. */
export function eventually(events: SimEvent[], type: SimEventType): SimEvent | undefined {
  return events.find((e) => e.type === type);
}

export function countEvents(events: SimEvent[], type: SimEventType): number {
  return events.filter((e) => e.type === type).length;
}

/**
 * Deterministic verdict from the trace and final state.
 *   nav modes: passed iff goal_reached happened and hazard_entered never did.
 *   towerdefense: passed iff all_waves_cleared happened and baseHp > 0.
 *   runetrading: passed iff the series finished with net P&L > 0 after fees.
 * `score` is a 0..1 quality figure: 1 on pass; on fail, partial credit for
 * progress (waves survived) so the UI can show "how close". Rune trading scales
 * the pass score with the return (5% of the starting balance = 1).
 */
export function verify(spec: LevelSpec, initialState: WorldState, finalState: WorldState, events: SimEvent[]): Verdict {
  const reasons: string[] = [];
  const evidence: Evidence[] = [];
  let passed = false;
  let score = 0;

  if (spec.mode === "runetrading") {
    // Passed iff the series was finished (status won) with strictly positive net P&L after fees.
    const market = finalState.market;
    const finalPnl = market?.finalPnl ?? (market ? market.balance - market.startingBalance : 0);
    passed = finalState.status === "won" && finalPnl > 0;
    if (passed) reasons.push(`Finished with positive net P&L ${finalPnl.toFixed(2)} after fees.`);
    else if (eventually(events, "liquidated")) reasons.push("Position liquidated: balance fell to zero.");
    else if (finalState.status === "out_of_budget" || (market && market.status === "running")) reasons.push(`Series not completed (${market?.candleIndex ?? 0}/${market?.candlesTotal ?? 0} candles).`);
    else reasons.push(`Net P&L ${finalPnl.toFixed(2)} is not positive after fees.`);
    evidence.push({
      type: "state",
      value: {
        startingBalance: initialState.market?.startingBalance ?? 0,
        finalBalance: market?.balance ?? 0,
        finalPnl,
        feesPaid: market?.feesPaid ?? 0,
        candles: market?.candleIndex ?? 0,
      },
      note: "rune trading result",
    });
    const denominator = Math.max(1, initialState.market?.startingBalance ?? 1);
    score = passed ? Math.max(0.1, Math.min(1, finalPnl / denominator / 0.05)) : 0;
    return { passed, score, confidence: 1, reasons, evidence };
  }

  if (spec.mode === "towerdefense") {
    const cleared = eventually(events, "all_waves_cleared");
    const destroyed = eventually(events, "base_destroyed");
    const hp = finalState.td?.baseHp ?? 0;
    const waves = finalState.td?.wavesTotal ?? 0;
    const done = finalState.td?.waveIndex ?? 0;
    passed = !!cleared && hp > 0;
    if (passed) {
      reasons.push(`All ${waves} waves cleared with base HP ${hp}/${finalState.td?.baseHpMax ?? hp}.`);
      evidence.push({ type: "tick", value: cleared!.tick, note: "all_waves_cleared" });
      evidence.push({ type: "state", value: { baseHp: hp }, note: "final base hp" });
      score = 1;
    } else {
      if (destroyed) {
        reasons.push(`Base destroyed during wave ${Number(destroyed.data?.waveIndex ?? 0) + 1}.`);
        evidence.push({ type: "event", value: destroyed, note: "base_destroyed" });
      } else if (finalState.status === "out_of_budget") {
        reasons.push(`${finalState.tick >= spec.limits.ticks ? `Tick budget (${spec.limits.ticks})` : `LLM call budget (${spec.limits.llmCalls})`} ran out after ${done}/${waves} waves.`);
        evidence.push({ type: "tick", value: finalState.tick, note: "budget_exhausted" });
      } else {
        reasons.push(`Only ${done}/${waves} waves completed.`);
        evidence.push({ type: "state", value: { waveIndex: done, wavesTotal: waves }, note: "waves progress" });
      }
      score = waves > 0 ? Math.max(0, Math.min(0.9, done / waves)) : 0;
    }
    return { passed, score, confidence: 1, reasons, evidence };
  }

  const goal = eventually(events, "goal_reached");
  const hazard = eventually(events, "hazard_entered");
  passed = !!goal && !hazard && finalState.status === "won";
  if (passed) {
    reasons.push(`Altar reached at tick ${goal!.tick} without touching hazard.`);
    evidence.push({ type: "tick", value: goal!.tick, note: "goal_reached" });
    evidence.push({ type: "position", value: finalState.agent.pos, note: "final position" });
    score = 1;
  } else {
    if (hazard) {
      reasons.push(`Golem stepped on red hazard at tick ${hazard.tick}.`);
      evidence.push({ type: "event", value: hazard, note: "hazard_entered" });
      evidence.push({ type: "position", value: hazard.data?.pos ?? finalState.agent.pos, note: "hazard tile" });
    } else if (finalState.status === "out_of_budget") {
      reasons.push(`${finalState.tick >= spec.limits.ticks ? `Tick budget (${spec.limits.ticks})` : `LLM call budget (${spec.limits.llmCalls}) or wall clock`} exhausted before reaching the altar.`);
      evidence.push({ type: "tick", value: finalState.tick, note: "budget_exhausted" });
      evidence.push({ type: "position", value: finalState.agent.pos, note: "final position" });
    } else {
      reasons.push("Altar never reached.");
      evidence.push({ type: "position", value: finalState.agent.pos, note: "final position" });
    }
    const moved = countEvents(events, "moved");
    const blocked = countEvents(events, "blocked");
    evidence.push({ type: "state", value: { moved, blocked, tick: finalState.tick }, note: "activity" });
    score = 0;
  }
  return { passed, score, confidence: 1, reasons, evidence };
}
