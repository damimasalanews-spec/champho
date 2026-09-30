"""Is the warp destroying the legs? Compare limb area / solidity against the
untouched original drawing at each beat. A smeared limb loses opaque area and
develops holes, so both are tracked."""
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
w, h = sprite.size


def solidity(al):
    on = al > 40
    ys, xs = np.nonzero(on)
    if not len(ys):
        return 0, 0.0, 0.0
    band = slice(int(pad + 0.55 * h), int(pad + 1.02 * h))
    reg = on[band]
    ysr = np.nonzero(reg.any(axis=1))[0]
    if not len(ysr):
        return 0, 0.0, 0.0
    sub = reg[ysr.min():ysr.max() + 1]
    cols = np.nonzero(sub.any(axis=0))[0]
    sub = sub[:, cols.min():cols.max() + 1]
    area = float(sub.sum())
    bbox = float(sub.shape[0] * sub.shape[1])
    # interior holes: transparent pixels fully enclosed by the limb
    holes = 0
    for r in range(1, sub.shape[0] - 1):
        row = sub[r]
        idx = np.nonzero(row)[0]
        if len(idx) > 1:
            holes += int((~row[idx.min():idx.max() + 1]).sum())
    return area, area / bbox, holes


ref_area, ref_fill, ref_holes = solidity(np.array(sprite, np.float32)[..., 3])
print("original drawing          area=%7.0f  fill=%.3f  holes=%d" %
      (ref_area, ref_fill, ref_holes))
print()
print("%-6s %-11s %8s %8s %9s %8s %7s" %
      ("t", "beat", "area", "%of ref", "fill", "holes", "vs ref"))
for t, beat in [(1.45, "brace"), (1.94, "shove wind"), (2.10, "shove PEAK"),
                (3.70, "kick wind-up"), (4.12, "kick swing"), (4.30, "KICK HIT"),
                (4.45, "kick recoil"), (6.00, "settle")]:
    mv, tx, ty, rot, sx, sy = M.pose(t, movers)
    _rgb, al = M.warp(sp, fld, mv, M.FIG_H)
    a, f, ho = solidity(al)
    print("%-6.2f %-11s %8.0f %7.1f%% %9.3f %8d %7.1f%%" %
          (t, beat, a, 100 * a / ref_area, f, ho, 100 * a / ref_area - 100))
