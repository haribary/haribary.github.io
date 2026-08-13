import { useEffect, useRef } from "react"

/**
 * A wispy, multi-stranded golden trail that follows the cursor.
 *
 * Five strands chase the pointer through critically-damped springs with
 * different stiffness and a slow per-strand orbit, so they braid around each
 * other and lag naturally — jerky mouse input comes out as smooth ribbons.
 * Each strand is stroked twice (wide soft pass + thin bright core) with width
 * and alpha tapering down its length, which is what sells the depth.
 *
 * The whole trail's intensity is a function of the cursor's distance to the
 * nearest interactive cell ([data-glow-cell]): a whisper out in the open field,
 * fully lit when closing in on a square. It also dies out when the pointer
 * rests, so the screen stays calm.
 *
 * Deliberately NOT gated on prefers-reduced-motion — like the blocks and the
 * toggle, this effect is the point of the page.
 */

const WISPS = 5
const POINTS = 34

type Strand = {
  x: number
  y: number
  /** per-frame exponential approach rate — pure glide, no momentum, so a
      jerked cursor is approached monotonically and never overshot */
  rate: number
  phase: number
  orbit: number
  speed: number
  pts: { x: number; y: number }[]
}

export function CursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
    }
    resize()
    window.addEventListener("resize", resize)

    // Screen centres of every interactive cell. Layout is static between
    // resizes, so a slow poll is plenty (and survives cells re-rendering).
    let cells: { x: number; y: number }[] = []
    let cellSize = 56
    const measure = () => {
      const els = document.querySelectorAll("[data-glow-cell]")
      cells = [...els].map((el) => {
        const r = el.getBoundingClientRect()
        cellSize = r.width
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
    }
    measure()
    const remeasure = window.setInterval(measure, 800)

    const mouse = { x: -1e4, y: -1e4 }
    let lastMove = 0
    let started = false
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      lastMove = performance.now()
      // On the very first move, teleport every strand to the cursor. Without
      // this they spring in from the middle of the screen — a page-wide flash
      // of gold streaks on startup.
      if (!started) {
        started = true
        for (const s of strands) {
          s.x = e.clientX
          s.y = e.clientY
          s.pts.length = 0
        }
      }
    }
    window.addEventListener("pointermove", onMove)

    const strands: Strand[] = Array.from({ length: WISPS }, (_, i) => ({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      rate: 0.3 - i * 0.045,
      phase: (i / WISPS) * Math.PI * 2,
      orbit: 4 + i * 2.5,
      speed: 1.1 + i * 0.4,
      pts: [],
    }))

    let intensity = 0
    let raf = 0

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      const t = now / 1000
      const dark = document.documentElement.classList.contains("dark")

      // intensity: proximity to the nearest cell, gated by recent movement
      let dMin = Infinity
      for (const c of cells) {
        const d = Math.hypot(mouse.x - c.x, mouse.y - c.y)
        if (d < dMin) dMin = d
      }
      const outer = cellSize * 4.5
      const inner = cellSize * 0.6
      const prox = Math.max(0, Math.min(1, (outer - dMin) / (outer - inner)))
      const activity = Math.max(0, Math.min(1, 1 - (now - lastMove - 700) / 700))
      // At point-blank range the trail yields to the cell itself — the light
      // reads as pouring INTO the mark instead of scribbling over it.
      const yieldNear = Math.max(
        0,
        Math.min(1, (dMin - cellSize * 0.55) / (cellSize * 0.6)),
      )
      const target = (0.12 + 0.88 * prox) * activity * (0.08 + 0.92 * yieldNear)
      intensity += (target - intensity) * 0.07

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      if (intensity < 0.01) return
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      // additive blending glows on the dark wall; on the light wall it would
      // wash out against white, so paint normally with deeper amber instead
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over"

      for (const s of strands) {
        const tx = mouse.x + Math.cos(t * s.speed + s.phase) * s.orbit
        const ty = mouse.y + Math.sin(t * s.speed * 1.3 + s.phase) * s.orbit * 0.8
        s.x += (tx - s.x) * s.rate
        s.y += (ty - s.y) * s.rate
        s.pts.unshift({ x: s.x, y: s.y })
        if (s.pts.length > POINTS) s.pts.pop()

        for (let j = 0; j < s.pts.length - 1; j++) {
          const a = s.pts[j]
          const b = s.pts[j + 1]
          const life = 1 - j / (s.pts.length - 1)
          const fade = Math.pow(life, 1.7) * intensity

          // soft wide pass — the haze around the strand
          ctx.strokeStyle = dark
            ? `hsla(43, 95%, 62%, ${fade * 0.16})`
            : `hsla(36, 90%, 46%, ${fade * 0.14})`
          ctx.lineWidth = 7 * life + 0.5
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()

          // bright thin core
          ctx.strokeStyle = dark
            ? `hsla(49, 100%, 74%, ${fade * 0.5})`
            : `hsla(40, 95%, 48%, ${fade * 0.45})`
          ctx.lineWidth = 1.8 * life + 0.3
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(remeasure)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", onMove)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-20 h-full w-full"
    />
  )
}
