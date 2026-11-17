#!/usr/bin/env python3
"""Optional: render preview.png (Praat-style view) from terrain.bin/terrain.json. Needs numpy + matplotlib."""
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

here = Path(__file__).resolve().parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent.parent / "public" / "lab" / "voice"
dst = Path(sys.argv[2]) if len(sys.argv) > 2 else here / "preview.png"
m = json.load(open(src / "terrain.json", encoding="utf8"))
F, B, hop, sr = m["frames"], m["bins"], m["hop"], m["sampleRate"]
img = np.frombuffer(open(src / "terrain.bin", "rb").read(), np.uint8).reshape(F, B)
t = np.arange(F) * hop / sr
c = np.array(m["melCenters"])
edges = np.concatenate([[m["fmin"]], (c[1:] + c[:-1]) / 2, [m["fmax"]]])
f0 = np.array(m["f0"]); fm = np.array(m["formants"], float); it = np.array(m["intensity"], float)
dur = m["duration"]

fig = plt.figure(figsize=(12, 6.2), dpi=110)
ax = fig.add_axes([0.07, 0.20, 0.86, 0.74])
tt = np.append(t, t[-1] + hop / sr) - hop / sr / 2
ax.pcolormesh(tt, edges, img.T, cmap="Greys", vmin=0, vmax=255, shading="flat", rasterized=True)
ax.set_ylim(0, 8000); ax.set_xlim(0, dur)
ax.set_ylabel("Frequency (Hz)  [grey = energy; formants red]")
ax.set_xticks([])
for k in range(3):
    v = fm[:, k] > 0
    ax.plot(t[v], fm[v, k], "o", color="#d62728", ms=2.6, mew=0)
ax.plot(t, it / 255 * 8000, color="#9acd32", lw=1.6)
ax2 = ax.twinx(); ax2.set_ylim(0, 400); ax2.set_ylabel("Pitch (Hz)  [blue]", color="#1f5fbf")
p = np.where(f0 > 0, f0, np.nan)
ax2.plot(t, p, color="#1f5fbf", lw=2.2)
ax2.tick_params(axis="y", colors="#1f5fbf")

lab = fig.add_axes([0.07, 0.04, 0.86, 0.15], sharex=ax)
lab.set_xlim(0, dur); lab.set_ylim(0, 2)
for s in ("top", "right", "left"): lab.spines[s].set_visible(False)
lab.set_yticks([]); lab.set_xlabel("Time (s)")
lab.text(-0.005, 1.5, "words", transform=lab.get_yaxis_transform(), ha="right", va="center", fontsize=8)
lab.text(-0.005, 0.5, "phones", transform=lab.get_yaxis_transform(), ha="right", va="center", fontsize=8)
for w in m["words"]:
    for x in (w["start"], w["end"]):
        lab.plot([x, x], [1, 2], color="#444", lw=0.8); ax.axvline(x, color="#444", lw=0.5, ls=":")
    lab.text((w["start"] + w["end"]) / 2, 1.5, w["text"], ha="center", va="center", fontsize=10)
for p_ in m["phones"]:
    for x in (p_["start"], p_["end"]):
        lab.plot([x, x], [0, 1], color="#777", lw=0.6)
    lab.text((p_["start"] + p_["end"]) / 2, 0.5, p_["symbol"], ha="center", va="center", fontsize=8, color="#222")
fig.savefig(dst, facecolor="white")
print("wrote", dst)
