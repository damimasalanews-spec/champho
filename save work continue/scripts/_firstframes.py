"""Render ONE braced-against-the-wall frame per avatar. These become the first
frames handed to image-to-video, so the generated clip starts as the real
character in the real composition instead of the model inventing a scene."""
import os

import render_movie as M

M.SHOW_TITLE = False                 # no floating title for the model to animate
OUT = os.path.join(M.ROOT, "first-frames")
os.makedirs(OUT, exist_ok=True)

T = 1.52                             # braced, hands on the wall, wall intact
i = int(round(T * M.FPS))

for key, name in M.AVATARS:
    sprite = M.load_sprite(key)
    movers = M.anchors(sprite)
    movers["_w"] = float(sprite.width)
    movers["_h"] = float(sprite.height)
    pad = 110
    fld = M.build_fields(sprite, movers, pad)
    sp = M.pad_sprite(sprite, pad)
    reach = movers["hand"][0][0] * sprite.width - sprite.width / 2 + pad
    frame = M.render(i, sprite, sp, movers, fld, pad, reach, name, M.Bits(), [0.0, 0.0])
    p = os.path.join(OUT, key + "-start.png")
    frame.save(p)
    print("wrote", p)
print("done")
