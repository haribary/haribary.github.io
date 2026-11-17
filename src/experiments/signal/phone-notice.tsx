import "./plate.css"

import { useSyncExternalStore, type ReactNode } from "react"

/**
 * The page is built for a computer screen. On a phone it is not shown at all:
 * the visitor gets a plain white page with one line of text instead, and none
 * of the scene is loaded.
 */

/** A phone held either way up: a narrow window, or a short one on a touch screen. */
const PHONE = "(max-width: 760px), ((pointer: coarse) and (max-height: 540px))"

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Shows the page on a computer and the notice on a phone; follows resizing and rotation. */
export function PhoneGate({ children }: { children: ReactNode }) {
  const phone = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  )
  if (!phone) return children
  return (
    <main className="sg-phone">
      <p>This site doesn’t support phones yet. Please view it on a computer.</p>
    </main>
  )
}
