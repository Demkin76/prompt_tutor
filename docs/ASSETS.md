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
| td.tower.arrow   | basic tower (short range, fast)                   |
| td.tower.cannon  | heavy tower (long range, slow)                    |
| td.tower.frost   | slowing tower (optional)                          |
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
