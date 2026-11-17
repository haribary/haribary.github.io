import { useEffect, useRef, useState } from "react"
import "@fontsource-variable/archivo/wdth.css"

import { useSmoothScroll, prefersReducedMotion, gsap, ScrollTrigger } from "@/lab/smooth-scroll"
import { CARD_COUNT, breathingWidth, clamp, motion, smoothstep, spiralState } from "./motion"
import { collectEdges, measureEdges, updateEdges } from "./edges"
import { ReelScene, type AdvanceRef } from "./scene"
import { About, Contact, Opening, Projects, Research, Spiral } from "./sections"
import "./reel.css"

/**
 * Reel: poster-scale type, hard cuts between flat fields of colour, and a
 * spiral of photographs in real 3D that you travel down as you scroll.
 *
 * One GSAP ticker callback drives everything after Lenis has moved the page:
 * it smooths Lenis's velocity, breathes the width axis of the giant type,
 * renders the WebGL frame, places the photo captions and redraws the
 * organic section edges.
 */
export default function Reel() {
  const lenisRef = useSmoothScroll({ lerp: 0.085 })
  const [reduced] = useState(prefersReducedMotion)
  const rootRef = useRef<HTMLDivElement>(null)
  const spiralRef = useRef<HTMLElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)
  const labelRef = useRef<HTMLHeadingElement>(null)
  const openFadeRef = useRef<HTMLDivElement>(null)
  const advanceRef: AdvanceRef = useRef(null)

  // Declared after useSmoothScroll, so this ticker runs after Lenis's each frame.
  useEffect(() => {
    const root = rootRef.current
    const spiral = spiralRef.current
    if (!root || !spiral) return
    motion.reduced = reduced
    const edges = reduced ? [] : collectEdges(root)
    const caption = captionRef.current
    const captionCount = caption?.querySelector<HTMLElement>("[data-count]")
    const captionText = caption?.querySelector<HTMLElement>("[data-text]")
    const captionItems = Array.from(
      root.querySelectorAll<HTMLElement>("[data-photo-alt]"),
      (el) => el.dataset.photoAlt ?? "",
    )

    const measure = () => {
      motion.vh = window.innerHeight
      motion.vw = window.innerWidth
      const sy = window.scrollY
      motion.spiralTop = spiral.getBoundingClientRect().top + sy
      motion.spiralHeight = spiral.offsetHeight
      measureEdges(edges)
    }
    measure()
    ScrollTrigger.addEventListener("refresh", measure)
    window.addEventListener("resize", measure)

    const start = performance.now()
    let last = start
    let lastWidth = -1
    let lastCaption = -1
    let lastCaptionVis = -1
    let lastOpen = -1
    let lastLabel = -1
    let canvasOn = true

    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const lenis = lenisRef.current
      motion.time = (now - start) / 1000
      motion.scroll = lenis ? lenis.scroll : window.scrollY

      // Velocity: px per frame -> -1..1, quick to rise, slower to settle.
      const raw = reduced ? 0 : (lenis?.velocity ?? 0)
      motion.raw = raw
      const target = clamp(raw / 42, -1, 1)
      const rising = Math.abs(target) > Math.abs(motion.vel)
      const a = 1 - Math.exp(-dt / (rising ? 0.08 : 0.32))
      motion.vel += (target - motion.vel) * a
      if (Math.abs(motion.vel) < 0.0008 && target === 0) motion.vel = 0
      const m = Math.abs(motion.vel)
      motion.speed = 1 - Math.pow(1 - m, 2.2)

      // Giant type breathes on the width axis.
      const w = Math.round(breathingWidth(motion.speed) * 4) / 4
      if (w !== lastWidth) {
        root.style.setProperty("--reel-wdth", String(w))
        lastWidth = w
      }

      const s = spiralState(motion.scroll, motion.vh, motion.spiralTop, motion.spiralHeight)

      // Opening DOM (role line, cue) fades as the forest field arrives.
      const open = Math.round((1 - smoothstep(0.04, 0.3, s.intro)) * 100) / 100
      if (open !== lastOpen && openFadeRef.current) {
        openFadeRef.current.style.opacity = String(open)
        openFadeRef.current.style.visibility = open === 0 ? "hidden" : ""
        lastOpen = open
      }

      const label = Math.round(smoothstep(0.62, 0.92, s.intro) * 50) / 50
      if (label !== lastLabel && labelRef.current) {
        labelRef.current.style.opacity = String(label)
        lastLabel = label
      }

      // WebGL: render only while the canvas can be seen.
      const visible = motion.scroll < motion.spiralTop + motion.spiralHeight + 4
      if (visible !== canvasOn && canvasWrapRef.current) {
        canvasWrapRef.current.style.visibility = visible ? "" : "hidden"
        canvasOn = visible
      }
      if (visible) advanceRef.current?.(now)

      // Caption for the photograph facing us.
      if (caption && captionText && captionCount) {
        const idx = Math.round(s.slot)
        const inSpiral = s.intro >= 0.999 && s.exit < 0.35
        const near = inSpiral ? 1 - smoothstep(0.03, 0.18, Math.abs(s.slot - idx)) : 0
        const vis = Math.round(near * 50) / 50
        if (idx !== lastCaption) {
          captionText.textContent = captionItems[idx] ?? ""
          captionCount.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(CARD_COUNT).padStart(2, "0")}`
          lastCaption = idx
        }
        if (vis !== lastCaptionVis) {
          caption.style.opacity = String(vis)
          caption.style.transform = `translate3d(0, ${((1 - vis) * 14).toFixed(1)}px, 0)`
          lastCaptionVis = vis
        }
      }

      updateEdges(edges)
    }
    gsap.ticker.add(tick)

    // Web font metrics change layout: re-measure once it has loaded.
    let alive = true
    document.fonts.ready.then(() => {
      if (alive) ScrollTrigger.refresh()
    })

    return () => {
      alive = false
      gsap.ticker.remove(tick)
      ScrollTrigger.removeEventListener("refresh", measure)
      window.removeEventListener("resize", measure)
      root.style.removeProperty("--reel-wdth")
    }
  }, [lenisRef, reduced])

  return (
    <div ref={rootRef} className="x-reel" data-static={reduced ? "" : undefined} id="top">
      {!reduced && (
        <div ref={canvasWrapRef} className="reel-canvas" aria-hidden="true">
          <ReelScene advanceRef={advanceRef} />
        </div>
      )}
      <main className="reel-main">
        <Opening fadeRef={openFadeRef} />
        <Spiral sectionRef={spiralRef} captionRef={captionRef} labelRef={labelRef} />
        <About reduced={reduced} />
        <Projects reduced={reduced} />
        <Research reduced={reduced} />
        <Contact />
      </main>
    </div>
  )
}
