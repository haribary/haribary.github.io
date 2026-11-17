import { Fragment, type ReactNode } from "react"

import type { Span } from "@/lab/content"

/** Wraps each word in a span so the controller can light them one at a time. */
function split(text: string, key: string): ReactNode[] {
  return text.split(/(\s+)/).map((part, i) =>
    part.trim() === "" ? (
      part
    ) : (
      <span key={`${key}-${i}`} className="sg-w">
        {part}
      </span>
    ),
  )
}

/** Running text as individually lit words; links and emphasis are preserved. */
export function Words({ spans, text }: { spans?: Span[]; text?: string }) {
  const runs: Span[] = spans ?? [{ text: text ?? "" }]
  return (
    <>
      {runs.map((s, i) => {
        const words = split(s.text, String(i))
        if (s.href) {
          return (
            <a key={i} href={s.href} target="_blank" rel="noreferrer">
              {words}
            </a>
          )
        }
        if (s.strong) return <strong key={i}>{words}</strong>
        return <Fragment key={i}>{words}</Fragment>
      })}
    </>
  )
}

/** A small arrow for links that leave the page. */
export function Out() {
  return (
    <svg className="sg-out" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M2 8 8 2M3.2 2H8v4.8" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
