#!/usr/bin/env python3
"""Turn a WAV recording into the files the spectrogram-terrain web page loads.

    python tools/voice/make_terrain.py utterance.wav [--align utterance.align.json] [--out public/lab/voice]

Needs only numpy and the standard library. Writes terrain.bin and terrain.json.
"""
import argparse
import json
import math
import sys
import wave
from pathlib import Path

import numpy as np

SR = 16000
WIN = 512
HOP = 80
NFFT = 2048           # zero-padded FFT so that the narrow low mel filters are never empty
BINS = 128
FMIN, FMAX = 50.0, 8000.0
DB_RANGE = 70.0
PAD = 0.060           # seconds of silence kept around the speech

# The page lays its story out on a fixed number of time frames: speech starts at
# LAYOUT[0], the longest pause in the sentence (the plain between the two
# ranges) runs from LAYOUT[1] to LAYOUT[2], and speech ends at LAYOUT[3]. Any
# recording is fitted to that, so the camera's path never needs retiming.
FRAMES_OUT = 353
LAYOUT = (11, 158, 228, 342)
HEADROOM = 12.0       # dB between the level of the louder speech and the top of the height scale
GAMMA = 2.2           # energy -> height on the page; "quiet" is judged on the same scale
QUIET = 0.05          # a frame whose tallest point is below this (0..1) is flat ground
# Mel bands the camera's lane may use in the first and in the second range (band 0 is the lowest
# frequency, drawn at the bottom of the figure and to the right of the flight).
LANE_FIRST = (45, BINS - 12)
LANE_SECOND = (30, 84)


# ---------------------------------------------------------------- audio I/O
def read_wav(path):
    with wave.open(str(path), "rb") as w:
        ch, width, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float64) - 128) / 128
    elif width == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float64) / 32768
    elif width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v & 0x800000, v - (1 << 24), v)
        x = v.astype(np.float64) / (1 << 23)
    elif width == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float64) / (1 << 31)
    else:
        sys.exit(f"unsupported sample width {width}")
    return x.reshape(-1, ch).mean(axis=1), sr


def resample(x, sr_in, sr_out):
    """Windowed-sinc low-pass (only when downsampling) followed by linear interpolation."""
    if sr_in == sr_out:
        return x
    if sr_out < sr_in:
        fc = 0.45 * sr_out / sr_in                     # cycles per input sample
        m = 128
        t = np.arange(-m, m + 1)
        h = 2 * fc * np.sinc(2 * fc * t) * np.kaiser(2 * m + 1, 8.0)
        x = np.convolve(x, h / h.sum(), mode="same")
    n_out = int(round(len(x) * sr_out / sr_in))
    pos = np.arange(n_out) * sr_in / sr_out
    return np.interp(pos, np.arange(len(x)), x)


def trim_silence(x):
    """Return (trimmed, seconds_removed_from_start). Keeps PAD seconds around the speech."""
    frame = int(0.010 * SR)
    n = len(x) // frame
    if n == 0:
        return x, 0.0
    fr = x[: n * frame].reshape(n, frame)
    rms = (fr - fr.mean(axis=1, keepdims=True)).std(axis=1)    # per-frame, so DC offset does not count
    db = 20 * np.log10(rms + 1e-9)
    thr = max(db.max() - 40.0, -75.0)
    idx = np.nonzero(db > thr)[0]
    if len(idx) == 0:
        return x, 0.0
    pad = int(PAD * SR)
    a = max(0, idx[0] * frame - pad)
    b = min(len(x), (idx[-1] + 1) * frame + pad)
    return x[a:b], a / SR


# ---------------------------------------------------------------- spectrogram
def frame_signal(x, size):
    """Frames of `size` samples centred on 0, HOP, 2*HOP, ... (padded at the edges)."""
    n_frames = len(x) // HOP + 1
    xp = np.pad(x, (size // 2, size // 2 + HOP), mode="constant")
    idx = np.arange(size)[None, :] + HOP * np.arange(n_frames)[:, None]
    return xp[idx]


def mel(f):
    return 2595.0 * np.log10(1.0 + np.asarray(f) / 700.0)


def imel(m):
    return 700.0 * (10.0 ** (np.asarray(m) / 2595.0) - 1.0)


def mel_filterbank():
    edges = imel(np.linspace(mel(FMIN), mel(FMAX), BINS + 2))
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    fb = np.zeros((BINS, len(freqs)))
    for i in range(BINS):
        lo, c, hi = edges[i], edges[i + 1], edges[i + 2]
        up = (freqs - lo) / (c - lo)
        dn = (hi - freqs) / (hi - c)
        fb[i] = np.clip(np.minimum(up, dn), 0, None)
        s = fb[i].sum()
        fb[i] = fb[i] / s if s > 0 else 0
    return fb, edges[1:-1]


def log_mel(x):
    xe = np.append(x[0], x[1:] - 0.97 * x[:-1])         # pre-emphasis, lifts the high frequencies
    fr = frame_signal(xe, WIN) * np.hanning(WIN + 1)[:-1]
    spec = np.abs(np.fft.rfft(fr, NFFT)) ** 2
    fb, centers = mel_filterbank()
    db = 10 * np.log10(spec @ fb.T + 1e-10)
    peak = db.max()
    # Levelling: a real voice has a few bursts (an "s", the first vowel) far above the rest, and
    # scaling to the loudest cell would leave most of the land as low foothills. So the top of the
    # scale sits HEADROOM above the level the louder speech reaches, and the bursts above it are
    # eased over with a soft knee instead of being cut flat.
    first = np.clip((db - (peak - DB_RANGE)) / DB_RANGE, 0, 1)
    speech = (first ** GAMMA).max(axis=1) >= QUIET
    top = peak
    if speech.any():
        top = min(peak, np.percentile(db[speech], 97) + HEADROOM)
    e = np.clip((db - (top - DB_RANGE)) / DB_RANGE, 0, None)
    if top < peak:
        knee = 0.85
        over = e > knee
        e[over] = knee + (1 - knee) * np.tanh((e[over] - knee) / (1 - knee))
    return np.round(np.clip(e, 0, 1) * 255).astype(np.uint8), centers


def intensity(x):
    w = np.hanning(WIN + 1)[:-1]
    fr = frame_signal(x, WIN) * w
    rms = np.sqrt((fr ** 2).sum(axis=1) / (w ** 2).sum())
    db = 20 * np.log10(rms + 1e-9)
    db = np.clip(db, db.max() - DB_RANGE, None)
    return db, np.round((db - db.min()) / (db.max() - db.min()) * 255).astype(int)


# ---------------------------------------------------------------- pitch
def medfilt(v, k):
    h = k // 2
    p = np.pad(v, h, mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(p, k), axis=1)


def pitch(x, db):
    size = 800                                           # 50 ms: >= 3 periods at 60 Hz
    fr = frame_signal(x, size)
    fr = fr - fr.mean(axis=1, keepdims=True)
    w = np.hanning(size + 1)[:-1]
    fr = fr * w
    nfft = 2048
    ac = np.fft.irfft(np.abs(np.fft.rfft(fr, nfft)) ** 2)[:, :size]
    wac = np.fft.irfft(np.abs(np.fft.rfft(w, nfft)) ** 2)[:size]
    r = ac / (ac[:, :1] + 1e-12) / (wac / wac[0])[None, :]      # normalised autocorrelation (Boersma)
    lo, hi = int(SR / 400), int(SR / 60)
    f0 = np.zeros(len(fr))
    for i in range(len(fr)):
        if db[i] < db.max() - 40:
            continue
        seg = r[i, lo - 1: hi + 2]
        pk = np.nonzero((seg[1:-1] >= seg[:-2]) & (seg[1:-1] > seg[2:]))[0] + 1
        if len(pk) == 0:
            continue
        best = seg[pk].max()
        if best < 0.45:                                  # voicing threshold
            continue
        # shortest-lag peak that is nearly as strong: avoids sub-octave errors
        k = pk[np.nonzero(seg[pk] >= 0.9 * best)[0][0]]
        a, b, c = seg[k - 1], seg[k], seg[k + 1]
        d = a - 2 * b + c
        off = 0.5 * (a - c) / d if d != 0 else 0.0
        f0[i] = SR / (lo - 1 + k + off)
    # per voiced run: fix octave jumps against the run median, drop very short runs, then smooth
    voiced = f0 > 0
    out = np.zeros_like(f0)
    i = 0
    while i < len(f0):
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j < len(f0) and voiced[j]:
            j += 1
        run = f0[i:j].copy()
        if len(run) >= 5:
            med = np.median(run)
            for _ in range(2):
                run = np.where(run > 1.6 * med, run / 2, run)
                run = np.where(run < 0.62 * med, run * 2, run)
            out[i:j] = medfilt(run, 7)
        i = j
    # one speaker, one sentence: anything far from the median is a tracking error (often on an "s")
    v = out[out > 0]
    if len(v):
        med = np.median(v)
        out[(out > 1.7 * med) | (out < 0.55 * med)] = 0
    return np.round(np.clip(out, 0, 400), 1)


# ---------------------------------------------------------------- fitting to the page's layout
def find_marks(img):
    """Source frames (first, pause_start, pause_end, last): where speech starts, the longest
    pause inside it, and where speech ends. Quietness is judged as the page draws it."""
    peak = ((img / 255.0) ** GAMMA).max(axis=1)
    loud = peak >= QUIET
    idx = np.nonzero(loud)[0]
    if len(idx) < 8:
        sys.exit("could not find speech in the recording")
    first, last = int(idx[0]), int(idx[-1]) + 1
    best = (0, 0)
    i = first
    while i < last:
        if loud[i]:
            i += 1
            continue
        j = i
        while j < last and not loud[j]:
            j += 1
        if j - i > best[1] - best[0]:
            best = (i, j)
        i = j
    if best[1] - best[0] < 4:
        # no pause at all: split at the quietest moment of the middle half
        a, b = first + (last - first) // 4, last - (last - first) // 4
        k = a + int(np.argmin(peak[a:b]))
        best = (k, k + 1)
        print("note: no pause found inside the sentence; the plain is its quietest moment stretched out")
    return first, best[0], best[1], last


def warp_spans(marks, n_src, frames):
    """For each output frame, the span [lo, hi] of source frames it stands for, and its centre."""
    first, pa, pb, last = marks
    l0, l1, l2, l3 = (int(round(v * (frames - 1) / (FRAMES_OUT - 1))) for v in LAYOUT)
    xs = [0, l0, l1, l2, l3, frames - 1]
    ys = [max(0, first - l0), first, pa, pb, last, min(n_src - 1, last + (frames - 1 - l3))]
    j = np.arange(frames, dtype=np.float64)
    return np.interp(j - 0.5, xs, ys), np.interp(j + 0.5, xs, ys), np.interp(j, xs, ys), (l0, l1, l2, l3)


def resample_rows(a, lo, hi):
    """Rows of `a` averaged over each span. Spans shorter than one frame are interpolated instead."""
    a = np.asarray(a, np.float64)
    flat = a.ndim == 1
    if flat:
        a = a[:, None]
    n = a.shape[0]
    c = np.vstack([np.zeros((1, a.shape[1])), np.cumsum(a, axis=0)])     # c[k] = rows 0..k-1 summed

    def integral(p):                                    # row i covers [i - 0.5, i + 0.5)
        q = np.clip(p + 0.5, 0.0, n)
        k = np.minimum(np.floor(q).astype(int), n - 1)
        return c[k] + a[k] * (q - k)[:, None]

    width = hi - lo
    area = (integral(hi) - integral(lo)) / np.maximum(width, 1e-9)[:, None]
    mid = np.clip((lo + hi) / 2, 0, n - 1)
    i0 = np.floor(mid).astype(int)
    i1 = np.minimum(i0 + 1, n - 1)
    t = (mid - i0)[:, None]
    out = np.where((width >= 1.0)[:, None], area, a[i0] * (1 - t) + a[i1] * t)
    return out[:, 0] if flat else out


def resample_voiced(v, lo, hi):
    """Per span: the median of the voiced values if at least half the span is voiced, else 0."""
    v = np.asarray(v, np.float64)
    two_d = v.ndim == 2
    if not two_d:
        v = v[:, None]
    n = len(v)
    out = np.zeros((len(lo), v.shape[1]))
    for j in range(len(lo)):
        a = int(np.clip(np.floor(lo[j] + 0.5), 0, n - 1))
        b = int(np.clip(np.ceil(hi[j] + 0.5), a + 1, n))
        for k in range(v.shape[1]):
            seg = v[a:b, k]
            on = seg[seg > 0]
            if len(on) and len(on) * 2 >= len(seg):
                out[j, k] = np.median(on)
    return out if two_d else out[:, 0]


def find_lane(img, layout):
    """The camera's corridor: one frequency band per frame, the lowest way through the land that
    is still smooth enough to fly. The first range is flown along its upper side, where the land
    is lowest; the second is flown through its middle, so the two halves of the page look
    different, and the lane crosses over on the plain between them. Returned as [frame, band] knots."""
    frames, bins = img.shape
    h = (img / 255.0) ** GAMMA
    half = 6                                             # the corridor is this many bands either side
    padded = np.pad(h, ((0, 0), (half, half)), mode="edge")
    wide = np.lib.stride_tricks.sliding_window_view(padded, 2 * half + 1, axis=1).max(axis=2)
    lo, hi = LANE_SECOND[0], bins - 12                   # every band the lane may ever use
    n = hi - lo
    band = np.arange(lo, hi)
    cost = wide[:, lo:hi].copy()
    # Each range has its own share of the bands, and a gentle pull toward its best straight corridor.
    for start, stop, (b0, b1) in ((0, layout[1], LANE_FIRST), (layout[2], frames, LANE_SECOND)):
        inside = (band >= b0) & (band < min(b1, hi))
        mean = np.where(inside, cost[start:stop].mean(axis=0), np.inf)
        home = band[int(np.argmin(mean))]
        cost[start:stop] += 0.02 * ((band - home) / 20.0) ** 2
        cost[start:stop, ~inside] = np.inf
    turn = 0.08                                          # price of moving one band between frames
    total = np.empty((frames, n))
    back = np.zeros((frames, n), np.int8)
    total[0] = cost[0]
    for f in range(1, frames):
        prev = total[f - 1]
        stay = prev
        down = np.concatenate([[np.inf], prev[:-1]]) + turn     # came from the band below
        up = np.concatenate([prev[1:], [np.inf]]) + turn        # came from the band above
        choice = np.argmin(np.stack([down, stay, up]), axis=0)
        back[f] = choice - 1
        total[f] = cost[f] + np.min(np.stack([down, stay, up]), axis=0)
    path = np.empty(frames)
    b = int(np.argmin(total[-1]))
    for f in range(frames - 1, -1, -1):
        path[f] = b + lo
        b += int(back[f, b])
    # smooth it into something a camera can follow
    sigma = 12.0
    k = np.arange(-36, 37)
    g = np.exp(-0.5 * (k / sigma) ** 2)
    smooth = np.convolve(np.pad(path, 36, mode="edge"), g / g.sum(), mode="valid")
    knots = [[int(f), round(float(smooth[f]), 1)] for f in range(0, frames, 12)]
    if knots[-1][0] != frames - 1:
        knots.append([frames - 1, round(float(smooth[-1]), 1)])
    return knots


# ---------------------------------------------------------------- formants (LPC)
def lpc(seg, order):
    """Autocorrelation-method LPC via Levinson-Durbin. Returns polynomial [1, a1..ap] or None."""
    n = len(seg)
    r = np.correlate(seg, seg, "full")[n - 1: n + order].copy()
    if r[0] <= 1e-9:
        return None
    r[0] *= 1.0001
    a = np.zeros(order + 1)
    a[0] = 1.0
    e = r[0]
    for i in range(1, order + 1):
        k = -(r[i] + np.dot(a[1:i], r[i - 1:0:-1])) / e
        a[1:i] = a[1:i] + k * a[i - 1:0:-1]
        a[i] = k
        e *= 1 - k * k
        if e <= 0:
            return None
    return a


def formants(x, f0, db):
    sr2, order = 10000, 10
    y = resample(x, SR, sr2)
    y = np.append(y[0], y[1:] - 0.97 * y[:-1])
    size = int(0.025 * sr2)
    hop2 = HOP * sr2 / SR                                # 50 samples at 10 kHz
    n = len(f0)
    out = np.zeros((n, 3))
    win = np.hanning(size + 1)[:-1]
    for i in range(n):
        if f0[i] <= 0 or db[i] < db.max() - 35:
            continue
        a0 = int(round(i * hop2)) - size // 2
        seg = np.zeros(size)
        lo, hi = max(0, a0), min(len(y), a0 + size)
        if hi <= lo:
            continue
        seg[lo - a0: hi - a0] = y[lo:hi]
        a = lpc(seg * win, order)
        if a is None:
            continue
        roots = np.roots(a)
        roots = roots[roots.imag > 0.01]
        fq = np.arctan2(roots.imag, roots.real) * sr2 / (2 * math.pi)
        bw = -np.log(np.abs(roots)) * sr2 / math.pi
        fq = np.sort(fq[(fq > 150) & (fq < 4500) & (bw < 400)])
        for k in range(min(3, len(fq))):
            out[i, k] = fq[k]
    # temporal clean-up: median filter inside continuous tracks, drop isolated points
    for k in range(3):
        col = out[:, k]
        sm = col.copy()
        i = 0
        while i < n:
            if col[i] <= 0:
                i += 1
                continue
            j = i
            while j < n and col[j] > 0:
                j += 1
            sm[i:j] = medfilt(col[i:j], 5) if j - i >= 3 else 0
            i = j
        out[:, k] = sm
    return np.round(out).astype(int)


# ---------------------------------------------------------------- alignment / output
def shift_items(items, offset, duration):
    res = []
    for it in items or []:
        s, e = it["start"] - offset, it["end"] - offset
        if e <= 0 or s >= duration:
            continue
        res.append({"text" if "text" in it else "symbol": it.get("text", it.get("symbol")),
                    "start": round(max(s, 0.0), 3), "end": round(min(e, duration), 3)})
    return res


def compact(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav")
    ap.add_argument("--align", help="optional alignment JSON {words:[{text,start,end}], phones:[{symbol,start,end}]}")
    ap.add_argument("--out", default=str(here.parent.parent / "public" / "lab" / "voice"))
    ap.add_argument("--frames", type=int, default=FRAMES_OUT,
                    help="time frames to fit the sentence to (the page needs %(default)s); 0 keeps the recording's own")
    a = ap.parse_args()

    x, sr = read_wav(a.wav)
    x = resample(x, sr, SR)
    peak = np.abs(x).max()
    if peak == 0:
        sys.exit("input is silent")
    x = x / peak * 0.9
    x, t0 = trim_silence(x)
    duration = len(x) / SR

    img, centers = log_mel(x)
    db, inten = intensity(x)
    f0 = pitch(x, db)
    fmt = formants(x, f0, db)

    extra = {}
    hop = HOP
    if a.frames:
        marks = find_marks(img)
        lo, hi, mid, layout = warp_spans(marks, img.shape[0], a.frames)
        img = np.round(resample_rows(img, lo, hi)).astype(np.uint8)
        inten = np.round(resample_rows(inten, lo, hi)).astype(int)
        f0 = np.round(resample_voiced(f0, lo, hi), 1)
        fmt = np.round(resample_voiced(fmt, lo, hi)).astype(int)
        hop = int(round(duration * SR / (a.frames - 1)))
        extra = {
            # output frames: [speech starts, pause starts, pause ends, speech ends]
            "layout": list(layout),
            # where in the recording (seconds) each frame comes from; the frames are not evenly spaced
            "times": [round(float(t) * HOP / SR, 4) for t in mid],
            "lane": find_lane(img, layout),
        }
        print(f"speech {marks[0] * HOP / SR:.2f}-{marks[3] * HOP / SR:.2f}s, "
              f"pause {marks[1] * HOP / SR:.2f}-{marks[2] * HOP / SR:.2f}s, fitted to frames {list(layout)}")
    frames = img.shape[0]
    voiced = f0[f0 > 0]
    if len(voiced):
        p5, p95 = np.percentile(voiced, [5, 95])
        span = max(p95 - p5, 10.0)
        # the page draws pitch between these two (Hz): the speaker's own range, with a little room
        extra["f0Range"] = [round(float(p5 - 0.1 * span), 1), round(float(p5 + 1.1 * span), 1)]

    words, phones = [], []
    if a.align:
        al = json.load(open(a.align, encoding="utf8"))
        words = shift_items(al.get("words"), t0, duration)
        phones = shift_items(al.get("phones"), t0, duration)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "terrain.bin").write_bytes(img.tobytes())
    meta = {
        "sampleRate": SR, "hop": hop, "frames": frames, "bins": BINS,
        "fmin": FMIN, "fmax": FMAX, "duration": round(duration, 4),
        "melCenters": [round(float(c), 1) for c in centers],
        "intensity": [int(v) for v in inten],
        "f0": [float(v) for v in f0],
        "formants": [[int(v) for v in row] for row in fmt],
        "words": words, "phones": phones,
        **extra,
    }
    (out / "terrain.json").write_text(compact(meta), encoding="utf8")
    print(f"{frames} frames x {BINS} bins, {duration:.3f}s, voiced {len(voiced)} frames, "
          f"f0 {voiced.min() if len(voiced) else 0:.0f}-{voiced.max() if len(voiced) else 0:.0f} Hz -> {out}")


if __name__ == "__main__":
    main()
