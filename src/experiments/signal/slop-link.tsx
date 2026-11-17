import "./slop-link.css"

import { useLayoutEffect, useRef } from "react"

/**
 * The way into Sloprillion, the trivia game in /sloprillion: a small plate at
 * the top right of the opening. It is drawn in the game's own pixel art (its
 * dusk sky, its wordmark with slop poured over the first four letters, its
 * mascot and its road) rather than in this page's ink, so it reads as a door
 * to somewhere else.
 *
 * The picture is drawn once, one canvas pixel per art pixel, and scaled up by
 * CSS. --u, the size of one art pixel, is snapped to a whole number of device
 * pixels so the art stays even at any zoom or display scaling.
 *
 * The letters, the mascot and the colours are copies of the ones in
 * sloprillion/src/sprites.js and sloprillion/src/scene.js; keep them in step.
 */

/** The picture inside the frame, in art pixels. slop-link.css uses the same numbers. */
const W = 94
const H = 21
/** Rows of sky. Below them: two rows of pavement, then the road. */
const SKY = 16
/** Where the first letter of the wordmark starts. */
const MARK_X = 22
const MARK_Y = 2

const INK = "#14151c"
const GOLD = "#ffc93c"
const GOLD_HI = "#fff1b8"
const GOLD_LO = "#dc9d1c"
const GOO = "#8fe36b"
const GOO_HI = "#dcffc8"
const GOO_LO = "#58b647"
const ROAD = "#2a2c38"

type Rgb = [number, number, number]
/** The game's sky at the first lot: early light, top to horizon. */
const SKY_TOP: Rgb = [0x3b, 0x34, 0x70]
const SKY_MID: Rgb = [0xb0, 0x62, 0x8c]
const SKY_BOT: Rgb = [0xff, 0xb3, 0x7a]
/** The first row of each band of sky. The seam between two bands is one dithered row. */
const BANDS = [0, 3, 6, 9, 12, 14]
const STARS = [
  [2, 1],
  [9, 3],
  [15, 0],
  [18, 2],
  [47, 0],
  [79, 0],
]

const LETTERS: Record<string, string[]> = {
  S: [".####.", "##..##", "##....", "##....", ".####.", "....##", "....##", "##..##", ".####."],
  L: ["##....", "##....", "##....", "##....", "##....", "##....", "##....", "######", "######"],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  P: ["#####.", "##..##", "##..##", "##..##", "#####.", "##....", "##....", "##....", "##...."],
  R: ["#####.", "##..##", "##..##", "##..##", "#####.", "##.##.", "##..##", "##..##", "##..##"],
  I: ["##", "##", "##", "##", "##", "##", "##", "##", "##"],
  N: ["##..##", "###.##", "###.##", "######", "##.###", "##.###", "##..##", "##..##", "##..##"],
}
const LETTER_ROWS = 9
/** Drips: [letter, column in the letter, last row]. Rows past the ninth hang below the letter. */
const DRIPS = [
  [0, 0, 4],
  [0, 5, 3],
  [1, 0, 6],
  [1, 1, 4],
  [2, 0, 5],
  [2, 5, 7],
  [3, 1, 11],
  [3, 0, 9],
  [3, 4, 3],
]

const BLOB = [
  ".....oooooo.....",
  "...ooggggggoo...",
  "..ogLLgggggggo..",
  ".ogLgggggggggdo.",
  ".oggggkggkgggdo.",
  ".oggggkggkgggdo.",
  "ogggggggggggggdo",
  "oggggggmmgggggdo",
  "ogggggggggggggdo",
  "oggggggggggggddo",
  "odggggggggggdddo",
  ".oooooooooooooo.",
]
const BLOB_COLOURS: Record<string, string> = { o: "#1f4a2a", g: "#8fe36b", L: "#d9ffc2", d: "#5fbf4d", k: INK, m: "#1f4a2a" }

const css = (c: Rgb) => `rgb(${c.map(Math.round).join(" ")})`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function paintSky(ctx: CanvasRenderingContext2D) {
  const colours = BANDS.map((_, i) => {
    const u = i / (BANDS.length - 1)
    return css(u < 0.5 ? mix(SKY_TOP, SKY_MID, u * 2) : mix(SKY_MID, SKY_BOT, (u - 0.5) * 2))
  })
  BANDS.forEach((from, i) => {
    const to = BANDS[i + 1] ?? SKY
    ctx.fillStyle = colours[i]
    ctx.fillRect(0, from, W, to - from)
    // The seam: this band's first row keeps every other pixel of the band above.
    if (i > 0) {
      ctx.fillStyle = colours[i - 1]
      for (let x = from % 2; x < W; x += 2) ctx.fillRect(x, from, 1, 1)
    }
  })
  ctx.fillStyle = "rgb(255 255 255 / 0.75)"
  for (const [x, y] of STARS) ctx.fillRect(x, y, 1, 1)
}

function paintWordmark(ctx: CanvasRenderingContext2D) {
  const pixels = new Map<string, string>()
  const starts: number[] = []
  let at = 0
  ;[..."SLOPRILLION"].forEach((letter, li) => {
    const glyph = LETTERS[letter]
    starts.push(at)
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "#") continue
        let colour = y === 0 ? GOLD_HI : y === LETTER_ROWS - 1 ? GOLD_LO : GOLD
        // Slop sits on the tops of S, L, O and P, with a ragged lower edge.
        if (li < 4 && (y < 2 || (y === 2 && (x + li) % 3 !== 1))) colour = y === 0 ? GOO_HI : GOO
        pixels.set(`${at + x},${y}`, colour)
      }
    })
    at += glyph[0].length + 1
  })
  for (const [li, column, last] of DRIPS) {
    for (let y = 2; y <= last; y++) {
      const key = `${starts[li] + column},${y}`
      if (y >= LETTER_ROWS || pixels.has(key)) pixels.set(key, y === last ? GOO_LO : GOO)
    }
  }

  const each = (draw: (x: number, y: number, colour: string) => void) => {
    for (const [key, colour] of pixels) {
      const [x, y] = key.split(",").map(Number)
      draw(MARK_X + x, MARK_Y + y, colour)
    }
  }
  // An outline, a row deeper underneath so the letters sit on a hard shadow.
  ctx.fillStyle = INK
  each((x, y) => ctx.fillRect(x - 1, y - 1, 3, 4))
  each((x, y, colour) => {
    ctx.fillStyle = colour
    ctx.fillRect(x, y, 1, 1)
  })
}

function paintScene(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  paintSky(ctx)
  paintWordmark(ctx)
  ctx.fillStyle = "#bdbab1"
  ctx.fillRect(0, SKY, W, 1)
  ctx.fillStyle = "#8d8a83"
  ctx.fillRect(0, SKY + 1, W, 1)
  ctx.fillStyle = ROAD
  ctx.fillRect(0, SKY + 2, W, H - SKY - 2)
  // Eight lane dashes, the same distance from both ends of the plate.
  ctx.fillStyle = GOLD
  for (let x = 6; x + 5 <= W; x += 11) ctx.fillRect(x, SKY + 3, 5, 1)
}

/** Two frames, one above the other: eyes open, then shut. The stylesheet shows one at a time. */
function paintBlob(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  for (let frame = 0; frame < 2; frame++) {
    BLOB.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        let cell = row[x]
        // Shut, an eye is only its lower pixel.
        if (frame === 1 && cell === "k" && BLOB[y + 1]?.[x] === "k") cell = "g"
        const colour = BLOB_COLOURS[cell]
        if (!colour) continue
        ctx.fillStyle = colour
        ctx.fillRect(x, frame * BLOB.length + y, 1, 1)
      }
    })
  }
}

/** One art pixel in CSS pixels: between 2 and 3, larger on larger windows, a whole number of device pixels. */
function artPixel() {
  const ratio = window.devicePixelRatio || 1
  const wanted = Math.min(3, Math.max(2, Math.min(window.innerWidth / 720, window.innerHeight / 300)))
  return Math.max(1, Math.round(wanted * ratio)) / ratio
}

export function SlopLink() {
  const link = useRef<HTMLAnchorElement>(null)
  const scene = useRef<HTMLCanvasElement>(null)
  const blob = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    if (scene.current) paintScene(scene.current)
    if (blob.current) paintBlob(blob.current)
  }, [])

  useLayoutEffect(() => {
    const fit = () => link.current?.style.setProperty("--u", `${artPixel()}px`)
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [])

  return (
    <a
      ref={link}
      className="sg-slop"
      href={`${import.meta.env.BASE_URL}sloprillion/`}
      aria-label="Play Sloprillion, a tech trivia game"
    >
      <canvas ref={scene} className="sg-slop-scene" width={W} height={H} aria-hidden="true" />
      <span className="sg-slop-blob" aria-hidden="true">
        <canvas ref={blob} width={BLOB[0].length} height={BLOB.length * 2} />
      </span>
    </a>
  )
}
