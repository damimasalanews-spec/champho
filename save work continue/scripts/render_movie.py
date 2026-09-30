"""
Wall Push - the movie cut.

Unlike the earlier clip, the fighter is NOT translated around as a rigid picture.
Its pixels are warped by a displacement field driven by movers planted on the
real joints (hand, elbow, shoulder, hip, knees, feet), so the arms actually
extend on the shove, the knees drive, and the front leg genuinely swings up and
kicks the wall. Rigid body motion (travel, lean, squash) rides on top.

Everything is drawn from scratch: the arena, the wall, the cracks, the debris,
the camera. Frames are piped straight into ffmpeg.
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
OUT = os.path.join(ROOT, "wallpush-movie")

W, H = 1280, 720
BAR = 58                      # cinematic letterbox
FPS = 30
DUR = 6.20
NF = int(DUR * FPS)
FLOOR = 596
FIG_H = 340                   # fighter height on stage
WALL_X = 900                  # wall centre
WALL_W, WALL_H = 168, 372

FILE = {"pumpkin-boy": "boy", "pumpkin-girl": "girl"}
AVATARS = [
    ("pumpkin-boy", "PUMPKIN BOY"), ("pumpkin-girl", "PUMPKIN GIRL"),
    ("knight", "SIR GOURD"), ("ninja", "SHADOW SQUASH"),
    ("pirate", "CAPTAIN GOURD"), ("vampire", "BARON VINE"),
    ("wizard", "WIZARD ZUCC"), ("scholar", "PROFESSOR PIP"),
    ("robot", "UNIT BLIP"), ("alien", "ZOG"),
    ("genie", "DJINN"), ("ghost", "CHEEKY BOO"), ("yeti", "YETI"),
]

T_BRACE = 1.30
SHOVES = [1.78, 2.36, 2.94]
SH_DUR = 0.50
T_WIND = 3.44
T_KICK = 3.86
T_HIT = 4.30
T_BREAK = 4.62
T_FADE = DUR - 0.55


def ease(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def ramp(t, a, b):
    if b <= a:
        return 1.0 if t >= b else 0.0
    return ease((t - a) / (b - a))


def pulse(t, a, b):
    """0 -> 1 -> 0 across a..b"""
    if not a <= t <= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a))


def clamp(v, a, b):
    return max(a, min(b, v))


def font(sz, bold=True):
    for n in (["seguisb.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        p = os.path.join(r"C:\Windows\Fonts", n)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


F_NAME = font(20)
F_TAG = font(12)
F_BIG = font(40)


# --------------------------------------------------------------- the arena --
def build_arena():
    yy = np.linspace(0.0, 1.0, H)[:, None]
    top = np.array([26, 40, 58], float)
    bot = np.array([7, 13, 21], float)
    a = top[None, None, :] * (1 - yy[:, :, None]) + bot[None, None, :] * yy[:, :, None]
    a = np.repeat(a, W, axis=1)
    gy, gx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((gx - W * 0.52) / (W * 0.62)) ** 2 + ((gy - H * 0.30) / (H * 0.72)) ** 2)
    a += (np.clip(1 - d, 0, 1) ** 2)[:, :, None] * np.array([46, 58, 74])
    vx = (gx - W / 2) / (W / 2)
    vy = (gy - H / 2) / (H / 2)
    a *= np.clip(1 - 0.62 * (vx * vx + vy * vy), 0, 1)[:, :, None]
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    # floor: receding bands, lit toward the camera
    for i in range(84):
        y = FLOOR + i
        k = i / 84.0
        c = int(30 - 16 * k)
        d.line([(0, y), (W, y)], fill=(c, c + 6, c + 12, 255))
    d.rectangle([0, FLOOR - 3, W, FLOOR], fill=(120, 140, 168, 60))
    # a cold backlight pool behind the wall
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    dl.ellipse([WALL_X - 300, FLOOR - 430, WALL_X + 300, FLOOR + 30], fill=(96, 132, 190, 40))
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(70)))
    return im


ARENA = build_arena()


def build_wall():
    im = Image.new("RGBA", (WALL_W, WALL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in range(WALL_H):
        k = y / (WALL_H - 1)
        c = (int(122 - 46 * k), int(132 - 46 * k), int(146 - 46 * k), 255)
        d.line([(0, y), (WALL_W, y)], fill=c)
    # masonry courses so it reads as a wall, not a card
    for r in range(6):
        y = 10 + r * (WALL_H - 20) / 6.0
        d.line([(6, y), (WALL_W - 6, y)], fill=(58, 64, 76, 150), width=3)
        off = 0 if r % 2 == 0 else WALL_W * 0.28
        for c2 in range(2):
            x = 22 + off + c2 * WALL_W * 0.5
            if 12 < x < WALL_W - 12:
                d.line([(x, y), (x, y + (WALL_H - 20) / 6.0)], fill=(58, 64, 76, 130), width=3)
    d.rounded_rectangle([0, 0, WALL_W - 1, WALL_H - 1], radius=10, outline=(38, 44, 54, 255), width=4)
    d.line([(10, 16), (10, WALL_H - 20)], fill=(255, 255, 255, 46), width=4)
    return im


WALL = build_wall()

CRACKS = [
    [(46, 128), (78, 168), (58, 206), (92, 244), (66, 282)],
    [(132, 96), (108, 142), (140, 186), (112, 228)],
    [(64, 250), (96, 274), (74, 306), (104, 330)],
    [(140, 226), (114, 262), (146, 296), (120, 330)],
    [(86, 60), (110, 84), (96, 112)],
]

SHARD = [(0, 0, 96, 96), (96, 0, 168, 110), (0, 96, 104, 210),
         (104, 110, 168, 232), (0, 210, 112, 300), (112, 232, 168, 372)]


# --------------------------------------------------------------- the sprite --
def load_sprite(key):
    im = Image.open(os.path.join(SPRITES, FILE.get(key, key) + "-body.png")).convert("RGBA")
    r = FIG_H / im.height
    return im.resize((max(1, int(im.width * r)), FIG_H), Image.LANCZOS)


def anchors(sprite):
    """Plant the mover joints on the drawing's real anatomy, read off the alpha."""
    a = np.array(sprite.split()[3])
    h, w = a.shape
    ys, xs = np.nonzero(a > 24)

    band = (ys > 0.16 * h) & (ys < 0.68 * h)
    bx, by = xs[band], ys[band]
    mx = bx.max()
    sel = bx > mx - 0.06 * w
    hand = (bx[sel].mean() / w, by[sel].mean() / h)

    low = ys > 0.84 * h
    lx, ly = xs[low], ys[low]
    fr = lx.max()
    fs = lx > fr - 0.16 * w
    footF = (lx[fs].mean() / w, ly[fs].mean() / h)
    bl = lx.min()
    bs = lx < bl + 0.16 * w
    footB = (lx[bs].mean() / w, ly[bs].mean() / h)

    top = ys < 0.22 * h
    head = (xs[top].mean() / w, ys[top].mean() / h)

    def mid(p, q, k=0.5):
        return (p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)

    hip = (0.50, 0.60)
    shoulder = (0.55, 0.32)
    # radii sized to the limb each mover has to carry. Too tight and the tip of a
    # limb sits on the zero edge of the falloff and barely moves at all.
    m = {
        "head": (head, 0.24),
        "torso": ((0.46, 0.44), 0.26),
        "hip": (hip, 0.20),
        "shoulder": (shoulder, 0.17),
        "elbow": (mid(shoulder, hand, 0.52), 0.18),
        "hand": (hand, 0.18),
        "kneeF": (mid(hip, footF, 0.55), 0.19),
        "footF": (footF, 0.17),
        "kneeB": (mid(hip, footB, 0.55), 0.18),
        "footB": (footB, 0.16),
    }
    return m


def falloff(d, r):
    """Plateau + skirt: full weight through the core of the mover's limb, easing to
    zero at the radius. A pure cone-to-zero falloff left the limb TIPS on the zero
    edge, so the foot barely moved and the kick could never reach the wall."""
    u = np.clip((d - 0.5 * r) / (0.5 * r), 0.0, 1.0)
    return 1.0 - u * u * (3 - 2 * u)


def build_fields(sprite, movers, pad):
    """Precompute each mover's falloff weight over the padded sprite, once."""
    w, h = sprite.size
    yy, xx = np.mgrid[0:h + 2 * pad, 0:w + 2 * pad]
    fields = {}
    for name, val in movers.items():
        if name.startswith("_"):
            continue
        uv, r = val
        cx = uv[0] * w + pad
        cy = uv[1] * h + pad
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        fields[name] = falloff(d, r * h)
    return fields


def rot_about(p, pivot, deg):
    """Screen coords, y down: a NEGATIVE angle swings a downward-pointing limb
    toward +x (forward)."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    dx, dy = p[0] - pivot[0], p[1] - pivot[1]
    return (pivot[0] + c * dx - s * dy, pivot[1] + s * dx + c * dy)


def pose(t, A):
    """Rigid travel + lean, and the per-joint displacement field (in H units)."""
    mv = {k: [0.0, 0.0] for k in
          ("head", "torso", "hip", "shoulder", "elbow", "hand",
           "kneeF", "footF", "kneeB", "footB")}
    tx, ty, rot, sx, sy = 0.0, 0.0, 0.0, 1.0, 1.0

    def px(nm):
        uv = A[nm][0]
        return (uv[0] * A["_w"], uv[1] * A["_h"])

    hip, kneeF, footF = px("hip"), px("kneeF"), px("footF")
    leg_theta, shin_theta = 0.0, 0.0

    # 1. travel in from off-stage, then plant
    if t < T_BRACE:
        k = ramp(t, 0.10, T_BRACE)
        tx = -620 * (1 - k)
        rot = -7 * (1 - k)
        sy = 1 + 0.03 * (1 - k)
    # step in behind each shove by exactly what the wall gave up, so the hands
    # keep landing on the face instead of falling short as the wall walks away
    for th in SHOVES:
        hit = th + SH_DUR * 0.64
        tx += 9 * ramp(t, hit, hit + 0.09)
    # 2. three shoves
    for i, th in enumerate(SHOVES):
        u = (t - th) / SH_DUR
        if not 0 <= u <= 1:
            continue
        wnd = clamp(u / 0.38, 0, 1)
        drv = clamp((u - 0.38) / 0.26, 0, 1)
        bck = clamp((u - 0.64) / 0.36, 0, 1)
        aw, ad, ab = ease(wnd), ease(drv), ease(bck)
        mv["hand"][0] += -0.050 * aw + 0.115 * ad - 0.105 * ab
        mv["hand"][1] += 0.012 * aw - 0.010 * ad + 0.006 * ab
        mv["elbow"][0] += -0.028 * aw + 0.060 * ad - 0.055 * ab
        mv["shoulder"][0] += -0.016 * aw + 0.032 * ad - 0.030 * ab
        mv["torso"][0] += -0.020 * aw + 0.038 * ad - 0.036 * ab
        mv["torso"][1] += 0.006 * aw - 0.004 * ad + 0.003 * ab
        mv["hip"][0] += -0.010 * aw + 0.020 * ad - 0.019 * ab
        mv["hip"][1] += 0.007 * aw - 0.005 * ad + 0.004 * ab
        mv["head"][0] += -0.016 * aw + 0.028 * ad - 0.026 * ab
        mv["head"][1] += 0.008 * aw - 0.006 * ad + 0.004 * ab
        tx += 7 * ease(clamp((u - 0.66) / 0.34, 0, 1))
        sy += 0.035 * aw - 0.055 * ad + 0.030 * ab
        sx += -0.020 * aw + 0.045 * ad - 0.028 * ab
    # 3. wind-up before the kick
    if t >= T_WIND:
        k = ramp(t, T_WIND, T_KICK)
        leg_theta += 9.0 * k              # leg draws back, heel cocked
        shin_theta += 14.0 * k
        mv["hip"][1] += 0.020 * k
        mv["torso"][1] += 0.016 * k
        # hands come off the wall and the body steps IN, so the leg has almost no
        # ground to make up when it swings
        mv["hand"][0] += -0.140 * k
        mv["elbow"][0] += -0.070 * k
        rot += -2.4 * k
        tx += 46 * k
        sy += 0.030 * k
        sx -= 0.022 * k
    # 4. the kick: front leg swings up and out
    if t >= T_KICK:
        k = ramp(t, T_KICK, T_HIT)
        rk = ramp(t, T_HIT, T_HIT + 0.42)
        sw = k - rk
        # swing the whole leg about the hip and snap the shin straight, instead of
        # dragging the foot sideways — dragging sheared the leg into a thin strand
        leg_theta += -23.0 * sw
        shin_theta += -13.0 * sw
        mv["hip"][0] += 0.036 * sw
        mv["hip"][1] += -0.014 * sw
        mv["torso"][0] += 0.040 * sw
        mv["torso"][1] += -0.030 * sw
        # arms stay tucked back while the leg drives
        mv["hand"][0] += -0.100 * sw
        mv["hand"][1] += -0.030 * sw
        mv["elbow"][0] += -0.050 * sw
        mv["head"][0] += 0.014 * sw
        mv["head"][1] += -0.012 * sw
        rot += 4.0 * sw
        tx += 34 * sw
        sy -= 0.030 * sw
        sx += 0.035 * sw
    # 5. settle after the wall goes
    if t >= T_BREAK:
        k = ramp(t, T_BREAK, DUR)
        rot -= 3.0 * k
        tx -= 18 * k
        ty += 4 * k
        sy -= 0.02 * k

    # forward kinematics for the kicking leg: the knee swings with the thigh about
    # the hip, then the shin swings about the moved knee. Rigid arcs, so the leg
    # keeps its shape instead of being stretched between two points.
    if leg_theta or shin_theta:
        kf = rot_about(kneeF, hip, leg_theta)
        ff = rot_about(rot_about(footF, hip, leg_theta), kf, shin_theta)
        mv["kneeF"][0] += (kf[0] - kneeF[0]) / FIG_H
        mv["kneeF"][1] += (kf[1] - kneeF[1]) / FIG_H
        mv["footF"][0] += (ff[0] - footF[0]) / FIG_H
        mv["footF"][1] += (ff[1] - footF[1]) / FIG_H
    return mv, tx, ty, rot, sx, sy


def warp(src, fld, mv, Hs):
    """Inverse-map the sprite through the summed displacement field."""
    h, w = src.shape[:2]
    dx = np.zeros((h, w), np.float32)
    dy = np.zeros((h, w), np.float32)
    wsum = np.zeros((h, w), np.float32)
    # normalised blend, so a joint shared by two movers lands between them instead
    # of being thrown by both at once. Safe now that the plateau keeps a limb's own
    # core at full weight.
    for name, f in fld.items():
        d = mv[name]
        wsum += f
        if d[0] == 0.0 and d[1] == 0.0:
            continue
        dx += f * (d[0] * Hs)
        dy += f * (d[1] * Hs)
    ws = np.maximum(wsum, 1.0)
    dx /= ws
    dy /= ws

    yy, xx = np.mgrid[0:h, 0:w]
    sx = xx - dx
    sy = yy - dy
    x0 = np.floor(sx).astype(np.int32)
    y0 = np.floor(sy).astype(np.int32)
    fx = (sx - x0)[..., None]
    fy = (sy - y0)[..., None]
    x0c = np.clip(x0, 0, w - 1)
    y0c = np.clip(y0, 0, h - 1)
    x1c = np.clip(x0 + 1, 0, w - 1)
    y1c = np.clip(y0 + 1, 0, h - 1)
    s = src.astype(np.float32)
    a = s[..., 3:4] / 255.0
    pm = np.concatenate([s[..., :3] * a, s[..., 3:4]], axis=2)   # premultiplied
    out = (pm[y0c, x0c] * (1 - fx) * (1 - fy) + pm[y0c, x1c] * fx * (1 - fy) +
           pm[y1c, x0c] * (1 - fx) * fy + pm[y1c, x1c] * fx * fy)
    al = out[..., 3:4] / 255.0
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0.0)
    return np.clip(rgb, 0, 255), np.clip(out[..., 3], 0, 255)


def pad_sprite(sprite, pad):
    """The warp works in padded coordinates so displaced limbs never clip the edge."""
    h, w = sprite.height, sprite.width
    out = np.zeros((h + 2 * pad, w + 2 * pad, 4), np.float32)
    out[pad:pad + h, pad:pad + w] = np.array(sprite, np.float32)
    return out


# ---------------------------------------------------------------- particles --
class Bits:
    def __init__(self):
        self.p = []

    def burst(self, x, y, n, pw=1.0, spread=1.0):
        rng = np.random.default_rng(int(x * 13 + y * 7) % 99991)
        for _ in range(n):
            a = rng.uniform(-math.pi * 0.95, 0.25)
            s = rng.uniform(70, 330) * pw
            self.p.append([x, y, math.cos(a) * s * spread, math.sin(a) * s - rng.uniform(20, 120),
                           rng.uniform(0.4, 1.1), rng.uniform(3, 14), rng.uniform(0.0, 1.0)])

    def step(self, dt):
        for q in self.p:
            q[0] += q[2] * dt
            q[1] += q[3] * dt
            q[3] += 260 * dt
            q[2] *= 0.984
            q[4] -= dt
        self.p = [q for q in self.p if q[4] > 0]

    def draw(self, rgb, gy, gx):
        for x, y, _vx, _vy, life, r, tone in self.p:
            a = clamp(life * 1.3, 0, 0.7)
            rr = r * (1.5 - life * 0.8)
            x0, x1 = int(max(0, x - rr)), int(min(W, x + rr))
            y0, y1 = int(max(0, y - rr)), int(min(H, y + rr))
            if x0 >= x1 or y0 >= y1:
                continue
            m = ((gx[y0:y1, x0:x1] - x) ** 2 + (gy[y0:y1, x0:x1] - y) ** 2) < rr * rr
            col = np.array([214, 202, 178]) if tone < 0.6 else np.array([150, 142, 128])
            rgb[y0:y1, x0:x1][m] = rgb[y0:y1, x0:x1][m] * (1 - a) + col * a


# ------------------------------------------------------------------- render --
SHOW_TITLE = True          # off when rendering a single frame for image-to-video
HAND_PEAK = 0.115          # how far the drive throws the hand, in H units
HAND_TAKEUP = 6            # px of take-up so the drive lands ON the face, not short


def render(i, sprite, sp_arr, movers, fld, pad, reach, name, bits, cam):
    t = i / FPS
    rgb = np.array(ARENA.convert("RGB"), np.float32)
    gy, gx = np.mgrid[0:H, 0:W]

    # ---- camera: track the action, punch in on the kick
    tz = 1.0 + 0.05 * ramp(t, 0, DUR) + 0.10 * pulse(t, T_HIT - 0.06, T_HIT + 0.30)
    cam[0] = cam[0] * 0.88 + (0 - 12 * ramp(t, T_HIT, T_BREAK)) * 0.12
    cam[1] = cam[1] * 0.85
    z = tz

    # ---- wall
    wall_dx, wall_rot, wall_dy = 0.0, 0.0, 0.0
    for th in SHOVES:
        hit = th + SH_DUR * 0.64
        wall_dx += 9 * ramp(t, hit, hit + 0.09)
    hit_k = ramp(t, T_HIT, T_HIT + 0.10)
    wall_dx += 22 * hit_k
    if t >= T_BREAK:
        bk = ramp(t, T_BREAK, T_BREAK + 0.70)
        wall_dx += 150 * bk
        wall_rot += 76 * bk
        wall_dy += 40 * bk

    wl = WALL.rotate(-wall_rot, resample=Image.BICUBIC, expand=True)
    if t > T_HIT - 0.10:
        ck = ramp(t, T_HIT - 0.10, T_HIT + 0.55)
        d = ImageDraw.Draw(wl, "RGBA")
        for ci, c in enumerate(CRACKS):
            if ck > ci * 0.17:
                d.line(c, fill=(24, 28, 36, 240), width=4, joint="curve")
                d.line(c, fill=(120, 128, 140, 90), width=1, joint="curve")
    wx = WALL_X + wall_dx
    wy = FLOOR - WALL_H - wall_dy
    wall_img = np.array(wl, np.float32)
    x0 = int(wx - wl.width / 2)
    y0 = int(wy - (wl.height - WALL_H))
    _blit(rgb, wall_img, x0, y0)

    # shards once it breaks
    if t >= T_BREAK:
        bkk = ramp(t, T_BREAK, T_BREAK + 0.85)
        for si, (sx0, sy0, sx1, sy1) in enumerate(SHARD):
            sub = WALL.crop((sx0, sy0, sx1, sy1))
            ang = (si - 2.5) * 26 * bkk
            s = sub.rotate(-ang, resample=Image.BICUBIC, expand=True)
            fx_ = wx + (sx0 + sx1) / 2 - WALL_W / 2 + (si - 2.5) * 46 * bkk
            fy_ = FLOOR - WALL_H + (sy0 + sy1) / 2 + 210 * bkk * bkk
            _blit(rgb, np.array(s, np.float32), int(fx_ - s.width / 2), int(fy_ - s.height / 2))

    bits.draw(rgb, gy, gx)

    # ---- fighter
    mv, tx, ty, rot, sx, sy = pose(t, movers)
    warped_rgb, warped_a = warp(sp_arr, fld, mv, FIG_H)
    fig = np.concatenate([warped_rgb, warped_a[..., None]], axis=2)
    tile = Image.fromarray(fig.astype(np.uint8), "RGBA")

    # rigid transform about the feet, then place the hand on the wall face
    tw, th = tile.size
    px, py = pad + sprite.width / 2.0, pad + sprite.height
    ang = math.radians(rot)
    m00, m01 = math.cos(ang) * sx, -math.sin(ang) * sy
    m10, m11 = math.sin(ang) * sx, math.cos(ang) * sy
    det = m00 * m11 - m01 * m10
    i00, i01 = m11 / det, -m01 / det
    i10, i11 = -m10 / det, m00 / det
    A, B = i00, i01
    C = px - A * px - B * py
    D, E = i10, i11
    F = py - D * px - E * py
    tile = tile.transform((tw, th), Image.AFFINE, (A, B, C, D, E, F), resample=Image.BICUBIC)

    # park the fighter a full drive short of the wall, so the hands meet the face
    # exactly at each impact and pull clear during every wind-up
    # +6, tuned against the measured peak: the plateau falloff now delivers nearly
    # the full authored drive to the hand, so only a few px of take-up are needed
    fx = WALL_X - WALL_W / 2 + HAND_TAKEUP - reach - HAND_PEAK * FIG_H + tx + pad
    fy = FLOOR + pad + ty
    _blit(rgb, np.array(tile, np.float32), int(fx - px), int(fy - py))

    # ---- camera transform
    cx = W / 2 + cam[0]
    cy = H / 2 + cam[1]
    yy, xx = np.mgrid[0:H, 0:W]
    mx = (xx - cx) / z + cx
    my = (yy - cy) / z + cy
    mx = np.clip(mx, 0, W - 1).astype(np.int32)
    my = np.clip(my, 0, H - 1).astype(np.int32)
    frame = rgb[my, mx]

    # ---- grading, letterbox, titles
    img = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, 0, W, BAR], fill=(4, 6, 9, 255))
    d.rectangle([0, H - BAR, W, H], fill=(4, 6, 9, 255))

    a = ramp(t, 0.55, 1.25) * (1 - ramp(t, 2.1, 2.7))
    if SHOW_TITLE and a > 0.02:
        tw_ = d.textlength("WALL PUSH", font=F_BIG)
        d.text((W / 2 - tw_ / 2, H / 2 - 120), "WALL PUSH", font=F_BIG,
               fill=(236, 240, 246, int(220 * a)))
        d.line([(W / 2 - 90, H / 2 - 62), (W / 2 + 90, H / 2 - 62)],
               fill=(220, 96, 72, int(200 * a)), width=3)

    d.text((44, BAR + 26), name, font=F_NAME, fill=(232, 238, 244, 236))
    d.line([(44, BAR + 54), (44 + d.textlength(name, font=F_NAME), BAR + 54)],
           fill=(220, 96, 72, 220), width=3)
    d.text((44, BAR + 62), "WALL PUSH  ·  ROUND 1", font=F_TAG, fill=(150, 164, 180, 220))

    if t > T_FADE:
        d.rectangle([0, 0, W, H], fill=(0, 0, 0, int(205 * ramp(t, T_FADE, DUR))))
    return img


def _blit(rgb, img, x0, y0):
    """Alpha-composite an RGBA float array onto the RGB stage at (x0, y0)."""
    ih, iw = img.shape[:2]
    x1, y1 = x0 + iw, y0 + ih
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1, sy1 = iw - max(0, x1 - W), ih - max(0, y1 - H)
    dx0, dy0 = max(0, x0), max(0, y0)
    dx1, dy1 = dx0 + (sx1 - sx0), dy0 + (sy1 - sy0)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    src = img[sy0:sy1, sx0:sx1]
    a = (src[..., 3:4] / 255.0)
    dst = rgb[dy0:dy1, dx0:dx1]
    rgb[dy0:dy1, dx0:dx1] = dst * (1 - a) + src[..., :3] * a


def build(key, name):
    sprite = load_sprite(key)
    movers = anchors(sprite)
    movers["_w"] = float(sprite.width)
    movers["_h"] = float(sprite.height)
    pad = 110
    fld = build_fields(sprite, movers, pad)
    sp_arr = pad_sprite(sprite, pad)
    reach = movers["hand"][0][0] * sprite.width - sprite.width / 2 + pad

    os.makedirs(OUT, exist_ok=True)
    mp4 = os.path.join(OUT, key + ".mp4")
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-", "-an",
           "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    bits = Bits()
    cam = [0.0, 0.0]
    prev = 0.0
    gif = []
    for i in range(NF):
        t = i / FPS
        for th in SHOVES:
            h_ = th + SH_DUR * 0.64
            if prev < h_ <= t:
                bits.burst(WALL_X - WALL_W / 2 - 4, FLOOR - FIG_H * 0.46, 22, 0.8)
        if prev < T_HIT <= t:
            bits.burst(WALL_X - WALL_W / 2 - 2, FLOOR - FIG_H * 0.30, 46, 1.35)
        if prev < T_BREAK <= t:
            bits.burst(WALL_X, FLOOR - WALL_H * 0.5, 70, 1.7)
            bits.burst(WALL_X + 40, FLOOR - 20, 40, 1.2)
        prev = t
        f = render(i, sprite, sp_arr, movers, fld, pad, reach, name, bits, cam)
        proc.stdin.write(f.tobytes())
        if i % 2 == 0:
            gif.append(f.resize((640, 360), Image.LANCZOS))
        bits.step(1.0 / FPS)

    proc.stdin.close()
    proc.wait()
    g = os.path.join(OUT, key + ".gif")
    pal = [x.convert("P", palette=Image.ADAPTIVE, colors=128) for x in gif]
    pal[0].save(g, save_all=True, append_images=pal[1:], duration=int(1000 / (FPS / 2)),
                loop=0, optimize=True, disposal=2)
    print("%-13s mp4 %5.0f KB  gif %5.0f KB" % (
        key, os.path.getsize(mp4) / 1024, os.path.getsize(g) / 1024), flush=True)


if __name__ == "__main__":
    only = sys.argv[1:] or None
    for k, n in AVATARS:
        if only and k not in only:
            continue
        build(k, n)
    print("done")
