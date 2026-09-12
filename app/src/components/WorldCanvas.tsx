import { useEffect, useRef } from "react";
import type { Vec, WorldState } from "@core/types";
import { drawFogPlaceholder, drawTraceEnemies, drawWorld } from "../render";
import type { TraceStep } from "../log";

export const TILE = 32;
const TRACE_MS = 120;

interface Props {
  state: WorldState | null;
  size?: Vec; // used for the fog placeholder when there is no state
  radius: number;
  showFog: boolean;
  trace?: { trace: TraceStep[]; hpMax: number } | null;
}

export function WorldCanvas({ state, size, radius, showFog, trace }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, h] = state?.size ?? size ?? [12, 12];

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!state) {
      drawFogPlaceholder(ctx, [w, h], TILE);
      return;
    }
    const base = () => drawWorld(ctx, state, { tileSize: TILE, radius, showFog });
    if (!trace || trace.trace.length === 0) {
      base();
      return;
    }
    let i = 0;
    let timer = 0;
    const tick = () => {
      base();
      const step = trace.trace[Math.min(i, trace.trace.length - 1)];
      drawTraceEnemies(ctx, step.enemies, TILE, trace.hpMax);
      i++;
      if (i < trace.trace.length) timer = window.setTimeout(tick, TRACE_MS);
      else timer = window.setTimeout(base, TRACE_MS * 2);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [state, w, h, radius, showFog, trace]);

  return <canvas ref={ref} width={w * TILE} height={h * TILE} style={{ maxWidth: `${w * TILE * 1.5}px` }} />;
}
