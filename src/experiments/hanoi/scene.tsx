import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei"

import { FONT, WORDS, makeBackdropMaterial, makeWordTexture, type WordTexture } from "./backdrop"
import type { Game } from "./game"
import {
  BASE_D,
  BASE_H,
  BASE_TOP,
  BASE_W,
  DISCS,
  DISC_COUNT,
  DISC_H,
  HOLE_R,
  LIFT_Y,
  OUTER_R,
  PEG_H,
  PEG_NAMES,
  PEG_R,
  PEG_SPACING,
  PEG_TOP,
  PEG_X,
  restY,
  clamp01,
  lastMovedDisc,
  lerp,
  movePose,
  movesShown,
  scrollPoses,
  MOVE_COUNT,
  type Pose,
} from "./solver"
import { DESKTOP, MOBILE, layoutAt, store, type WordSpec } from "./store"

const FOV = 17
const TAN_H = Math.tan(((FOV / 2) * Math.PI) / 180)
const TARGET_Y = 0.78
const TOWER_H = 2.75
const ZW = 4.2 // backdrop distance behind the tower
const EL = (27 * Math.PI) / 180
const DEG = Math.PI / 180

const STUDIO = new THREE.Color("#ECEDEF")
const NIGHT = new THREE.Color("#0A0B0E")
const INK = new THREE.Color("#111318")
const INK_NIGHT = new THREE.Color("#1F2229")
const BASE_DAY = new THREE.Color("#d7dade")
const BASE_NIGHT = new THREE.Color("#16181d")

// ---------------------------------------------------------------- geometry

function arcPoints(out: THREE.Vector2[], cx: number, cy: number, r: number, a0: number, a1: number, n: number) {
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
  }
}

/** A thick ring with softly rounded edges, turned on a lathe. */
function discGeometry(rOut: number, rIn: number, h: number, b: number) {
  const pts: THREE.Vector2[] = []
  const rm = (rOut + rIn) / 2
  const y0 = -h / 2
  const y1 = h / 2
  pts.push(new THREE.Vector2(rm, y0))
  arcPoints(pts, rOut - b, y0 + b, b, -Math.PI / 2, 0, 10)
  arcPoints(pts, rOut - b, y1 - b, b, 0, Math.PI / 2, 10)
  arcPoints(pts, rIn + b, y1 - b, b, Math.PI / 2, Math.PI, 8)
  arcPoints(pts, rIn + b, y0 + b, b, Math.PI, Math.PI * 1.5, 8)
  pts.push(new THREE.Vector2(rm, y0))
  const g = new THREE.LatheGeometry(pts, 160)
  return g
}

/** A plain steel rod with a small chamfer, sunk slightly into the slab. */
function pegGeometry() {
  const c = 0.025
  const pts = [
    new THREE.Vector2(0.0001, -0.04),
    new THREE.Vector2(PEG_R, -0.04),
    new THREE.Vector2(PEG_R, PEG_H - c),
    new THREE.Vector2(PEG_R - c * 0.35, PEG_H - c * 0.35),
    new THREE.Vector2(PEG_R - c, PEG_H),
    new THREE.Vector2(0.0001, PEG_H),
  ]
  const g = new THREE.LatheGeometry(pts, 48)
  g.computeTangents()
  return g
}

function letterTexture(letter: string) {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 128
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.font = `600 104px ${FONT}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(letter, 64, 70)
  const t = new THREE.CanvasTexture(c)
  t.anisotropy = 8
  return t
}

// ---------------------------------------------------------------- materials

const glow = { value: 0 }

function discMaterial(hue: string) {
  const c = new THREE.Color(hue)
  const m = new THREE.MeshPhysicalMaterial({
    color: c.clone().lerp(new THREE.Color("#ffffff"), 0.12),
    transmission: 1,
    roughness: 0.025,
    metalness: 0,
    ior: 1.49,
    thickness: 0.32,
    attenuationColor: c,
    attenuationDistance: 5,
    dispersion: 0.12,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.0,
  })
  const glowColor = { value: c.clone() }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.uniforms.uGlowColor = glowColor
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;\nuniform vec3 uGlowColor;")
      .replace(
        "#include <transmission_fragment>",
        // Longer path through the sheet at grazing angles: rims and bevels
        // read deeper in colour and bend the type harder than the faces.
        THREE.ShaderChunk.transmission_fragment.replace(
          "material.thickness = thickness;",
          "material.thickness = thickness * mix(2.0, 0.8, pow(abs(dot(normalize(normal), normalize(vViewPosition))), 0.6));",
        ),
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Light scattered inside the sheet: the disc keeps its own colour even
        // where it sits over black type, so strokes read as tinted fragments.
        totalEmissiveRadiance += uGlowColor * (1.0 - uGlow) * 0.16;
        if (uGlow > 0.0) {
          // Edge-lit acrylic: light trapped in the sheet escapes at the cut
          // edges, so the rim (normals near horizontal) glows, faces stay clear.
          vec3 nW = inverseTransformDirection(normalize(normal), viewMatrix);
          float side = 1.0 - abs(nW.y);
          float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
          totalEmissiveRadiance += uGlowColor * uGlow * (0.03 + 3.2 * pow(side, 6.0) * (0.35 + fr) + 0.6 * pow(fr, 4.0));
        }`,
      )
  }
  return m
}

// ---------------------------------------------------------------- words

function useWordTextures(gl: THREE.WebGLRenderer) {
  const [words, setWords] = useState<WordTexture[] | null>(null)
  useEffect(() => {
    let alive = true
    let made: WordTexture[] = []
    const aniso = gl.capabilities.getMaxAnisotropy()
    Promise.all([document.fonts.load(`820 200px "Rubik Variable"`), document.fonts.load(`600 100px "Rubik Variable"`)])
      .catch(() => undefined)
      .then(() => {
        if (!alive) return
        made = WORDS.map((w) => makeWordTexture(w, aniso))
        setWords(made)
      })
    return () => {
      alive = false
      made.forEach((w) => w.texture.dispose())
    }
  }, [gl])
  return words
}

// ---------------------------------------------------------------- the stage

const v3 = new THREE.Vector3()

function Stage({ game }: { game: Game }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const words = useWordTextures(gl)

  const backdrop = useMemo(makeBackdropMaterial, [])
  const discGeos = useMemo(() => OUTER_R.map((r) => discGeometry(r, HOLE_R, DISC_H, 0.085)), [])
  const discMats = useMemo(() => DISCS.map((d) => discMaterial(d.hue)), [])
  const pegGeo = useMemo(pegGeometry, [])
  const pegMat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: "#e2e5ea",
      metalness: 1,
      roughness: 0.16,
      anisotropy: 0.6,
      anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.25,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uGlow;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          if (uGlow > 0.0) {
            float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
            totalEmissiveRadiance += vec3(0.75, 0.82, 1.0) * uGlow * 1.6 * pow(fr, 3.0);
          }`,
        )
    }
    return m
  }, [])
  const baseMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#d7dade", roughness: 0.62, metalness: 0, envMapIntensity: 0.95, sheen: 0.2, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffffff") }),
    [],
  )
  const letters = useMemo(() => PEG_NAMES.map(letterTexture), [])
  const letterMat = useMemo(
    () => letters.map((t) => new THREE.MeshBasicMaterial({ map: t, color: "#8b919b", transparent: true, depthWrite: false })),
    [letters],
  )

  useEffect(
    () => () => {
      backdrop.dispose()
      discGeos.forEach((g) => g.dispose())
      discMats.forEach((m) => m.dispose())
      pegGeo.dispose()
      pegMat.dispose()
      baseMat.dispose()
      letters.forEach((t) => t.dispose())
      letterMat.forEach((m) => m.dispose())
    },
    [backdrop, discGeos, discMats, pegGeo, pegMat, baseMat, letters, letterMat],
  )

  const discRefs = useRef<(THREE.Mesh | null)[]>([])
  const poolRefs = useRef<(THREE.Mesh | null)[]>([])
  const poolTex = useMemo(() => {
    const c = document.createElement("canvas")
    c.width = c.height = 128
    const ctx = c.getContext("2d")!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.35, "rgba(255,255,255,0.45)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  // Daylight: coloured shadows on the slab, as if light passed through.
  const tintRefs = useRef<(THREE.Mesh | null)[]>([])
  const tintTex = useMemo(() => {
    const c = document.createElement("canvas")
    c.width = c.height = 256
    const ctx = c.getContext("2d")!
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, "rgba(255,255,255,0.15)")
    g.addColorStop(0.3, "rgba(255,255,255,0.35)")
    g.addColorStop(0.62, "rgba(255,255,255,1)")
    g.addColorStop(0.8, "rgba(255,255,255,0.55)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  const tintMats = useMemo(
    () =>
      DISCS.map(
        (d) =>
          new THREE.MeshBasicMaterial({
            map: tintTex,
            color: new THREE.Color(d.hue).lerp(new THREE.Color("#ffffff"), 0.1),
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
      ),
    [tintTex],
  )
  useEffect(
    () => () => {
      tintTex.dispose()
      tintMats.forEach((m) => m.dispose())
    },
    [tintTex, tintMats],
  )
  const poolMats = useMemo(
    () =>
      DISCS.map(
        (d) =>
          new THREE.MeshBasicMaterial({
            map: poolTex,
            color: d.hue,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [poolTex],
  )
  useEffect(
    () => () => {
      poolTex.dispose()
      poolMats.forEach((m) => m.dispose())
    },
    [poolTex, poolMats],
  )
  const backdropRef = useRef<THREE.Mesh>(null)

  // Per-frame memory, kept out of React.
  const mem = useRef({
    px: 0,
    py: 0,
    mode: "scroll" as "scroll" | "play",
    blendAt: -10,
    blendFrom: [] as Pose[],
    rendered: [] as Pose[],
    shown: -1,
    last: -2,
    dark: -1,
    play: false,
    introAt: -1,
    darkV: 0,
  })

  useFrame((state, delta) => {
    const m = mem.current
    const now = performance.now() / 1000
    const camera = state.camera as THREE.PerspectiveCamera
    const { width: w, height: h } = state.size
    const aspect = w / h
    const y = window.scrollY
    const sections = store.sections
    if (sections.length === 0) return
    const L = store.mobile ? MOBILE : DESKTOP

    // ---- layout and camera
    const { a, b, e } = layoutAt(y)
    const la = L[sections[a].layout]
    const lb = L[sections[b].layout]
    const sx = lerp(la.sx, lb.sx, e)
    const sy = lerp(la.sy, lb.sy, e)
    const fit = lerp(la.fit, lb.fit, e)
    const fitH = lerp(la.fitH, lb.fitH, e)
    const dist = Math.max((BASE_W * 1.04) / (fit * 2 * TAN_H * aspect), TOWER_H / (fitH * 2 * TAN_H))

    const k = Math.min(1, delta * 3.5)
    const motion = store.finePointer && !store.reduced
    m.px += ((motion ? store.pointer.x : 0) - m.px) * k
    m.py += ((motion ? store.pointer.y : 0) - m.py) * k
    const page = clamp01(y / Math.max(1, store.maxScroll))
    const idle = store.reduced ? 0 : Math.sin(now * 0.23) * 0.6 * DEG
    const az = (-5 + 10 * page) * DEG + m.px * 3.5 * DEG + idle
    const el = EL - m.py * 2.2 * DEG
    camera.position.set(
      Math.sin(az) * Math.cos(el) * dist,
      TARGET_Y + Math.sin(el) * dist,
      Math.cos(az) * Math.cos(el) * dist,
    )
    camera.lookAt(0, TARGET_Y, 0)
    camera.setViewOffset(w, h, (0.5 - sx) * w, (0.5 - sy) * h, w, h)
    // The backdrop turns with the orbit so the type never keystones; it stays
    // put in space, so it still slides behind the tower (parallax).
    if (backdropRef.current) backdropRef.current.rotation.y = az

    // ---- words on the backdrop (computed from the unorbited camera so the
    // orbit and the pointer give real parallax between type and tower)
    const camY = TARGET_Y + Math.sin(EL) * dist
    const camZ = Math.cos(EL) * dist
    // Where the slab's back edge lands on the backdrop: the words stand on
    // that line, so their full height clears the slab.
    const t = (-ZW - camZ) / (-BASE_D / 2 - camZ)
    const ax = 0
    const ay = camY + (BASE_TOP + 0.02 - camY) * t
    const vdy = TARGET_Y - camY
    const vdz = -camZ
    const vl = Math.hypot(vdy, vdz)
    const dp = ((ay - camY) * vdy + (-ZW - camZ) * vdz) / vl
    const visW = 2 * dp * TAN_H * aspect
    const visH = (2 * dp * TAN_H) / Math.cos(EL)
    const u = backdrop.uniforms
    const rect = (spec: WordSpec, wt: WordTexture, out: THREE.Vector4) => {
      let ww: number
      let hh: number
      let cx = ax
      if (spec.mode === "fit") {
        ww = spec.width * visW
        hh = ww / wt.aspect
        cx = ax + (0.5 - sx) * visW
      } else {
        // Never wider than the room on its side of the page, so the word
        // always reads whole.
        const room =
          spec.mode === "edge" ? (spec.align === "right" ? spec.edge - 0.03 : 0.97 - spec.edge) * visW : 0.94 * visW
        hh = Math.min(spec.height * visH, room / wt.aspect)
        ww = hh * wt.aspect
        if (spec.mode === "edge") {
          const edge = ax + (spec.edge - sx) * visW
          cx = spec.align === "right" ? edge - ww / 2 : edge + ww / 2
        }
      }
      // Baseline sits 22.7% up the texture box (see makeWordTexture).
      out.set(cx, ay + hh * 0.03 + hh * (0.5 - 0.227), ww, hh)
    }
    if (words && m.introAt === -1) m.introAt = store.reduced ? now - 1000 : now + 0.15
    const intro = m.introAt === -1 ? 0 : now - m.introAt
    if (words) {
      const wa = words[sections[a].word]
      const wb = words[sections[b].word]
      u.uTexA.value = wa.texture
      u.uTexB.value = wb.texture
      rect(la.word, wa, u.uRectA.value)
      rect(lb.word, wb, u.uRectB.value)
      // The old word rolls up and out, then the new one rolls up into place.
      const out = clamp01(e / 0.42)
      const inn = clamp01((e - 0.34) / 0.46)
      const enter = 1 - (1 - clamp01(intro / 1.1)) ** 4
      u.uRollA.value = a === b ? enter - 1 : out * out * out
      u.uRollB.value = a === b ? 2 : 1 - (1 - inn) ** 3 - 1
    }
    u.uSpot.value.set(ax, ay, visW * 0.32)

    // ---- dark studio for play
    // The lights go out over a moment once you arrive, rather than being
    // scrubbed: a half-lit grey studio is never a good frame.
    const darkTarget = y >= (store.darkStart + store.darkEnd) / 2 ? 1 : 0
    m.darkV += (darkTarget - m.darkV) * Math.min(1, delta * (store.reduced ? 12 : 2.6))
    if (Math.abs(darkTarget - m.darkV) < 0.002) m.darkV = darkTarget
    const dark = m.darkV * m.darkV * (3 - 2 * m.darkV)
    u.uBg.value.copy(STUDIO).lerp(NIGHT, dark)
    u.uInk.value.copy(INK).lerp(INK_NIGHT, dark)
    u.uSpotGain.value = lerp(store.mobile ? 0 : 0.05, 0.9, dark)
    scene.environmentIntensity = lerp(1, 0.22, dark)
    glow.value = dark
    baseMat.color.copy(BASE_DAY).lerp(BASE_NIGHT, dark)
    if (Math.abs(dark - m.dark) > 0.002 && store.root) {
      m.dark = dark
      store.root.style.setProperty("--dark", dark.toFixed(3))
      store.root.dataset.dark = dark > 0.5 ? "true" : "false"
    }

    // ---- disc poses
    const span = Math.max(1, store.moveEnd - store.moveStart)
    const tm = MOVE_COUNT * clamp01((y - store.moveStart) / span)
    const r = clamp01((y - store.resetStart) / Math.max(1, store.resetEnd - store.resetStart))
    const play = y >= store.playAt - 2
    const mode = play ? "play" : "scroll"
    if (mode !== m.mode) {
      m.mode = mode
      m.blendAt = now
      m.blendFrom = m.rendered.map((p) => ({ ...p }))
    }
    const target = play ? null : scrollPoses(tm, r)
    for (let d = 0; d < DISC_COUNT; d++) {
      let p = target ? target[d] : game.pose(d, now, !store.reduced)
      const bt = (now - m.blendAt) / 0.75
      const from = m.blendFrom[d]
      if (bt < 1 && from) {
        const moved = Math.abs(from.x - p.x) + Math.abs(from.y - p.y) > 0.01
        if (moved) {
          const q = movePose(from.x, from.y, p.x, p.y, bt * 0.8, LIFT_Y + 0.2 + (DISC_COUNT - d) * (DISC_H + 0.02))
          p = { ...q, scale: lerp(from.scale, p.scale, clamp01(bt * 1.4)) }
        } else {
          p = { ...p, scale: lerp(from.scale, p.scale, clamp01(bt * 1.4)) }
        }
      }
      // Entrance: the discs drop onto their pegs, largest first.
      if (intro < 2.2) {
        const tt = intro - 0.35 - (DISC_COUNT - 1 - d) * 0.14
        if (tt < 0) p = { ...p, scale: 0 }
        else if (tt < 0.75) {
          const f = tt / 0.75
          const q = movePose(p.x, p.y + 2.4, p.x, p.y, 0.528 + f * 0.472, p.y + 2.4)
          p = { ...p, y: q.y, tilt: q.tilt * 0.5 }
        }
      }
      m.rendered[d] = p
      const pool = poolRefs.current[d]
      if (pool) {
        const k = dark * Math.exp(-(p.y - restY(0)) * 2.4) * p.scale
        // Always drawn (at zero opacity in daylight) so its shader is compiled
        // up front instead of stalling the frame the lights go out.
        pool.position.set(p.x, BASE_TOP + 0.006, 0)
        pool.scale.setScalar(OUTER_R[d] * 3.4)
        ;(pool.material as THREE.MeshBasicMaterial).opacity = k * 0.9
      }
      const tint = tintRefs.current[d]
      if (tint) {
        const h = Math.max(0, p.y - restY(0))
        const k = (1 - dark) * Math.exp(-h * 0.9) * p.scale
        const spread = 1 + h * 0.25
        tint.position.set(p.x + 0.08 + h * 0.05, BASE_TOP + 0.005, 0.2 + h * 0.12)
        tint.scale.setScalar(OUTER_R[d] * 2.25 * spread)
        ;(tint.material as THREE.MeshBasicMaterial).opacity = k * 0.42
      }
      const mesh = discRefs.current[d]
      if (mesh) {
        mesh.position.set(p.x, p.y, 0)
        mesh.rotation.set(0, 0, p.tilt)
        mesh.scale.setScalar(Math.max(p.scale, 0.0001))
        mesh.visible = p.scale > 0.003
      }
    }

    // ---- tell the DOM
    let changed = false
    const shown = play ? game.moves : movesShown(tm)
    const last = play ? (game.lastDisc >= 0 ? game.lastDisc : lastMovedDisc(MOVE_COUNT)) : lastMovedDisc(tm)
    if (shown !== m.shown || play !== m.play) {
      m.shown = shown
      store.shownMoves = movesShown(tm)
      changed = true
    }
    if (play !== m.play) {
      m.play = play
      store.playActive = play
      changed = true
    }
    const resetting = !play && r > 0
    if (resetting !== store.resetting) {
      store.resetting = resetting
      changed = true
    }
    if (last !== m.last) {
      m.last = last
      store.lastDisc = last
      if (store.root) store.root.style.setProperty("--accent", last >= 0 ? DISCS[last].hue : "#111318")
      changed = true
    }
    if (changed) store.emit()

    // ---- the caption sits under the base, wherever the tower is
    const ro = store.readout
    if (ro) {
      v3.set(0, 0, BASE_D / 2).project(camera)
      const rx = ((v3.x + 1) / 2) * w
      const ry = ((1 - v3.y) / 2) * h
      ro.style.transform = `translate3d(${rx.toFixed(1)}px, ${(ry + (store.mobile ? 10 : 26)).toFixed(1)}px, 0) translateX(-50%)`
    }

    // ---- peg buttons follow the pegs on screen
    const btns = store.pegButtons
    if (btns.length === 3 && (play || y > store.resetStart)) {
      camera.updateMatrixWorld()
      for (let p = 0; p < 3; p++) {
        const el = btns[p]
        if (!el) continue
        v3.set(PEG_X[p], PEG_TOP + 0.75, 0).project(camera)
        const top = ((1 - v3.y) / 2) * h
        const cx = ((v3.x + 1) / 2) * w
        v3.set(PEG_X[p], 0, BASE_D / 2).project(camera)
        const bottom = ((1 - v3.y) / 2) * h
        v3.set(PEG_X[p] + PEG_SPACING * 0.47, 0, BASE_D / 2).project(camera)
        const half = ((v3.x + 1) / 2) * w - cx
        el.style.transform = `translate3d(${(cx - half).toFixed(1)}px, ${top.toFixed(1)}px, 0)`
        el.style.width = `${(half * 2).toFixed(1)}px`
        el.style.height = `${(bottom - top).toFixed(1)}px`
      }
    }
  })

  return (
    <>
      <mesh ref={backdropRef} position={[0, 0, -ZW]} material={backdrop} renderOrder={-1}>
        <planeGeometry args={[400, 200]} />
      </mesh>

      <RoundedBox args={[BASE_W, BASE_H, BASE_D]} radius={0.045} smoothness={5} position={[0, BASE_H / 2, 0]} material={baseMat} />
      {PEG_X.map((x, i) => (
        <mesh key={i} position={[x, BASE_TOP + 0.003, BASE_D / 2 - 0.13]} rotation-x={-Math.PI / 2} material={letterMat[i]}>
          <planeGeometry args={[0.17, 0.17]} />
        </mesh>
      ))}
      {PEG_X.map((x, i) => (
        <mesh key={i} geometry={pegGeo} material={pegMat} position={[x, BASE_TOP, 0]} />
      ))}
      {DISCS.map((_, d) => (
        <mesh
          key={d}
          ref={(el) => {
            discRefs.current[d] = el
          }}
          geometry={discGeos[d]}
          material={discMats[d]}
        />
      ))}

      {DISCS.map((_, d) => (
        <mesh
          key={d}
          rotation-x={-Math.PI / 2}
          material={tintMats[d]}
          renderOrder={1}
          ref={(el) => {
            tintRefs.current[d] = el
          }}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      {DISCS.map((_, d) => (
        <mesh
          key={d}
          rotation-x={-Math.PI / 2}
          material={poolMats[d]}
          renderOrder={2}
          ref={(el) => {
            poolRefs.current[d] = el
          }}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}

      <ContactShadows
        position={[0, BASE_TOP + 0.004, 0]}
        scale={[BASE_W - 0.12, BASE_D - 0.12]}
        far={1.6}
        blur={2.6}
        opacity={0.26}
        resolution={512}
        color="#1d2130"
      />
      <ContactShadows position={[0, 0.002, 0]} scale={[BASE_W + 3.5, BASE_D + 3.2]} far={2.6} blur={2.2} opacity={0.55} resolution={512} color="#1b1e27" />

      <Environment resolution={512} frames={1}>
        <color attach="background" args={["#c3c8cf"]} />
        {/* Overhead softbox: the broad sheen across the disc tops. */}
        <Lightformer form="rect" intensity={2.6} scale={[16, 5]} position={[0, 10, 0]} rotation-x={Math.PI / 2} />
        {/* Long horizontal strips in front: a clean line along every rim. */}
        <Lightformer form="rect" intensity={6} scale={[24, 0.5]} position={[0, 3.2, 10]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={2.5} scale={[24, 0.35]} position={[0, -1.5, 9]} target={[0, 1, 0]} />
        {/* Tall strips behind and to the sides: bright silhouette edges. */}
        <Lightformer form="rect" intensity={7} scale={[1.2, 16]} position={[-10, 3, -3]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={7} scale={[1.2, 16]} position={[10, 3, -3]} target={[0, 1, 0]} />
        {/* Soft fill from the camera side. */}
        <Lightformer form="rect" intensity={1.2} scale={[20, 8]} position={[0, 2, 14]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#e4ecff" scale={[20, 3]} position={[0, 5, -12]} target={[0, 1, 0]} />
        {/* Thin bright bars behind and above: crisp lines across the disc tops
            and bevels, seen in reflection from the raised camera. */}
        <Lightformer form="rect" intensity={9} scale={[26, 0.35]} position={[0, 7, -9]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={6} scale={[26, 0.25]} position={[0, 4, -11]} target={[0, 0, 0]} />
      </Environment>
    </>
  )
}

export default function Scene({ game }: { game: Game }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, powerPreference: "high-performance" }}
      camera={{ fov: FOV, near: 1, far: 400, position: [0, 6, 28] }}
      aria-hidden="true"
      tabIndex={-1}
    >
      <Stage game={game} />
    </Canvas>
  )
}
