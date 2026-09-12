/**
 * Loads app/public/assets/atlas.json (produced by scripts/slice-atlas.py) and registers every
 * sprite with the renderer. Until it resolves, the renderer keeps drawing coloured placeholders.
 */
import { registerAnimation, registerSprite, type Sprite } from "./render";

interface AtlasFrame {
  file: string;
  w: number;
  h: number;
}
type Atlas = Record<string, { frames: AtlasFrame[] }>;

const BASE = `${import.meta.env.BASE_URL}assets/`;
const ANIMATIONS = ["idle", "walk", "interact", "fail", "success"];
const listeners = new Set<() => void>();
let loaded = false;
let atlasData: Atlas | null = null;

export function assetUrl(key: string, frame?: number): string {
  const f = atlasData?.[key]?.frames;
  if (!f || f.length === 0) return `${BASE}${key}.png`;
  return `${BASE}${f[Math.min(frame ?? 0, f.length - 1)].file}`;
}

export function assetsLoaded(): boolean {
  return loaded;
}

export function onAssetsLoaded(fn: () => void): () => void {
  listeners.add(fn);
  if (loaded) fn();
  return () => listeners.delete(fn);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`asset ${url}`));
    img.src = url;
  });
}

async function toSprites(frames: AtlasFrame[]): Promise<Sprite[]> {
  return Promise.all(
    frames.map(async (f) => {
      const image = await loadImage(`${BASE}${f.file}`);
      return { image, sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight };
    }),
  );
}

export async function loadAssets(): Promise<void> {
  try {
    const res = await fetch(`${BASE}atlas.json`);
    if (!res.ok) return;
    atlasData = (await res.json()) as Atlas;
  } catch {
    return;
  }
  const jobs: Promise<void>[] = [];
  for (const [key, { frames }] of Object.entries(atlasData)) {
    if (key.startsWith("ui.") || key.startsWith("bg.") || key.startsWith("fg.")) continue; // used via <img>/CSS
    const parts = key.split(".");
    const anim = parts[parts.length - 1];
    if (ANIMATIONS.includes(anim) && parts.length > 2) {
      const base = parts.slice(0, -1).join(".");
      jobs.push(toSprites(frames).then((sprites) => registerAnimation(base, { [anim]: sprites })));
    } else {
      jobs.push(toSprites(frames).then((sprites) => registerSprite(key, sprites[0])));
    }
  }
  await Promise.allSettled(jobs);
  loaded = true;
  for (const l of listeners) l();
}
