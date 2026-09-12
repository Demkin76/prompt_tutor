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
 * `score` is a 0..1 quality figure: 1 on pass; on fail, partial credit for
 * progress (waves survived) so the UI can show "how close".
 */
export function verify(spec: LevelSpec, initialState: WorldState, finalState: WorldState, events: SimEvent[]): Verdict {
  const reasons: string[] = [];
  const evidence: Evidence[] = [];
  let passed = false;
  let score = 0;

  if (spec.mode === "keymaster") {
    const collected = events.find(e => e.type === "item_collected" && e.data?.item === "item.key");
    const opened = events.find(e => e.type === "door_opened" && e.data?.with === "key");
    const reached = eventually(events, "altar_reached");
    const altar = initialState.tiles.indexOf("altar");
    const atAltar = finalState.agent.pos[1] * finalState.size[0] + finalState.agent.pos[0] === altar;
    const door = finalState.entities.find(e => e.kind === "door");
    passed = !!collected && !!opened && !!reached && collected.tick < opened.tick && opened.tick < reached.tick
      && atAltar && door?.props.open === true && door.props.locked === false && finalState.status === "won"
      && finalState.agent.alive && finalState.keymaster?.key === "consumed";
    if (collected) reasons.push("Ключ найден и подобран");
    if (opened) reasons.push("Дверь открыта ключом");
    if (reached && atAltar) reasons.push("Алтарь достигнут");
    if (!passed) {
      if (!collected) reasons.push("Голем не подобрал ключ. Устав должен разрешать поиск и использование полезных предметов.");
      else if (!opened) reasons.push("Ключ получен, но дверь не открыта. Нужно вернуться к обнаруженному препятствию и использовать предмет.");
      else if (!reached) reasons.push("Путь открыт, но голем не дошёл до алтаря.");
      else reasons.push("Нарушен порядок действий или итоговое состояние мира.");
      if (events.some(e => e.type === "agent_stuck")) reasons.push("Голем повторял действия без прогресса.");
      if (finalState.status === "out_of_budget") reasons.push("Исчерпан бюджет действий, вызовов модели или времени.");
    }
    for (const e of [collected, opened, reached]) if (e) evidence.push({ type: "event", value: e });
    evidence.push({ type: "state", value: { atAltar, doorOpen: door?.props.open === true, key: finalState.keymaster?.key ?? "world" } });
    if (passed && collected && opened) {
      const priorMoves = events.filter(e => e.type === "moved" && e.tick < collected.tick);
      const positions = priorMoves.map(e => JSON.stringify(e.data?.to));
      if (new Set(positions).size === positions.length) evidence.push({ type: "state", value: 100, note: "bonus" });
      if (!events.some(e => e.type === "interaction_failed" && e.tick > collected.tick && e.tick < opened.tick))
        evidence.push({ type: "state", value: 100, note: "bonus" });
    }
    return { passed, score: passed ? 1 : 0, confidence: 1, reasons, evidence };
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
