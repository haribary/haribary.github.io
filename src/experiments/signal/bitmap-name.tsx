import "@fontsource/press-start-2p/400.css"
import "./plate.css"

import { useEffect, useRef } from "react"

import { prefersReducedMotion } from "@/lab/smooth-scroll"

/**
 * The name on the opening plate, as retro bitmap type. The letters are the
 * capitals of an 8 by 8 pixel face (Press Start 2P), drawn as large square blocks; each block
 * is then made of a few finer cells, which shade the letters from full ink at
 * the top down to a scatter at the baseline with an ordered dither, inside a
 * solid outline.
 *
 * The real text stays in the heading (transparent, selectable, read by screen
 * readers); the canvas is drawn exactly over it and is redrawn whenever the
 * layout changes. If the face or the canvas is unavailable, the text shows.
 */

const FACE = '"Press Start 2P"'
/** The face is drawn on a grid of this many pixels per em, and its capitals are this many tall. */
const GRID = 8
const CAP = 7
/** Rows sampled above and below the baseline: the whole em and room for a descender. */
const ABOVE = 8
const BELOW = 2
/** The size of the type before it is snapped to whole blocks: clamp(min rem, vw, max rem). */
const SIZE = { min: 1.5, vw: 7.8, max: 9 }
/** The space between words, in ems. plate.css sets the same with word-spacing. */
const WORD_SPACE = 0.5
/** Ink inside the letters: all of it at the top of the capitals, this much at the baseline. */
const LIGHTEST = 0.42
/** Milliseconds the name takes to come up, dot by dot, on load. */
const APPEAR_MS = 1300

/** The 8 by 8 Bayer matrix, as thresholds in 0..1. */
const BAYER = (() => {
  let m = [[0]]
  for (let size = 1; size < 8; size *= 2) {
    const next = Array.from({ length: size * 2 }, () => new Array<number>(size * 2).fill(0))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4
        next[y][x] = v
        next[y][x + size] = v + 2
        next[y + size][x] = v + 3
        next[y + size][x + size] = v + 1
      }
    }
    m = next
  }
  return m.map((row) => row.map((v) => (v + 0.5) / 64))
})()

type Bitmap = {
  cols: number
  rows: number
  /** Side of one fine cell, in CSS px. */
  cell: number
  left: number
  top: number
  /** Per cell: 0 outside the letters, otherwise how much ink the inside carries there (up to 1). */
  tone: Float32Array
  /** Per cell: 1 on the outline of a letter. */
  edge: Uint8Array
  rgb: [number, number, number]
}

function parseColor(value: string): [number, number, number] {
  const m = value.match(/[\d.]+/g)
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [20, 23, 28]
}

/**
 * The size the type should be: as large as the page asks for and the line has
 * room for, snapped so that a block is a whole number of fine cells and a fine
 * cell is a whole number of device pixels.
 */
function sizing(heading: HTMLElement, ems: number) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const wanted = Math.min(SIZE.max * rem, Math.max(SIZE.min * rem, (SIZE.vw / 100) * window.innerWidth))
  const dpr = window.devicePixelRatio || 1
  const room = heading.parentElement?.clientWidth ?? window.innerWidth
  // Device pixels per block: what is wanted, and the most that fits on one line.
  const fits = (room / (ems * GRID)) * dpr
  const want = Math.min((wanted / GRID) * dpr, fits)
  // A fine cell is about 2 CSS px across; finer only when blocks that size would not fit.
  let perBlock = 2
  let cellDevice = 1
  for (const size of dpr >= 1.5 ? [3, 2, 1] : [2, 1]) {
    let n = Math.round(want / size)
    while (n > 2 && n * size > fits) n--
    if (n >= 2 && n * size <= fits + 1e-6) {
      perBlock = n
      cellDevice = size
      break
    }
  }
  const cell = cellDevice / dpr
  return { cell, perBlock, font: perBlock * cell * GRID, dpr }
}

/** Which pixels of the face's own grid a word turns on: rows from ABOVE the baseline to BELOW it. */
function glyphs(word: string) {
  const s = 4
  const cols = word.length * GRID
  const rows = ABOVE + BELOW
  const off = document.createElement("canvas")
  off.width = cols * s
  off.height = rows * s
  const ctx = off.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.font = `${GRID * s}px ${FACE}`
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = "#000"
  ctx.fillText(word, 0, ABOVE * s)
  const data = ctx.getImageData(0, 0, off.width, off.height).data
  const on = new Uint8Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // The middle of each pixel of the face.
      on[y * cols + x] = data[((y * s + s / 2) * off.width + x * s + s / 2) * 4 + 3] > 127 ? 1 : 0
    }
  }
  return { on, cols, rows }
}

/** Lays the words out as blocks where the browser put them, then shades them. */
function measure(heading: HTMLElement, words: HTMLElement[], cell: number, perBlock: number, dpr: number): Bitmap | null {
  const box = heading.getBoundingClientRect()
  if (box.width < 2 || box.height < 2 || words.length === 0) return null
  const block = cell * perBlock
  // The canvas starts on a whole device pixel, one block outside the heading's box.
  const left = Math.round((box.left - block) * dpr) / dpr - box.left
  const top = Math.round((box.top - block) * dpr) / dpr - box.top
  const cols = Math.ceil((box.width + block * 2) / cell)
  const rows = Math.ceil((box.height + block * 3) / cell)
  const inside = new Uint8Array(cols * rows)
  /** How far down the capitals each inked cell is: 0 at their top, 1 at the baseline. */
  const depth = new Float32Array(cols * rows)

  const probe = document.createElement("canvas").getContext("2d")
  if (!probe) return null
  probe.font = `${block * GRID}px ${FACE}`
  for (const word of words) {
    // Capitals only; the heading's own text keeps its case.
    const text = (word.textContent ?? "").toUpperCase()
    const g = glyphs(text)
    if (!g) return null
    const r = word.getBoundingClientRect()
    const metrics = probe.measureText(text)
    const ascent = metrics.fontBoundingBoxAscent ?? block * GRID
    const descent = metrics.fontBoundingBoxDescent ?? 0
    const baseline = r.top - box.top + (r.height - (ascent + descent)) / 2 + ascent
    const x0 = Math.round((r.left - box.left - left) / cell)
    const yBase = Math.round((baseline - top) / cell)
    for (let gy = 0; gy < g.rows; gy++) {
      for (let gx = 0; gx < g.cols; gx++) {
        if (!g.on[gy * g.cols + gx]) continue
        for (let j = 0; j < perBlock; j++) {
          const y = yBase + (gy - ABOVE) * perBlock + j
          if (y < 0 || y >= rows) continue
          for (let k = 0; k < perBlock; k++) {
            const x = x0 + gx * perBlock + k
            if (x < 0 || x >= cols) continue
            inside[y * cols + x] = 1
            depth[y * cols + x] = (y - (yBase - CAP * perBlock) + 0.5) / (CAP * perBlock)
          }
        }
      }
    }
  }

  const tone = new Float32Array(cols * rows)
  const edge = new Uint8Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (!inside[i]) continue
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - cols] || !inside[i + cols]) {
        edge[i] = 1
      }
      const t = Math.min(1, Math.max(0, (depth[i] - 0.14) / 0.82))
      const eased = t * t * (3 - 2 * t)
      tone[i] = 1 - (1 - LIGHTEST) * eased
    }
  }
  return { cols, rows, cell, left, top, tone, edge, rgb: parseColor(getComputedStyle(heading).color) }
}

/** Draws the bitmap with `appear` (0..1) of its dots in place. */
function paint(canvas: HTMLCanvasElement, b: Bitmap, appear: number) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return false
  const image = ctx.createImageData(b.cols, b.rows)
  const px = image.data
  const [r, g, bl] = b.rgb
  for (let y = 0; y < b.rows; y++) {
    const row = BAYER[y & 7]
    for (let x = 0; x < b.cols; x++) {
      const tone = b.tone[y * b.cols + x]
      if (tone === 0) continue
      const threshold = row[x & 7]
      // The inside settles first, in dither order; the outline closes over it last.
      const on = b.edge[y * b.cols + x] ? appear >= 0.55 + 0.45 * threshold : tone * Math.min(1, appear / 0.7) > threshold
      if (!on) continue
      const i = (y * b.cols + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = bl
      px[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return true
}

export function BitmapName({ text }: { text: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const h = heading.current
    const c = canvas.current
    if (!h || !c) return
    let alive = true
    let frame = 0
    let started = 0
    let bitmap: Bitmap | null = null
    const reduced = prefersReducedMotion()

    const layout = () => {
      const words = Array.from(h.querySelectorAll<HTMLElement>("[data-word]"))
      const ems = words.reduce((sum, w) => sum + (w.textContent ?? "").length, 0) + WORD_SPACE * (words.length - 1)
      const { cell, perBlock, font, dpr } = sizing(h, ems)
      h.style.fontSize = `${font}px`
      bitmap = measure(h, words, cell, perBlock, dpr)
      if (!bitmap) return false
      c.width = bitmap.cols
      c.height = bitmap.rows
      c.style.left = `${bitmap.left}px`
      c.style.top = `${bitmap.top}px`
      c.style.width = `${bitmap.cols * bitmap.cell}px`
      c.style.height = `${bitmap.rows * bitmap.cell}px`
      return true
    }

    const draw = (now: number) => {
      frame = 0
      if (!alive || !bitmap) return
      const appear = reduced ? 1 : Math.min(1, (now - started) / APPEAR_MS)
      const ok = paint(c, bitmap, appear)
      h.dataset.drawn = ok ? "true" : "false"
      if (ok && appear < 1) frame = requestAnimationFrame(draw)
    }

    const redraw = () => {
      if (!alive || !started) return
      if (!layout()) {
        h.dataset.drawn = "false"
        return
      }
      if (!frame) frame = requestAnimationFrame(draw)
    }

    // The blocks are read off the face itself, so it has to be loaded first.
    const face = `${GRID * 4}px ${FACE}`
    const caps = text.toUpperCase()
    const fonts = document.fonts
    Promise.resolve(fonts?.load ? fonts.load(face, caps) : [])
      .catch(() => [])
      .then(() => {
        if (!alive || !fonts?.check?.(face, caps)) return
        started = performance.now()
        redraw()
      })

    const observer = new ResizeObserver(redraw)
    observer.observe(h)
    window.addEventListener("resize", redraw)
    return () => {
      alive = false
      observer.disconnect()
      window.removeEventListener("resize", redraw)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [text])

  const words = text.split(" ")
  return (
    <h1 ref={heading} className="sg-name sg-bitmap" tabIndex={-1} data-drawn="false">
      {words.map((word, i) => (
        <span key={i}>
          <span data-word>{word}</span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
      <canvas ref={canvas} className="sg-bitmap__canvas" aria-hidden="true" />
    </h1>
  )
}
