#!/usr/bin/env python3
"""Make the recording sound as if it came over a walkie-talkie, for the page's play button.

    python tools/voice/walkie.py tools/voice/recording.wav

Writes public/lab/voice/voice.wav (16 kHz, mono, 16 bit). Nothing is added to the recording:
no static, no clicks, no tail. Only the voice itself is changed, into something thin, clipped
and digital. The silence at both ends is trimmed the same way make_terrain.py trims it, so the
sound matches the landscape. Only numpy is needed.
"""
import argparse
import wave
from pathlib import Path

import numpy as np

from make_terrain import SR, read_wav, resample, trim_silence

BAND = (480.0, 3200.0)   # what a small radio speaker passes, Hz
DRIVE = 7.0              # how hard the voice is pushed into the clipper
HOLD_HZ = 4400.0         # the voice is re-sampled this coarsely, which gives it a digital ring
BITS = 6                 # and stored this coarsely, which makes it gritty
GATE = 0.06              # anything quieter than this (against the loudest speech) is cut to silence


def band_pass(x, lo, hi, width=120.0):
    """Zero-phase band-pass in the frequency domain, with raised-cosine edges `width` Hz wide."""
    n = len(x)
    spec = np.fft.rfft(x, 2 * n)
    f = np.fft.rfftfreq(2 * n, 1 / SR)
    rise = np.clip((f - (lo - width)) / width, 0, 1)
    fall = np.clip(((hi + width) - f) / width, 0, 1)
    gain = 0.25 * (1 - np.cos(np.pi * rise)) * (1 - np.cos(np.pi * fall))
    return np.fft.irfft(spec * gain)[:n]


def peak_filter(x, centre, q, gain_db):
    """A resonance: the boxy ring of a small speaker cone."""
    n = len(x)
    spec = np.fft.rfft(x, 2 * n)
    f = np.fft.rfftfreq(2 * n, 1 / SR)
    bell = 1 / (1 + ((f - centre) / (centre / (2 * q))) ** 2)
    return np.fft.irfft(spec * (1 + (10 ** (gain_db / 20) - 1) * bell))[:n]


def compress(x, window=0.012):
    """Even out the level the way a radio's automatic gain does, so quiet syllables come up."""
    w = max(1, int(window * SR))
    env = np.sqrt(np.convolve(x * x, np.ones(w) / w, mode="same") + 1e-6)
    env = np.maximum(env, 0.25 * env.max())
    return x / env


def gate(x, like, window=0.02):
    """Silence wherever `like` (the untouched voice) is quiet, with short fades in and out."""
    w = max(1, int(window * SR))
    env = np.sqrt(np.convolve(like * like, np.ones(w) / w, mode="same"))
    open_ = (env > GATE * env.max()).astype(np.float64)
    fade = np.hanning(2 * int(0.006 * SR) + 1)
    return x * np.clip(np.convolve(open_, fade / fade.sum(), mode="same"), 0, 1)


def walkie(x):
    v = np.append(x[0], x[1:] - 0.7 * x[:-1])      # tilt toward the highs: thin and nasal
    v = band_pass(v, *BAND)
    v = compress(v)
    v = v / np.abs(v).max()
    v = np.tanh(DRIVE * v) / np.tanh(DRIVE)          # overdriven, flat-topped
    v = peak_filter(v, 1700.0, 2.2, 5.0)
    v = band_pass(v, *BAND)                          # take the clipper's fizz back off
    v = v / np.abs(v).max()

    # Sample and hold: each value is kept for a few samples, as a cheap digital radio would.
    # What folds back down is not in tune with the voice, and that is the electronic sound.
    held = v[np.floor(np.floor(np.arange(len(v)) * HOLD_HZ / SR) * SR / HOLD_HZ).astype(int)]
    levels = 2 ** (BITS - 1)
    held = np.round(held * levels) / levels
    v = band_pass(held, 300.0, 5200.0, width=200.0)  # keep the grit, drop the harshest of it

    v = gate(v, x)
    fade = int(0.004 * SR)
    v[:fade] *= np.linspace(0, 1, fade)
    v[-fade:] *= np.linspace(1, 0, fade)
    return 0.92 * v / np.abs(v).max()


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav", nargs="?", default=str(here / "recording.wav"))
    ap.add_argument("--out", default=str(here.parent.parent / "public" / "lab" / "voice" / "voice.wav"))
    a = ap.parse_args()

    x, sr = read_wav(a.wav)
    x = resample(x - x.mean(), sr, SR)
    x = x / np.abs(x).max() * 0.9
    x, _ = trim_silence(x)
    y = walkie(x)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.round(y * 32767).astype("<i2").tobytes())
    print(f"{len(y) / SR:.2f}s -> {out}")


if __name__ == "__main__":
    main()
