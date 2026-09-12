"""
Slice every GOLEM art atlas into per-assetKey sprites (app/public/assets + atlas.json).

  python scripts/slice-assets.py --src <folder with the atlas PNGs> [--out app/public/assets] [--sheet <contact.png>]

Expected files in --src (any of them may be missing; that section is then skipped):
  game.png     "GAME ASSET ATLAS"            tiles, golem, enemies, objects, UI, backgrounds (paper bg)
  fly.png      "FLY (DROSOPHILA) WITH CASSETTE"  8 directions x 11 states x 4 frames + extras (dark bg)
  trader.png   "TRADER UNIT, FX & RESULTS"   trader golem animations, FX (checker bg), result medals
  tradeui.png  "TRADE UI & SYMBOLS"          9-slice panels, divider, currency, state/indicator/controller icons
  sanctum.png  "TRADE SANCTUM BACKGROUND"    main background + scene panels

Quality rules:
  - crops keep native resolution (the renderer scales); nothing is resampled
  - every non-tile sprite gets its background keyed to alpha (paper / dark checker / light checker)
  - animation frames of one strip share ONE bounding box (union over frames) so the sprite never jitters
  - 9-slice panels are re-assembled from their exploded pieces into a single clean frame image
  - keys already used by the app keep their names (unit.fly.*, trade.*, ui.mascot.*, tile.*, ...)
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

# ───────────────────────── args ─────────────────────────
args = sys.argv[1:]
opts = {"--src": ".", "--out": "app/public/assets", "--sheet": None}
i = 0
while i < len(args):
    if args[i] in opts and i + 1 < len(args):
        opts[args[i]] = args[i + 1]
        i += 2
    else:
        i += 1
SRC = Path(opts["--src"])
OUT = Path(opts["--out"])
OUT.mkdir(parents=True, exist_ok=True)

atlas: dict = {}
written: list[tuple[str, str]] = []


# ───────────────────────── helpers ─────────────────────────
def load(name):
    p = SRC / name
    if not p.exists():
        print(f"skip {name}: not found")
        return None
    return np.asarray(Image.open(p).convert("RGBA")).astype(np.int16)


def dominant_colors(region, n=2, quant=8):
    """Most common colours (quantised) — used to find checker/paper backgrounds."""
    px = region[:, :, :3].reshape(-1, 3) // quant * quant
    c = Counter(map(tuple, px))
    return [np.array(k, dtype=np.int16) for k, _ in c.most_common(n)]


def paper_of(A):
    """Paper colour of a light-background atlas: median of its bright, unsaturated pixels."""
    rgb = A[::4, ::4, :3].reshape(-1, 3)
    lum = rgb.mean(axis=1)
    sat = rgb.max(axis=1) - rgb.min(axis=1)
    sel = rgb[(lum > 190) & (sat < 30)]
    return [np.median(sel if len(sel) else rgb, axis=0).astype(np.int16)]


def bg_distance(region, bgs):
    d = None
    for bg in bgs:
        di = np.abs(region[:, :, :3] - bg).sum(axis=2)
        d = di if d is None else np.minimum(d, di)
    return d


def key_alpha(region, bgs, thresh=40, soft=6):
    """Alpha from distance to the background colours. Hard cut with a short soft ramp for glows."""
    d = bg_distance(region, bgs)
    a = np.clip((d - thresh) * (255 // soft), 0, 255)
    out = region.copy()
    out[:, :, 3] = np.minimum(out[:, :, 3], a)
    return out


def content_mask(region, bgs, thresh=40):
    return bg_distance(region, bgs) > thresh


def key_grey_checker(region, lum_lo=110, lum_hi=228, sat_max=22):
    """For FX drawn on a noisy grey checkerboard: grey mid-luminance pixels become transparent,
    saturated colours, white sparkles and dark outlines stay."""
    rgb = region[:, :, :3]
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = rgb.mean(axis=2)
    bg = (sat < sat_max) & (lum > lum_lo) & (lum < lum_hi)
    out = region.copy()
    out[bg, 3] = 0
    return out


def bbox(mask, pad=1):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + 1 + pad, ys.max() + 1 + pad)


def runs_1d(vec, min_len=4, min_gap=2):
    """Contiguous True runs in a 1-D bool vector, dropping specks and bridging tiny gaps."""
    runs, start = [], None
    for x, on in enumerate(list(vec) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append([start, x])
            start = None
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [r for r in merged if r[1] - r[0] >= min_len] or merged


def split_runs(mask, n, axis):
    """Split a strip into n cells along `axis` (1 = columns) using background gaps; equal split fallback."""
    proj = mask.any(axis=0 if axis == 1 else 1)
    runs = runs_1d(proj)
    while len(runs) > n:
        gaps = [(runs[k + 1][0] - runs[k][1], k) for k in range(len(runs) - 1)]
        _, k = min(gaps)
        runs[k][1] = runs[k + 1][1]
        del runs[k + 1]
    if len(runs) != n:
        L = mask.shape[1] if axis == 1 else mask.shape[0]
        w = L / n
        runs = [[int(k * w), int((k + 1) * w)] for k in range(n)]
    return runs


def save(key, img, frame=None, box=None):
    name = f"{key}.png" if frame is None else f"{key}.{frame}.png"
    img.save(OUT / name)
    entry = atlas.setdefault(key, {"frames": []})
    entry["frames"].append({"file": name, "w": img.width, "h": img.height, "box": [int(v) for v in box] if box else None})
    written.append((key, name))


def to_img(arr):
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def single(A, key, box, bgs, transparent=True, thresh=40, tighten=True, square=False):
    x0, y0, x1, y1 = box
    reg = A[y0:y1, x0:x1]
    if tighten:
        b = bbox(content_mask(reg, bgs, thresh))
        if b:
            reg = reg[b[1] : b[3], b[0] : b[2]]
            box = (x0 + b[0], y0 + b[1], x0 + b[2], y0 + b[3])
    if transparent:
        reg = key_alpha(reg, bgs, thresh)
    img = to_img(reg)
    if square:
        s = max(img.size)
        canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        canvas.paste(img, ((s - img.width) // 2, (s - img.height) // 2))
        img = canvas
    save(key, img, None, box)
    return box


def drop_thin_lines(mask, reg, max_width=3, cover=0.8):
    """Sheet dividers: 1-3 px lines spanning (almost) the whole cell height/width. Sprites are wider, so
    only high-coverage runs no wider than `max_width` are removed (from the mask and the pixels)."""
    for axis in (0, 1):
        n = mask.shape[1] if axis == 0 else mask.shape[0]
        covf = mask.sum(axis=axis) / mask.shape[axis]
        anyc = mask.any(axis=axis)
        kill = []
        for a, b in runs_1d(covf >= cover, min_len=1, min_gap=0):
            if b - a <= max_width:
                kill.append((a, b))
        # dotted / faint dividers: thin runs with modest coverage that are isolated (empty on both sides)
        for a, b in runs_1d(anyc, min_len=1, min_gap=0):
            if b - a <= max_width and covf[a:b].max() >= 0.2:
                left_empty = a == 0 or not anyc[max(0, a - 3) : a].any()
                right_empty = b >= n or not anyc[b : min(n, b + 3)].any()
                if left_empty and right_empty:
                    kill.append((a, b))
        for a, b in kill:
            if axis == 0:
                mask[:, a:b] = False
                reg[:, a:b, 3] = 0
            else:
                mask[a:b, :] = False
                reg[a:b, :, 3] = 0


def strip(A, key, box, n, bgs, thresh=40, equal=False, key_out=True):
    """Horizontal animation strip → n frames of identical size (union bbox), saved as key.0..n-1."""
    x0, y0, x1, y1 = box
    reg = A[y0:y1, x0:x1].copy()
    mask = content_mask(reg, bgs, thresh)
    drop_thin_lines(mask, reg)
    if equal:
        w = (x1 - x0) / n
        cols = [[int(k * w), int((k + 1) * w)] for k in range(n)]
    else:
        cols = split_runs(mask, n, axis=1)
    # union bbox relative to each cell (so frames align on the same anchor)
    rel = None
    cells = []
    for a, b in cols:
        m = mask[:, a:b]
        bb = bbox(m, pad=1)
        cells.append((a, b, bb))
        if bb:
            rel = bb if rel is None else (min(rel[0], bb[0]), min(rel[1], bb[1]), max(rel[2], bb[2]), max(rel[3], bb[3]))
    if rel is None:
        print(f"!! {key}: empty strip")
        return
    for fi, (a, b, _) in enumerate(cells):
        cw = b - a
        rx0, ry0, rx1, ry1 = max(0, rel[0]), rel[1], min(cw, rel[2]), rel[3]
        part = reg[ry0:ry1, a + rx0 : a + rx1]
        # pad frames to the same width if the cell was narrower than the union bbox
        target_w = rel[2] - max(0, rel[0])
        if part.shape[1] < target_w:
            padded = np.zeros((part.shape[0], target_w, 4), dtype=np.int16)
            padded[:, : part.shape[1]] = part
            part = padded
        if key_out:
            part = key_alpha(part, bgs, thresh)
        save(key, to_img(part), fi, (x0 + a + rx0, y0 + ry0, x0 + a + rx1, y0 + ry1))


def components(mask):
    """Connected components (4-neighbour) of a small boolean mask → list of (area, x0, y0, x1, y1)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            stack = [(sy, sx)]
            seen[sy, sx] = True
            x0 = x1 = sx
            y0 = y1 = sy
            area = 0
            while stack:
                y, x = stack.pop()
                area += 1
                x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            comps.append((area, x0, y0, x1 + 1, y1 + 1))
    return comps


def assemble9(A, key, box, preview_box, bgs, thresh=40, yscale=0.5):
    """Nine-slice panel = the seamless frame of the assembled preview with its demo content replaced by the
    exploded centre piece (stretched). Corner size comes from the exploded corner pieces."""
    x0, y0, x1, y1 = box
    reg = A[y0:y1, x0:x1]
    mask = content_mask(reg, bgs, max(thresh, 110))
    comps = sorted(components(mask), reverse=True)[:9]
    if len(comps) < 9:
        print(f"!! {key}: only {len(comps)} pieces found")
        return
    comps.sort(key=lambda c: (c[2] + c[4]) / 2)
    rows = [sorted(comps[k * 3 : k * 3 + 3], key=lambda c: c[1]) for k in range(3)]
    corner = rows[0][0]
    cw, ch = corner[3] - corner[1], corner[4] - corner[2]
    centre = rows[1][1]
    centre_img = to_img(reg[centre[2] : centre[4], centre[1] : centre[3]])
    # frame from the preview
    px0, py0, px1, py1 = preview_box
    prev = A[py0:py1, px0:px1]
    pb = bbox(content_mask(prev, bgs, max(thresh, 110)), pad=0)
    prev = key_alpha(prev[pb[1] : pb[3], pb[0] : pb[2]], bgs, thresh)
    panel = to_img(prev)
    W, H = panel.size
    # the preview frame is roughly half as thick as an exploded corner piece
    inset_x, inset_y = round(cw * 0.5), round(ch * yscale)
    inner = (inset_x, inset_y, W - inset_x, H - inset_y)
    # use only the interior texture of the centre piece (drop its own outline)
    mx, my = int(centre_img.width * 0.18), int(centre_img.height * 0.18)
    texture = centre_img.crop((mx, my, centre_img.width - mx, centre_img.height - my))
    fill = texture.resize((inner[2] - inner[0], inner[3] - inner[1]), Image.NEAREST)
    panel.paste(fill, (inner[0], inner[1]))
    save(key, panel, None, (px0 + pb[0], py0 + pb[1], px0 + pb[2], py0 + pb[3]))
    atlas[key]["slice"] = {"left": inset_x, "top": inset_y, "right": inset_x, "bottom": inset_y}


# ───────────────────────── 1. game atlas (paper background) ─────────────────────────
A = load("game.png")
if A is not None:
    paper = paper_of(A)
    T = [  # tiles: opaque squares
        ("tile.floor", (16, 140, 100, 232)), ("tile.floor.v2", (104, 140, 190, 232)), ("tile.floor.v3", (194, 140, 280, 232)),
        ("tile.wall", (288, 140, 376, 232)), ("tile.wall.top", (388, 140, 476, 232)), ("tile.hazard", (486, 140, 576, 232)),
        ("tile.bridge", (588, 140, 706, 232)), ("tile.altar", (16, 276, 100, 362)), ("tile.altar.f2", (104, 276, 190, 362)),
        ("tile.path", (192, 276, 274, 362)), ("tile.buildable", (276, 276, 356, 362)), ("tile.spawn", (360, 276, 446, 362)),
        ("tile.base", (450, 276, 532, 362)), ("tile.fog", (536, 276, 632, 374)), ("tile.unknown", (640, 276, 720, 362)),
    ]
    for k, b in T:
        single(A, k, b, paper, transparent=False, square=True)
    S = [  # animation strips
        ("unit.golem.idle", (744, 170, 838, 248), 2), ("unit.golem.walk", (848, 170, 1020, 248), 4),
        ("unit.golem.interact", (1026, 170, 1118, 248), 2), ("unit.golem.fail", (1130, 170, 1282, 248), 4),
        ("unit.golem.success", (1286, 170, 1436, 248), 3), ("td.enemy.grunt.walk", (744, 320, 940, 396), 4),
        ("td.enemy.runner.walk", (955, 322, 1146, 396), 4), ("td.enemy.brute.walk", (1154, 320, 1440, 396), 4),
    ]
    for k, b, n in S:
        strip(A, k, b, n, paper)
    O = [
        ("item.plank", (10, 470, 98, 586)), ("item.key", (100, 470, 176, 586)), ("obj.door.closed", (184, 470, 282, 586)),
        ("obj.door.open", (286, 470, 384, 586)), ("obj.lever.off", (388, 470, 478, 586)), ("obj.lever.on", (482, 470, 576, 586)),
        ("obj.crate", (586, 470, 676, 586)), ("td.tower.archer", (696, 452, 816, 586)), ("td.tower.cannon", (818, 452, 926, 586)),
        ("td.tower.ballista", (928, 452, 1042, 586)), ("td.projectile", (1078, 512, 1122, 550)), ("td.base", (1150, 445, 1292, 586)),
        ("td.base.damaged", (1294, 445, 1440, 586)),
        ("ui.button.primary", (462, 668, 602, 720)), ("ui.button.primary.pressed", (604, 668, 742, 720)),
        ("ui.button.secondary", (518, 766, 676, 826)), ("ui.icon.heart", (758, 694, 810, 730)), ("ui.icon.heart.empty", (814, 694, 866, 730)),
        ("ui.icon.footsteps", (878, 694, 930, 730)), ("ui.icon.lock", (940, 694, 992, 730)), ("ui.icon.unlock", (1002, 694, 1056, 730)),
        ("ui.icon.brain", (1070, 694, 1126, 730)), ("ui.icon.skull", (758, 774, 810, 812)), ("ui.icon.check", (814, 774, 866, 812)),
        ("ui.icon.cross", (866, 774, 912, 812)), ("ui.icon.play", (916, 774, 964, 812)), ("ui.icon.pause", (968, 774, 1018, 812)),
        ("ui.icon.replay", (1020, 774, 1070, 812)), ("ui.icon.tower", (1074, 774, 1130, 812)), ("ui.logo", (1156, 660, 1436, 744)),
        ("fg.table", (648, 918, 1068, 1056)),
    ]
    for k, b in O:
        single(A, k, b, paper)
    single(A, "ui.panel.parchment", (14, 670, 232, 846), paper, transparent=False)
    single(A, "ui.panel.stone", (240, 670, 456, 846), paper, transparent=False)
    single(A, "bg.dungeon_wall", (12, 918, 642, 1056), paper, transparent=False)
    strip(A, "ui.mascot.golem", (1150, 760, 1436, 856), 3, paper)

# ───────────────────────── 2. fly with cassette (dark checker background) ─────────────────────────
A = load("fly.png")
if A is not None:
    dark = dominant_colors(A[950:1080, 1200:1440], n=3)
    DIRS = [("south", 105, 268), ("north", 270, 433), ("east", 437, 600), ("west", 603, 766),
            ("southeast", 768, 931), ("southwest", 934, 1098), ("northeast", 1102, 1265), ("northwest", 1270, 1440)]
    ROWS = [("idle", 92, 160), ("walk", 160, 232), ("fly", 232, 306), ("think", 306, 388), ("cast", 388, 468),
            ("buy", 468, 542), ("sell", 542, 612), ("profit", 612, 688), ("loss", 688, 762), ("success", 762, 838), ("dead", 838, 915)]
    ALIAS = {"fly": ["interact"], "dead": ["fail"]}  # names the app already uses
    for state, y0, y1 in ROWS:
        for d, x0, x1 in DIRS:
            strip(A, f"unit.fly.{state}.{d}", (x0, y0, x1, y1), 4, dark, thresh=48, equal=True)
        # side-facing default = east column (the renderer mirrors west)
        for name in [state] + ALIAS.get(state, []):
            strip(A, f"unit.fly.{name}", (437, y0, 600, y1), 4, dark, thresh=48, equal=True)
    EXTRA = [("hover", 30, 320, 8), ("spin", 330, 572, 8), ("hit", 585, 842, 6), ("respawn", 850, 1112, 6), ("transform", 1128, 1442, 8)]
    for name, x0, x1, n in EXTRA:
        strip(A, f"unit.fly.{name}", (x0, 975, x1, 1040), n, dark, thresh=48, equal=True)
    # mascot poses for the UI: idle / success / dead (east-facing, first frame)
    for mi, (state, y0, y1) in enumerate([ROWS[0], ROWS[9], ROWS[10]]):
        single(A, "ui.mascot", (437, y0, 480, y1), dark, thresh=48)
        atlas["ui.mascot"]["frames"][-1]["file"] = f"ui.mascot.{mi}.png"
        (OUT / "ui.mascot.png").replace(OUT / f"ui.mascot.{mi}.png")
        written[-1] = ("ui.mascot", f"ui.mascot.{mi}.png")

# ───────────────────────── 3. trader golem, FX, results (paper + light checker) ─────────────────────────
A = load("trader.png")
if A is not None:
    paper = paper_of(A)
    TR = [("idle", 20, 360, 150, 265, 4), ("think", 400, 720, 150, 265, 4), ("cast", 740, 1060, 150, 265, 4), ("buy", 1100, 1440, 150, 265, 4),
          ("sell", 20, 360, 315, 430, 4), ("profit", 400, 720, 315, 430, 3), ("loss", 740, 1060, 315, 430, 4), ("success", 1080, 1440, 315, 430, 4)]
    for name, x0, x1, y0, y1, n in TR:
        strip(A, f"unit.golem.trader.{name}", (x0, y0, x1, y1), n, paper)
    FX = [("buy", 25, 175), ("sell", 195, 345), ("profit", 365, 515), ("loss", 535, 685), ("indicator.activate", 710, 895),
          ("candle.new", 905, 1060), ("level.complete", 1080, 1235), ("level.fail", 1265, 1425)]
    for name, x0, x1 in FX:
        reg = key_grey_checker(A[525:715, x0:x1])
        m = reg[:, :, 3] > 0
        drop_thin_lines(m, reg, max_width=5, cover=0.4)  # the box outline around each FX
        b = bbox(m, pad=1)
        reg = reg[b[1] : b[3], b[0] : b[2]]
        save(f"trade.fx.{name}", to_img(reg), None, (x0 + b[0], 525 + b[1], x0 + b[2], 525 + b[3]))
    for name, x0, x1 in [("result.profit", 30, 215), ("result.loss", 245, 410), ("result.breakeven", 455, 620), ("rank.positive", 1215, 1425)]:
        single(A, f"trade.{name}", (x0, 825, x1, 1015), paper)
    single(A, "trade.result.chart.frame", (670, 800, 1150, 1010), paper)

# ───────────────────────── 4. trade UI & symbols (paper) ─────────────────────────
A = load("tradeui.png")
if A is not None:
    paper = paper_of(A)
    for name, x0, x1 in [("chart", 25, 280), ("indicators", 315, 565), ("portfolio", 600, 850), ("order", 885, 1135), ("tooltip", 1170, 1420)]:
        assemble9(A, f"trade.panel.{name}", (x0, 178, x1, 315), (x0, 355, x1, 512), paper, yscale=0.36 if name == "order" else 0.5)
        single(A, f"trade.panel.{name}.preview", (x0, 355, x1, 512), paper)
    single(A, "trade.divider.rune", (20, 595, 295, 660), paper)
    for name, x0, x1 in [("currency.sun", 320, 415), ("currency.moon", 430, 525), ("pair.emblem", 545, 640)]:
        single(A, f"trade.{name}", (x0, 590, x1, 672), paper)
    for k in range(10):
        x0 = 650 + k * 78
        single(A, f"trade.currency.rune.{k + 1:02d}", (x0, 590, x0 + 76, 668), paper)  # rune.01 .. rune.10 as in the atlas
        atlas.setdefault("trade.currency.rune", {"frames": []})["frames"].append(dict(atlas[f"trade.currency.rune.{k + 1:02d}"]["frames"][0]))
    STATE = [("buy", 35, 95), ("sell", 150, 210), ("hold", 255, 315), ("long", 365, 425), ("short", 470, 530), ("close", 575, 635),
             ("balance", 690, 750), ("profit", 800, 860), ("loss", 905, 965), ("fee", 1015, 1075), ("candle", 1125, 1185),
             ("position", 1230, 1290), ("clock", 1345, 1405)]
    for name, x0, x1 in STATE:
        single(A, f"trade.icon.{name}", (x0, 755, x1, 818), paper)
    IND = [("sma", 35, 92), ("ema", 120, 178), ("bollinger", 210, 268), ("rsi", 305, 362), ("macd", 400, 458), ("stochastic", 495, 552),
           ("atr", 590, 648), ("volume", 685, 742)]
    for name, x0, x1 in IND:
        single(A, f"trade.indicator.{name}", (x0, 885, x1, 948), paper)
    CTRL = [("add", 780, 842), ("settings", 855, 917), ("visibility.on", 928, 990), ("visibility.off", 1000, 1062), ("remove", 1075, 1137),
            ("reset", 1145, 1207), ("color", 1215, 1277), ("expand", 1290, 1352), ("collapse", 1362, 1424)]
    for name, x0, x1 in CTRL:
        single(A, f"trade.icon.{name}", (x0, 885, x1, 932), paper)
    # compat alias: the app references trade.indicator.cross (no such icon in the atlas) → stochastic (two crossing curves)
    st = atlas["trade.indicator.stochastic"]["frames"][0]
    Image.open(OUT / st["file"]).save(OUT / "trade.indicator.cross.png")
    atlas["trade.indicator.cross"] = {"frames": [dict(st, file="trade.indicator.cross.png")]}

# ───────────────────────── 5. sanctum background ─────────────────────────
A = load("sanctum.png")
if A is not None:
    paper = paper_of(A)
    single(A, "trade.bg.sanctum", (10, 110, 1662, 652), paper, transparent=False, tighten=False)
    for name, x0, x1 in [("chart", 420, 692), ("indicators", 725, 998), ("portfolio", 1030, 1320), ("order", 1355, 1652)]:
        single(A, f"trade.scene.{name}", (x0, 714, x1, 882), paper, transparent=False)

# ───────────────────────── atlas + contact sheet ─────────────────────────
for entry in atlas.values():
    for f in entry["frames"]:
        f.pop("box", None) if f.get("box") is None else None
(OUT / "atlas.json").write_text(json.dumps(atlas, indent=1))
print(f"wrote {len(written)} files, {len(atlas)} keys -> {OUT / 'atlas.json'}")

if opts["--sheet"]:
    from PIL import ImageDraw

    GROUPS = {
        "game": lambda k: k.startswith(("tile.", "unit.golem.", "td.", "item.", "obj.", "ui.", "bg.", "fg.")) and not k.startswith("unit.golem.trader"),
        "fly": lambda k: k.startswith("unit.fly.") and k.count(".") == 2 or k.startswith("ui.mascot"),
        "flydirs": lambda k: k.startswith(("unit.fly.walk.", "unit.fly.idle.", "unit.fly.dead.")) and k.count(".") == 3,
        "trader": lambda k: k.startswith(("unit.golem.trader", "trade.fx", "trade.result", "trade.rank")),
        "tradeui": lambda k: k.startswith(("trade.panel", "trade.divider", "trade.currency", "trade.pair", "trade.icon", "trade.indicator", "trade.scene", "trade.bg")),
    }
    base = Path(opts["--sheet"])
    for g, pred in GROUPS.items():
        items = [(k, f) for k, f in written if pred(k)]
        if not items:
            continue
        cell, cols = 72, 16
        rows = (len(items) + cols - 1) // cols
        cs = Image.new("RGBA", (cols * cell, rows * (cell + 12)), (60, 60, 70, 255))
        d = ImageDraw.Draw(cs)
        for k, (key, f) in enumerate(items):
            im = Image.open(OUT / f)
            im.thumbnail((cell - 4, cell - 4))
            x, y = (k % cols) * cell, (k // cols) * (cell + 12)
            cs.paste(im, (x + 2, y + 2), im)
            d.text((x + 1, y + cell - 1), f[:-4][-12:], fill=(255, 255, 255, 255))
        out = base.with_name(f"{base.stem}_{g}{base.suffix}")
        cs.save(out)
        print("sheet", g, len(items), out)
