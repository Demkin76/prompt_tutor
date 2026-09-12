import { useEffect, useRef } from "react";
import type { ModeId, TileType } from "@core/types";
import { drawAsset, drawTile, TILE_LABELS } from "../render";

type Item = { tile: TileType; label?: string } | { asset: string; kind: string; label: string };

const LEGEND: Record<ModeId, Item[]> = {
  maze: [
    { tile: "floor" },
    { tile: "wall" },
    { tile: "altar" },
    { tile: "hazard" },
    { asset: "item.plank", kind: "plank", label: "Plank — bridges red floor" },
    { asset: "item.key", kind: "key", label: "Key — opens a door" },
    { asset: "prop.door", kind: "door", label: "Door — may be locked" },
    { asset: "unit.golem", kind: "golem", label: "Your golem" },
  ],
  redfloor: [
    { tile: "floor" },
    { tile: "wall" },
    { tile: "hazard" },
    { tile: "bridge" },
    { tile: "altar" },
    { asset: "item.plank", kind: "plank", label: "Plank — carry one at a time" },
    { asset: "prop.crate", kind: "crate", label: "Crate — push onto red floor" },
    { asset: "unit.golem", kind: "golem", label: "Your golem" },
  ],
  towerdefense: [
    { tile: "path" },
    { tile: "buildable" },
    { tile: "spawn" },
    { tile: "base" },
    { asset: "td.tower", kind: "tower", label: "Tower — shoots enemies in range" },
    { asset: "td.enemy", kind: "enemy", label: "Enemy — walks the path" },
  ],
};

function Swatch({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if ("tile" in item) {
      drawTile(ctx, item.tile, 0, 0, 32, 5);
    } else {
      drawTile(ctx, item.kind === "tower" ? "buildable" : item.kind === "enemy" ? "path" : "floor", 0, 0, 32, 5);
      drawAsset(ctx, item.asset, 0, 0, 32, null, "south", "idle", item.kind);
    }
  }, [item]);
  return <canvas ref={ref} width={32} height={32} />;
}

export function Legend({ mode }: { mode: ModeId }) {
  return (
    <div className="legend">
      {LEGEND[mode].map((item, i) => (
        <div className="item" key={i}>
          <Swatch item={item} />
          <span>{"tile" in item ? item.label ?? TILE_LABELS[item.tile] : item.label}</span>
        </div>
      ))}
    </div>
  );
}
