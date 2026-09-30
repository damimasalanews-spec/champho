"""Measure the rig: where the hand tip, the front foot and the head actually land
at each beat, against the wall face. No rendering to disk."""
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

print("sprite %dx%d  hand_uv=(%.3f,%.3f)  footF_uv=(%.3f,%.3f)  footB_uv=(%.3f,%.3f)"
      % (w, h, movers["hand"][0][0], movers["hand"][0][1],
         movers["footF"][0][0], movers["footF"][0][1],
         movers["footB"][0][0], movers["footB"][0][1]))
print()
print("%-6s %-10s %8s %8s %8s %8s %8s" %
      ("t", "beat", "handtip", "foottip", "headtop", "wallface", "footgap"))

BEATS = [(0.60, "run-in"), (1.45, "brace"), (1.94, "shove1 wind"),
         (2.10, "shove1 PEAK"), (2.36, "shove2 wind"), (2.68, "shove2 PEAK"),
         (2.94, "shove3 wind"), (3.26, "shove3 PEAK"), (3.70, "wind-up"),
         (4.12, "kick swing"), (4.30, "KICK HIT"), (4.90, "wall gone"),
         (6.00, "settle")]

for t, beat in BEATS:
    mv, tx, ty, rot, sx, sy = M.pose(t, movers)
    rgb, al = M.warp(sp, fld, mv, M.FIG_H)
    on = al > 30
    ys, xs = np.nonzero(on)

    # same band the anchors are read from, so the two agree
    band = (ys > pad + 0.18 * h) & (ys < pad + 0.70 * h)
    hand_x = xs[band].max() if band.any() else -1
    # the kicking foot swings UP, so the foot band has to start at mid-height or
    # the measure silently starts tracking the standing leg instead
    low = (ys > pad + 0.55 * h) & (ys < pad + 1.02 * h)
    foot_x = xs[low].max() if low.any() else -1
    gx = xs.max() if len(xs) else -1
    gy = ys[xs == gx].mean() if len(xs) else -1
    head_y = ys.min() if len(ys) else -1

    reach = movers["hand"][0][0] * w - w / 2 + pad
    tile_left = (M.WALL_X - M.WALL_W / 2 + M.HAND_TAKEUP - reach
                 - M.HAND_PEAK * M.FIG_H + tx + pad) - (pad + w / 2)
    stage_hand = tile_left + hand_x
    stage_foot = tile_left + foot_x

    wall_dx = 0.0
    for th in M.SHOVES:
        hit = th + M.SH_DUR * 0.64
        wall_dx += 9 * M.ramp(t, hit, hit + 0.09)
    wall_dx += 22 * M.ramp(t, M.T_HIT, M.T_HIT + 0.10)
    if t >= M.T_BREAK:
        wall_dx += 150 * M.ramp(t, M.T_BREAK, M.T_BREAK + 0.70)
    face = M.WALL_X + wall_dx - M.WALL_W / 2

    print("%-6.2f %-10s %8.1f %8.1f %8.1f %8.1f %8.1f   maxx=%.1f@y=%.0f" %
          (t, beat, stage_hand, stage_foot, head_y, face, face - stage_foot,
           tile_left + gx, gy - pad))
