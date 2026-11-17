import "@fontsource-variable/rubik/wght.css"
import "./hanoi.css"

import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react"

import { about, contacts, interests, papers, person, projects, type Span } from "@/lab/content"
import { gsap, prefersReducedMotion, ScrollTrigger, useSmoothScroll } from "@/lab/smooth-scroll"
import Counter from "@/components/reactbits/Counter"

import { Game } from "./game"
import { DISCS, MOVES, MOVE_COUNT, PEG_NAMES, describeMove } from "./solver"
import { store, type LayoutKey } from "./store"

const Scene = lazy(() => import("./scene"))

const game = new Game()

// ------------------------------------------------------------ lit text

/** A paragraph whose words light up as they pass the reading zone. */
function Lit({ spans, className }: { spans: Span[]; className?: string }) {
  return (
    <p className={className} data-lit="">
      {spans.map((s, i) => {
        const parts = s.text.split(/(\s+)/).map((wd, j) =>
          wd === "" ? null : /^\s+$/.test(wd) ? wd : (
            <span key={j} className="hz-w">
              {wd}
            </span>
          ),
        )
        if (s.href)
          return (
            <a key={i} href={s.href} target="_blank" rel="noreferrer">
              {parts}
            </a>
          )
        if (s.strong) return <strong key={i}>{parts}</strong>
        return <Fragment key={i}>{parts}</Fragment>
      })}
    </p>
  )
}

const plain = (text: string): Span[] => [{ text }]

// ------------------------------------------------------------ readout

function Readout() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(force), [])
  const n = store.shownMoves
  let detail: string
  if (store.resetting) detail = "Solved. Three discs go back to peg A for you."
  else if (n === 0) detail = "Five discs on peg A. Scroll to solve."
  else if (n === MOVE_COUNT) detail = `${describeMove(MOVES[n - 1])}. Solved.`
  else detail = describeMove(MOVES[n - 1])
  return (
    <div
      className="hz-readout"
      ref={(el) => {
        store.readout = el
      }}
      data-hidden={store.playActive}
      aria-hidden="true"
    >
      <span className="hz-readout__dot" />
      <span className="hz-readout__count">
        Move <Counter value={n} fontSize="1em" fontWeight={600} duration={0.45} intro={false} minDigits={2} /> of{" "}
        {MOVE_COUNT}
      </span>
      <span className="hz-readout__detail">{detail}</span>
    </div>
  )
}

// ------------------------------------------------------------ play

function PlayPanel({ onWake }: { onWake: () => void }) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [message, setMessage] = useState("")
  const [shake, setShake] = useState(0)
  useEffect(
    () =>
      game.subscribe((e) => {
        force()
        if (e) {
          setMessage(e.message)
          if (e.message.includes("can't")) setShake((s) => s + 1)
        }
      }),
    [],
  )
  useEffect(() => store.subscribe(force), [])
  const active = store.playActive

  const select = (p: number) => {
    if (!store.playActive) {
      onWake()
      return
    }
    game.select(p, performance.now() / 1000)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!store.playActive || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const i = ["1", "2", "3"].indexOf(e.key)
      if (i < 0) return
      e.preventDefault()
      game.select(i, performance.now() / 1000)
      store.pegButtons[i]?.focus({ preventScroll: true })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const now = () => performance.now() / 1000
  const held = game.held

  // Both restart buttons disable or disappear once pressed, which would drop
  // keyboard focus to the page body. Hand it to peg A, where play resumes.
  const restart = (discs: number) => {
    game.reset(discs, now())
    store.pegButtons[0]?.focus({ preventScroll: true })
  }

  return (
    <div className="hz-play">
      <div className="hz-pegs" data-active={active} data-shake={shake % 2}>
        {PEG_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            className="hz-peg"
            data-held={held?.from === i}
            aria-label={game.describePeg(i)}
            ref={(el) => {
              store.pegButtons[i] = el
            }}
            onClick={() => select(i)}
            onFocus={() => {
              if (!store.playActive) onWake()
            }}
          >
          </button>
        ))}
      </div>

      <div className="hz-play__bar">
        <div className="hz-play__rules">
          <p>
            Move the tower to peg C. One disc at a time, and never a larger disc on a smaller one.
          </p>
          <p className="hz-muted">Click or tap a peg to lift its top disc, then another to set it down. Keys 1, 2 and 3 work too.</p>
        </div>
        <div className="hz-play__score" aria-hidden="true">
          <div>
            <span className="hz-play__big">
              <Counter value={game.moves} fontSize="1em" fontWeight={700} duration={0.4} intro={false} />
            </span>
            <span className="hz-play__label">your moves</span>
          </div>
          <div>
            <span className="hz-play__big hz-muted">{game.optimum}</span>
            <span className="hz-play__label">fewest possible, {game.n} discs</span>
          </div>
        </div>
        <div className="hz-play__actions">
          <p className="hz-play__message" role="status" aria-live="polite">
            {message || `${game.n} discs on peg A. Your move.`}
          </p>
          <div className="hz-play__buttons">
            {game.solved && game.n < DISCS.length && (
              <button type="button" className="hz-btn hz-btn--solid" onClick={() => restart(game.n + 1)}>
                Add a disc
              </button>
            )}
            <button
              type="button"
              className="hz-btn"
              onClick={() => restart(game.n)}
              disabled={game.moves === 0 && !held && !game.solved}
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ page

const ARROW = (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className="hz-arrow">
    <path d="M3 9 9 3M4 3h5v5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:/.test(href)
  return (
    <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className="hz-link">
      {children}
      {external && ARROW}
    </a>
  )
}

export default function Hanoi() {
  const lenis = useSmoothScroll({ lerp: 0.085 })
  const rootRef = useRef<HTMLDivElement>(null)
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches)

  // Hanoi paper first: it explains the object.
  const orderedPapers = [...papers].sort((a, b) => (a.id === "hanoi" ? -1 : b.id === "hanoi" ? 1 : 0))

  const wake = () => {
    const el = document.getElementById("play")
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY
    if (lenis.current) lenis.current.scrollTo(y, { duration: 1.2 })
    else window.scrollTo({ top: y })
  }

  // Measure sections into the shared store.
  useLayoutEffect(() => {
    const root = rootRef.current!
    store.root = root
    store.reduced = prefersReducedMotion()
    const mq = window.matchMedia("(max-width: 760px)")
    const fine = window.matchMedia("(pointer: fine)")
    const measure = () => {
      store.mobile = mq.matches
      store.finePointer = fine.matches
      setMobile(mq.matches)
      const vh = window.innerHeight
      store.vh = vh
      const secs = [...root.querySelectorAll<HTMLElement>("[data-layout]")]
      store.sections = secs.map((el) => ({
        top: el.getBoundingClientRect().top + window.scrollY,
        layout: el.dataset.layout as LayoutKey,
        word: Number(el.dataset.word),
      }))
      const playTop = store.sections[store.sections.length - 1]?.top ?? vh * 8
      store.maxScroll = Math.max(1, document.documentElement.scrollHeight - vh)
      store.moveStart = 0.05 * vh
      store.moveEnd = playTop - 1.0 * vh
      store.resetStart = playTop - 0.92 * vh
      store.resetEnd = playTop - 0.42 * vh
      store.playAt = Math.min(store.maxScroll, playTop) - 0.28 * vh
      store.darkStart = playTop - 0.62 * vh
      store.darkEnd = playTop - 0.18 * vh
      ScrollTrigger.refresh()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    window.addEventListener("resize", measure)
    mq.addEventListener("change", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
      mq.removeEventListener("change", measure)
      store.root = null
    }
  }, [])

  // Pointer for the eased parallax (mouse only).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return
      store.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      store.pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])

  // Words light up as they pass the reading zone, scrubbed by scroll.
  useEffect(() => {
    const root = rootRef.current!
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      root.querySelectorAll<HTMLElement>("[data-lit]").forEach((p) => {
        const words = p.querySelectorAll(".hz-w")
        gsap.fromTo(
          words,
          { opacity: 0.14 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.08,
            scrollTrigger: {
              trigger: p,
              start: mobile ? "top 96%" : "top 86%",
              end: mobile ? "bottom 70%" : "bottom 56%",
              scrub: 0.4,
            },
          },
        )
      })
    }, root)
    return () => ctx.revert()
  }, [mobile])

  return (
    <div className="x-hanoi" ref={rootRef}>
      <div className="hz-stage" aria-hidden="true">
        <Suspense fallback={null}>
          <Scene game={game} />
        </Suspense>
        <div className="hz-stage__fade" />
      </div>

      <div className="hz-veil" aria-hidden="true" />
      <header className="hz-top">
        <a href="#top" className="hz-top__name">
          {person.name}
        </a>
        <nav aria-label="Sections" className="hz-top__nav">
          <a href="#about">About</a>
          <a href="#research">Research</a>
          <a href="#projects">Projects</a>
          <a href="#contact">Contact</a>
          <a href="#play">Play</a>
        </nav>
      </header>

      <Readout />

      <main>
        <section id="top" className="hz-hero" data-layout="hero" data-word="0" aria-labelledby="hz-name">
          <h1 id="hz-name" className="hz-sr">
            {person.name}
          </h1>
          <div className="hz-hero__foot">
            <p className="hz-hero__role">{person.role}</p>
            <p className="hz-hero__hint">
              Scroll, and the tower solves itself in 31 moves. At the bottom, it is your turn.
            </p>
          </div>
        </section>

        <section id="about" className="hz-sec" data-layout="left" data-word="1" aria-labelledby="hz-about">
          <div className="hz-col hz-col--r">
            <h2 id="hz-about" className="hz-sr">
              About
            </h2>
            {about.map((p, i) => (
              <Lit key={i} spans={p} className={i === 0 ? "hz-lede" : "hz-body"} />
            ))}
            <ul className="hz-tags" aria-label="Interests">
              {interests.map((t, i) => (
                <li key={t} style={{ "--c": DISCS[i].hue } as React.CSSProperties}>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="research" className="hz-sec" data-layout="right" data-word="2" aria-labelledby="hz-research">
          <div className="hz-col hz-col--l">
            <h2 id="hz-research" className="hz-sr">
              Research
            </h2>
            {orderedPapers.map((p) => (
              <article key={p.id} className="hz-paper">
                <p className="hz-paper__venue">{p.venue}</p>
                <h3 className="hz-paper__title">{p.title}</h3>
                <Lit spans={plain(p.blurb)} className="hz-body" />
                {p.id === "hanoi" && (
                  <p className="hz-note">
                    <span className="hz-note__mark" aria-hidden="true" />
                    The object on this page is that game: five discs, three pegs, and a shortest solution of 31
                    moves, which it plays as you scroll.
                  </p>
                )}
                <p className="hz-links">
                  {p.links.map((l) => (
                    <Ext key={l.href} href={l.href}>
                      {l.label}
                    </Ext>
                  ))}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section id="projects" className="hz-sec" data-layout="left" data-word="3" aria-labelledby="hz-projects">
          <div className="hz-col hz-col--r">
            <h2 id="hz-projects" className="hz-sr">
              Projects
            </h2>
            {projects.map((p) => (
              <article key={p.id} className="hz-project">
                <img src={p.image} alt={`Cover image for ${p.title}`} loading="lazy" decoding="async" />
                <h3 className="hz-project__title">{p.title}</h3>
                <p className="hz-project__tags">{p.tags.join(" · ")}</p>
                <Lit spans={plain(p.blurb)} className="hz-body" />
                <p className="hz-links">
                  {p.links.map((l) => (
                    <Ext key={l.href} href={l.href}>
                      {l.label}
                    </Ext>
                  ))}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="hz-sec hz-sec--contact" data-layout="right" data-word="4" aria-labelledby="hz-contact">
          <div className="hz-col hz-col--l">
            <h2 id="hz-contact" className="hz-sr">
              Contact
            </h2>
            <p className="hz-lede">Email, code, papers, and a resume.</p>
            <ul className="hz-contacts">
              {contacts.map((c) => (
                <li key={c.label}>
                  <span className="hz-contacts__label">{c.label}</span>
                  <Ext href={c.href}>{c.value}</Ext>
                </li>
              ))}
              <li>
                <span className="hz-contacts__label">Resume</span>
                <a href={person.resume} className="hz-link" target="_blank" rel="noreferrer">
                  Resume (PDF){ARROW}
                </a>
              </li>
            </ul>
          </div>
        </section>

        <section id="play" className="hz-playsec" data-layout="play" data-word="5" aria-labelledby="hz-play">
          <h2 id="hz-play" className="hz-sr">
            Your turn
          </h2>
          <PlayPanel onWake={wake} />
        </section>
      </main>
    </div>
  )
}
