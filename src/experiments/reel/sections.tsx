import { useRef, type CSSProperties, type RefObject } from "react"
import { useGSAP } from "@gsap/react"
import { SplitText } from "gsap/SplitText"

import { about, contacts, interests, papers, person, photos, projects, type Span } from "@/lab/content"
import { gsap, ScrollTrigger } from "@/lab/smooth-scroll"
import Magnet from "@/components/reactbits/Magnet"
import ScrollVelocity from "@/components/reactbits/ScrollVelocity"
import { photoSrc } from "./assets"

gsap.registerPlugin(useGSAP, SplitText, ScrollTrigger)

const [FIRST_NAME, LAST_NAME] = (() => {
  const parts = person.name.split(" ")
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]]
})()

function Edge() {
  return (
    <svg className="reel-edge" data-edge viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,101 L100,101 Z" />
    </svg>
  )
}

const isExternal = (href: string) => /^https?:/.test(href)
const linkProps = (href: string) =>
  isExternal(href) ? { href, target: "_blank", rel: "noreferrer" } : { href }

/* ------------------------------------------------------------------ */

export function Opening({ fadeRef }: { fadeRef: RefObject<HTMLDivElement | null> }) {
  return (
    <section className="reel-open" aria-labelledby="reel-name">
      <h1 id="reel-name" className="reel-name">
        <span className="reel-name__first">{FIRST_NAME}</span>{" "}
        <span className="reel-name__last">{LAST_NAME}</span>
      </h1>
      <div ref={fadeRef} className="reel-open__meta">
        <p className="reel-role">{person.role}</p>
        <p className="reel-cue" aria-hidden="true">
          <span className="reel-cue__line" />
          Scroll
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export function Spiral({
  sectionRef,
  captionRef,
  labelRef,
}: {
  sectionRef: RefObject<HTMLElement | null>
  captionRef: RefObject<HTMLParagraphElement | null>
  labelRef: RefObject<HTMLHeadingElement | null>
}) {
  return (
    <section ref={sectionRef} className="reel-spiral" aria-labelledby="reel-photos">
      <div className="reel-spiral__sticky">
        <h2 ref={labelRef} id="reel-photos" className="reel-label">
          Away from the desk
        </h2>
        <p ref={captionRef} className="reel-caption" aria-hidden="true">
          <span className="reel-caption__count" data-count>
            01 / 07
          </span>
          <span className="reel-caption__text" data-text>
            {photos[0].alt}
          </span>
        </p>
      </div>
      <ul className="reel-photos">
        {photos.map((p) => (
          <li key={p.src} data-photo-alt={p.alt}>
            <figure>
              <img src={photoSrc(p.src)} alt={p.alt} loading="lazy" decoding="async" />
              <figcaption>{p.alt}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.href ? (
          <a key={i} {...linkProps(s.href)}>
            {s.text}
          </a>
        ) : s.strong ? (
          <strong key={i}>{s.text}</strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

export function About({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      if (reduced) return
      const paras = gsap.utils.toArray<HTMLElement>(".reel-about__p")
      paras.forEach((p) => {
        const split = SplitText.create(p, { type: "words", wordsClass: "reel-word" })
        gsap.fromTo(
          split.words,
          { opacity: 0.16 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.12,
            scrollTrigger: { trigger: p, start: "top 78%", end: "bottom 48%", scrub: true },
          },
        )
      })
    },
    { scope: ref, dependencies: [reduced] },
  )

  return (
    <section ref={ref} className="reel-about" aria-labelledby="reel-about-h">
      <h2 id="reel-about-h" className="reel-giant reel-about__h">
        About
      </h2>
      <div className="reel-about__body">
        {about.map((spans, i) => (
          <p key={i} className="reel-about__p">
            <Spans spans={spans} />
          </p>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

const PROJECT_LAYOUT = [
  { y: "4vh", depth: 1 },
  { y: "17vh", depth: 0.86 },
  { y: "8vh", depth: 1.06 },
]

export function Projects({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const section = ref.current
      const track = trackRef.current
      if (reduced || !section || !track) return
      const cards = gsap.utils.toArray<HTMLElement>(".reel-proj", section)
      const imgs = cards.map((c) => c.querySelector<HTMLElement>(".reel-proj__img"))
      const depths = cards.map((c) => Number(c.dataset.depth ?? 1))
      const setters = cards.map((c) => gsap.quickSetter(c, "x", "px"))
      const imgSetters = imgs.map((img) => (img ? gsap.quickSetter(img, "xPercent") : null))
      const titleSetters = cards.map((c) => {
        const t = c.querySelector<HTMLElement>(".reel-proj__title")
        return t ? gsap.quickSetter(t, "x", "px") : null
      })
      const tail = track.querySelector<HTMLElement>(".reel-projects__tail")!
      // Layout width, not scrollWidth: the parallax transforms would inflate it.
      const dist = () => Math.max(0, tail.offsetLeft + tail.offsetWidth - window.innerWidth)

      const parallax = () => {
        const vw = window.innerWidth
        const tx = Number(gsap.getProperty(track, "x")) || 0
        cards.forEach((c, i) => {
          const center = c.offsetLeft + c.offsetWidth / 2 + tx
          const n = (center - vw / 2) / vw
          setters[i]((depths[i] - 1) * n * vw * (vw < 760 ? 0.3 : 0.9))
          imgSetters[i]?.(-n * 9)
          // The title drifts against the image, a little slower than the card.
          titleSetters[i]?.(n * c.offsetWidth * 0.12)
        })
      }

      const tween = gsap.to(track, { x: () => -dist(), ease: "none", onUpdate: parallax })
      const st = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: () => `+=${dist()}`,
        pin: true,
        scrub: true,
        animation: tween,
        invalidateOnRefresh: true,
        onRefresh: parallax,
      })
      parallax()

      // Keyboard: tabbing into a card scrolls the page to where it is in view.
      const onFocus = (e: FocusEvent) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>(".reel-proj")
        if (!card) return
        const d = dist()
        if (!d) return
        const target = card.offsetLeft - (window.innerWidth - card.offsetWidth) / 2
        const p = Math.min(1, Math.max(0, target / d))
        window.scrollTo({ top: st.start + p * (st.end - st.start), behavior: "instant" })
      }
      // Focus can scroll the clipped viewport itself; keep it at zero.
      const viewport = section.querySelector<HTMLElement>(".reel-projects__viewport")!
      const unscroll = () => {
        if (viewport.scrollLeft) viewport.scrollLeft = 0
      }
      section.addEventListener("focusin", onFocus)
      viewport.addEventListener("scroll", unscroll)
      return () => {
        section.removeEventListener("focusin", onFocus)
        viewport.removeEventListener("scroll", unscroll)
      }
    },
    { scope: ref, dependencies: [reduced] },
  )

  return (
    <section ref={ref} className="reel-projects" aria-labelledby="reel-projects-h">
      <Edge />
      <div className="reel-projects__viewport">
        <div ref={trackRef} className="reel-projects__track">
          <h2 id="reel-projects-h" className="reel-giant reel-projects__h">
            Projects
          </h2>
          {projects.map((p, i) => {
            const layout = PROJECT_LAYOUT[i % PROJECT_LAYOUT.length]
            return (
              <article
                key={p.id}
                className="reel-proj"
                data-depth={layout.depth}
                style={{ "--y": layout.y, "--depth": layout.depth } as CSSProperties}
              >
                <h3 className="reel-proj__title">{p.title}</h3>
                <div className="reel-proj__frame">
                  <img
                    className="reel-proj__img"
                    src={photoSrc(p.image)}
                    alt={`Cover image for ${p.title}`}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <ul className="reel-proj__tags" aria-label="Built with">
                  {p.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p className="reel-proj__blurb">{p.blurb}</p>
                <p className="reel-proj__links">
                  {p.links.map((l) => (
                    <a key={l.href} {...linkProps(l.href)} aria-label={`${p.title}: ${l.label}`}>
                      {l.label}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ))}
                </p>
              </article>
            )
          })}
          <div className="reel-projects__tail" aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export function Research({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      if (reduced) return
      gsap.utils.toArray<HTMLElement>(".reel-paper", ref.current).forEach((paper) => {
        const digits = paper.querySelectorAll<HTMLElement>(".reel-year__d")
        gsap.fromTo(
          digits,
          { yPercent: 105, "--arrive-w": 22 },
          {
            yPercent: 0,
            "--arrive-w": 0,
            ease: "power2.out",
            stagger: 0.14,
            scrollTrigger: { trigger: paper, start: "top 92%", end: "top 30%", scrub: true },
          },
        )
        const text = paper.querySelector(".reel-paper__text")
        if (text)
          gsap.fromTo(
            text,
            { y: 60 },
            {
              y: 0,
              ease: "none",
              scrollTrigger: { trigger: paper, start: "top 95%", end: "top 35%", scrub: true },
            },
          )
      })
    },
    { scope: ref, dependencies: [reduced] },
  )

  return (
    <section ref={ref} className="reel-research" aria-labelledby="reel-research-h">
      <Edge />
      <h2 id="reel-research-h" className="reel-giant reel-research__h">
        Research
      </h2>
      {papers.map((p) => {
        const year = p.venue.match(/\b(19|20)\d{2}\b/)?.[0]
        return (
          <article key={p.id} className="reel-paper">
            {year && (
              <p className="reel-year" aria-hidden="true">
                {year.split("").map((d, i) => (
                  <span key={i} className="reel-year__mask">
                    <span className="reel-year__d">{d}</span>
                  </span>
                ))}
              </p>
            )}
            <div className="reel-paper__text">
              <h3 className="reel-paper__title">{p.title}</h3>
              <p className="reel-paper__venue">{p.venue}</p>
              <p className="reel-paper__blurb">{p.blurb}</p>
              <p className="reel-paper__links">
                {p.links.map((l) => (
                  <a key={l.href} {...linkProps(l.href)} aria-label={`${l.label}: ${p.title}`}>
                    Read on {l.label}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                ))}
              </p>
            </div>
          </article>
        )
      })}
    </section>
  )
}

/* ------------------------------------------------------------------ */

export function Contact() {
  return (
    <section className="reel-contact" aria-labelledby="reel-contact-h">
      <Edge />
      <h2 id="reel-contact-h" className="reel-giant reel-contact__h">
        <span>Say</span>
        <span>hello</span>
      </h2>
      <ul className="reel-contact__list">
        {contacts.map((c) => (
          <li key={c.href}>
            <span className="reel-contact__label">{c.label}</span>
            <Magnet padding={60} magnetStrength={6} wrapperClassName="reel-magnet">
              <a className="reel-contact__value" {...linkProps(c.href)}>
                {c.value}
              </a>
            </Magnet>
          </li>
        ))}
        <li>
          <span className="reel-contact__label">Resume</span>
          <Magnet padding={60} magnetStrength={6} wrapperClassName="reel-magnet">
            <a className="reel-contact__value" href={person.resume} target="_blank" rel="noreferrer">
              Resume (PDF)
            </a>
          </Magnet>
        </li>
      </ul>
      <div className="reel-band" aria-hidden="true">
        <ScrollVelocity
          texts={[
            <span key="band" className="reel-band__item">
              {interests.map((t) => (
                <span key={t}>
                  {t}
                  <span className="reel-band__sep">✶</span>
                </span>
              ))}
            </span>,
          ]}
          velocity={55}
          numCopies={4}
          damping={40}
          stiffness={300}
          velocityMapping={{ input: [0, 1200], output: [0, 6] }}
          skewWithVelocity={7}
          parallaxClassName="reel-band__clip"
          scrollerClassName="reel-band__row"
        />
      </div>
      <p className="reel-interests-sr">Interests: {interests.join(", ")}.</p>
      <footer className="reel-foot">
        <span>{person.name}</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </section>
  )
}
