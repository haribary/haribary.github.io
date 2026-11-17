import { useCallback, useEffect, useId, useRef, useState } from "react"

/** The recording the landscape is drawn from, as it is offered for listening. */
const RECORDING = "/lab/voice/voice.wav"

/**
 * The small "i" at the corner of the opening figure. It opens a note that
 * says what the figure is and lets the visitor hear the recording it was
 * drawn from. The note closes on Escape, on a click anywhere else, and when
 * the page is scrolled away from it.
 */
export function FigureNote() {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const id = useId()

  const stop = useCallback(() => {
    const a = audio.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    setPlaying(false)
  }, [])

  const close = useCallback(
    (refocus: boolean) => {
      stop()
      setOpen(false)
      if (refocus) opener.current?.focus()
    },
    [stop],
  )

  useEffect(() => {
    if (!open) return
    const from = window.scrollY
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true)
    }
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false)
    }
    const onScroll = () => {
      if (Math.abs(window.scrollY - from) > window.innerHeight * 0.12) close(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onDown)
      window.removeEventListener("scroll", onScroll)
    }
  }, [open, close])

  // Nothing keeps playing once the page is left.
  useEffect(() => () => audio.current?.pause(), [])

  const toggle = () => {
    if (playing) {
      stop()
      return
    }
    let a = audio.current
    if (!a) {
      a = new Audio(RECORDING)
      a.addEventListener("ended", () => setPlaying(false))
      a.addEventListener("error", () => setPlaying(false))
      audio.current = a
    }
    a.currentTime = 0
    // If the file is missing, or the browser will not play it, nothing happens.
    a.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
  }

  return (
    <div ref={wrap} className="sg-note">
      <button
        ref={opener}
        type="button"
        className="sg-info"
        aria-label="About this figure"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <div id={id} className="sg-pop" role="dialog" aria-label="About this figure">
          <p>A spectrogram of my voice saying: “Hi, my name is Harrison Li. Welcome to my website.”</p>
          <button type="button" className="sg-play" aria-pressed={playing} onClick={toggle} autoFocus>
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
              {playing ? <path d="M1.5 1.5h7v7h-7z" /> : <path d="M2 1l7 4-7 4z" />}
            </svg>
            {playing ? "Stop" : "Play the recording"}
          </button>
        </div>
      )}
    </div>
  )
}
