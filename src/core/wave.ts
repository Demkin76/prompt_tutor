import type { LevelSpec, SimEventType, Vec, WaveSpec, WorldState } from "./types";
import { manhattan } from "./grid";
import { enemyRoute } from "./generators/towerdefense";

type Emit = (type: SimEventType, data?: Record<string, unknown>) => void;

interface LiveEnemy {
  id: string;
  hp: number;
  speed: number;
  pathIndex: number;
}

export interface WaveTraceFrame {
  subTick: number;
  enemies: { id: string; pos: Vec; hp: number }[];
  shots: { towerId: string; enemyId: string; damage: number }[];
}

/**
 * Resolve the next wave's effective spec by applying `opponent.rules` to the
 * base wave, given the previous wave's outcome:
 *   onLeakBonus: number   → if the previous wave leaked ≥1 enemy, count += bonus
 *   onNoLeakSwitch: boolean → if the previous wave leaked 0, enemies become
 *                             "runner" with speed + 1 (same hp)
 * The very first wave is never modified.
 */
export function effectiveWave(spec: LevelSpec, td: NonNullable<WorldState["td"]>): WaveSpec {
  const base = spec.opponent!.waves[td.waveIndex];
  const wave: WaveSpec = { ...base };
  const rules = spec.opponent!.rules ?? {};
  const last = td.lastWave;
  if (!last) return wave;
  const leakBonus = rules.onLeakBonus;
  if (typeof leakBonus === "number" && last.leaked >= 1) wave.count += leakBonus;
  if (rules.onNoLeakSwitch === true && last.leaked === 0) {
    wave.enemyType = "runner";
    wave.speed = base.speed + 1;
  }
  return wave;
}

/**
 * Runs one full wave inside a single sim step. Order per sub-tick:
 *   1. every live enemy advances `speed` tiles; reaching the base → leak
 *   2. spawn one enemy (if any left) at the spawn tile (pathIndex 0)
 *   3. every tower shoots the live enemy closest to the base within its
 *      Manhattan `range` for `damage`; hp ≤ 0 → killed
 * Enemies are transient: they never appear in the returned state, only in the
 * `trace` of the wave_ended event.
 */
export function runWave(spec: LevelSpec, s: WorldState, emit: Emit): void {
  const td = s.td!;
  const route = enemyRoute(s);
  const wave = effectiveWave(spec, td);
  const waveIndex = td.waveIndex;
  emit("wave_started", { waveIndex, count: wave.count, enemyType: wave.enemyType, hp: wave.hp, speed: wave.speed });

  const towers = s.entities
    .filter((e) => e.kind === "tower")
    .map((e) => ({ id: e.id, pos: e.pos, range: Number(e.props.range ?? 1), damage: Number(e.props.damage ?? 1) }));

  const live: LiveEnemy[] = [];
  const trace: WaveTraceFrame[] = [];
  let spawned = 0;
  let killed = 0;
  let leaked = 0;
  const lastIndex = route.length - 1;
  const MAX_SUBTICKS = 2000;

  for (let subTick = 0; subTick < MAX_SUBTICKS; subTick++) {
    if (spawned >= wave.count && live.length === 0) break;
    if (td.baseHp <= 0) break;

    for (let i = live.length - 1; i >= 0; i--) {
      const en = live[i];
      en.pathIndex += en.speed;
      if (en.pathIndex >= lastIndex) {
        live.splice(i, 1);
        leaked++;
        td.baseHp -= 1;
        emit("enemy_leaked", { id: en.id, subTick, baseHp: td.baseHp });
      }
    }

    if (spawned < wave.count) {
      const id = `enemy-${waveIndex + 1}-${spawned + 1}`;
      live.push({ id, hp: wave.hp, speed: Math.max(1, wave.speed), pathIndex: 0 });
      spawned++;
      emit("enemy_spawned", { id, enemyType: wave.enemyType, subTick, pos: route[0] });
    }

    const shots: WaveTraceFrame["shots"] = [];
    for (const t of towers) {
      let target: LiveEnemy | null = null;
      for (const en of live) {
        if (en.hp <= 0) continue;
        if (manhattan(t.pos, route[en.pathIndex]) > t.range) continue;
        if (!target || en.pathIndex > target.pathIndex) target = en;
      }
      if (!target) continue;
      target.hp -= t.damage;
      shots.push({ towerId: t.id, enemyId: target.id, damage: t.damage });
      if (target.hp <= 0) {
        killed++;
        emit("enemy_killed", { id: target.id, by: t.id, subTick, pos: route[target.pathIndex] });
      }
    }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].hp <= 0) live.splice(i, 1);

    trace.push({
      subTick,
      enemies: live.map((en) => ({ id: en.id, pos: route[en.pathIndex], hp: en.hp })),
      shots,
    });
  }

  td.lastWave = { spawned, killed, leaked };
  td.waveIndex += 1;
  emit("wave_ended", { waveIndex, spawned, killed, leaked, baseHp: td.baseHp, trace });

  const baseEntity = s.entities.find((e) => e.kind === "base");
  if (baseEntity) baseEntity.props.hp = td.baseHp;

  if (td.baseHp <= 0) {
    td.phase = "done";
    s.status = "lost";
    emit("base_destroyed", { waveIndex });
  } else if (td.waveIndex >= td.wavesTotal) {
    td.phase = "done";
    s.status = "won";
    emit("all_waves_cleared", { baseHp: td.baseHp });
  }
}
