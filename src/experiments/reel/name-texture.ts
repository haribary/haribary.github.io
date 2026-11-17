import * as THREE from "three"
import archivoUrl from "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url"

import { person } from "@/lab/content"
import { maxWidth, restWidth } from "./motion"

/**
 * The giant name lives inside the WebGL scene so photographs can pass both in
 * front of and behind its letters. It is rasterised from the real web font.
 *
 * Canvas 2D cannot take arbitrary font-variation-settings, so each width step
 * gets its own FontFace pointing at the same file with a single-value
 * `stretch` descriptor; the browser clamps the width axis to that value.
 * Each step becomes a one-channel texture; the name shows the nearest step
 * as it breathes with scroll speed.
 */

// Steps close enough together (about 4 units) that switching between them
// reads as continuous motion.
export const WIDTH_STEPS = Array.from({ length: 13 }, (_, i) =>
  Math.round(restWidth + ((maxWidth - restWidth) * i) / 12),
)

const faces = new Map<number, Promise<string>>()

function faceFor(width: number) {
  let p = faces.get(width)
  if (!p) {
    const family = `ReelName${width}`
    const face = new FontFace(family, `url(${archivoUrl})`, {
      weight: "900",
      stretch: `${width}%`,
    })
    p = face.load().then((f) => {
      document.fonts.add(f)
      return family
    })
    faces.set(width, p)
  }
  return p
}

export type NameLayout = {
  vw: number
  vh: number
  res: number
  /** Font size and baseline of each line, CSS px. */
  f1: number
  f2: number
  y1: number
  y2: number
  /** Right edge of line two. */
  x2: number
  /** Cap top of line 1 and baseline of line 2, for placing DOM around it. */
  top: number
  bottom: number
}

const [FIRST, LAST] = splitName(person.name)

function splitName(name: string): [string, string] {
  const parts = name.toUpperCase().split(" ")
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]]
}

export async function layoutName(vw: number, vh: number, dpr: number): Promise<NameLayout> {
  const family = await faceFor(restWidth)
  const ctx = document.createElement("canvas").getContext("2d")!
  ctx.font = `900 100px ${family}`
  const w1 = ctx.measureText(FIRST).width / 100
  const w2 = ctx.measureText(LAST).width / 100
  const cap = ctx.measureText("H").actualBoundingBoxAscent / 100

  const top = Math.max(64, vh * 0.075)
  let f1 = (vw * 1.1) / w1
  const portrait = vw / vh < 0.85
  let f2 = Math.max(f1, Math.min(((portrait ? 0.4 : 0.46) * vh) / cap, (0.92 * vw) / w2))
  const gap = () => 0.07 * f1
  let bottom = top + cap * f1 + gap() + cap * f2
  const limit = vh * (portrait ? 0.78 : 0.86)
  if (bottom > limit) {
    // Shrink the last name first, then both.
    f2 = Math.max(f1, f2 - (bottom - limit) / cap)
    bottom = top + cap * f1 + gap() + cap * f2
    if (bottom > limit) {
      const k = (limit - top) / (bottom - top)
      f1 *= k
      f2 *= k
      bottom = top + cap * f1 + gap() + cap * f2
    }
  }
  const y1 = top + cap * f1
  const y2 = y1 + gap() + cap * f2
  const x2 = vw + 0.05 * f2
  const res = Math.min(Math.max(1, dpr), 1.6, 2304 / vw)
  return { vw, vh, res, f1, f2, y1, y2, x2, top, bottom }
}

/** Rasterise the name at one width into a one-channel texture. */
export async function renderName(layout: NameLayout, width: number): Promise<THREE.DataTexture> {
  const family = await faceFor(width)
  const W = Math.round(layout.vw * layout.res)
  const H = Math.round(layout.vh * layout.res)
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.scale(layout.res, layout.res)
  ctx.fillStyle = "#fff"
  ctx.textBaseline = "alphabetic"

  ctx.font = `900 ${layout.f1}px ${family}`
  ctx.textAlign = "center"
  ctx.fillText(FIRST, layout.vw / 2, layout.y1)

  ctx.font = `900 ${layout.f2}px ${family}`
  ctx.textAlign = "right"
  ctx.fillText(LAST, layout.x2, layout.y2)

  const rgba = ctx.getImageData(0, 0, W, H).data
  const alpha = new Uint8Array(W * H)
  // Flip rows: canvas is top-down, textures are bottom-up.
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4 + 3
    const dst = y * W
    for (let x = 0; x < W; x++) alpha[dst + x] = rgba[src + x * 4]
  }
  const tex = new THREE.DataTexture(alpha, W, H, THREE.RedFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}
