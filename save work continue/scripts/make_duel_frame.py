"""Build one duel first-frame in the GAME's layout: green felt, two fighters
facing off across the slab, name plates. This is the frame handed to
image-to-video so the model animates the shove and the knockout in the game's
own composition rather than inventing a scene."""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SPR = r"C:\Users\fanso\AccioWork\2026-09-30-00-27-10-099-37804b95\champho\assets\wallpush"
MY = r"C:\Users\fanso\AccioWork\2026-09-30-02-42-01-003-492501db\wallpush-bodies"
OUT = r"C:\Users\fanso\AccioWork\2026-09-30-02-42-01-003-492501db\duel-frames"
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 720
BAR = 0
FLOOR = 596
FIG_H = 330
SLAB_W, SLAB_H = 116, 232
CENTER = W // 2


def font(sz, bold=True):
    for n in (["seguisb.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        p = os.path.join(r"C:\Windows\Fonts", n)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


F_NAME = font(26)
F_TAG = font(15)


def felt():
    """The game's table: green felt with a warm pool of light and a floor band."""
    yy = np.linspace(0.0, 1.0, H)[:, None]
    top = np.array([22, 118, 74], float)
    bot = np.array([9, 62, 40], float)
    a = top[None, None, :] * (1 - yy[:, :, None]) + bot[None, None, :] * yy[:, :, None]
    a = np.repeat(a, W, axis=1)
    gy, gx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((gx - CENTER) / (W * 0.62)) ** 2 + ((gy - H * 0.42) / (H * 0.70)) ** 2)
    a += (np.clip(1 - d, 0, 1) ** 2)[:, :, None] * np.array([30, 78, 50])
    vx = (gx - W / 2) / (W / 2)
    vy = (gy - H / 2) / (H / 2)
    a *= np.clip(1 - 0.55 * (vx * vx + vy * vy), 0, 1)[:, :, None]
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    dr = ImageDraw.Draw(im, "RGBA")
    dr.rectangle([0, FLOOR, W, H], fill=(0, 0, 0, 58))
    dr.rectangle([0, FLOOR - 3, W, FLOOR], fill=(190, 226, 200, 60))
    return im


def slab():
    im = Image.new("RGBA", (SLAB_W, SLAB_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in range(SLAB_H):
        k = y / (SLAB_H - 1)
        c = (int(150 - 52 * k), int(158 - 52 * k), int(170 - 50 * k), 255)
        d.line([(0, y), (SLAB_W, y)], fill=c)
    d.rounded_rectangle([0, 0, SLAB_W - 1, SLAB_H - 1], radius=10, outline=(46, 54, 66, 255), width=4)
    d.line([(10, 16), (10, SLAB_H - 20)], fill=(255, 255, 255, 70), width=4)
    for r in range(4):
        for c2 in range(2):
            x = 32 + c2 * 50
            y = 40 + r * 56
            d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(120, 130, 144, 215))
            d.ellipse([x - 7, y - 7, x + 3, y + 3], fill=(206, 214, 224, 160))
    return im


LEGACY = {"pumpkin-boy": "boy-body.png", "pumpkin-girl": "girl-body.png"}


def sprite_path(key):
    """The two original sprites keep their legacy filenames in the game repo."""
    if key in LEGACY:
        return os.path.join(SPR, LEGACY[key])
    return os.path.join(MY, key + "-body.png")


def load(path):
    im = Image.open(path).convert("RGBA")
    r = FIG_H / im.height
    return im.resize((max(1, int(im.width * r)), FIG_H), Image.LANCZOS)


def place(stage, sprite, cx, flip):
    s = sprite.transpose(Image.FLIP_LEFT_RIGHT) if flip else sprite
    stage.alpha_composite(s, (int(cx - s.width / 2), int(FLOOR - s.height)))


def plate(stage, x, name, color, left):
    d = ImageDraw.Draw(stage, "RGBA")
    tw = d.textlength(name, font=F_NAME)
    pad = 18
    x0 = x - tw / 2 - pad
    y0 = FLOOR - FIG_H - 66
    d.rounded_rectangle([x0, y0, x0 + tw + pad * 2, y0 + 40], radius=20,
                        fill=(250, 250, 252, 240), outline=color, width=3)
    d.text((x0 + pad, y0 + 8), name, font=F_NAME, fill=(24, 28, 34, 255))


def build(left_key, right_key, left_name, right_name, right_flip=True):
    stage = felt()
    # slab first so the fighters' hands overlap its face
    sl = slab()
    stage.alpha_composite(sl, (int(CENTER - SLAB_W / 2), int(FLOOR - SLAB_H)))
    fL = load(sprite_path(left_key))
    fR = load(sprite_path(right_key))
    # hands of each fighter meet the slab face
    gap = 26
    place(stage, fL, CENTER - SLAB_W / 2 - gap - fL.width * 0.30, False)
    place(stage, fR, CENTER + SLAB_W / 2 + gap + fR.width * 0.30, right_flip)
    plate(stage, 250, left_name, (60, 130, 240, 255), True)
    plate(stage, W - 250, right_name, (232, 72, 72, 255), False)
    d = ImageDraw.Draw(stage, "RGBA")
    tw = d.textlength("WALL PUSH", font=F_TAG)
    d.text((W / 2 - tw / 2, 34), "W A L L   P U S H", font=F_TAG, fill=(214, 240, 224, 210))
    return stage.convert("RGB")


if __name__ == "__main__":
    combos = [
        ("pumpkin-boy", "ninja", "Champ", "Jess"),
        ("ninja", "pumpkin-boy", "Jess", "Champ"),
    ]
    for lk, rk, ln, rn in combos:
        p = os.path.join(OUT, "%s-vs-%s.png" % (lk, rk))
        build(lk, rk, ln, rn).save(p)
        print("wrote", p)
    print("done")
