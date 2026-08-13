import { useEffect, useRef, useState } from "react"
import { motion, useTransform } from "motion/react"
import type { MotionValue } from "motion/react"
import { X } from "lucide-react"

import type { Section } from "@/data/sections"

export type Rect = { left: number; top: number; width: number; height: number }

/** The destination square's share of the viewport's smaller side. The camera's
 *  zoom factor is derived from the same number, so the magnified block face
 *  lands exactly under this panel. */
export const SQUARE_FRACTION = 0.92

/** A SQUARE, like the block it is — uniform scale, no stretch. */
function squareBox() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const d = Math.min(vw, vh) * SQUARE_FRACTION
  return { d, left: (vw - d) / 2, top: (vh - d) / 2 }
}

type SectionPanelProps = {
  section: Section
  /** Content visibility, owned by the Wall: animated to 1 only when the
   *  camera flight completes, snapped back to 0 the moment a close begins. */
  reveal: MotionValue<number>
  onClose: () => void
}

/**
 * The content layer for an open section. It does not animate itself — the
 * camera (in Wall) flies the whole scene at the block's face, and this square
 * simply fades in over the magnified face during the last stretch of the
 * flight. Same colour as the face, so the hand-off is invisible.
 */
export function SectionPanel({ section, reveal, onClose }: SectionPanelProps) {
  const cardRef = useRef<HTMLElement>(null)
  const [box, setBox] = useState(squareBox)

  useEffect(() => {
    const onResize = () => setBox(squareBox())
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    // Focus the panel itself, not the close button: Escape and tabbing still
    // work, without a focus ring flashing on top of the animation.
    cardRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // while invisible, let clicks fall through to the close-catcher behind
  const pointerEvents = useTransform(reveal, (o) => (o > 0.5 ? "auto" : "none"))

  return (
    <motion.section
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={section.label}
      tabIndex={-1}
      style={{
        position: "fixed",
        left: box.left,
        top: box.top,
        width: box.d,
        height: box.d,
        opacity: reveal,
        pointerEvents,
      }}
      className="z-50 flex flex-col overflow-hidden bg-[var(--block-face-hover)] text-foreground outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-4 sm:px-8 sm:py-5">
        <h2 className="font-mono text-xl tracking-tight lowercase sm:text-[1.5rem]">
          {section.label}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="group grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface/40 text-muted transition-colors duration-200 hover:border-line-strong hover:text-foreground"
        >
          <X className="size-4 transition-transform duration-300 group-hover:rotate-90" />
        </button>
      </header>

      <div className="scroll-slim flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 sm:px-8 sm:pb-8">
        {/* flex-1 lets the body fill the square, and still scroll when taller */}
        <div className="flex flex-1 flex-col [&>*]:flex-1">{section.body()}</div>
      </div>
    </motion.section>
  )
}
