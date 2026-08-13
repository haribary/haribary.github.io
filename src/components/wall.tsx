import { useCallback, useRef, useState } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import type { AnimationPlaybackControls } from "motion/react"

import { CursorTrail } from "@/components/cursor-trail"
import { GridPattern } from "@/components/ui/grid-pattern"
import { DEPTH_RATIO, FACE_SCALE, NavBlock } from "@/components/nav-block"
import { SectionPanel, SQUARE_FRACTION } from "@/components/section-panel"
import { SocialCell, SOCIALS } from "@/components/social-cell"
import { cellBox, SKEW_DEG, SKEW_TAN, useWallMetrics, Z_DIR } from "@/hooks/use-wall-metrics"
import { sections } from "@/data/sections"
import { cn } from "@/lib/utils"

/**
 * Opening a section is a camera move, not an overlay: the whole wall flies at
 * the clicked block's face — zooming in while the plane unskews and takes a
 * small 3D swing — until the face IS the screen. One spring drives it; the
 * scene stays live throughout and simply sweeps out of frame.
 */
const CAMERA_SPRING = {
  type: "spring",
  stiffness: 55,
  damping: 15,
  mass: 1,
  restDelta: 0.0005,
} as const

/** Mid-flight 3D swing (degrees): zero at both endpoints via a sine bell, so
 *  takeoff and landing stay exact while the plane visibly rotates in x and y
 *  on the way (the unskew itself supplies the z feel). */
const SWING_X = 2.5
const SWING_Y = -4
const PERSPECTIVE = 1200

/**
 * The camera's transform chain at progress v, shared verbatim by the wall and
 * the crisp overlay: with each element's transform-origin pinned on its copy
 * of the SAME pivot (the wall's is the cell centre; the overlay's, the
 * viewport centre the cell lands on), an identical perspective/swing/unskew
 * chain — differing only in translate and zoom — keeps the two aligned to the
 * pixel at every v.
 */
const chain = (v: number, tx: number, ty: number, scale: number) => {
  const bell = Math.sin(Math.PI * Math.min(Math.max(v, 0), 1))
  return (
    `translate3d(${tx}px, ${ty}px, 0) ` +
    `perspective(${PERSPECTIVE}px) rotateX(${SWING_X * bell}deg) rotateY(${SWING_Y * bell}deg) ` +
    `skewY(${SKEW_DEG * (1 - v)}deg) scale(${scale})`
  )
}

type CamGeom = {
  /** transform-origin: the target cell's centre in the wall's local (unskewed)
   *  coords — the fixed point every camera operation pivots around. */
  origin: string
  /** Translate at p=0 that makes skewing about the cell equal the rest state's
   *  skew about the wall centre. */
  t0y: number
  /** Translate at p=1 that parks the cell centre on the viewport centre. */
  t1x: number
  t1y: number
  /** Zoom that makes the flattened face match the destination square. */
  k: number
  /** Overlay translate at p=0 (it vanishes linearly by p=1). */
  ox0: number
  oy0: number
  /**
   * The crisp overlay: a native-resolution reconstruction of the zoomed view
   * (grid, flanks, face), authored in landed screen coords and driven by the
   * same camera chain — scaled DOWN mid-flight instead of a raster scaled up,
   * so it is sharp at every point it is visible. `m` oversizes it so it
   * covers the viewport from the fade-in point onward; `span` is the
   * magnified cell (= socket side), `stroke` the magnified grid line, `D` the
   * face side, `ud` the magnified extrusion depth for the flank/face slide.
   */
  ov: { m: number; vw: number; vh: number; span: number; stroke: number; D: number; ud: number }
}

/**
 * Every darkened cell on the wall has a job: four pop out into the section
 * squares, four carry the etched social marks. There is no purely decorative
 * fill — if a square is dark, it does something.
 */
export function Wall() {
  const { stageRef, wallRef, metrics } = useWallMetrics()
  const reduce = useReducedMotion()

  const [poppedId, setPoppedId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const active = sections.find((s) => s.id === activeId) ?? null

  /** Camera flight progress. */
  const p = useMotionValue(0)
  /** Geometry version — bumped whenever camRef changes so the derived styles
   *  below recompute even though p hasn't moved. */
  const gv = useMotionValue(0)
  const camRef = useRef<CamGeom | null>(null)
  const flight = useRef<AnimationPlaybackControls | null>(null)

  /** Content visibility, deliberately NOT derived from p: it fades in only
   *  when the flight actually completes (spring tails make "p ≈ 1" a long,
   *  fuzzy moment) and is yanked the instant a close begins. */
  const reveal = useMotionValue(0)
  const revealAnim = useRef<AnimationPlaybackControls | null>(null)

  // The camera aims at the CELL centre, not at the popped face: the same
  // progress value flattens the block's oblique offset (see NavBlock), so by
  // landing the face sits dead-centre over its socket — a plain square of
  // side S·FACE_SCALE, which is all a perpendicular view of a cube shows.
  const computeCam = (cell: [col: number, row: number]): CamGeom => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const box = cellBox(metrics, cell[0], cell[1])
    const fx = box.left + box.size / 2
    const fy = box.top + box.size / 2
    const wallTop = wallRef.current?.offsetTop ?? -0.3 * vh
    const D = Math.min(vw, vh) * SQUARE_FRACTION
    const k = D / (box.size * FACE_SCALE)
    const t0y = SKEW_TAN * (fx - metrics.wallW / 2)
    return {
      origin: `${fx}px ${fy}px`,
      t0y,
      t1x: vw / 2 - fx,
      t1y: vh / 2 - (fy + wallTop),
      k,
      ox0: fx - vw / 2,
      oy0: fy + wallTop + t0y - vh / 2,
      ov: {
        m: Math.round(0.8 * Math.max(vw, vh)),
        vw,
        vh,
        span: box.size * k,
        stroke: k,
        D,
        ud: k * Math.round(box.size * DEPTH_RATIO),
      },
    }
  }

  /** Prewarm on hover: mounting the (invisible) overlay while the block pops
   *  lets its large layer rasterize before the click, so the flight never pays
   *  that cost as a takeoff hitch. Safe at p=0 — the parameterized transform
   *  collapses to the resting skew for ANY geometry. */
  const prime = (id: string, cell: [col: number, row: number]) => {
    setPoppedId(id)
    if (!activeId) {
      camRef.current = computeCam(cell)
      gv.set(gv.get() + 1)
    }
  }

  const open = (id: string, cell: [col: number, row: number]) => {
    camRef.current = computeCam(cell)
    gv.set(gv.get() + 1)
    setActiveId(id)
    revealAnim.current?.stop()
    reveal.set(0)
    flight.current?.stop()
    flight.current = animate(p, 1, {
      ...CAMERA_SPRING,
      onComplete: () => {
        revealAnim.current = animate(reveal, 1, { duration: 0.22, ease: "easeOut" })
      },
    })
  }

  const close = useCallback(() => {
    revealAnim.current?.stop()
    revealAnim.current = animate(reveal, 0, { duration: 0.1, ease: "easeOut" })
    flight.current?.stop()
    flight.current = animate(p, 0, {
      ...CAMERA_SPRING,
      onComplete: () => {
        // back to the plain resting skew — identical on screen at p=0, but
        // free of stale geometry if the window later resizes
        camRef.current = null
        setActiveId(null)
        gv.set(gv.get() + 1)
      },
    })
  }, [gv, p, reveal])

  /**
   * The camera, as one compositor-only transform. With the origin pinned on
   * the face centre, skew/zoom/swing all pivot around the destination, and the
   * translate alone steers that point from its resting spot to the viewport
   * centre. Zoom is exponential (k^p) — equal flight time covers equal
   * magnification, which is what makes it read as a dolly rather than a
   * stretch. At p=0 the whole expression collapses to the resting skew.
   */
  const camTransform = useTransform([p, gv], (latest: unknown[]) => {
    const v = latest[0] as number
    const g = camRef.current
    if (!g) return `skewY(${SKEW_DEG}deg)`
    return chain(v, g.t1x * v, g.t0y + (g.t1y - g.t0y) * v, Math.pow(g.k, v))
  })
  const camOrigin = useTransform([p, gv], () => camRef.current?.origin ?? "50% 50%")

  /**
   * The crisp overlay's camera: same chain, translate shrinking linearly to
   * zero and zoom k^(v-1) so it hits identity exactly at landing. It fades in
   * once its oversized authoring region covers the viewport — the raster
   * blur is only ever visible below ~5× zoom, where motion hides it.
   */
  const overlayTransform = useTransform([p, gv], (latest: unknown[]) => {
    const v = latest[0] as number
    const g = camRef.current
    if (!g) return "none"
    return chain(v, g.ox0 * (1 - v), g.oy0 * (1 - v), Math.pow(g.k, v - 1))
  })
  const overlayOpacity = useTransform(p, [0.62, 0.78], [0, 1])

  /** The block solid inside the overlay, tracking NavBlock's flatten exactly:
   *  face offset u = k·depth·(1-v²) along Z_DIR, flanks joining face corners
   *  to the socket's — the same geometry, magnified. */
  const overlaySolid = (v: number) => {
    const g = camRef.current
    if (!g) return { ux: 0, uy: 0, top: "", right: "" }
    const { vw, vh, span, D, ud } = g.ov
    const e = Math.min(Math.max(v, 0), 1)
    const flat = 1 - e * e
    const ux = Z_DIR.x * ud * flat
    const uy = Z_DIR.y * ud * flat
    const cx = vw / 2
    const cy = vh / 2
    const hf = D / 2
    const hs = span / 2
    // face corners a,b,c (TL, TR, BR) and socket corners p,q,r (TL, TR, BR)
    const ax = cx + ux - hf
    const ay = cy + uy - hf
    const bx = cx + ux + hf
    const cyy = cy + uy + hf
    const px = cx - hs
    const py = cy - hs
    const qx = cx + hs
    const ry = cy + hs
    return {
      ux,
      uy,
      top: `M${ax} ${ay}L${bx} ${ay}L${qx} ${py}L${px} ${py}Z`,
      right: `M${bx} ${ay}L${qx} ${py}L${qx} ${ry}L${bx} ${cyy}Z`,
    }
  }
  const flankTopD = useTransform([p, gv], (l: unknown[]) => overlaySolid(l[0] as number).top)
  const flankRightD = useTransform([p, gv], (l: unknown[]) => overlaySolid(l[0] as number).right)
  const faceUx = useTransform([p, gv], (l: unknown[]) => overlaySolid(l[0] as number).ux)
  const faceUy = useTransform([p, gv], (l: unknown[]) => overlaySolid(l[0] as number).uy)

  // the name isn't part of the wall plane, so it bows out as the camera moves
  const nameOpacity = useTransform(p, [0, 0.3], [1, 0])

  return (
    <div ref={stageRef} className="fixed inset-0 overflow-hidden bg-background">
      {/* The wall plane, slanted like the original demo. A 2D skew keeps the
          SVG crisp at rest — Chrome paints 2D transforms as vectors; the 3D
          camera only kicks in during a flight. Oversized vertically so the
          slant never exposes a corner of background. */}
      <motion.div
        ref={wallRef}
        className="absolute inset-x-0 inset-y-[-30%]"
        style={{
          transform: camTransform,
          transformOrigin: camOrigin,
          willChange: "transform",
          pointerEvents: activeId ? "none" : undefined,
        }}
      >
        <motion.div
          className="absolute inset-0"
          initial={reduce ? {} : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        >
          <GridPattern
            width={metrics.cell}
            height={metrics.cell}
            x={metrics.originX}
            y={metrics.originY}
            className={cn(
              "fill-grid-fill stroke-grid-line",
              // vignette around the edges of the field
              "[mask-image:radial-gradient(closest-side_at_50%_50%,white_45%,transparent_94%)]",
            )}
          />
        </motion.div>

        {/* recesses the nav blocks sit in, revealed once they slide out */}
        {metrics.navOffsets.map(([col, row], i) => {
          const box = cellBox(metrics, col, row)
          return (
            <div
              key={`socket-${i}`}
              aria-hidden
              className="absolute bg-[var(--socket)] shadow-[inset_0_1px_6px_var(--socket-shadow)]"
              style={{ left: box.left, top: box.top, width: box.size, height: box.size }}
            />
          )
        })}

        {sections.map((section, i) => {
          const offset = metrics.navOffsets[i]
          if (!offset) return null
          return (
            <NavBlock
              key={section.id}
              label={section.label}
              box={cellBox(metrics, offset[0], offset[1])}
              popped={poppedId === section.id || activeId === section.id}
              flatten={p}
              onPop={() => prime(section.id, offset)}
              onUnpop={() => setPoppedId((id) => (id === section.id ? null : id))}
              onOpen={() => open(section.id, offset)}
            />
          )
        })}

        {/* the other four darkened cells: social marks etched into the wall */}
        {SOCIALS.map((social, i) => {
          const offset = metrics.socialOffsets[i]
          if (!offset) return null
          return (
            <SocialCell
              key={social.id}
              social={social}
              box={cellBox(metrics, offset[0], offset[1])}
            />
          )
        })}
      </motion.div>

      <CursorTrail />

      <motion.div
        className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full"
        style={{ top: `calc(50% - ${metrics.cell * 0.9}px)`, opacity: nameOpacity }}
      >
        <motion.h1
          initial={reduce ? {} : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="font-mono text-[clamp(1.4rem,4.4vw,2.5rem)] leading-none tracking-[-0.03em] whitespace-nowrap lowercase"
        >
          harrison li
          <span
            aria-hidden
            className="ml-[0.12em] inline-block h-[0.78em] w-[0.38em] translate-y-[0.04em] bg-accent-soft/55 align-middle caret-blink"
          />
        </motion.h1>
      </motion.div>

      {/* The crisp view: a native-resolution reconstruction of the zoomed
          scene (background, grid, flanks, face), flown by the same camera
          chain as the wall so they align to the pixel, fading in mid-flight
          where the wall's scaled raster would start to smear. Being authored
          at landed size and scaled DOWN, it is sharp wherever it is visible. */}
      {(active || poppedId) &&
        camRef.current &&
        (() => {
          const { m, vw, vh, span, stroke, D } = camRef.current.ov
          const xs: number[] = []
          const ys: number[] = []
          const nMax = Math.ceil((Math.max(vw, vh) / 2 + m) / span) + 1
          for (let n = -nMax; n <= nMax + 1; n++) {
            const x = vw / 2 + span * (n - 0.5)
            if (x >= -m && x <= vw + m) xs.push(x)
            const y = vh / 2 + span * (n - 0.5)
            if (y >= -m && y <= vh + m) ys.push(y)
          }
          return (
            <motion.svg
              aria-hidden
              className="pointer-events-none fixed z-40"
              style={{
                left: -m,
                top: -m,
                width: vw + 2 * m,
                height: vh + 2 * m,
                opacity: overlayOpacity,
                transform: overlayTransform,
                transformOrigin: `${vw / 2 + m}px ${vh / 2 + m}px`,
                willChange: "transform",
              }}
              viewBox={`${-m} ${-m} ${vw + 2 * m} ${vh + 2 * m}`}
            >
              <rect
                x={-m}
                y={-m}
                width={vw + 2 * m}
                height={vh + 2 * m}
                style={{ fill: "var(--background)" }}
              />
              {xs.map((x) => (
                <line
                  key={`x${x}`}
                  x1={x}
                  y1={-m}
                  x2={x}
                  y2={vh + m}
                  strokeWidth={stroke}
                  style={{ stroke: "var(--grid-line)" }}
                />
              ))}
              {ys.map((y) => (
                <line
                  key={`y${y}`}
                  x1={-m}
                  y1={y}
                  x2={vw + m}
                  y2={y}
                  strokeWidth={stroke}
                  style={{ stroke: "var(--grid-line)" }}
                />
              ))}
              <motion.path d={flankTopD} style={{ fill: "var(--block-side-top)" }} />
              <motion.path d={flankRightD} style={{ fill: "var(--block-side-right)" }} />
              <motion.rect
                x={vw / 2 - D / 2}
                y={vh / 2 - D / 2}
                width={D}
                height={D}
                style={{ fill: "var(--block-face-hover)", x: faceUx, y: faceUy }}
              />
            </motion.svg>
          )
        })()}

      {/* invisible click-catcher: the background stays exactly as the camera
          left it, but a click anywhere off the square still closes */}
      {active && <div aria-hidden className="fixed inset-0 z-40" onClick={close} />}

      {active && <SectionPanel section={active} reveal={reveal} onClose={close} />}
    </div>
  )
}
