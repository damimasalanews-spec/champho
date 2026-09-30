"""
Wall-push animation renderer.

Builds a real video (mp4 + gif) for each avatar from the transparent fighter
sprites in wallpush-bodies/. Motion is procedural: the sprite is driven as a
puppet (rotation about the feet, squash/stretch, translation) through a shove
beat, against a code-drawn stage with a slab that takes damage and topples.

Frames are piped straight into ffmpeg as rawvideo, so nothing lands on disk
but the finished videos.
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

ROOT = os.path.dirname(os.path.abspath(__file__))
SPRITES = os.path.join(ROOT, "wallpush-bodies")
OUT = os.path.join(ROOT, "wallpush-video")

W, H = 960, 540            # delivered frame
PAD = 28                   # overscan so camera shake never shows an edge
CW, CH = W + PAD * 2, H + PAD * 2
FPS = 24
DUR = 3.9
NF = int(round(DUR * FPS))
FLOOR = 452                # y the fighters' feet stand on
SLAB_X = 690               # slab centre
SLAB_W, SLAB_H = 88, 176

AVATARS = [
    ("pumpkin-boy", "PUMPKIN BOY"),
    ("pumpkin-girl", "PUMPKIN GIRL"),
    ("knight", "SIR GOURD"),
    ("ninja", "SHADOW SQUASH"),
    ("pirate", "CAPTAIN GOURD"),
    ("vampire", "BARON VINE"),
    ("wizard", "WIZARD ZUCC"),
    ("scholar", "PROFESSOR PIP"),
    ("robot", "UNIT BLIP"),
    ("alien", "ZOG"),
    ("genie", "DJINN"),
    ("ghost", "CHEEKY BOO"),
    ("yeti", "YETI"),
]

SPRITE_H = 300             # on-stage height of a fighter

# the two original sprites keep their legacy filenames
FILE = {"pumpkin-boy": "boy", "pumpkin-girl": "girl"}


# ----------------------------------------------------------------- helpers --
def ease(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def ramp(t, a, b):
    """0 before a, 1 after b, smooth in between."""
    if b <= a:
        return 1.0 if t >= b else 0.0
    return ease((t - a) / (b - a))


def clamp(v, a, b):
    return max(a, min(b, v))


def font(size, bold=True):
    names = (["seguisb.ttf", "arialbd.ttf", "segoeuib.ttf"] if bold
             else ["segoeui.ttf", "arial.ttf"])
    for n in names:
        p = os.path.join(r"C:\Windows\Fonts", n)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


F_TITLE = font(15)
F_NAME = font(21)
F_SMALL = font(13)
F_PCT = font(15)


# ------------------------------------------------------------------- stage --
def build_bg():
    """Green felt table with a soft key light and a floor band, code-drawn."""
    yy = np.linspace(0.0, 1.0, CH)[:, None]
    top = np.array([27, 104, 71], dtype=float)
    bot = np.array([8, 44, 30], dtype=float)
    bg = top[None, None, :] * (1 - yy[:, :, None]) + bot[None, None, :] * yy[:, :, None]
    bg = np.repeat(bg, CW, axis=1)

    # key light, upper centre
    gy, gx = np.mgrid[0:CH, 0:CW]
    cx, cy = CW * 0.5, CH * 0.34
    d = np.sqrt(((gx - cx) / (CW * 0.75)) ** 2 + ((gy - cy) / (CH * 0.85)) ** 2)
    bg += (np.clip(1.0 - d, 0, 1) ** 2)[:, :, None] * np.array([26, 62, 40])

    # vignette
    vx = (gx - CW / 2) / (CW / 2)
    vy = (gy - CH / 2) / (CH / 2)
    v = np.clip(1.0 - 0.55 * (vx * vx + vy * vy), 0, 1)
    bg *= v[:, :, None]

    im = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    # floor band + lit lip
    fy = FLOOR + PAD
    d.rectangle([0, fy, CW, CH], fill=(0, 0, 0, 46))
    d.rectangle([0, fy - 2, CW, fy], fill=(255, 255, 255, 34))
    d.rectangle([0, fy + 84, CW, CH], fill=(0, 0, 0, 40))
    return im


BG = build_bg()


def slab_fill():
    """Grey slab face, built once."""
    im = Image.new("RGBA", (SLAB_W, SLAB_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in range(SLAB_H):
        k = y / (SLAB_H - 1)
        c = (int(139 - 34 * k), int(148 - 34 * k), int(159 - 33 * k), 255)
        d.line([(0, y), (SLAB_W, y)], fill=c)
    d.rounded_rectangle([0, 0, SLAB_W - 1, SLAB_H - 1], radius=9, outline=(58, 65, 74, 255), width=3)
    d.line([(7, 12), (7, SLAB_H - 14)], fill=(255, 255, 255, 62), width=3)
    for r in range(3):
        for c2 in range(2):
            x = 18 + c2 * 28
            y = 34 + r * 46
            d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(120, 128, 138, 210))
            d.ellipse([x - 4, y - 4, x + 2, y + 2], fill=(196, 202, 210, 150))
    return im


SLAB = slab_fill()

CRACKS = [
    [(4, 70), (22, 88), (10, 106), (30, 122)],
    [(60, 54), (44, 70), (58, 88), (40, 104)],
    [(6, 120), (26, 132), (14, 146), (34, 152)],
    [(58, 112), (42, 128), (56, 140), (40, 152)],
]


def load_sprite(key):
    p = os.path.join(SPRITES, FILE.get(key, key) + "-body.png")
    im = Image.open(p).convert("RGBA")
    r = SPRITE_H / im.height
    return im.resize((max(1, int(im.width * r)), SPRITE_H), Image.LANCZOS)


def measure_reach(sprite):
    """How far the outstretched hands stick out to the right of the bottom-centre
    pivot. Sprites are framed differently, so planting every fighter at the same
    x left the shorter-armed ones short of the slab — the hands are what have to
    land on it, so the offset is measured instead of guessed."""
    a = np.array(sprite.split()[3])
    h, w = a.shape
    band = a[int(h * 0.18):int(h * 0.66), :]
    cols = np.where(band.max(axis=0) > 24)[0]
    tip = int(cols.max()) if len(cols) else w - 1
    return tip - w / 2.0


def draw_puppet(canvas, sprite, pivot_out, sx, sy, deg, shear=0.0, alpha=1.0):
    """Paste `sprite` with its bottom-centre at pivot_out, transformed about it."""
    w, h = sprite.size
    pad = 60
    tile = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    tile.paste(sprite, (pad, pad))
    tw, th = tile.size
    px, py = pad + w / 2.0, pad + h

    a = math.radians(deg)
    m00 = math.cos(a) * sx
    m01 = -math.sin(a) * sy + shear
    m10 = math.sin(a) * sx
    m11 = math.cos(a) * sy
    det = m00 * m11 - m01 * m10
    if abs(det) < 1e-6:
        return
    i00, i01 = m11 / det, -m01 / det
    i10, i11 = -m10 / det, m00 / det
    A, B = i00, i01
    C = px - A * px - B * py
    D, E = i10, i11
    F = py - D * px - E * py
    tile = tile.transform((tw, th), Image.AFFINE, (A, B, C, D, E, F), resample=Image.BICUBIC)
    if alpha < 1.0:
        ch = tile.split()[3].point(lambda v: int(v * alpha))
        tile.putalpha(ch)
    canvas.alpha_composite(tile, (int(round(pivot_out[0] - px)), int(round(pivot_out[1] - py))))


# ------------------------------------------------------------------ motion --
HEAVES = [0.62, 1.34, 2.06]
HDUR = 0.60
BREAK_T = 3.24


def fighter_state(t):
    """-> (dx, sx, sy, deg, impact)  impact is the 0..1 pulse at a heave."""
    dx, sx, sy, deg = 0.0, 1.0, 1.0, 0.0
    impact = 0.0

    # step in behind every heave, by exactly what the slab gave up, so the hands
    # keep landing on the face instead of falling short as the wall walks away
    creep = 0.0
    for th in HEAVES:
        hit = th + HDUR * 0.70
        creep += 11 * ramp(t, hit, hit + 0.22)
    dx += creep

    # settle into the brace
    k = ramp(t, 0.0, 0.55)
    dx = -22 * (1 - k)
    deg = -4 * (1 - k)

    for i, th in enumerate(HEAVES):
        u = (t - th) / HDUR
        if not (0 <= u <= 1):
            continue
        wind = clamp(u / 0.40, 0, 1)
        drive = clamp((u - 0.40) / 0.26, 0, 1)
        back = clamp((u - 0.66) / 0.34, 0, 1)
        dx += -16 * ease(wind) + 34 * ease(drive) - 30 * ease(back)
        deg += -5 * ease(wind) + 8 * ease(drive) - 8 * ease(back)
        sy += 0.05 * ease(wind) - 0.09 * ease(drive) + 0.04 * ease(back)
        sx += -0.03 * ease(wind) + 0.07 * ease(drive) - 0.04 * ease(back)
        if drive > 0 and u < 0.72:
            impact = max(impact, math.sin(math.pi * clamp((u - 0.40) / 0.32, 0, 1)))

    # the big one
    if t >= 2.72:
        wu = ramp(t, 2.72, 2.94)
        dv = ramp(t, 2.94, BREAK_T)
        rc = ramp(t, BREAK_T, DUR)
        dx = -24 * wu + 62 * dv - 46 * rc
        deg = -7 * wu + 10 * dv - 6 * rc
        sy = 1 + 0.06 * wu - 0.12 * dv + 0.07 * rc
        sx = 1 - 0.04 * wu + 0.10 * dv - 0.06 * rc
        impact = max(impact, math.sin(math.pi * clamp((t - 2.94) / 0.30, 0, 1)))
    return dx, sx, sy, deg, impact


def slab_state(t):
    """-> (dx, deg, dy, broken)"""
    dx, deg, dy = 0.0, 0.0, 0.0
    for i, th in enumerate(HEAVES):
        hit = th + HDUR * 0.62
        k = ramp(t, hit, hit + 0.10)
        dx += 11 * k
        deg += 1.6 * k
    if t >= BREAK_T:
        k = ramp(t, BREAK_T, BREAK_T + 0.55)
        dx += 78 * k
        deg += 84 * k
        dy += 26 * k
    return dx, deg, dy


def hud(t):
    pct = 0
    for i, th in enumerate(HEAVES):
        pct = max(pct, int(33 * ramp(t, th + HDUR * 0.40, th + HDUR * 0.64) + i * 33))
    if t >= BREAK_T:
        pct = 100
    return pct


# ---------------------------------------------------------------- particles --
class Dust:
    def __init__(self):
        self.p = []

    def burst(self, x, y, n, power=1.0):
        import random
        for _ in range(n):
            a = random.uniform(-math.pi, 0.35)
            s = random.uniform(60, 220) * power
            self.p.append([x, y, math.cos(a) * s * 0.6,
                           math.sin(a) * s * -0.5 - random.uniform(10, 70),
                           random.uniform(0.35, 0.85), random.uniform(4, 13)])

    def step(self, dt):
        for q in self.p:
            q[0] += q[2] * dt
            q[1] += q[3] * dt
            q[3] += 210 * dt
            q[2] *= 0.985
            q[4] -= dt
        self.p = [q for q in self.p if q[4] > 0]

    def draw(self, canvas):
        for x, y, _vx, _vy, life, r in self.p:
            a = clamp(life * 1.6, 0, 0.62)
            rr = r * (1.35 - life * 0.6)
            d = ImageDraw.Draw(canvas, "RGBA")
            d.ellipse([x - rr, y - rr * 0.8, x + rr, y + rr * 0.8],
                      fill=(226, 214, 190, int(150 * a)))


# -------------------------------------------------------------------- frame --
def render_frame(i, sprite, reach, dust, shake, name):
    t = i / FPS
    canvas = BG.copy()

    sdx, sdeg, sdy = slab_state(t)
    slab_pos = (SLAB_X + sdx + PAD, FLOOR + PAD - SLAB_H - sdy)
    sl = SLAB.rotate(-sdeg, resample=Image.BICUBIC, expand=True)
    if t >= BREAK_T:
        ck = ramp(t, BREAK_T, BREAK_T + 0.34)
        d = ImageDraw.Draw(sl, "RGBA")
        for ci, c in enumerate(CRACKS):
            if ck > ci * 0.22:
                d.line(c, fill=(38, 43, 50, 235), width=3, joint="curve")
    canvas.alpha_composite(sl, (int(slab_pos[0] - sl.width / 2), int(slab_pos[1] - (sl.height - SLAB_H))))

    dust.draw(canvas)

    dx, sx, sy, deg, impact = fighter_state(t)
    # plant the fighter so its measured hand tip sits against the slab face
    fx = SLAB_X + PAD - SLAB_W / 2.0 - 4 - reach + dx

    # onion-skin trails give the drive its speed read
    if dx > 8:
        k = clamp((dx - 8) / 34.0, 0, 1)
        draw_puppet(canvas, sprite, (fx - 30, FLOOR + PAD), sx, sy, deg, alpha=0.09 * k)
        draw_puppet(canvas, sprite, (fx - 15, FLOOR + PAD), sx, sy, deg, alpha=0.18 * k)
    draw_puppet(canvas, sprite, (fx, FLOOR + PAD), sx, sy, deg)

    # impact flash on the slab face
    if impact > 0.05:
        d = ImageDraw.Draw(canvas, "RGBA")
        r = 16 + 22 * impact
        d.ellipse([slab_pos[0] - r, FLOOR + PAD - SLAB_H * 0.58 - r,
                   slab_pos[0] + r, FLOOR + PAD - SLAB_H * 0.58 + r],
                  fill=(255, 248, 222, int(38 * impact)))

    # ---- camera: slow push-in, plus shake ------------------------------------
    z = 1.0 + 0.07 * ramp(t, 0.0, DUR)
    vw, vh = W / z, H / z
    cx = CW / 2 - 26 + shake[0]
    cy = CH / 2 + 16 + shake[1]
    x0 = clamp(cx - vw / 2, 0, CW - vw)
    y0 = clamp(cy - vh / 2, 0, CH - vh)
    frame = canvas.crop((int(x0), int(y0), int(x0 + vw), int(y0 + vh))) \
                  .resize((W, H), Image.LANCZOS).convert("RGB")
    sxf = (fx - x0) * z                      # fighter x in screen space

    d = ImageDraw.Draw(frame, "RGBA")
    pct = hud(t)
    bx, by, bw, bh = 46, 46, 300, 15
    d.text((bx, by - 22), "PUSH POWER", font=F_TITLE, fill=(198, 232, 212, 235))
    d.text((bx + bw - 44, by - 22), "%d%%" % pct, font=F_PCT, fill=(214, 240, 224, 235))
    d.rounded_rectangle([bx - 2, by - 2, bx + bw + 2, by + bh + 2], radius=9,
                        fill=(0, 0, 0, 92))
    if pct > 0:
        d.rounded_rectangle([bx, by, bx + bw * pct / 100.0, by + bh], radius=7,
                            fill=(86, 162, 240, 255) if pct < 100 else (255, 206, 84, 255))
    d.rounded_rectangle([bx + bw * pct / 100.0 - 1, by - 3, bx + bw, by + bh + 1],
                        radius=6, fill=(226, 236, 245, 255))

    # name plate, above the fighter
    tw = d.textlength(name, font=F_NAME)
    px = clamp(sxf - tw / 2 - 16, 18, W - tw - 34)
    py = (FLOOR + PAD - SPRITE_H - 58 - y0) * z
    d.rounded_rectangle([px, py, px + tw + 32, py + 34], radius=17, fill=(250, 248, 240, 245))
    d.text((px + 16, py + 7), name, font=F_NAME, fill=(28, 32, 30, 255))

    d.text((W / 2 - 78, 34), "W A L L   P U S H", font=F_TITLE, fill=(190, 226, 204, 190))

    # cinematic finish
    if t > DUR - 0.5:
        a = int(150 * ramp(t, DUR - 0.5, DUR))
        d.rectangle([0, 0, W, H], fill=(0, 0, 0, a))
    return frame


def build(key, name):
    sprite = load_sprite(key)
    reach = measure_reach(sprite)
    dust = Dust()
    shake = [0.0, 0.0]
    rng = np.random.default_rng(7)

    os.makedirs(OUT, exist_ok=True)
    mp4 = os.path.join(OUT, key + ".mp4")
    cmd = [FFMPEG, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS),
           "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    gif_frames = []
    prev_t = 0.0
    for i in range(NF):
        t = i / FPS
        # events fired between frames
        for th in HEAVES:
            hit = th + HDUR * 0.62
            if prev_t < hit <= t:
                dust.burst(SLAB_X + PAD - SLAB_W / 2 - 6, FLOOR + PAD - SPRITE_H * 0.46, 16, 0.75)
        if prev_t < BREAK_T <= t:
            dust.burst(SLAB_X + PAD, FLOOR + PAD - SLAB_H * 0.45, 54, 1.5)
            dust.burst(SLAB_X + PAD + 60, FLOOR + PAD - 10, 30, 1.1)
        prev_t = t

        _dx, _sx, _sy, _deg, impact = fighter_state(t)
        big = ramp(t, BREAK_T, BREAK_T + 0.18) - ramp(t, BREAK_T + 0.30, BREAK_T + 0.6)
        amp = 7.5 * impact + 11 * big
        if amp > 0.2:
            shake[0] = float(rng.uniform(-amp, amp))
            shake[1] = float(rng.uniform(-amp * 0.6, amp * 0.6))
        else:
            shake[0] *= 0.7
            shake[1] *= 0.7

        f = render_frame(i, sprite, reach, dust, shake, name)
        proc.stdin.write(f.tobytes())
        if i % 2 == 0:                      # gif at half rate
            gif_frames.append(f.resize((560, 315), Image.LANCZOS))
        dust.step(1.0 / FPS)

    proc.stdin.close()
    proc.wait()

    gif = os.path.join(OUT, key + ".gif")
    pal = [g.convert("P", palette=Image.ADAPTIVE, colors=128) for g in gif_frames]
    pal[0].save(gif, save_all=True, append_images=pal[1:], duration=int(1000 / (FPS / 2)),
                loop=0, optimize=True, disposal=2)
    print("%-14s mp4 %6.0f KB   gif %6.0f KB" % (
        key, os.path.getsize(mp4) / 1024, os.path.getsize(gif) / 1024), flush=True)


if __name__ == "__main__":
    only = sys.argv[1:] or None
    for key, name in AVATARS:
        if only and key not in only:
            continue
        build(key, name)
    print("done")
