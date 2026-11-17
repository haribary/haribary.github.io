import { motion, smoothstep } from "./motion"

/**
 * Organic section edges. Each section after a colour change carries an SVG
 * above its top edge, filled with its own colour. As the boundary rises
 * through the viewport the edge swells into lobes that run ahead of it, so the
 * new field floods the screen with a soft, living front instead of a ruler line.
 * Velocity adds wobble. With reduced motion the SVG is hidden: a plain cut.
 */

export type Edge = {
  host: HTMLElement
  path: SVGPathElement
  top: number
  seed: number
  last: string
}

const POINTS = 36

export function collectEdges(root: HTMLElement): Edge[] {
  return Array.from(root.querySelectorAll<SVGSVGElement>("[data-edge]")).map((svg, i) => ({
    host: svg.parentElement as HTMLElement,
    path: svg.querySelector("path")!,
    top: 0,
    seed: 0.7 + i * 2.31,
    last: "",
  }))
}

export function measureEdges(edges: Edge[]) {
  const sy = window.scrollY
  for (const e of edges) {
    const box = (e.host.closest(".pin-spacer") as HTMLElement | null) ?? e.host
    e.top = box.getBoundingClientRect().top + sy
  }
}

export function updateEdges(edges: Edge[]) {
  const { scroll, vh, time, speed } = motion
  for (const e of edges) {
    const p = 1 - (e.top - scroll) / vh // 0: boundary at the bottom, 1: at the top
    if (p < -0.02 || p > 1.6) continue
    const amp = smoothstep(0.0, 0.6, p)
    const s = e.seed
    const t = time * (0.35 + speed * 1.4)
    const ys: number[] = []
    for (let i = 0; i <= POINTS; i++) {
      const x = i / POINTS
      const f =
        0.56 +
        0.24 * Math.sin(Math.PI * 2 * (x * 1.15 + s) + t * 0.6) +
        0.13 * Math.sin(Math.PI * 2 * (x * 2.7 + s * 1.7) - t * 0.9) +
        (0.06 + 0.06 * speed) * Math.sin(Math.PI * 2 * (x * 5.3 + s * 0.6) + t * 1.5)
      ys.push(100 - amp * Math.min(1, Math.max(0, f)) * 100)
    }
    // Smooth curve through the midpoints.
    let d = `M0,101 L0,${ys[0].toFixed(2)}`
    for (let i = 0; i < POINTS; i++) {
      const x0 = (i / POINTS) * 100
      const x1 = ((i + 1) / POINTS) * 100
      const mx = (x0 + x1) / 2
      const my = (ys[i] + ys[i + 1]) / 2
      d += ` Q${x0.toFixed(2)},${ys[i].toFixed(2)} ${mx.toFixed(2)},${my.toFixed(2)}`
    }
    d += ` L100,${ys[POINTS].toFixed(2)} L100,101 Z`
    if (d !== e.last) {
      e.path.setAttribute("d", d)
      e.last = d
    }
  }
}
