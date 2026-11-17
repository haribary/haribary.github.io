import "@fontsource/gentium-book-plus/400.css"
import "@fontsource/gentium-book-plus/400-italic.css"
import "@fontsource/gentium-book-plus/700.css"
import "./signal.css"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"

import { about, papers, person, projects } from "@/lab/content"
import { prefersReducedMotion, useSmoothScroll } from "@/lab/smooth-scroll"

import { BitmapName } from "./bitmap-name"
import { ContactIcons } from "./contact-icons"
import { Controller, type ChapterId } from "./controller"
import { FigureNote } from "./note"
import { PhoneGate } from "./phone-notice"
import { SignalCanvas } from "./scene"
import { SlopLink } from "./slop-link"
import { createStore } from "./store"
import { CHAPTERS } from "./story"
import { loadTerrain, type Terrain } from "./terrain"
import { Out, Words } from "./words"

/**
 * The pictures the sheet of glass shows beside About, in order. Resized copies
 * live in public/lab/signal; any image URL can be added here, a chart or a
 * figure as readily as a photograph.
 */
const PHOTOS = ["/lab/signal/profile_pic.jpg", "/lab/signal/IMG_1565.jpg", "/lab/signal/IMG_5693.jpg"] as const

/** The paper that is held in place while the shards' Tower of Hanoi plays out beside it. */
const HELD_PAPER = "hanoi"

/** A phone gets a plain notice instead; nothing of the page is mounted there. */
export default function Signal() {
  return (
    <PhoneGate>
      <SignalPage />
    </PhoneGate>
  )
}

/**
 * Signal: a drawing becomes a place. A fixed canvas sits behind the document;
 * the document is ordinary sections of real text. Each element marked
 * `data-anchor` is one unit of story time (see story.ts), which is how the
 * camera stays in step with what is being read at any viewport size. A cluster
 * of glass shards comes along for the whole page (see companion.ts).
 */
function SignalPage() {
  const root = useRef<HTMLElement>(null)
  const lenis = useSmoothScroll()
  const store = useMemo(createStore, [])
  const controller = useRef<Controller | null>(null)
  const [terrain, setTerrain] = useState<Terrain | null>(null)
  const [ready, setReady] = useState(false)
  // What the shards show: the photographs beside About, each project's image beside Projects.
  const pictures = useMemo(() => ({ photos: PHOTOS, covers: projects.map((p) => p.image) }), [])

  useEffect(() => {
    const abort = new AbortController()
    let built: Terrain | null = null
    loadTerrain(abort.signal)
      .then((t) => {
        if (abort.signal.aborted) {
          t.dispose()
          return
        }
        built = t
        setTerrain(t)
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) console.error("Signal: could not load the terrain.", error)
      })
    return () => {
      abort.abort()
      built?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!root.current) return
    store.reduced = prefersReducedMotion()
    const c = new Controller(root.current, store, () => lenis.current)
    controller.current = c
    c.start()
    return () => {
      c.stop()
      controller.current = null
    }
  }, [store, lenis])

  // Dev only: `window.__signal.setU(4.2)` pins the story time for inspection.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __signal?: unknown }
    const pinned = new URLSearchParams(window.location.search).get("u")
    if (pinned !== null) store.override = Number(pinned)
    w.__signal = {
      store,
      setU: (u: number | null) => {
        store.override = u
        store.invalidate()
      },
      // Pins parts of the shards' pose, e.g. `force({ to: 1, mix: 0.5 })`; null lets go.
      force: (pose: typeof store.force) => {
        store.force = pose
        store.invalidate()
      },
      // Jumps the real scroll position to a story time, text and all.
      goU: (u: number) => {
        const y = controller.current?.scrollFor(u) ?? 0
        if (lenis.current) lenis.current.scrollTo(y, { immediate: true, force: true })
        else window.scrollTo(0, y)
      },
    }
    return () => {
      delete w.__signal
    }
  }, [store, lenis])

  const onFirstFrame = useCallback(() => setReady(true), [])
  const go = useCallback((id: ChapterId) => controller.current?.go(id), [])

  return (
    <main ref={root} className="x-signal" data-night="false" data-ready={ready}>
      <div className="sg-stage" aria-hidden="true">
        <SignalCanvas store={store} terrain={terrain} pictures={pictures} onFirstFrame={onFirstFrame} />
      </div>

      <ChapterNav onGo={go} />

      {/* The opening plate stays put while the camera starts to move, then lets go. */}
      <div className="sg-open" data-anchor>
        <header id="figure" className="sg-hero">
          <SlopLink />
          <div className="sg-hero-head">
            <BitmapName text={person.name} />
          </div>
          <div className="sg-plate">
            <div className="sg-figure">
              <div className="sg-slot" data-slot="hero" />
              <FigureNote />
            </div>
          </div>
          <p className="sg-cue" aria-hidden="true">
            <span>Scroll</span>
            <i />
          </p>
        </header>
        <div className="sg-mark" data-anchor aria-hidden="true" />
      </div>

      <section id="about" className="sg-chapter sg-about" data-anchor aria-labelledby="sg-about-h">
        <div className="sg-col">
          <h2 id="sg-about-h" className="sg-h2" data-lit tabIndex={-1}>
            <Words text="About" />
          </h2>
          {about.map((paragraph, i) => (
            <p key={i} className="sg-body" data-lit>
              <Words spans={paragraph} />
            </p>
          ))}
        </div>
      </section>

      <div className="sg-gap sg-gap--night" data-anchor aria-hidden="true" />

      <section id="research" className="sg-chapter sg-research" data-anchor aria-labelledby="sg-research-h">
        <div className="sg-col">
          <h2 id="sg-research-h" className="sg-h2" data-lit tabIndex={-1}>
            <Words text="Research" />
          </h2>
          {papers.map((paper) => {
            const held = paper.id === HELD_PAPER
            const article = (
              <article key={paper.id} className="sg-paper">
                <p className="sg-meta" data-fade>
                  {paper.venue}
                </p>
                <h3 className="sg-h3" data-lit>
                  <Words text={paper.title} />
                </h3>
                <p className="sg-body" data-lit>
                  <Words text={paper.blurb} />
                </p>
                <p className="sg-links" data-fade>
                  {paper.links.map((link) => (
                    <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                      Read on {link.label}
                      <Out />
                    </a>
                  ))}
                </p>
              </article>
            )
            // The held paper stays in the column while the tower beside it plays out.
            return held ? (
              <div key={paper.id} className="sg-hold">
                {article}
              </div>
            ) : (
              article
            )
          })}
        </div>
      </section>

      <section id="projects" className="sg-chapter sg-projects" aria-labelledby="sg-projects-h">
        <div className="sg-col sg-projects-head">
          <h2 id="sg-projects-h" className="sg-h2" data-lit tabIndex={-1}>
            <Words text="Projects" />
          </h2>
        </div>
        {projects.map((project) => (
          <article key={project.id} className="sg-project" data-anchor>
            <div className="sg-col">
              <h3 className="sg-title" data-lit>
                <Words text={project.title} />
              </h3>
              <ul className="sg-tags" data-fade>
                {project.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
              <p className="sg-body" data-lit>
                <Words text={project.blurb} />
              </p>
              <p className="sg-links" data-fade>
                {project.links.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                    <Out />
                  </a>
                ))}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section id="contact" className="sg-contact" data-anchor aria-labelledby="sg-contact-h">
        <div className="sg-end">
          <h2 id="sg-contact-h" className="sg-name" tabIndex={-1}>
            Contact
          </h2>
          <div className="sg-plate">
            <div className="sg-slot" data-slot="end" />
            <ContactIcons />
          </div>
        </div>
      </section>
    </main>
  )
}

function ChapterNav({ onGo }: { onGo: (id: ChapterId) => void }) {
  const click = (e: MouseEvent<HTMLAnchorElement>, id: ChapterId) => {
    // Handled here rather than by Lenis's own anchor support, so the jump can
    // land on the chapter heading and respect reduced motion.
    e.preventDefault()
    e.stopPropagation()
    onGo(id)
  }
  return (
    <nav className="sg-nav" aria-label="Chapters">
      <ol>
        {CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <a href={`#${chapter.id}`} onClick={(e) => click(e, chapter.id)}>
              <span>{chapter.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
