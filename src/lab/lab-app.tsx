import { Suspense, useEffect, useId, useRef, useState } from "react"

import { currentExperiment, experiments, type Experiment } from "./experiments"
import "./lab.css"

/** Root of the design-lab branch: mounts one experiment and the switcher. */
export function LabApp() {
  const [experiment] = useState(currentExperiment)

  useEffect(() => {
    document.documentElement.dataset.lab = experiment.id
    if (experiment.id !== "wall") {
      // The wall's light/dark tokens are its own; experiments set their palette.
      document.documentElement.classList.remove("dark")
      document.title = `Harrison Li — ${experiment.title}`
    }
  }, [experiment])

  return (
    <>
      <Suspense fallback={null}>
        <experiment.Component />
      </Suspense>
      <LabSwitcher current={experiment} />
    </>
  )
}

function LabSwitcher({ current }: { current: Experiment }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  return (
    <div ref={rootRef} className="lab-switcher" data-dock={current.dock} data-open={open}>
      {open && (
        <nav id={menuId} className="lab-switcher__menu" aria-label="Design experiments">
          {experiments.map((e) => (
            <a
              key={e.id}
              href={`?lab=${e.id}`}
              className="lab-switcher__item"
              aria-current={e.id === current.id ? "page" : undefined}
            >
              <span className="lab-switcher__title">{e.title}</span>
              <span className="lab-switcher__summary">{e.summary}</span>
            </a>
          ))}
        </nav>
      )}
      <button
        type="button"
        className="lab-switcher__button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lab-switcher__dot" aria-hidden="true" />
        Lab: {current.title}
      </button>
    </div>
  )
}
