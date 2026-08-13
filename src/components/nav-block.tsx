import { useEffect } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import type { MotionValue } from "motion/react"

import { Z_DIR } from "@/hooks/use-wall-metrics"
import { cn } from "@/lib/utils"

/** Extrusion depth as a fraction of the cell — how far the block leaves the wall. */
export const DEPTH_RATIO = 0.55
/** Slight growth of the front face, the one cue that says "toward you". */
export const FACE_SCALE = 1.09
/** One spring for the whole solid: unhurried out, quick settle, no wobble. */
const POP_SPRING = { type: "spring", stiffness: 190, damping: 26, mass: 0.85 } as const
/** Reduced motion keeps a short, quiet slide — subtle, but never a hard snap. */
const POP_TWEEN = { duration: 0.22, ease: "easeOut" } as const

type Pt = [number, number]

type NavBlockProps = {
  label: string
  /** Cell rect in wall coordinates. */
  box: { left: number; top: number; size: number }
  popped: boolean
  /**
   * Camera progress, 0..1. The block's oblique offset is a side-view artifact:
   * as the camera arcs perpendicular to the wall, the face slides back over
   * its socket, the flanks vanish behind it, and the shadow dies — at 1 the
   * "cube" is literally just a square, which is what a dead-on view shows.
   */
  flatten: MotionValue<number>
  onPop: () => void
  onUnpop: () => void
  onOpen: () => void
}

const poly = (...pts: Pt[]) =>
  `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(",")})`

/**
 * A darkened grid cell that becomes a solid block sliding out of the wall,
 * along the plane's one shared z-axis (`Z_DIR`).
 *
 * This does NOT use CSS 3D. A real perspective projection of a 56px square near
 * the middle of the screen yields a few px of side face — geometrically correct
 * and visually nothing. So the block is drawn directly: the front face travels
 * along Z_DIR while the two flanks that direction exposes (top and right, for a
 * down-left axis) are filled in as quads joining the face's edges to the
 * socket's edges. The quads share their edges with the face and each other, so
 * the three shapes tile into one seamless solid; the two hidden flanks are
 * simply never drawn.
 */
export function NavBlock({ label, box, popped, flatten, onPop, onUnpop, onOpen }: NavBlockProps) {
  const reduce = useReducedMotion()

  const S = box.size
  const depth = Math.round(S * DEPTH_RATIO)
  // padding around the cell so the block has room to travel and cast its shadow
  const M = depth + 8
  const W = S + 2 * M

  const t = useMotionValue(0)

  useEffect(() => {
    const controls = animate(t, popped ? 1 : 0, reduce ? POP_TWEEN : POP_SPRING)
    return () => controls.stop()
  }, [popped, reduce, t])

  /** How much of the oblique (side-view) offset survives at camera-fraction
   *  fv. Eased in quadratically: the block keeps its full solidity early in
   *  the flight and flattens late, when the camera is actually coming
   *  perpendicular — a linear tie-in made a barely-started flight (or a quick
   *  Escape) read as the block sinking while its face floated in place. */
  const flat = (fv: number) => {
    const e = Math.min(Math.max(fv, 0), 1)
    return 1 - e * e
  }

  /** Face and socket corners at pop-fraction tv / camera-fraction fv, in the
   *  padded local box. The oblique travel carries the flat() factor: seen
   *  dead-on there is no sideways offset, so the face sits concentric over the
   *  socket and (being FACE_SCALE bigger) hides both flank quads completely. */
  const geom = (tv: number, fv: number) => {
    const side = flat(fv) * tv * depth
    const ox = Z_DIR.x * side
    const oy = Z_DIR.y * side
    const fw = S * (1 + (FACE_SCALE - 1) * tv)
    const fx = M + ox + (S - fw) / 2
    const fy = M + oy + (S - fw) / 2
    return {
      // front face, clockwise from top-left
      a: [fx, fy] as Pt,
      b: [fx + fw, fy] as Pt,
      c: [fx + fw, fy + fw] as Pt,
      d: [fx, fy + fw] as Pt,
      // socket, the hole left in the wall
      p: [M, M] as Pt,
      q: [M + S, M] as Pt,
      r: [M + S, M + S] as Pt,
      s: [M, M + S] as Pt,
    }
  }

  const pair = [t, flatten]

  const faceClip = useTransform(pair, ([tv, fv]: number[]) => {
    const g = geom(tv, fv)
    return poly(g.a, g.b, g.c, g.d)
  })
  // Z_DIR points down-left, so the exposed flanks are the top and the right.
  const topClip = useTransform(pair, ([tv, fv]: number[]) => {
    const g = geom(tv, fv)
    return poly(g.a, g.b, g.q, g.p)
  })
  const rightClip = useTransform(pair, ([tv, fv]: number[]) => {
    const g = geom(tv, fv)
    return poly(g.b, g.q, g.r, g.c)
  })

  const shadowOpacity = useTransform(pair, ([tv, fv]: number[]) => 0.45 * tv * flat(fv))
  const shadowBlur = useTransform(t, [0, 1], ["blur(1px)", "blur(10px)"])
  const shadowScale = useTransform(t, [0, 1], [1, 1.1])
  // the contact shadow trails the block a little way along the same axis
  const shadowX = useTransform(pair, ([tv, fv]: number[]) => Z_DIR.x * depth * tv * flat(fv) * 0.3)
  const shadowY = useTransform(pair, ([tv, fv]: number[]) => Z_DIR.y * depth * tv * flat(fv) * 0.3)

  const layer = "pointer-events-none absolute"
  const layerStyle = { left: -M, top: -M, width: W, height: W }

  return (
    <button
      type="button"
      aria-label={`Open ${label}`}
      data-glow-cell
      onPointerEnter={onPop}
      onPointerLeave={onUnpop}
      onFocus={onPop}
      onBlur={onUnpop}
      onClick={() => {
        // Expand only from a block that is already out of the wall. Taps normally
        // fire pointerenter first, so one tap is enough; this covers the rest.
        if (!popped) {
          onPop()
          return
        }
        onOpen()
      }}
      className="absolute cursor-pointer border-0 bg-transparent p-0 outline-none"
      style={{ left: box.left, top: box.top, width: S, height: S }}
    >
      {/* Once out, the block sits off its cell — extend the hover region to match,
          so the pointer doesn't fall off the raised face and drop it back in. */}
      <span
        aria-hidden
        className={cn("absolute", !popped && "pointer-events-none")}
        style={layerStyle}
      />

      {/* Contact shadow on the wall, clipped to the socket's down-left side:
          the blur spreads ~3× its radius, and any of it landing above or right
          of the socket sits where the solid never covers it — a stray black
          fringe over the wall. Bleeding is only legal along +Z_DIR. */}
      <span
        aria-hidden
        className="pointer-events-none absolute overflow-hidden"
        style={{ left: -M, top: 0, width: M + S, height: M + S }}
      >
        <motion.span
          className="absolute bg-black"
          style={{
            left: M,
            top: 0,
            width: S,
            height: S,
            opacity: shadowOpacity,
            filter: shadowBlur,
            scale: shadowScale,
            x: shadowX,
            y: shadowY,
          }}
        />
      </span>

      {/* the solid: the two exposed flanks, then the front face on top */}
      <motion.span
        aria-hidden
        className={cn(layer, "bg-[var(--block-side-top)]")}
        style={{ ...layerStyle, clipPath: topClip }}
      />
      <motion.span
        aria-hidden
        className={cn(layer, "bg-[var(--block-side-right)]")}
        style={{ ...layerStyle, clipPath: rightClip }}
      />
      <motion.span
        aria-hidden
        className={cn(
          layer,
          "transition-colors duration-300 ease-out",
          popped ? "bg-[var(--block-face-hover)]" : "bg-[var(--block-face)]",
        )}
        style={{ ...layerStyle, clipPath: faceClip }}
      />
    </button>
  )
}
