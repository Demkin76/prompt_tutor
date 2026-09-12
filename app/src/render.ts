/**
 * Canvas renderer for GOLEM worlds. Pure drawing — no sim knowledge beyond `@core/types`.
 * Entities are resolved by `visual.assetKey` through the ASSETS registry; a spritesheet
 * region can be plugged in per key with `registerSprite()` without touching anything else.
 */
import type { Dir, Entity, TileType, Vec, WorldState } from "@core/types";

export type Ctx = CanvasRenderingContext2D;

export interface Sprite {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface DrawArgs {
  ctx: Ctx;
  x: number; // pixel x (top-left)
  y: number; // pixel y (top-left)
  size: number; // tile size in px
  entity: Entity | null;
  facing: Dir;
  animation: string;
}

export type DrawFn = (a: DrawArgs) => void;

export interface DrawWorldOpts {
  tileSize: number;
  radius: number; // observation radius (Chebyshev) around the agent
  showFog: boolean;
  seen?: number[]; // tile indices ever seen; defaults to state.seen
}

export interface TraceEnemy {
  id: string;
  pos: Vec;
  hp: number;
}

// ───────────────────────── Tile colours ─────────────────────────
export const TILE_COLORS: Record<TileType, string> = {
  floor: "#6c6f78",
  wall: "#2c3548",
  hazard: "#b8322a",
  bridge: "#8a5a2b",
  altar: "#2fbf6a",
  path: "#cdb77a",
  buildable: "#2f5f3a",
  spawn: "#7a3fb0",
  base: "#3b6fd0",
};

export const TILE_LABELS: Record<TileType, string> = {
  floor: "Floor — walkable",
  wall: "Wall — blocked",
  hazard: "Red floor — deadly",
  bridge: "Bridge — plank over red floor",
  altar: "Altar — the goal",
  path: "Path — enemy route",
  buildable: "Slot — tower can be built",
  spawn: "Spawn — enemies enter",
  base: "Base — defend it",
};

function hash(n: number): number {
  let h = (n | 0) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

export function drawTile(ctx: Ctx, tile: TileType, x: number, y: number, s: number, seed = 0): void {
  const sp = tileSprite(tile, seed);
  if (sp) {
    blitSprite(ctx, sp, x, y, s, false, true);
    return;
  }
  const base = TILE_COLORS[tile] ?? "#ff00ff";
  ctx.fillStyle = base;
  ctx.fillRect(x, y, s, s);
  const px = Math.max(1, Math.floor(s / 16));
  switch (tile) {
    case "floor": {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x, y, s, px);
      ctx.fillRect(x, y, px, s);
      if (hash(seed) > 0.7) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x + s * 0.3, y + s * 0.6, px * 3, px);
      }
      break;
    }
    case "wall": {
      ctx.fillStyle = "#4a5670"; // lighter top edge
      ctx.fillRect(x, y, s, Math.max(2, s * 0.18));
      ctx.fillStyle = "#1a2030";
      ctx.fillRect(x, y + s - px * 2, s, px * 2);
      // brick seams
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x, y + s * 0.55, s, px);
      ctx.fillRect(x + s * 0.5, y + s * 0.18, px, s * 0.37);
      ctx.fillRect(x + s * 0.25, y + s * 0.55, px, s * 0.45);
      break;
    }
    case "hazard": {
      ctx.fillStyle = "#e0553f";
      ctx.fillRect(x + px, y + px, s - px * 2, s - px * 2);
      // cracks
      ctx.strokeStyle = "#5a120c";
      ctx.lineWidth = px;
      ctx.beginPath();
      const r1 = hash(seed + 1), r2 = hash(seed + 2);
      ctx.moveTo(x + s * 0.2, y + s * (0.2 + r1 * 0.3));
      ctx.lineTo(x + s * 0.5, y + s * 0.5);
      ctx.lineTo(x + s * (0.6 + r2 * 0.3), y + s * 0.85);
      ctx.moveTo(x + s * 0.5, y + s * 0.5);
      ctx.lineTo(x + s * 0.85, y + s * (0.25 + r2 * 0.2));
      ctx.stroke();
      // glow speck
      ctx.fillStyle = "rgba(255,200,120,0.5)";
      ctx.fillRect(x + s * 0.3, y + s * 0.7, px * 2, px * 2);
      break;
    }
    case "bridge": {
      ctx.fillStyle = "#b8322a"; // hazard under the planks
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(x, y + s * 0.08, s, s * 0.84);
      ctx.fillStyle = "#4b2f14";
      for (let i = 1; i < 4; i++) ctx.fillRect(x, y + s * (0.08 + i * 0.21), s, px);
      ctx.fillStyle = "#c58a4a";
      ctx.fillRect(x + s * 0.15, y + s * 0.12, px * 2, px);
      ctx.fillRect(x + s * 0.7, y + s * 0.55, px * 2, px);
      break;
    }
    case "altar": {
      ctx.fillStyle = "#6c6f78";
      ctx.fillRect(x, y, s, s);
      const g = ctx.createRadialGradient(x + s / 2, y + s / 2, s * 0.1, x + s / 2, y + s / 2, s * 0.7);
      g.addColorStop(0, "rgba(120,255,160,0.95)");
      g.addColorStop(1, "rgba(47,191,106,0.05)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#1f6f31";
      ctx.fillRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4);
      ctx.fillStyle = "#c9ffd6";
      ctx.fillRect(x + s * 0.42, y + s * 0.42, s * 0.16, s * 0.16);
      break;
    }
    case "path": {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let i = 0; i < 4; i++) {
        const r = hash(seed * 7 + i);
        ctx.fillRect(x + s * ((r * 13) % 1) * 0.9, y + s * ((r * 29) % 1) * 0.9, px, px);
      }
      break;
    }
    case "buildable": {
      ctx.strokeStyle = "#5ea36d";
      ctx.lineWidth = px;
      ctx.strokeRect(x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6);
      ctx.fillStyle = "rgba(94,163,109,0.35)";
      ctx.fillRect(x + s * 0.4, y + s * 0.4, s * 0.2, s * 0.2);
      break;
    }
    case "spawn": {
      ctx.strokeStyle = "#d9b6ff";
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s * 0.15, Math.PI, Math.PI * 2.5);
      ctx.stroke();
      break;
    }
    case "base": {
      ctx.fillStyle = "#1f3f80";
      ctx.fillRect(x + s * 0.15, y + s * 0.45, s * 0.7, s * 0.45);
      ctx.fillStyle = "#8fb6ff";
      ctx.beginPath();
      ctx.moveTo(x + s * 0.1, y + s * 0.5);
      ctx.lineTo(x + s * 0.5, y + s * 0.15);
      ctx.lineTo(x + s * 0.9, y + s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

// ───────────────────────── Entity placeholders ─────────────────────────
function eyes(ctx: Ctx, x: number, y: number, s: number, facing: Dir, color: string): void {
  const e = Math.max(2, s * 0.1);
  let ox = 0, oy = 0;
  if (facing === "east") ox = s * 0.08;
  if (facing === "west") ox = -s * 0.08;
  if (facing === "south") oy = s * 0.06;
  if (facing === "north") oy = -s * 0.06;
  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.32 + ox, y + s * 0.38 + oy, e, e);
  ctx.fillRect(x + s * 0.58 + ox, y + s * 0.38 + oy, e, e);
}

const drawGolem: DrawFn = ({ ctx, x, y, size: s, facing, animation }) => {
  const dead = animation === "fail";
  const won = animation === "success";
  if (won) {
    const g = ctx.createRadialGradient(x + s / 2, y + s / 2, s * 0.2, x + s / 2, y + s / 2, s * 0.8);
    g.addColorStop(0, "rgba(255,240,150,0.7)");
    g.addColorStop(1, "rgba(255,240,150,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - s * 0.3, y - s * 0.3, s * 1.6, s * 1.6);
  }
  ctx.fillStyle = dead ? "#6f6a63" : "#d3a86a";
  const r = s * 0.16;
  const bx = x + s * 0.15, by = y + s * 0.15, bw = s * 0.7, bh = s * 0.7;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.lineTo(bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.lineTo(bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.lineTo(bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dead ? "#4a4640" : "#8c6a3c"; // shading
  ctx.fillRect(bx, by + bh - s * 0.08, bw, s * 0.08);
  ctx.fillStyle = "#3a2a14";
  ctx.fillRect(x + s * 0.45, y + s * 0.15, s * 0.1, s * 0.1); // rune
  if (dead) {
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = Math.max(1, s * 0.05);
    for (const ex of [s * 0.3, s * 0.56]) {
      ctx.beginPath();
      ctx.moveTo(x + ex, y + s * 0.36);
      ctx.lineTo(x + ex + s * 0.14, y + s * 0.5);
      ctx.moveTo(x + ex + s * 0.14, y + s * 0.36);
      ctx.lineTo(x + ex, y + s * 0.5);
      ctx.stroke();
    }
  } else {
    eyes(ctx, x, y, s, facing, animation === "interact" ? "#ffd36b" : "#4ce0ff");
  }
};

const drawPlank: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#3a2410";
  ctx.fillRect(x + s * 0.12, y + s * 0.4, s * 0.76, s * 0.26);
  ctx.fillStyle = "#a5692f";
  ctx.fillRect(x + s * 0.15, y + s * 0.42, s * 0.7, s * 0.18);
  ctx.fillStyle = "#d69a55";
  ctx.fillRect(x + s * 0.2, y + s * 0.44, s * 0.3, s * 0.05);
};

const drawKey: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.arc(x + s * 0.35, y + s * 0.4, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + s * 0.45, y + s * 0.36, s * 0.4, s * 0.08);
  ctx.fillRect(x + s * 0.7, y + s * 0.44, s * 0.06, s * 0.12);
  ctx.fillRect(x + s * 0.8, y + s * 0.44, s * 0.06, s * 0.1);
  ctx.fillStyle = "#7a5a10";
  ctx.beginPath();
  ctx.arc(x + s * 0.35, y + s * 0.4, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
};

const drawDoor: DrawFn = ({ ctx, x, y, size: s, entity }) => {
  const open = entity?.props.open === true;
  const locked = entity?.props.locked === true;
  ctx.fillStyle = open ? "#4b3218" : "#7a4a1e";
  ctx.fillRect(x + s * 0.12, y + s * 0.05, s * 0.76, s * 0.9);
  ctx.fillStyle = "#3a2410";
  ctx.fillRect(x + s * 0.12, y + s * 0.05, s * 0.76, s * 0.06);
  if (open) {
    ctx.fillStyle = "#6c6f78";
    ctx.fillRect(x + s * 0.3, y + s * 0.2, s * 0.4, s * 0.75);
  } else {
    ctx.fillStyle = locked ? "#f2c94c" : "#c9c9c9";
    ctx.fillRect(x + s * 0.55, y + s * 0.45, s * 0.14, s * 0.16);
  }
};

const drawLever: DrawFn = ({ ctx, x, y, size: s, entity }) => {
  const on = entity?.props.on === true;
  ctx.fillStyle = "#3a3f4a";
  ctx.fillRect(x + s * 0.25, y + s * 0.7, s * 0.5, s * 0.15);
  ctx.strokeStyle = "#9aa0ad";
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y + s * 0.72);
  ctx.lineTo(x + s * (on ? 0.75 : 0.25), y + s * 0.25);
  ctx.stroke();
  ctx.fillStyle = on ? "#3fbf5a" : "#d24b3c";
  ctx.fillRect(x + s * (on ? 0.68 : 0.18), y + s * 0.18, s * 0.14, s * 0.14);
};

const drawCrate: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#8a5a2b";
  ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
  ctx.strokeStyle = "#3a2410";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.12, y + s * 0.12);
  ctx.lineTo(x + s * 0.88, y + s * 0.88);
  ctx.moveTo(x + s * 0.88, y + s * 0.12);
  ctx.lineTo(x + s * 0.12, y + s * 0.88);
  ctx.stroke();
};

const drawTower: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#3a3f4a";
  ctx.fillRect(x + s * 0.2, y + s * 0.35, s * 0.6, s * 0.55);
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(x + s * 0.15, y + s * 0.25, s * 0.7, s * 0.14);
  ctx.fillStyle = "#9aa0ad";
  for (let i = 0; i < 3; i++) ctx.fillRect(x + s * (0.2 + i * 0.22), y + s * 0.15, s * 0.14, s * 0.12);
  ctx.fillStyle = "#1a1d24";
  ctx.fillRect(x + s * 0.42, y + s * 0.5, s * 0.16, s * 0.25);
};

const drawBase: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#1f3f80";
  ctx.fillRect(x + s * 0.15, y + s * 0.45, s * 0.7, s * 0.45);
  ctx.fillStyle = "#8fb6ff";
  ctx.beginPath();
  ctx.moveTo(x + s * 0.08, y + s * 0.5);
  ctx.lineTo(x + s * 0.5, y + s * 0.12);
  ctx.lineTo(x + s * 0.92, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd36b";
  ctx.fillRect(x + s * 0.42, y + s * 0.62, s * 0.16, s * 0.2);
};

const drawEnemy: DrawFn = ({ ctx, x, y, size: s, entity }) => {
  ctx.fillStyle = "#d24b3c";
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s * 0.55, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8f2a20";
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s * 0.62, s * 0.3, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + s * 0.38, y + s * 0.45, s * 0.08, s * 0.08);
  ctx.fillRect(x + s * 0.54, y + s * 0.45, s * 0.08, s * 0.08);
  const hp = typeof entity?.props.hp === "number" ? (entity!.props.hp as number) : null;
  const hpMax = typeof entity?.props.hpMax === "number" ? (entity!.props.hpMax as number) : null;
  if (hp !== null && hpMax) {
    ctx.fillStyle = "#000";
    ctx.fillRect(x + s * 0.2, y + s * 0.1, s * 0.6, s * 0.1);
    ctx.fillStyle = "#3fbf5a";
    ctx.fillRect(x + s * 0.2, y + s * 0.1, s * 0.6 * Math.max(0, Math.min(1, hp / hpMax)), s * 0.1);
  }
};

const drawUnknown: DrawFn = ({ ctx, x, y, size: s }) => {
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.5, s * 0.5);
};

/** assetKey → placeholder draw function. Keys are matched exactly, then by last "." segment, then by entity kind. */
export const ASSETS: Record<string, DrawFn> = {
  "unit.golem": drawGolem,
  golem: drawGolem,
  "item.plank": drawPlank,
  plank: drawPlank,
  "item.key": drawKey,
  key: drawKey,
  "obj.door.closed": drawDoor,
  "obj.door.open": drawDoor,
  "obj.crate": drawCrate,
  "prop.door": drawDoor,
  door: drawDoor,
  "prop.lever": drawLever,
  lever: drawLever,
  "prop.crate": drawCrate,
  crate: drawCrate,
  "td.tower": drawTower,
  tower: drawTower,
  "td.base": drawBase,
  base: drawBase,
  "td.enemy": drawEnemy,
  enemy: drawEnemy,
};

const SPRITES = new Map<string, Sprite>();
const ANIMS = new Map<string, Record<string, Sprite[]>>();
const FRAME_MS = 160;

/** Plug a spritesheet region in for an assetKey; it overrides the placeholder for that key. */
export function registerSprite(assetKey: string, sprite: Sprite): void {
  SPRITES.set(assetKey, sprite);
}

/** Register animation strips for an assetKey: { idle: [...], walk: [...], ... }. */
export function registerAnimation(assetKey: string, anims: Record<string, Sprite[]>): void {
  ANIMS.set(assetKey, { ...(ANIMS.get(assetKey) ?? {}), ...anims });
}

export function unregisterSprite(assetKey: string): void {
  SPRITES.delete(assetKey);
  ANIMS.delete(assetKey);
}

export function hasSprites(): boolean {
  return SPRITES.size > 0 || ANIMS.size > 0;
}

function frameIndex(n: number, offset = 0): number {
  return n <= 1 ? 0 : (Math.floor(performance.now() / FRAME_MS) + offset) % n;
}

/** Pick a state-dependent sprite key for entities with variants (door open/closed, lever on/off, base damaged). */
function variantKey(assetKey: string, entity: Entity | null): string {
  if (!entity) return assetKey;
  if (entity.kind === "door") return `obj.door.${entity.props.open ? "open" : "closed"}`;
  if (entity.kind === "lever") return `obj.lever.${entity.props.on ? "on" : "off"}`;
  if (entity.kind === "base") {
    const hp = entity.props.hp;
    const hpMax = entity.props.hpMax;
    if (typeof hp === "number" && typeof hpMax === "number" && hp < hpMax) return "td.base.damaged";
  }
  return assetKey;
}

/** Draw a sprite scaled to fit a tile cell, aspect preserved, anchored bottom-centre; flipped for west-facing units. */
function blitSprite(ctx: Ctx, sp: Sprite, x: number, y: number, size: number, flip: boolean, fill = false): void {
  let dw = size;
  let dh = size;
  if (!fill) {
    const k = Math.min(size / sp.sw, size / sp.sh);
    dw = sp.sw * k;
    dh = sp.sh * k;
  }
  const dx = x + (size - dw) / 2;
  const dy = y + size - dh;
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sp.image, sp.sx, sp.sy, sp.sw, sp.sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(sp.image, sp.sx, sp.sy, sp.sw, sp.sh, dx, dy, dw, dh);
  }
}

/** Sprite for a static tile type, if registered (floor variants picked by seed, altar glow animated). */
function tileSprite(tile: TileType, seed: number): Sprite | undefined {
  if (tile === "floor") {
    const v = hash(seed * 7);
    return (v > 0.85 ? SPRITES.get("tile.floor.v3") : v > 0.6 ? SPRITES.get("tile.floor.v2") : undefined) ?? SPRITES.get("tile.floor");
  }
  if (tile === "altar") return (frameIndex(2, seed) === 1 ? SPRITES.get("tile.altar.f2") : undefined) ?? SPRITES.get("tile.altar");
  return SPRITES.get(`tile.${tile}`);
}

function resolveDraw(assetKey: string, kind?: string): DrawFn {
  if (ASSETS[assetKey]) return ASSETS[assetKey];
  const tail = assetKey.split(".").pop() ?? assetKey;
  if (ASSETS[tail]) return ASSETS[tail];
  if (kind && ASSETS[kind]) return ASSETS[kind];
  return drawUnknown;
}

export function drawAsset(
  ctx: Ctx,
  assetKey: string,
  x: number,
  y: number,
  size: number,
  entity: Entity | null = null,
  facing: Dir = "south",
  animation = "idle",
  kind?: string,
): void {
  const key = variantKey(assetKey, entity);
  const flip = facing === "west";
  const anims = ANIMS.get(key) ?? ANIMS.get(assetKey) ?? (kind === "enemy" ? ANIMS.get("td.enemy.grunt") : undefined);
  if (anims) {
    const strip = anims[animation] ?? anims.idle ?? anims.walk ?? Object.values(anims)[0];
    if (strip && strip.length > 0) {
      const seed = entity ? entity.id.length + entity.pos[0] * 3 + entity.pos[1] * 5 : 0;
      blitSprite(ctx, strip[frameIndex(strip.length, seed)], x, y, size, flip);
      if (entity && kind === "enemy") drawHpBar(ctx, entity, x, y, size);
      return;
    }
  }
  const sprite = SPRITES.get(key) ?? SPRITES.get(assetKey);
  if (sprite) {
    blitSprite(ctx, sprite, x, y, size, flip);
    if (entity && kind === "enemy") drawHpBar(ctx, entity, x, y, size);
    return;
  }
  resolveDraw(assetKey, kind)({ ctx, x, y, size, entity, facing, animation });
}

function drawHpBar(ctx: Ctx, entity: Entity, x: number, y: number, s: number): void {
  const hp = typeof entity.props.hp === "number" ? entity.props.hp : null;
  const hpMax = typeof entity.props.hpMax === "number" ? entity.props.hpMax : null;
  if (hp === null || !hpMax) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + s * 0.2, y + s * 0.02, s * 0.6, s * 0.12);
  ctx.fillStyle = hp / hpMax > 0.5 ? "#4fd35a" : "#e0453a";
  ctx.fillRect(x + s * 0.22, y + s * 0.04, s * 0.56 * Math.max(0, Math.min(1, hp / hpMax)), s * 0.08);
}

// ───────────────────────── World ─────────────────────────
function drawUnseen(ctx: Ctx, x: number, y: number, s: number, seed: number): void {
  const sp = SPRITES.get("tile.unknown");
  if (sp) {
    blitSprite(ctx, sp, x, y, s, false, true);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, y, s, s);
    return;
  }
  ctx.fillStyle = "#07080b";
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  if (hash(seed * 3) > 0.6) ctx.fillRect(x + s * 0.3, y + s * 0.4, 2, 2);
}

export function drawWorld(ctx: Ctx, state: WorldState, opts: DrawWorldOpts): void {
  const [w, h] = state.size;
  const s = opts.tileSize;
  const seen = opts.seen ?? state.seen ?? [];
  const seenSet = opts.showFog ? new Set(seen) : null;
  const [ax, ay] = state.agent.pos;
  const inRadius = (x: number, y: number): boolean =>
    !opts.showFog || (Math.abs(x - ax) <= opts.radius && Math.abs(y - ay) <= opts.radius);

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w * s, h * s);

  const visibility: ("hidden" | "dim" | "lit")[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const tile = state.tiles[i] ?? "wall";
      let vis: "hidden" | "dim" | "lit" = "lit";
      if (seenSet) {
        if (inRadius(x, y)) vis = "lit";
        else if (seenSet.has(i)) vis = "dim";
        else vis = "hidden";
      }
      visibility[i] = vis;
      if (vis === "hidden") drawUnseen(ctx, x * s, y * s, s, i);
      else drawTile(ctx, tile, x * s, y * s, s, i);
    }
  }

  // Entities (skip hidden tiles). Draw the golem last so it sits on top.
  let golemDrawn = false;
  const sorted = [...state.entities].sort((a, b) => (a.kind === "golem" ? 1 : 0) - (b.kind === "golem" ? 1 : 0));
  for (const e of sorted) {
    const [ex, ey] = e.pos;
    const i = ey * w + ex;
    if (visibility[i] === "hidden" && e.kind !== "golem") continue;
    drawAsset(ctx, e.visual.assetKey, ex * s, ey * s, s, e, e.visual.facing, e.visual.animation, e.kind);
    if (e.kind === "golem") golemDrawn = true;
  }
  if (!golemDrawn) {
    const anim = !state.agent.alive ? "fail" : state.status === "won" ? "success" : "idle";
    drawAsset(ctx, "unit.golem", ax * s, ay * s, s, null, state.agent.facing, anim, "golem");
  }

  if (state.keymaster && state.entities.find(e => e.kind === "golem")?.visual.animation === "interact") {
    ctx.fillStyle = "#ffd36b";
    for (const [dx, dy] of [[0.1, 0.2], [0.8, 0.1], [0.9, 0.7]]) ctx.fillRect((ax + dx) * s, (ay + dy) * s, 3, 3);
  }
  // Dim remembered-but-not-visible tiles.
  if (seenSet) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (visibility[y * w + x] === "dim") ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }

  // Grid lines
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x++) {
    ctx.beginPath();
    ctx.moveTo(x * s + 0.5, 0);
    ctx.lineTo(x * s + 0.5, h * s);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * s + 0.5);
    ctx.lineTo(w * s, y * s + 0.5);
    ctx.stroke();
  }
}

/** Overlay enemies from a towerdefense wave trace sub-tick. */
export function drawTraceEnemies(ctx: Ctx, enemies: TraceEnemy[], tileSize: number, hpMax = 0, enemyType = "grunt"): void {
  const enemyKey = `td.enemy.${enemyType}`;
  for (const en of enemies) {
    if (en.hp <= 0) continue;
    const fake: Entity = {
      id: en.id,
      kind: "enemy",
      pos: en.pos,
      props: { hp: en.hp, hpMax: hpMax || en.hp },
      visual: { assetKey: enemyKey, animation: "walk", facing: "east" },
    };
    drawAsset(ctx, enemyKey, en.pos[0] * tileSize, en.pos[1] * tileSize, tileSize, fake, "east", "walk", "enemy");
  }
}

/** Fog-of-war placeholder grid with "?" marks, used before a run has started. */
export function drawFogPlaceholder(ctx: Ctx, size: Vec, tileSize: number): void {
  const [w, h] = size;
  const s = tileSize;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      drawUnseen(ctx, x * s, y * s, s, i);
      if (hash(i * 11) > 0.82) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.font = `${Math.floor(s * 0.55)}px "Press Start 2P", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x * s + s / 2, y * s + s / 2 + 1);
      }
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x++) {
    ctx.beginPath();
    ctx.moveTo(x * s + 0.5, 0);
    ctx.lineTo(x * s + 0.5, h * s);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * s + 0.5);
    ctx.lineTo(w * s, y * s + 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = `${Math.floor(s * 0.7)}px "Press Start 2P", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", (w * s) / 2, (h * s) / 2);
}
