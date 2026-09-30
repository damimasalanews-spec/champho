"""Find the action beats inside the generated clips by frame-difference profile,
so the push / wall-break split is picked from the footage instead of guessed."""
import os
import subprocess

import numpy as np
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
D = r"C:\Users\fanso\AccioWork\2026-09-30-00-27-10-099-37804b95\champho\assets\wallpush"

for name in ("pumpkin-boy.mp4", "ninja.mp4"):
    p = os.path.join(D, name)
    info = subprocess.run([FF, "-i", p], capture_output=True, text=True).stderr
    dur = float(info.split("Duration: ")[1].split(",")[0].split(":")[-1]) + \
        int(info.split("Duration: ")[1].split(":")[1]) * 60
    raw = subprocess.run([FF, "-loglevel", "error", "-i", p, "-f", "rawvideo",
                          "-pix_fmt", "gray", "-s", "192x108", "-"],
                         capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 108, 192).astype(np.float32)
    n = a.shape[0]
    d = np.abs(np.diff(a, axis=0)).mean(axis=(1, 2))
    fps = n / dur

    # biggest sustained changes = impact / collapse beats
    order = np.argsort(d)[::-1]
    peaks = []
    for i in order:
        if all(abs(i - j) > fps * 0.5 for j in peaks):
            peaks.append(int(i))
        if len(peaks) >= 5:
            break
    peaks.sort()

    print("%s  frames=%d  %.2fs  %.1ffps" % (name, n, dur, fps))
    print("  motion profile (per 0.5s):")
    step = max(1, int(fps * 0.5))
    row = "   ".join("%.1fs:%.0f" % (i / fps, d[i:i + step].mean())
                     for i in range(0, n - 1, step))
    print("   " + row)
    print("  top change points: " + ", ".join("%.2fs(%.1f)" % (i / fps, d[i]) for i in peaks))
    print()
