"""Print the warped silhouette as text so the pose is readable without an image."""
import numpy as np

import render_movie as M

key = "pumpkin-boy"
sprite = M.load_sprite(key)
movers = M.anchors(sprite)
movers["_w"] = float(sprite.width)
movers["_h"] = float(sprite.height)
pad = 110
fld = M.build_fields(sprite, movers, pad)
sp = M.pad_sprite(sprite, pad)

COLS, ROWS = 62, 30
tiles = []
labels = []
for t, beat in [(1.45, "BRACE"), (2.10, "SHOVE PEAK"), (3.70, "KICK WIND-UP"),
                (4.30, "KICK HIT")]:
    mv, tx, ty, rot, sx, sy = M.pose(t, movers)
    _rgb, al = M.warp(sp, fld, mv, M.FIG_H)
    sub = al[pad:pad + sprite.height, pad:pad + sprite.width]
    # grid-average into cells
    hh, ww = sub.shape
    out = []
    for r in range(ROWS):
        row = ""
        for c in range(COLS):
            y0, y1 = int(r * hh / ROWS), int((r + 1) * hh / ROWS)
            x0, x1 = int(c * ww / COLS), int((c + 1) * ww / COLS)
            v = sub[y0:y1, x0:x1].mean() / 255.0
            row += " .:-=+*#%@"[min(9, int(v * 9.999))]
        out.append(row)
    tiles.append((beat, out))

for beat, out in tiles:
    print("=" * COLS)
    print(beat)
    print("=" * COLS)
    for r in out:
        print(r)
    print()
