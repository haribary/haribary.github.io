import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

/** The wall plane's slant — same treatment as the original GridPatternDemo. */
export const SKEW_DEG = 12
export const SKEW_TAN = Math.tan((SKEW_DEG * Math.PI) / 180)

/**
 * The tilted plane's z-axis, projected to screen (unit vector, y down). Every
 * block extrudes along this one direction — that shared axis is what makes the
 * scene read as a single tilted wall rather than four independent widgets. It is
 * an oblique-projection choice, picked so a popped block shows its top and right
 * flanks: lit top, shaded side — the classic raised look.
 */
export const Z_DIR = { x: -0.8, y: 0.6 }

/**
 * Geometry for the wall.
 *
 * Everything is placed from the wall's centre: the pattern origin is set so a
 * grid line falls exactly on the centre, which means any whole-cell offset from
 * the centre also lands on a line. That keeps the interactive cells
 * indistinguishable from the drawn grid at rest.
 */

/**
 * Interactive cells, as whole-cell offsets from the centre. Mirrored pairs that
 * frame the name, and all well off-centre — a block sitting dead centre would
 * face the camera squarely and show no flanks when it pops out. The tight set
 * keeps the outer pair on screen on phones.
 */
const NAV_WIDE: Array<[col: number, row: number]> = [
  [-6, -2],
  [-3, 2],
  [2, 2],
  [5, -2],
]

const NAV_TIGHT: Array<[col: number, row: number]> = [
  [-4, -2],
  [-2, 2],
  [1, 2],
  [3, -2],
]

/**
 * The etched social cells ride the same grid, orbiting wider than the nav
 * blocks so the eight cells read as one constellation around the name.
 */
const SOCIAL_WIDE: Array<[col: number, row: number]> = [
  [-8, 0],
  [-2, -4],
  [3, 4],
  [7, 1],
]

const SOCIAL_TIGHT: Array<[col: number, row: number]> = [
  [-5, 0],
  [-1, -4],
  [2, 4],
  [4, 0],
]

export type WallMetrics = {
  /** Grid cell size in px. */
  cell: number
  /** How far a block travels out of the wall, in px. */
  pop: number
  /** Wall size in px. */
  wallW: number
  wallH: number
  /** Pattern origin for GridPattern, aligned to the wall centre. */
  originX: number
  originY: number
  /** Wall centre in wall coordinates; always sits on a grid line. */
  centerX: number
  centerY: number
  /** Pattern cell index of the centre, for placing decorative cells. */
  centerCol: number
  centerRow: number
  /** Which cells are interactive, as whole-cell offsets from the centre. */
  navOffsets: Array<[col: number, row: number]>
  socialOffsets: Array<[col: number, row: number]>
}

function cellFor(width: number) {
  if (width < 560) return 34
  if (width < 900) return 44
  if (width < 1280) return 50
  return 56
}

export function useWallMetrics() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const wallRef = useRef<HTMLDivElement | null>(null)

  const [cell, setCell] = useState(() =>
    cellFor(typeof window === "undefined" ? 1440 : window.innerWidth),
  )
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const onResize = () => setCell(cellFor(window.innerWidth))
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const measure = useCallback(() => {
    const wall = wallRef.current
    if (!wall) return
    // offset* is layout size — getBoundingClientRect would include the skew,
    // inflating the box and pushing the computed centre off the true centre.
    const w = wall.offsetWidth
    const h = wall.offsetHeight
    setSize((prev) =>
      Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h },
    )
  }, [])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (wallRef.current) ro.observe(wallRef.current)
    return () => ro.disconnect()
  }, [measure])

  const centerX = size.w / 2
  const centerY = size.h / 2

  const metrics: WallMetrics = {
    cell,
    pop: Math.round(cell * 1.5),
    wallW: size.w,
    wallH: size.h,
    // GridPattern strokes at `origin + 0.5 + k·cell`, so this puts a line on the centre
    originX: (((centerX % cell) + cell) % cell) - 0.5,
    originY: (((centerY % cell) + cell) % cell) - 0.5,
    centerX,
    centerY,
    centerCol: Math.floor(centerX / cell),
    centerRow: Math.floor(centerY / cell),
    navOffsets: size.w / cell < 16 ? NAV_TIGHT : NAV_WIDE,
    socialOffsets: size.w / cell < 16 ? SOCIAL_TIGHT : SOCIAL_WIDE,
  }

  return { stageRef, wallRef, metrics }
}

/** Screen-space rect of a cell, given as a whole-cell offset from the centre. */
export function cellBox(m: WallMetrics, col: number, row: number) {
  return {
    left: m.centerX + col * m.cell,
    top: m.centerY + row * m.cell,
    size: m.cell,
  }
}
