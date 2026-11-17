import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react"
import { Euler, Quaternion, Vector2, type PerspectiveCamera } from "three"

import { createCompanion, createDirector, type Director } from "./companion"
import type { Life, Pictures } from "./glass"
import { smooth } from "./math"
import { FORM } from "./shards"
import { MAX_DPR, type Store } from "./store"
import { createRig, createShot, type Rig } from "./story"
import type { Terrain } from "./terrain"
import { createWorld, PALETTE } from "./world"

/** Pointer parallax, in radians at the edge of the window. */
const YAW = 0.05
const PITCH = 0.03
/**
 * Multisampling softens the places where a hill cuts a line, which no shader
 * here can do (the cut is a depth test). It is on wherever the canvas is drawn
 * close to the screen's own pixels; on very dense phone screens the canvas is
 * already upscaled and the extra samples would only cost.
 */
const MULTISAMPLE = typeof window === "undefined" || (window.devicePixelRatio || 1) < 2.5
/** Seconds the opening takes to plot the figure, left to right. */
const PLOT_SECONDS = 1.7
/** How far the vanishing point moves off centre, as a fraction of the half-screen. */
const SHIFT_X = 0.38
const SHIFT_Y = 0.36

/** The stone's own slow turn while the page is still, in radians per second. */
const IDLE_TURN = 0.1
/** How quickly the shards catch up with the scroll, per second. */
const FOLLOW = 13
/** The most a fast scroll leaves the shards behind, in CSS px. */
const DRAG = 18

type SceneProps = { store: Store; terrain: Terrain; pictures: Pictures; onFirstFrame: () => void }

function Scene({ store, terrain, pictures, onFirstFrame }: SceneProps) {
  const invalidate = useThree((s) => s.invalidate)
  const get = useThree((s) => s.get)
  const world = useMemo(() => createWorld(terrain, pictures), [terrain, pictures])
  const shot = useMemo(createShot, [])
  const companion = useMemo(createCompanion, [])
  const life = useMemo<Life>(
    () => ({ appear: 0, spin: 0, clock: 0, leanX: 0, leanY: 0, drag: 0, reduced: false }),
    [],
  )
  const director = useRef<{ director: Director; version: number; w: number; h: number; reduced: boolean } | null>(null)
  /** The story time the shards are shown at: it trails the scroll a little. */
  const trail = useRef<{ u: number; last: number } | null>(null)
  const idle = useRef(false)
  const scratch = useMemo(() => ({ q: new Quaternion(), e: new Euler(), size: new Vector2() }), [])
  const rig = useRef<{ rig: Rig; version: number; w: number; h: number } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const drawn = useRef(false)
  const plot = useRef(0)

  useEffect(() => {
    world.onChange = () => invalidate()
    world.onTexture = (texture) => get().gl.initTexture(texture)
    world.load()
    // Compile every shader now, including the ones for the later schemes, so
    // nothing hitches the first time one of them arrives mid-scroll.
    const state = get()
    const restore = world.everything()
    state.gl.compile(world.group, state.camera)
    restore()
    store.invalidate = () => invalidate()
    invalidate()
    return () => {
      store.invalidate = () => {}
      world.onChange = () => {}
      world.onTexture = () => {}
      world.dispose()
    }
  }, [world, store, invalidate, get])

  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera
    const { width, height } = state.size
    if (width === 0 || height === 0) return

    let r = rig.current
    if (!r || r.version !== store.viewVersion || r.w !== width || r.h !== height) {
      r = {
        rig: createRig(terrain, { ...store.view, w: width, h: height }, store.marks),
        version: store.viewVersion,
        w: width,
        h: height,
      }
      rig.current = r
    }

    r.rig.evaluate(store.override ?? store.u, shot)

    // Ease the pointer; keep asking for frames until it has settled.
    const p = pointer.current
    const k = store.reduced ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) * 4.5)
    p.x += (store.pointer.x - p.x) * k
    p.y += (store.pointer.y - p.y) * k
    if (Math.abs(store.pointer.x - p.x) + Math.abs(store.pointer.y - p.y) > 0.002) state.invalidate()

    camera.position.set(shot.pos[0], shot.pos[1], shot.pos[2])
    camera.up.set(shot.up[0], shot.up[1], shot.up[2]).normalize()
    camera.lookAt(shot.target[0], shot.target[1], shot.target[2])
    // A flat drawing on a page does not sway: parallax belongs to the place,
    // and it would also pull the figure's strokes off the pixel grid.
    const sway = 1 - shot.fill
    camera.quaternion.multiply(scratch.q.setFromEuler(scratch.e.set(-p.y * PITCH * sway, -p.x * YAW * sway, 0)))

    camera.fov = shot.fov
    camera.near = 0.08
    camera.far = 1500
    camera.updateProjectionMatrix()
    // Lens shift: slide the vanishing point toward the open side of the page.
    const m = camera.projectionMatrix.elements
    if (r.rig.stacked) m[9] = -SHIFT_Y * shot.shift
    else m[8] = -SHIFT_X * shot.shift
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.updateMatrixWorld()

    // The one thing here that runs on time rather than scroll: on load the
    // figure is plotted once, then this is 1 for good.
    if (plot.current < 1) {
      plot.current = store.reduced ? 1 : Math.min(1, plot.current + Math.min(delta, 0.05) / PLOT_SECONDS)
      state.invalidate()
    }
    const t = plot.current
    const plotted = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    // --- The shards ------------------------------------------------------------
    let d = director.current
    if (!d || d.version !== store.viewVersion || d.w !== width || d.h !== height || d.reduced !== store.reduced) {
      d = {
        director: createDirector({
          view: { ...store.view, w: width, h: height },
          columnEdge: store.columnEdge,
          marks: store.marks,
          photos: pictures.photos.length,
          reduced: store.reduced,
        }),
        version: store.viewVersion,
        w: width,
        h: height,
        reduced: store.reduced,
      }
      director.current = d
    }
    const dt = Math.min(delta, 0.05)
    const now = store.override ?? store.u
    // They trail a fast scroll and catch up, landing exactly on their pose.
    const tr = trail.current ?? (trail.current = { u: now, last: now })
    const speed = dt > 0 ? (now - tr.last) / dt : 0
    tr.last = now
    if (store.reduced || Math.abs(now - tr.u) > 1.5) tr.u = now
    else {
      tr.u += (now - tr.u) * (1 - Math.exp(-dt * FOLLOW))
      if (Math.abs(now - tr.u) < 2e-4) tr.u = now
      else state.invalidate()
    }
    const drag = store.reduced ? 0 : -Math.max(-DRAG, Math.min(DRAG, speed * 26))
    life.drag += (drag - life.drag) * (1 - Math.exp(-dt * 7))
    if (Math.abs(life.drag) < 0.05 && drag === 0) life.drag = 0
    else state.invalidate()

    d.director.evaluate(tr.u, companion)
    if (import.meta.env.DEV && store.force) Object.assign(companion, store.force)

    // It fades in as the opening finishes plotting the figure.
    if (life.appear < 1) {
      life.appear = store.reduced ? 1 : Math.min(1, life.appear + (plotted > 0.9 ? dt / 0.9 : 0))
      state.invalidate()
    }
    life.reduced = store.reduced
    life.leanX = p.x
    life.leanY = p.y
    // Two things keep moving while the page is still: the stone, while it is
    // whole, turns slowly on its own; and a sheet, while it is whole, has
    // loose tiles round its rim that drift. Both need a frame now and then
    // even when nothing else moves; every other display frame is plenty for
    // motion that slow. The voice and the tower stand still.
    const whole = companion.from === FORM.stone ? 1 - smooth(0, 0.02, companion.mix) : 0
    const sheet = companion.to === FORM.photo || companion.to === FORM.cover ? smooth(0.9, 1, companion.mix) : 0
    if (!store.reduced && life.appear > 0 && (whole > 0 || sheet > 0)) {
      life.spin += IDLE_TURN * dt * whole
      if (life.spin > Math.PI) life.spin -= Math.PI * 2
      life.clock += dt * sheet
      if (!idle.current) {
        idle.current = true
        requestAnimationFrame(() => {
          idle.current = false
          state.invalidate()
        })
      }
    }

    state.gl.getDrawingBufferSize(scratch.size)
    world.update(
      shot,
      {
        width: scratch.size.x,
        height: scratch.size.y,
        dpr: state.gl.getPixelRatio(),
        stacked: r.rig.stacked,
        columnEdge: store.columnEdge,
        drawn: plotted,
      },
      companion,
      life,
    )
    // While one scheme is coming over another, its spots are drawn first.
    world.prepare(state.gl)

    if (!drawn.current) {
      drawn.current = true
      onFirstFrame()
    }
  })

  return <primitive object={world.group} />
}

/** If WebGL is unavailable the page still reads: the text is all in the DOM. */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

type CanvasProps = {
  store: Store
  terrain: Terrain | null
  /** The pictures the shards show: photographs beside About, covers beside Projects. */
  pictures: Pictures
  onFirstFrame: () => void
}

export function SignalCanvas({ store, terrain, pictures, onFirstFrame }: CanvasProps) {
  return (
    <CanvasBoundary>
      <Canvas
        flat
        frameloop="demand"
        dpr={[1, MAX_DPR]}
        gl={{ antialias: MULTISAMPLE, alpha: false, stencil: false, powerPreference: "high-performance" }}
        camera={{ fov: 46, near: 0.08, far: 1500, position: [35, 60, 0] }}
        resize={{ scroll: false }}
        onCreated={({ gl }) => gl.setClearColor(PALETTE.paper)}
      >
        {terrain && <Scene store={store} terrain={terrain} pictures={pictures} onFirstFrame={onFirstFrame} />}
      </Canvas>
    </CanvasBoundary>
  )
}
