/** Observation-only reference policy for offline demos and integration tests.
 * It demonstrates a good policy; it is NOT a natural-language charter evaluator.
 * Production still uses the configured LLM with the player's immutable charter.
 */
import type { AgentDecision, Observation, Vec } from "../core/types";
import { bfs, dirTo, manhattan, neighbors, samePos } from "../core/grid";

export function keymasterDemoDecision(obs: Observation): AgentDecision {
  const size: Vec = [16, 16];
  const key = (p: Vec) => p.join(",");
  const known = new Map([...(obs.memory.knownTiles ?? []), ...obs.visible.tiles].map(t => [key(t.pos), t.tile]));
  const objects = obs.memory.knownLandmarks;
  const me = obs.self.pos;
  const door = objects.find(e => e.kind === "door");
  const item = objects.find(e => e.kind === "key" && (!e.props?.state || e.props.state === "world"));
  const hasKey = obs.self.inventory.includes("key");
  const blocked = new Set(objects.filter(e => e.kind === "crate" || (e.kind === "door" && !e.props?.open)).map(e => key(e.pos)));
  const passable = (p: Vec) => known.has(key(p)) && known.get(key(p)) !== "wall" && !blocked.has(key(p));
  const decide = (intent: string, plan: AgentDecision["plan"]): AgentDecision => ({ intent, plan, stopOn: ["new_entity", "state_changed", "goal_visible"] });
  if (item && !hasKey && manhattan(me, item.pos) <= 1) return decide("Ключ рядом: подбираю полезный предмет.", [{ type: "pickup" }]);
  if (door && !door.props?.open && hasKey && manhattan(me, door.pos) === 1)
    return decide("Ключ получен: открываю запертую дверь.", [{ type: "interact", args: { dir: dirTo(me, door.pos)! } }]);
  let path: Vec[] | null = null;
  let intent = door && !door.props?.open && !hasKey ? "Дверь блокирует путь: исследую мир в поисках ключа." : "Исследую неизвестные проходы.";
  const shortest = (targets: Vec[]) => {
    let best: Vec[] | null = null;
    for (const p of targets) {
      const candidate = bfs(size, passable, me, p);
      if (candidate && candidate.length > 1 && (!best || candidate.length < best.length)) best = candidate;
    }
    return best;
  };
  if (item && !hasKey) { path = shortest([item.pos]); intent = "Обнаружен ключ: иду к нему."; }
  if (door && !door.props?.open && hasKey) {
    path = shortest(neighbors(size, door.pos).filter(passable));
    intent = "Ключ в инвентаре: возвращаюсь к запомненной двери.";
  }
  if (door?.props?.open) {
    path = shortest(objects.filter(e => e.kind === "altar").map(e => e.pos));
    intent = "Дверь открыта: продолжаю путь к алтарю.";
  }
  if (!path) {
    const frontiers = [...known.keys()].map(k => k.split(",").map(Number) as Vec)
      .filter(p => passable(p) && !samePos(p, me) && neighbors(size, p).some(n => !known.has(key(n))));
    path = shortest(frontiers);
  }
  if (!path) return decide("Доступных проходов не осталось.", [{ type: "wait" }]);
  return decide(intent, path.slice(1, 6).map((p, i) => ({ type: "move", args: { dir: dirTo(path![i], p)! } })));
}
