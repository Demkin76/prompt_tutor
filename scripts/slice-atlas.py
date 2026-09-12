"""
Slice the hand-drawn GOLEM asset atlas (one big PNG) into per-assetKey sprites.

  python scripts/slice-atlas.py "<atlas.png>" [--out app/public/assets] [--sheet contact.png]

Regions below are rough boxes in atlas pixels (labels excluded). Each box is tightened to the
bounding box of non-paper pixels; strips are split into frames at background gaps. Non-tile assets
get the paper background converted to alpha. Writes <out>/<assetKey>.png + <out>/atlas.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

args = sys.argv[1:]
src = Path(args[0])
out = Path("app/public/assets")
sheet = None
i = 1
while i < len(args):
    if args[i] == "--out":
        out = Path(args[i + 1]); i += 2
    elif args[i] == "--sheet":
        sheet = Path(args[i + 1]); i += 2
    else:
        i += 1

img = Image.open(src).convert("RGBA")
A = np.asarray(img).astype(np.int16)
H, W = A.shape[:2]

# Paper background: sample the median of a known empty margin.
paper = np.median(A[1070:1084, 700:900, :3].reshape(-1, 3), axis=0)
print("paper colour", paper)


def mask_content(region, thresh=48):
    """Boolean mask of pixels that differ from the paper (ignores faint grid lines)."""
    d = np.abs(region[:, :, :3] - paper).sum(axis=2)
    return d > thresh


def tighten(box, thresh=48, pad=1):
    x0, y0, x1, y1 = box
    m = mask_content(A[y0:y1, x0:x1], thresh)
    ys, xs = np.where(m)
    if len(xs) == 0:
        return box
    return (max(0, x0 + xs.min() - pad), max(0, y0 + ys.min() - pad), min(W, x0 + xs.max() + 1 + pad), min(H, y0 + ys.max() + 1 + pad))


def split_frames(box, n, thresh=48, min_gap=3):
    """Split a horizontal strip into n frames using background gaps; fall back to equal split."""
    x0, y0, x1, y1 = box
    m = mask_content(A[y0:y1, x0:x1], thresh)
    cols = m.any(axis=0)
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append([start, x]); start = None
    # drop noise specks, then merge runs separated by tiny gaps
    runs = [r for r in runs if r[1] - r[0] >= 6] or runs
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    # merge smallest gaps until n runs remain
    while len(merged) > n:
        gaps = [(merged[k + 1][0] - merged[k][1], k) for k in range(len(merged) - 1)]
        _, k = min(gaps)
        merged[k][1] = merged[k + 1][1]
        del merged[k + 1]
    if len(merged) != n:
        w = (x1 - x0) / n
        merged = [[int(k * w), int((k + 1) * w)] for k in range(n)]
    return [tighten((x0 + a, y0, x0 + b, y1), thresh) for a, b in merged]


def cut(box, transparent):
    x0, y0, x1, y1 = box
    part = A[y0:y1, x0:x1].copy()
    if transparent:
        d = np.abs(part[:, :, :3] - paper).sum(axis=2)
        alpha = np.clip((d - 30) * 6, 0, 255)
        part[:, :, 3] = alpha
    return Image.fromarray(part.astype(np.uint8), "RGBA")


# (assetKey, rough box, frames, transparent, square)
# square=True keeps the tightened box but pads to a square canvas (tiles are drawn stretched to 32x32).
R = [
    # 1. tiles
    ("tile.floor", (16, 140, 100, 232), 1, False, True),
    ("tile.floor.v2", (104, 140, 190, 232), 1, False, True),
    ("tile.floor.v3", (194, 140, 280, 232), 1, False, True),
    ("tile.wall", (288, 140, 376, 232), 1, False, True),
    ("tile.wall.top", (388, 140, 476, 232), 1, False, True),
    ("tile.hazard", (486, 140, 576, 232), 1, False, True),
    ("tile.bridge", (588, 140, 706, 232), 1, False, True),
    ("tile.altar", (16, 276, 100, 362), 1, False, True),
    ("tile.altar.f2", (104, 276, 190, 362), 1, False, True),
    ("tile.path", (192, 276, 274, 362), 1, False, True),
    ("tile.buildable", (276, 276, 356, 362), 1, False, True),
    ("tile.spawn", (360, 276, 446, 362), 1, False, True),
    ("tile.base", (450, 276, 532, 362), 1, False, True),
    ("tile.fog", (536, 276, 632, 374), 1, False, True),
    ("tile.unknown", (640, 276, 720, 362), 1, False, True),
    # 2. units
    ("unit.golem.idle", (744, 170, 838, 248), 2, True, False),
    ("unit.golem.walk", (848, 170, 1020, 248), 4, True, False),
    ("unit.golem.interact", (1026, 170, 1118, 248), 2, True, False),
    ("unit.golem.fail", (1130, 170, 1282, 248), 4, True, False),
    ("unit.golem.success", (1286, 170, 1436, 248), 3, True, False),
    ("td.enemy.grunt.walk", (744, 320, 940, 396), 4, True, False),
    ("td.enemy.runner.walk", (955, 322, 1146, 396), 4, True, False),
    ("td.enemy.brute.walk", (1154, 320, 1440, 396), 4, True, False),
    # 3. objects
    ("item.plank", (10, 470, 98, 586), 1, True, False),
    ("item.key", (100, 470, 176, 586), 1, True, False),
    ("obj.door.closed", (184, 470, 282, 586), 1, True, False),
    ("obj.door.open", (286, 470, 384, 586), 1, True, False),
    ("obj.lever.off", (388, 470, 478, 586), 1, True, False),
    ("obj.lever.on", (482, 470, 576, 586), 1, True, False),
    ("obj.crate", (586, 470, 676, 586), 1, True, False),
    ("td.tower.archer", (696, 452, 816, 586), 1, True, False),
    ("td.tower.cannon", (818, 452, 926, 586), 1, True, False),
    ("td.tower.ballista", (928, 452, 1042, 586), 1, True, False),
    ("td.projectile", (1070, 500, 1130, 560), 1, True, False),
    ("td.base", (1150, 445, 1292, 586), 1, True, False),
    ("td.base.damaged", (1294, 445, 1440, 586), 1, True, False),
    # 4. UI
    ("ui.panel.parchment", (14, 670, 232, 846), 1, False, False),
    ("ui.panel.stone", (240, 670, 456, 846), 1, False, False),
    ("ui.button.primary", (462, 668, 602, 720), 1, True, False),
    ("ui.button.primary.pressed", (604, 668, 742, 720), 1, True, False),
    ("ui.button.secondary", (518, 766, 676, 826), 1, True, False),
    ("ui.icon.heart", (758, 694, 810, 736), 1, True, False),
    ("ui.icon.heart.empty", (814, 694, 866, 736), 1, True, False),
    ("ui.icon.footsteps", (878, 694, 930, 736), 1, True, False),
    ("ui.icon.lock", (940, 694, 992, 736), 1, True, False),
    ("ui.icon.unlock", (1002, 694, 1056, 736), 1, True, False),
    ("ui.icon.brain", (1070, 694, 1126, 736), 1, True, False),
    ("ui.icon.skull", (758, 774, 810, 818), 1, True, False),
    ("ui.icon.check", (814, 774, 866, 818), 1, True, False),
    ("ui.icon.cross", (866, 774, 912, 818), 1, True, False),
    ("ui.icon.play", (916, 774, 964, 818), 1, True, False),
    ("ui.icon.pause", (968, 774, 1018, 818), 1, True, False),
    ("ui.icon.replay", (1020, 774, 1070, 818), 1, True, False),
    ("ui.icon.tower", (1074, 774, 1130, 818), 1, True, False),
    ("ui.logo", (1156, 660, 1436, 744), 1, True, False),
    ("ui.mascot", (1150, 760, 1436, 856), 3, True, False),
    # 5. backgrounds
    ("bg.dungeon_wall", (12, 918, 642, 1056), 1, False, False),
    ("fg.table", (648, 918, 1068, 1056), 1, True, False),
]

out.mkdir(parents=True, exist_ok=True)
atlas = {}
tiles = []
for key, box, n, transparent, square in R:
    boxes = split_frames(box, n) if n > 1 else [tighten(box)]
    frames = []
    for fi, b in enumerate(boxes):
        im = cut(b, transparent)
        if square:
            s = max(im.size)
            canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
            canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
            im = canvas
        name = f"{key}.png" if n == 1 else f"{key}.{fi}.png"
        im.save(out / name)
        frames.append({"file": name, "w": im.width, "h": im.height, "box": [int(v) for v in b]})
    atlas[key] = {"frames": frames}
    tiles.extend((key, f["file"]) for f in frames)
    print(f"{key:28s} {n} frame(s) {[f['box'] for f in frames][0]}")

(out / "atlas.json").write_text(json.dumps(atlas, indent=1))
print("wrote", out / "atlas.json", len(atlas), "keys")

if sheet:
    cell = 72
    cols = 12
    rows = (len(tiles) + cols - 1) // cols
    cs = Image.new("RGBA", (cols * cell, rows * (cell + 14)), (60, 60, 70, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(cs)
    for k, (key, f) in enumerate(tiles):
        im = Image.open(out / f)
        im.thumbnail((cell - 4, cell - 4))
        x, y = (k % cols) * cell, (k // cols) * (cell + 14)
        cs.paste(im, (x + 2, y + 2), im)
        d.text((x + 2, y + cell), f[:-4][-14:], fill=(255, 255, 255, 255))
    cs.save(sheet)
    print("sheet", sheet)
