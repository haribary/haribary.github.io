import type Lenis from "lenis"

import { gsap, ScrollTrigger } from "@/lab/smooth-scroll"

import { fitMarks } from "./companion"
import { clamp, lerp, smooth } from "./math"
import { spotsAt } from "./spots"
import { MAX_DPR, type Store } from "./store"
import { CHAPTERS, NIGHT_SEED, nightfall, snapFigure, U_END } from "./story"
import { HALF_W, LENGTH } from "./terrain"

/** The layout with the text under the picture; signal.css uses the same query. */
const STACKED = "(max-width: 760px), (max-aspect-ratio: 9/10)"
/** Where on the screen a line of text is being read, as a fraction of the height. */
const READ_LINE = 0.74
/** Opacity of a word before it has been read. */
const DIM = 0.24
/** The fastest the light may travel down a paragraph, however fast the scroll. */
const LINES_PER_SECOND = 1.5

/** How dark the sheet behind a label must be before the label turns light. */
const NAV_CROSS = 0.56
const INK = [20, 23, 28]
const GRAPHITE = [90, 100, 114]
const HAIRLINE = [200, 206, 214]
const rgb = (c: number[]) => `rgb(${c[0]} ${c[1]} ${c[2]})`
const blend = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(lerp(v, b[i], t)))

/** A label of the chapter list: where it is on screen, and how much night is behind it. */
type NavItem = { el: HTMLElement; x0: number; x1: number; y: number; night: number }
type Word = { el: HTMLElement; y: number; at: number; soft: number; op: number }
/** `held` marks text inside the paper that is pinned while the tower solves. */
type Block = { top: number; bottom: number; line: number; shown: number; words: Word[]; held: boolean }
type Fader = { el: HTMLElement; y: number; half: number; op: number; held: boolean }

export type ChapterId = (typeof CHAPTERS)[number]["id"]

/**
 * The DOM half of the page. One ScrollTrigger spans the document; its scroll
 * position becomes the story time `u` through the section boundaries, and from
 * `u` come the chapter list, the day/night palette of the text and the
 * closing panel. The same tick lights the body text word by word.
 */
export class Controller {
  private root: HTMLElement
  private store: Store
  private lenis: () => Lenis | null
  private trigger: ScrollTrigger | null = null
  private observer: ResizeObserver | null = null
  private refreshTimer = 0

  private knotY: number[] = [0, 1]
  private knotU: number[] = [0, U_END]
  private max = 1
  private vh = 1
  private stacked = false
  private blocks: Block[] = []
  private faders: Fader[] = []
  private lastY = -1
  private dirty = true
  private night: boolean | null = null
  private active = -1
  private vw = 1
  /** Where the visitor was when a resize began, and the scroll that restores it. */
  private resizeFrom: { w: number; h: number; u: number } | null = null
  private pendingScroll: number | null = null
  private navItems: NavItem[] = []
  private navNight = NaN
  private navAt = 0
  /**
   * The hold: the second paper sticks in the column for `len` px of scroll,
   * starting at scroll position `from`, while the tower beside it plays out.
   * Everything measured inside it is stored where it would lie unpinned, and
   * `pin` (how far it is currently carried down the page) is added back.
   * `read` is how much further the reading light must travel, once pinned,
   * to reach the paper's last line.
   */
  private hold = { from: 0, len: 0, read: 0 }
  private pin = 0

  private nav: HTMLElement | null
  private navLinks: HTMLElement[]
  private endPanel: HTMLElement | null
  private hero: HTMLElement | null
  private cue: HTMLElement | null

  constructor(root: HTMLElement, store: Store, lenis: () => Lenis | null) {
    this.root = root
    this.store = store
    this.lenis = lenis
    this.nav = root.querySelector<HTMLElement>(".sg-nav")
    this.navLinks = Array.from(root.querySelectorAll<HTMLElement>(".sg-nav a"))
    this.endPanel = root.querySelector<HTMLElement>(".sg-end")
    this.hero = root.querySelector<HTMLElement>(".sg-hero")
    this.cue = root.querySelector<HTMLElement>(".sg-cue")
  }

  start() {
    this.trigger = ScrollTrigger.create({
      trigger: this.root,
      start: "top top",
      end: "bottom bottom",
      onRefresh: () => this.measure(),
    })
    this.measure()
    // From here on unread words are dimmed; without this script they never are.
    this.root.dataset.live = "true"
    gsap.ticker.add(this.tick)
    window.addEventListener("pointermove", this.onPointer, { passive: true })
    window.addEventListener("resize", this.onResize, { passive: true })
    this.endPanel?.addEventListener("focusin", this.onEndFocus)

    // Fonts and images change the height of the page after first layout.
    this.observer = new ResizeObserver(() => {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 120)
    })
    this.observer.observe(this.root)
  }

  stop() {
    window.clearTimeout(this.refreshTimer)
    this.observer?.disconnect()
    this.trigger?.kill()
    gsap.ticker.remove(this.tick)
    window.removeEventListener("pointermove", this.onPointer)
    window.removeEventListener("resize", this.onResize)
    this.endPanel?.removeEventListener("focusin", this.onEndFocus)
    delete document.documentElement.dataset.signalNight
    delete this.root.dataset.live
  }

  /** Scrolls to a chapter and hands focus to its heading. */
  go(id: ChapterId) {
    const heading = this.root.querySelector<HTMLElement>(`#${id} h1, #${id} h2`)
    let y = 0
    if (id === "contact") y = this.max
    else if (id !== "figure" && heading) {
      y = clamp(heading.getBoundingClientRect().top + window.scrollY - this.vh * 0.3, 0, this.max)
    }
    const lenis = this.lenis()
    if (lenis && !this.store.reduced) {
      const distance = Math.abs(y - window.scrollY) / this.vh
      lenis.scrollTo(y, {
        duration: clamp(0.9 + distance * 0.35, 1.2, 3.6),
        easing: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      })
    } else {
      window.scrollTo(0, y)
    }
    heading?.focus({ preventScroll: true })
  }

  /** The scroll position at which the story reaches `u` (the inverse of the mapping). */
  scrollFor(u: number) {
    const ys = this.knotY
    const us = this.knotU
    for (let i = 1; i < us.length; i++) {
      if (u <= us[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (u - us[i - 1])) / (us[i] - us[i - 1])
    }
    return ys[ys.length - 1]
  }

  /** Tabbing into the closing plate before it has appeared brings the page to it. */
  private onEndFocus = () => {
    if (this.max - window.scrollY < 4) return
    const lenis = this.lenis()
    if (lenis && !this.store.reduced) lenis.scrollTo(this.max, { duration: 1.4 })
    else window.scrollTo(0, this.max)
  }

  /**
   * A resize changes how tall every section is, so the same scroll offset
   * would land in a different chapter. Note where the story was when the
   * resize began; `measure` puts the page back there once layout settles.
   */
  private onResize = () => {
    if (!this.resizeFrom) this.resizeFrom = { w: this.vw, h: this.vh, u: this.store.u }
  }

  private onPointer = (e: PointerEvent) => {
    if (this.store.reduced || e.pointerType === "touch") return
    this.store.pointer.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1)
    this.store.pointer.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1)
    this.store.invalidate()
  }

  private measure() {
    const { root, store } = this
    const vw = window.innerWidth
    const vh = window.innerHeight
    const sy = window.scrollY
    this.vw = vw
    this.vh = vh
    this.stacked = window.matchMedia(STACKED).matches

    // The figure's drawn width: the room the plate gives it, snapped (where the
    // canvas is pixel-exact) so its strokes sit a whole number of device pixels
    // apart. The slot and the contact list take the same width from the page.
    const real = window.devicePixelRatio || 1
    store.view.dpr = clamp(real, 1, MAX_DPR)
    store.view.exact = real >= 1 && real <= MAX_DPR
    const room = root.querySelector<HTMLElement>(".sg-plate")?.clientWidth ?? 0
    if (room > 0) {
      const figure = `${snapFigure(room, store.view.dpr, store.view.exact).toFixed(3)}px`
      if (root.style.getPropertyValue("--sg-fig") !== figure) root.style.setProperty("--sg-fig", figure)
    }

    this.max = Math.max(1, document.documentElement.scrollHeight - vh)
    const top = (el: Element) => el.getBoundingClientRect().top + sy

    // Scroll position -> story time: each anchored section is one unit, entered
    // when its top edge crosses the middle of the viewport.
    const anchors = Array.from(root.querySelectorAll("[data-anchor]"))
    const ys = [0]
    const us = [0]
    for (let i = 1; i < anchors.length; i++) {
      ys.push(Math.max(ys[i - 1] + 1, top(anchors[i]) - vh / 2))
      us.push(i)
    }
    ys.push(Math.max(ys[ys.length - 1] + 1, this.max))
    us.push(U_END)
    this.knotY = ys
    this.knotU = us

    // After a real resize (not a phone's address bar sliding away), return to
    // the story time the visitor was at. Applied on the next tick, after
    // ScrollTrigger has finished its own refresh.
    const was = this.resizeFrom
    this.resizeFrom = null
    if (was && (was.w !== vw || Math.abs(was.h - vh) > was.h * 0.25)) {
      const y = this.scrollFor(was.u)
      if (Math.abs(y - sy) > 2) this.pendingScroll = y
    }

    // The two places the top-down figure is framed into.
    const hero = root.querySelector('[data-slot="hero"]')?.getBoundingClientRect()
    const end = root.querySelector('[data-slot="end"]')?.getBoundingClientRect()
    const panel = this.endPanel?.getBoundingClientRect()
    // The opening plate is sticky, so its slot is measured against the plate.
    const plate = this.hero?.getBoundingClientRect()
    if (hero && plate) {
      store.view.hero = {
        cx: hero.left + hero.width / 2,
        cy: hero.top - plate.top + hero.height / 2,
        w: hero.width,
        h: hero.height,
      }
      // The figure is drawn as wide as its slot unless the slot is too low for
      // that; then it is narrower, and the note at its corner moves in with it.
      const drawn = Math.min(hero.width, (hero.height * LENGTH) / (2 * HALF_W))
      const inset = `${(this.stacked ? 0 : Math.max(0, (hero.width - drawn) / 2)).toFixed(1)}px`
      if (root.style.getPropertyValue("--sg-inset") !== inset) root.style.setProperty("--sg-inset", inset)
    }
    if (end && panel) {
      store.view.end = {
        cx: end.left + end.width / 2,
        cy: end.top - panel.top + end.height / 2,
        w: end.width,
        h: end.height,
      }
    }
    store.view.w = vw
    store.view.h = vh
    store.view.stacked = this.stacked
    const column = root.querySelector(".sg-col")?.getBoundingClientRect()
    if (column) store.columnEdge = column.right / vw

    // The hold. The paper sticks at a height where it can be read whole: high
    // in the column beside the picture, or just under the picture when the
    // layout is stacked (and no lower than lets its last line stay on screen).
    const holder = root.querySelector<HTMLElement>(".sg-hold")
    const held = holder?.querySelector<HTMLElement>(".sg-paper") ?? null
    const first = root.querySelector<HTMLElement>(".sg-research .sg-col > .sg-paper")
    let pinNow = 0
    if (holder && held) {
      const tall = held.offsetHeight
      const line = this.stacked ? 0.52 : 0.24
      const floor = this.stacked ? 0.43 : 0.06
      const stick = Math.round(Math.max(floor * vh, Math.min(line * vh, vh - tall - 20)))
      const value = `${stick}px`
      if (root.style.getPropertyValue("--sg-pin") !== value) root.style.setProperty("--sg-pin", value)
      const from = top(holder) - stick
      const len = Math.max(0, holder.offsetHeight - tall)
      this.hold = { from, len, read: Math.max(0, stick + tall - vh * READ_LINE + 48) }
      pinNow = clamp(sy - from, 0, len)
      // The same stretch as story time, for the canvas: it stays a function of
      // `u`. With it goes the moment the first paper reaches that same height.
      // After it comes the stretch with no text on it, where night falls:
      // from when the paper, let go, has all but left through the top, until
      // the Projects heading comes in at the bottom.
      const head = root.querySelector<HTMLElement>(".sg-projects-head")
      const clear = from + len + Math.max(0, stick + tall - 0.12 * vh)
      store.marks = fitMarks(
        this.storyTime(first ? top(first) - stick : from - vh * 0.6),
        this.storyTime(from),
        this.storyTime(from + len),
        this.storyTime(from + vh) - this.storyTime(from),
        this.storyTime(clear),
        this.storyTime(head ? top(head) - 0.94 * vh : clear + vh),
      )
    } else this.hold = { from: 0, len: 0, read: 0 }
    store.viewVersion++

    // Words to light, and everything else that leaves through the top. A
    // re-measure (a resize, a late font) keeps how far each block had been read.
    const before = this.blocks
    this.blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-lit]")).map((el, i) => {
      const isHeld = held !== null && held.contains(el)
      // Where it lies in the document when nothing is pinned.
      const doc = sy - (isHeld ? pinNow : 0)
      const rect = el.getBoundingClientRect()
      const words = Array.from(el.querySelectorAll<HTMLElement>(".sg-w")).map((w) => {
        const r = w.getBoundingClientRect()
        const y = r.top + doc + r.height / 2
        const across = clamp((r.left - rect.left) / Math.max(1, rect.width))
        return { el: w, y, at: y + (across - 0.5) * r.height * 0.8, soft: r.height * 0.7, op: -1 }
      })
      const line = Math.max(16, words[0] ? words[0].soft / 0.7 : 24)
      const top = rect.top + doc
      const bottom = rect.bottom + doc
      const old = before[i]
      const read = old ? clamp((old.shown - old.top) / Math.max(1, old.bottom - old.top), -1, 2) : -1
      return { top, bottom, line, shown: Math.max(top - line, top + read * (bottom - top)), words, held: isHeld }
    })
    this.faders = Array.from(root.querySelectorAll<HTMLElement>("[data-fade]")).map((el) => {
      const isHeld = held !== null && held.contains(el)
      const r = el.getBoundingClientRect()
      return { el, y: r.top + sy - (isHeld ? pinNow : 0) + r.height / 2, half: r.height / 2, op: -1, held: isHeld }
    })

    // The chapter list is fixed, so each label has one place on the screen.
    this.navItems = Array.from(root.querySelectorAll<HTMLElement>(".sg-nav li")).map((el) => {
      const r = el.getBoundingClientRect()
      const label = el.querySelector("a")?.getBoundingClientRect() ?? r
      return { el, x0: label.left, x1: label.right, y: r.top + r.height / 2, night: -1 }
    })
    this.navNight = NaN

    this.dirty = true
    store.invalidate()
  }

  private storyTime(y: number) {
    const ys = this.knotY
    const us = this.knotU
    if (y <= ys[0]) return us[0]
    for (let i = 1; i < ys.length; i++) {
      if (y <= ys[i]) return us[i - 1] + ((us[i] - us[i - 1]) * (y - ys[i - 1])) / (ys[i] - ys[i - 1])
    }
    return us[us.length - 1]
  }

  /** Text gives the top of the screen back to the picture as it leaves. */
  private topFade(yView: number) {
    return this.stacked
      ? smooth(this.vh * 0.4, this.vh * 0.5, yView)
      : smooth(this.vh * 0.035, this.vh * 0.13, yView)
  }

  private tick = (_time: number, deltaMs: number) => {
    if (this.pendingScroll !== null) {
      const to = this.pendingScroll
      this.pendingScroll = null
      const lenis = this.lenis()
      if (lenis) {
        // Lenis measures the page on its own schedule; without this it would
        // clamp the jump to the height the page had before the resize.
        lenis.resize()
        lenis.scrollTo(to, { immediate: true, force: true })
      } else window.scrollTo(0, to)
    }
    const y = this.trigger ? this.trigger.scroll() : window.scrollY
    const moved = y !== this.lastY || this.dirty
    if (moved) {
      this.lastY = y
      this.pin = clamp(y - this.hold.from, 0, this.hold.len)
      const u = this.storyTime(y)
      this.store.u = u
      this.store.invalidate()
      this.chrome(u)
      this.fade(y)
    }
    this.light(y, Math.min(deltaMs / 1000, 0.1), moved)
    this.dirty = false
  }

  private chrome(u: number) {
    const night = u > (this.store.marks.nightFrom + this.store.marks.nightTo) / 2
    if (night !== this.night) {
      this.night = night
      this.root.dataset.night = String(night)
      if (night) document.documentElement.dataset.signalNight = "true"
      else delete document.documentElement.dataset.signalNight
    }

    let index = 0
    for (let i = 0; i < CHAPTERS.length; i++) if (u >= CHAPTERS[i].from) index = i
    const from = CHAPTERS[index].from
    const to = index + 1 < CHAPTERS.length ? CHAPTERS[index + 1].from : U_END
    // The marker stays beside the current chapter's label and travels the
    // height of that one row as the chapter is read; it never runs ahead.
    const at = index + 0.4 * clamp((u - from) / (to - from))
    this.navAt = at
    this.nav?.style.setProperty("--sg-at", at.toFixed(3))
    this.paintNav(u)
    if (index !== this.active) {
      this.active = index
      this.navLinks.forEach((a, i) => {
        if (i === index) a.setAttribute("aria-current", "location")
        else a.removeAttribute("aria-current")
      })
    }

    if (this.endPanel) this.endPanel.style.opacity = smooth(8.58, 8.9, u).toFixed(3)
    if (this.cue) this.cue.style.opacity = (1 - smooth(0.03, 0.3, u)).toFixed(3)
    // The opening plate holds while the camera starts to move, then lets go.
    if (this.hero) {
      const gone = smooth(0.42, 0.95, u)
      this.hero.style.opacity = (1 - gone).toFixed(3)
      this.hero.style.visibility = gone >= 1 ? "hidden" : "visible"
    }
  }

  /**
   * Night comes over the screen as spots, and the chapter list sits in its
   * way. Each label takes its colours from the sheet directly behind it (the
   * same function of the same number the canvas draws night with): ink while
   * that is white (by day and in the kaleidoscope alike), light once it is
   * night. While a blot's edge is crossing it
   * the label goes to full strength and gains a halo of the tone it is
   * leaving, so it stays readable wherever the scroll comes to rest.
   */
  private paintNav(u: number) {
    const t = nightfall(u, this.store.marks)
    if (t === this.navNight) return
    this.navNight = t
    const aspect = this.vw / this.vh
    for (const item of this.navItems) {
      // Three places along the label, so a blot's edge crosses it gradually.
      let night = 0
      for (let k = 0; k < 3; k++) {
        const x = lerp(item.x0, item.x1, (k + 0.5) / 3)
        night += spotsAt(x / this.vw, 1 - item.y / this.vh, aspect, t, NIGHT_SEED) / 3
      }
      if (Math.abs(night - item.night) < 0.003) continue
      item.night = night
      const s = item.el.style
      if (night < NAV_CROSS) {
        const band = night / NAV_CROSS
        s.setProperty("--fg", rgb(INK))
        s.setProperty("--fg-soft", rgb(blend(GRAPHITE, INK, band)))
        s.setProperty("--rule", rgb(blend(HAIRLINE, GRAPHITE, band)))
        // (Night falls over the kaleidoscope's warm white.)
        s.setProperty("--halo", `rgb(251 247 234 / ${(0.95 * band).toFixed(3)})`)
      } else {
        const band = (1 - night) / (1 - NAV_CROSS)
        s.setProperty("--fg", "rgb(238 242 248)")
        s.setProperty("--fg-soft", `rgb(238 242 248 / ${lerp(0.68, 1, band).toFixed(3)})`)
        s.setProperty("--rule", `rgb(238 242 248 / ${lerp(0.22, 0.6, band).toFixed(3)})`)
        s.setProperty("--halo", `rgb(6 20 46 / ${(0.95 * band).toFixed(3)})`)
      }
    }
    // The marker takes the palette of the label it is passing.
    const under = this.navItems[Math.floor(this.navAt)]
    if (under) this.nav?.style.setProperty("--link", under.night < NAV_CROSS ? "#1f47e6" : "#7fa2ff")
  }

  private fade(scroll: number) {
    for (const f of this.faders) {
      const y = f.held ? scroll - this.pin : scroll
      if (f.y + f.half < y - 20 || f.y - f.half > y + this.vh + 20) continue
      const op = this.topFade(f.y - y)
      if (Math.abs(op - f.op) > 0.004) {
        f.op = op
        f.el.style.opacity = op.toFixed(3)
      }
    }
  }

  private light(scroll: number, dt: number, moved: boolean) {
    for (const b of this.blocks) {
      // A held paper stays where it is on screen, so the light goes on down
      // it with the first of the scroll that holds it.
      const y = b.held ? scroll - this.pin : scroll
      const read = y + this.vh * READ_LINE + (b.held ? Math.min(this.pin, this.hold.read) : 0)
      const lo = b.top - b.line
      const hi = b.bottom + b.line
      const target = clamp(read, lo, hi)
      const onScreen = b.bottom > y - 40 && b.top < y + this.vh + 40
      let shown = b.shown
      if (this.store.reduced) shown = hi
      else if (!onScreen || target < shown) shown = target
      else if (target > shown) {
        // Scrubbed by scroll, but the light never outruns a reader: it moves
        // at a reading pace and only hurries when it has fallen far behind.
        const lag = target - shown
        const rate = b.line * LINES_PER_SECOND * (1 + lag / (this.vh * 0.3))
        shown = Math.min(target, shown + rate * dt)
      }
      if (shown === b.shown && !(moved && onScreen)) continue
      b.shown = shown
      for (const w of b.words) {
        const lit = clamp((shown - w.at) / w.soft + 0.5)
        const op = (DIM + (1 - DIM) * lit) * this.topFade(w.y - y)
        if (Math.abs(op - w.op) > 0.004) {
          w.op = op
          w.el.style.opacity = op.toFixed(3)
        }
      }
    }
  }
}
