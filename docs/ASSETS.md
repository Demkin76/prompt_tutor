# GOLEM — Asset request list

Format rules (so assets drop in without code changes):

- Tile size **32×32 px**, PNG with alpha, pixel-art (nearest-neighbour scaling, no anti-aliasing).
- Deliver either one spritesheet per group **plus** a JSON atlas (`{ "frames": { "<assetKey>": { "x", "y", "w", "h" } } }`),
  or separate PNGs named exactly by `assetKey` (dots allowed): `unit.golem.idle.east.png`.
- Animations: 2–4 frames per state, horizontal strip, name `<assetKey>.<animation>.<facing>` where
  `animation ∈ idle | walk | interact | fail | success`, `facing ∈ north | south | east | west`
  (a single facing is acceptable; the renderer will mirror east/west).
- If you can send only one file (zip / psd / big png), fine: I will extract, but tell me the grid size.

## 1. Tiles (static, 32×32, tileable)

| assetKey         | What it is                                        | Notes                                   |
|------------------|---------------------------------------------------|-----------------------------------------|
| tile.floor       | plain stone slab, walkable                        | 2–3 variants for variety optional       |
| tile.wall        | stone wall block                                  | optionally a "top edge" variant         |
| tile.hazard      | red cracked slab (deadly)                         | with glow variant for animation optional|
| tile.bridge      | wooden planks laid over red slab                  |                                         |
| tile.altar       | green glowing exit altar                          | 2-frame glow animation optional         |
| tile.path        | sand/dirt enemy road (Tower Defense)              |                                         |
| tile.buildable   | empty tower slot (grass or marked stone)          |                                         |
| tile.spawn       | dark portal / cave mouth (enemy entry)            |                                         |
| tile.base        | ground under the base building                    |                                         |
| tile.fog         | fog overlay (semi-transparent dark)               | 64×64 ok, will be tiled                 |
| tile.unknown     | "?" never-seen tile                               |                                         |

## 2. Units

| assetKey         | States needed                                     |
|------------------|---------------------------------------------------|
| unit.golem       | idle, walk (4 dirs or 1 + mirror), interact, fail (crumble), success (cheer) |
| td.enemy.grunt   | walk                                              |
| td.enemy.runner  | walk (thin, fast-looking)                         |
| td.enemy.brute   | walk (big, armored)                               |

## 3. Objects / items (single frame unless noted)

| assetKey         | What it is                                        |
|------------------|---------------------------------------------------|
| item.plank       | wooden plank lying on floor (pickable)            |
| item.key         | key                                               |
| obj.door.closed  | locked/closed door                                |
| obj.door.open    | open door                                         |
| obj.lever.off    | lever, off                                        |
| obj.lever.on     | lever, on                                         |
| obj.crate        | pushable crate                                    |
| td.tower.archer  | basic tower (tier 1+): short range, fast          |
| td.tower.cannon  | heavy tower (tier 2+): mid range, high damage      |
| td.tower.ballista| long-range tower (tier 3)                         |
| td.projectile    | small 8×8 arrow/bolt                              |
| td.base          | player's base building (2 states: intact, damaged)|

## 4. UI (any size, we scale)

| Piece                          | Notes                                                        |
|--------------------------------|--------------------------------------------------------------|
| Parchment panel (9-slice)      | for Level / Rules / Result cards                             |
| Dark stone panel (9-slice)     | for Charter / Log / Status                                   |
| Green button + pressed state   | DEPLOY / "Animate"                                           |
| Grey button + pressed state    | secondary buttons                                            |
| Icons 16×16                    | heart (full/empty), footsteps, lock, unlock, brain (LLM call), skull, checkmark, cross, replay/play/pause, tower count |
| Logo "GOLEM"                   | PNG with alpha                                               |
| Small golem mascot (2–3 poses) | for the Status box and the Home screen                       |
| Background                     | dungeon wall texture + table/desk foreground (optional)      |

## 5. Fonts / sound (optional, not blocking)

- Pixel display font (OFL licensed) for headings; monospace for body. Default: Press Start 2P + VT323 from Google Fonts.
- SFX: step, blocked bump, plank place, door open, lever, hazard death, altar win, tower shoot, enemy die, base hit, wave start, deploy.

Everything in the engine references `assetKey` only. Missing keys fall back to coloured placeholders.

## Slicing the atlases (how the files in `app/public/assets` are made)

```bash
python scripts/slice-assets.py --src <folder with game.png fly.png trader.png tradeui.png sanctum.png> --out app/public/assets --sheet sheet.png
```

- Crops keep native resolution; the renderer scales to the tile size.
- Backgrounds are keyed to alpha: paper (light atlases), dark checker (fly sheet), grey checker (FX).
- Frames of one animation share a single bounding box, so sprites do not jitter between frames.
- Fly: `unit.fly.<state>.<N>` is the east-facing strip (the renderer mirrors west); `unit.fly.<state>.<direction>.<N>` holds all 8 directions.
  States: idle, walk, fly (alias interact), think, cast, buy, sell, profit, loss, success, dead (alias fail), plus hover, spin, hit, respawn, transform.
- Trade panels (`trade.panel.*`) are the seamless preview frame with the demo content replaced by the panel's own centre texture; `atlas.json` carries the 9-slice insets.
- `trade.indicator.cross` has no icon in the atlas and reuses the stochastic icon.
