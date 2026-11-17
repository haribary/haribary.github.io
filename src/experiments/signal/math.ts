/** Small numeric helpers shared by the terrain builder and the camera rig. */

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Hermite 0..1 ramp between two edges (C1). */
export function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Quintic 0..1 ramp between two edges (C2), for anything the eye tracks. */
export function smoother(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson) through (xs, ys). C1, never
 * overshoots its knots, and holds the end values outside the knot range.
 */
export function pchip(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length
  const h: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    d.push((ys[i + 1] - ys[i]) / h[i])
  }
  const m: number[] = Array.from({ length: n }, () => 0)
  if (n > 1) {
    m[0] = d[0]
    m[n - 1] = d[n - 2]
  }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const t = (x - xs[lo]) / h[lo]
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h[lo] * m[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * h[lo] * m[lo + 1]
    )
  }
}

export type Vec3 = [number, number, number]

/** Three pchips, one per component: a smooth path through keyed points. */
export function path3(us: readonly number[], pts: readonly Vec3[]) {
  const fx = pchip(
    us,
    pts.map((p) => p[0]),
  )
  const fy = pchip(
    us,
    pts.map((p) => p[1]),
  )
  const fz = pchip(
    us,
    pts.map((p) => p[2]),
  )
  return (u: number, out: Vec3) => {
    out[0] = fx(u)
    out[1] = fy(u)
    out[2] = fz(u)
    return out
  }
}

/** In-place Gaussian blur of a 1D signal, clamping at the ends. */
export function blur1d(src: Float32Array, sigma: number) {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
    sum += k[i + r]
  }
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    let acc = 0
    for (let j = -r; j <= r; j++) {
      const idx = clamp(i + j, 0, src.length - 1)
      acc += src[idx] * k[j + r]
    }
    out[i] = acc / sum
  }
  src.set(out)
  return src
}

/** Linear sample of a 1D array at a fractional index, clamped. */
export function sample1d(arr: Float32Array, i: number) {
  const x = clamp(i, 0, arr.length - 1)
  const i0 = Math.floor(x)
  const i1 = Math.min(arr.length - 1, i0 + 1)
  return lerp(arr[i0], arr[i1], x - i0)
}
