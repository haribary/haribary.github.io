import { lazy, type ComponentType, type LazyExoticComponent } from "react"

export type Experiment = {
  /** Used in the URL: `?lab=<id>`. */
  id: string
  title: string
  /** One plain sentence about it. */
  summary: string
  Component: LazyExoticComponent<ComponentType>
}

/**
 * Every design experiment on this branch. Each one is a full page that owns
 * its own look; the only shared pieces are src/lab/content.ts (the facts) and
 * src/lab/smooth-scroll.ts (Lenis + GSAP wiring).
 *
 * Switching experiments is a real page load (`?lab=<id>`), so WebGL contexts,
 * scroll listeners and global styles never leak from one into the next.
 */
export const experiments: Experiment[] = [
  {
    id: "signal",
    title: "Signal",
    summary: "A flat drawing tilts into a landscape you fly through.",
    Component: lazy(() => import("@/experiments/signal")),
  },
  {
    id: "hanoi",
    title: "Hanoi",
    summary: "An acrylic Tower of Hanoi solves itself as you scroll.",
    Component: lazy(() => import("@/experiments/hanoi")),
  },
  {
    id: "reel",
    title: "Reel",
    summary: "Poster-scale type and a spiral of photographs.",
    Component: lazy(() => import("@/experiments/reel")),
  },
  {
    id: "wall",
    title: "Wall",
    summary: "The current site, unchanged, for comparison.",
    Component: lazy(() => import("@/App")),
  },
]

export const defaultExperiment = experiments[0]

export function currentExperiment(): Experiment {
  const id = new URLSearchParams(window.location.search).get("lab")
  return experiments.find((e) => e.id === id) ?? defaultExperiment
}
