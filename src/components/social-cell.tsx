import { useEffect, useRef } from "react"
import { motion, useSpring, useTransform } from "motion/react"

/**
 * A darkened grid cell with a social mark ETCHED into it — an engraving, not a
 * button: the glyph reads as a groove cut into the face (dark incision plus a
 * lit lower lip, the classic chisel cue). Nothing moves on hover; instead the
 * light leaking out of the cracks is driven by MOUSE PROXIMITY — the molten
 * layer's opacity ramps from nothing at ~3 cells away to fully lit with the
 * cursor on the icon, so at half distance the mark sits half-filled with gold.
 * The 0→1 proximity value runs through a spring, which is what keeps jerky
 * pointer movement from strobing the glow. Clicking simply follows the link.
 *
 * Brand paths are from Simple Icons (24x24 viewBox).
 */

type Social = {
  id: string
  label: string
  href: string
  /** SVG path in a 0 0 24 24 viewBox. */
  path: string
}

export const SOCIALS: Social[] = [
  {
    id: "github",
    label: "GitHub",
    href: "https://github.com/haribary",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/harrison-li-60b551368/",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  {
    id: "instagram",
    // TODO: point at the real handle
    label: "Instagram",
    href: "https://www.instagram.com/",
    path: "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z",
  },
  {
    id: "scholar",
    label: "Google Scholar",
    href: "https://scholar.google.com/citations?hl=en&user=a3g1GUwAAAAJ",
    path: "M5.242 13.769L0 9.5 12 0l12 9.5-5.242 4.269C17.548 11.249 14.978 9.5 12 9.5c-2.977 0-5.548 1.749-6.758 4.269zM12 10a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  },
]

function Glyph({ path, className }: { path: string; className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d={path} />
    </svg>
  )
}

export function SocialCell({
  social,
  box,
}: {
  social: Social
  box: { left: number; top: number; size: number }
}) {
  const ref = useRef<HTMLAnchorElement>(null)
  const pinned = useRef(false)

  // 0 at ~3 cells out → 1 with the cursor on the icon. The spring soaks up
  // jerky pointer movement so the fill swells and settles smoothly.
  const p = useSpring(0, { stiffness: 150, damping: 26, mass: 0.6 })

  useEffect(() => {
    // The centre is read fresh on every event rather than cached — a cached
    // centre has too many ways to go stale (late wall layout, devtools
    // resizes, HMR reloads) and a stale centre kills the fill silently.
    // Layout is clean between events, so the rect read costs nothing.
    const onMove = (e: PointerEvent) => {
      if (pinned.current) return
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const size = r.width || 56
      const d = Math.hypot(e.clientX - cx, e.clientY - cy)
      const outer = size * 3
      const inner = size * 0.5
      p.set(Math.max(0, Math.min(1, (outer - d) / (outer - inner))))
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [p])

  const bloomWide = useTransform(p, [0, 1], [0, 1])
  const bloomTight = useTransform(p, [0, 1], [0, 0.9])

  return (
    <a
      ref={ref}
      href={social.href}
      target="_blank"
      rel="noreferrer"
      aria-label={social.label}
      data-glow-cell
      onPointerEnter={() => {
        // direct hover pins the fill to full — a guarantee independent of the
        // distance math
        pinned.current = true
        p.set(1)
      }}
      onPointerLeave={() => {
        pinned.current = false
      }}
      onFocus={() => {
        pinned.current = true
        p.set(1)
      }}
      onBlur={() => {
        pinned.current = false
        p.set(0)
      }}
      className="group absolute grid place-items-center bg-[var(--social-face)] outline-none"
      style={{ left: box.left, top: box.top, width: box.size, height: box.size }}
    >
      <span className="relative block aspect-square w-[54%]">
        {/* lit lower lip of the groove — the cue that the mark is cut in, not printed */}
        <Glyph
          path={social.path}
          className="absolute inset-0 translate-y-[7%] text-[var(--etch-lip)]"
        />
        {/* bloom: light spilling out of the cracks, swelling with proximity */}
        <motion.span className="absolute inset-0" style={{ opacity: bloomWide }}>
          <Glyph
            path={social.path}
            className="absolute inset-0 scale-110 text-[var(--etch-glow)] blur-[7px]"
          />
        </motion.span>
        <motion.span className="absolute inset-0" style={{ opacity: bloomTight }}>
          <Glyph
            path={social.path}
            className="absolute inset-0 text-[var(--etch-glow)] blur-[2px]"
          />
        </motion.span>
        {/* the groove: a dark incision, crossfaded to molten by proximity */}
        <Glyph
          path={social.path}
          className="absolute inset-0 text-[var(--etch-groove)]"
        />
        <motion.span className="absolute inset-0" style={{ opacity: p }}>
          <Glyph path={social.path} className="absolute inset-0 text-[var(--etch-core)]" />
        </motion.span>
      </span>
    </a>
  )
}
