import os
import re
import subprocess

import numpy as np
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
V = "wallpush-video"
KEYS = ["pumpkin-boy", "pumpkin-girl", "knight", "ninja", "pirate", "vampire",
        "wizard", "scholar", "robot", "alien", "genie", "ghost", "yeti"]

print("%-13s %6s %5s %7s %9s %8s" % ("avatar", "frames", "fps", "dur_s", "mean|d|", "KB"))
for k in KEYS:
    p = os.path.join(V, k + ".mp4")
    info = subprocess.run([FF, "-i", p], capture_output=True, text=True).stderr
    fr = [l for l in info.splitlines() if "Stream #0" in l and "Video" in l][0]
    fps = float(re.search(r"([\d.]+) fps", fr).group(1))
    dur = float(re.search(r"Duration: \d+:(\d+):([\d.]+)", info).group(2)) + \
          int(re.search(r"Duration: \d+:(\d+):", info).group(1)) * 60
    raw = subprocess.run([FF, "-loglevel", "error", "-i", p, "-f", "rawvideo",
                          "-pix_fmt", "gray", "-s", "160x90", "-"],
                         capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 90, 160).astype(np.int16)
    md = np.abs(np.diff(a, axis=0)).mean()
    print("%-13s %6d %5.1f %7.2f %9.2f %8.0f" % (
        k, a.shape[0], fps, dur, md, os.path.getsize(p) / 1024))

with open(os.path.join(V, "_reel.txt"), "w") as f:
    for k in KEYS:
        f.write("file '" + k + ".mp4'\n")
subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                "-i", "_reel.txt", "-c", "copy", "all-13-avatars.mp4"], cwd=V, check=True)
r = os.path.join(V, "all-13-avatars.mp4")
print("reel %.0f KB  %.1f s" % (os.path.getsize(r) / 1024, len(KEYS) * 3.9))
