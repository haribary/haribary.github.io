import { useEffect, useRef } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import Lenis, { type LenisOptions } from "lenis"
import "lenis/dist/lenis.css"

gsap.registerPlugin(ScrollTrigger)

/** True when the visitor asked the OS for less motion. */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Lenis smooth scrolling on the window, driven by GSAP's ticker so Lenis,
 * ScrollTrigger and any scrubbed timeline all advance in the same frame.
 *
 * Call once at the root of an experiment. The instance is destroyed on
 * unmount, and every ScrollTrigger created while it was alive is killed, so
 * switching experiments leaves nothing behind.
 *
 * With reduced motion requested, Lenis is not created at all: the page scrolls
 * natively and ScrollTrigger still works off the native scroll position.
 */
export function useSmoothScroll(options?: LenisOptions) {
  const lenisRef = useRef<Lenis | null>(null)
  // Options are read once on mount; an experiment has one scroll feel.
  const optionsRef = useRef(options)

  useEffect(() => {
    window.scrollTo(0, 0)
    if (prefersReducedMotion()) {
      return () => {
        ScrollTrigger.getAll().forEach((t) => t.kill())
      }
    }

    const lenis = new Lenis({
      lerp: 0.09,
      wheelMultiplier: 1,
      anchors: true,
      ...optionsRef.current,
      autoRaf: false,
    })
    lenisRef.current = lenis

    lenis.on("scroll", ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      lenisRef.current = null
      ScrollTrigger.getAll().forEach((t) => t.kill())
    }
  }, [])

  return lenisRef
}

export { gsap, ScrollTrigger }
