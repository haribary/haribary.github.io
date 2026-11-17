import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three"

import type { Companion } from "./companion"
import { createGlass, type Life, type Pictures } from "./glass"
import { lerp, smoother } from "./math"
import {
  BACK_FRAG,
  BACK_VERT,
  GLOW_FRAG,
  LINE_FRAG,
  LINE_VERT,
  OCCLUDER_FRAG,
  OCCLUDER_VERT,
  SHADOW_FRAG,
  SHADOW_VERT,
  SPOTS_FRAG,
  SPOTS_VERT,
} from "./shaders"
import { BLOOM_SEED, NIGHT_SEED, type Shot } from "./story"
import { DX, LENGTH, type Terrain } from "./terrain"

/** The palette, and nothing else (Research adds the Hanoi discs' colours: see shaders.ts). */
export const PALETTE = {
  paper: "#F2F4F6",
  /** The sheet in Research: the same white, a little warmer. */
  warm: "#FBF7EA",
  ink: "#14171C",
  graphite: "#5A6472",
  hairline: "#C8CED6",
  blue: "#1F47E6",
  gold: "#F2A900",
  night: "#06142E",
  nightGold: "#FFC83D",
  nightText: "#EEF2F8",
  nightBlue: "#7FA2FF",
} as const

const rgb = (hex: string) =>
  new Vector3(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  )

/** The shards' shadow: how dark at its darkest, and how flat an oval on the ground looks in flight. */
const SHADE = 0.36
const FLAT = 0.24
/** How far the prismatic gem's kaleidoscope reaches over the sheet, as a fraction of the viewport height. */
const FAN_REACH = 0.6

export type Frame = {
  /** Drawing buffer size in device px, and the device pixel ratio in use. */
  width: number
  height: number
  dpr: number
  /** True when the text sits under the picture instead of beside it. */
  stacked: boolean
  /** Right edge of the text column, as a fraction of the width. */
  columnEdge: number
  /** 0..1: how much of the figure the opening has plotted so far. */
  drawn: number
}

/**
 * Everything in the scene, built once from the terrain. `update` applies one
 * evaluated shot; it is the only thing that changes after construction.
 */
export function createWorld(terrain: Terrain, pictures: Pictures) {
  const group = new Group()
  const disposables: { dispose: () => void }[] = []

  // The spots a scheme arrives in, drawn at half size while it does (see `prepare`).
  const spotsTarget = new WebGLRenderTarget(4, 4, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  })

  const shared = {
    uRes: { value: new Vector2(1, 1) },
    uDpr: { value: 1 },
    uRise: { value: 0 },
    uNightfall: { value: new Vector2(0, NIGHT_SEED) },
    uBloom: { value: new Vector2(0, BLOOM_SEED) },
    uSpots: { value: spotsTarget.texture },
    uQuietX: { value: new Vector3() },
    uQuietY: { value: new Vector3() },
    uFog: { value: new Vector2(100, 400) },
    uGround: { value: 0 },
    uDraw: { value: new Vector2(1, LENGTH) },
    uFan: { value: new Vector4(0, 0, 1, 0) },
    uFanTurn: { value: 0 },
  }
  const fill = { value: 1 }

  // On a layer of its own, so the page's camera never draws it; part of the
  // group all the same, so its shader is compiled up front with the rest.
  const spotsMat = new ShaderMaterial({
    vertexShader: SPOTS_VERT,
    fragmentShader: SPOTS_FRAG,
    uniforms: { uRes: shared.uRes, uNightfall: shared.uNightfall, uBloom: shared.uBloom },
    depthTest: false,
    depthWrite: false,
  })
  const spotsGeo = new PlaneGeometry(2, 2)
  const spots = new Mesh(spotsGeo, spotsMat)
  spots.frustumCulled = false
  spots.layers.set(2)
  group.add(spots)
  const spotsCamera = new Camera()
  spotsCamera.layers.set(2)
  /** What the target was last drawn for: how far each scheme had come, and its size. */
  const spotsFor = { night: -1, bloom: -1, width: 0, height: 0 }
  disposables.push(spotsTarget, spotsMat, spotsGeo)

  type LineLook = {
    dayLo: string
    dayHi: string
    nightLo: string
    nightHi: string
    /** Opacity of flat-ground lines by day and by night. */
    alphaLo: [number, number]
    width: number
    fill?: { value: number }
  }
  const lineUniforms = (o: LineLook) => ({
    ...shared,
    uFill: o.fill ?? { value: 0 },
    uDX: { value: DX },
    uMinGap: { value: 2 },
    uWidth: { value: o.width },
    uPad: { value: 0 },
    uBias: { value: 0.5 },
    uNightFigure: { value: 0.6 },
    uOpacity: { value: 1 },
    uDayLo: { value: rgb(o.dayLo) },
    uDayHi: { value: rgb(o.dayHi) },
    uDayFigure: { value: rgb(PALETTE.ink).lerp(rgb(PALETTE.graphite), 0.35) },
    uNightLo: { value: rgb(o.nightLo) },
    uNightHi: { value: rgb(o.nightHi) },
    uAlphaLo: { value: new Vector2(...o.alphaLo) },
  })
  const lineMaterial = (o: LineLook) => {
    const m = new ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: lineUniforms(o),
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      // A ribbon's winding depends on which way its line runs across the screen.
      side: DoubleSide,
    })
    disposables.push(m)
    return m
  }
  /** The same lines again, wider and additive: the glow, drawn only at night. */
  const glowMaterial = (o: LineLook, radius: number, strength: number, flat: number) => {
    const uniforms = lineUniforms(o)
    uniforms.uPad.value = radius * 2.3
    uniforms.uBias.value = 0.6
    const m = new ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { ...uniforms, uGlow: { value: new Vector3(radius, strength, flat) } },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: DoubleSide,
    })
    disposables.push(m)
    return m
  }

  // --- The sheet -------------------------------------------------------------
  const backGeo = new BufferGeometry()
  backGeo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const backMat = new ShaderMaterial({
    vertexShader: BACK_VERT,
    fragmentShader: BACK_FRAG,
    uniforms: {
      ...shared,
      uPaper: { value: rgb(PALETTE.paper) },
      uWarm: { value: rgb(PALETTE.warm) },
      uNightGround: { value: rgb(PALETTE.night) },
    },
    depthTest: false,
    depthWrite: false,
  })
  const back = new Mesh(backGeo, backMat)
  back.renderOrder = -10
  back.frustumCulled = false
  group.add(back)
  disposables.push(backGeo, backMat)

  // --- The land: a depth-only surface, then the lines on top of it -----------
  const occluderMat = new ShaderMaterial({
    vertexShader: OCCLUDER_VERT,
    fragmentShader: OCCLUDER_FRAG,
    uniforms: { uRise: shared.uRise },
    colorWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
  const occluder = new Mesh(terrain.occluder, occluderMat)
  occluder.renderOrder = -5
  occluder.frustumCulled = false
  group.add(occluder)
  disposables.push(occluderMat)

  const landLook: LineLook = {
    dayLo: PALETTE.graphite,
    dayHi: PALETTE.ink,
    nightLo: PALETTE.nightGold,
    nightHi: PALETTE.nightGold,
    alphaLo: [0.85, 0.42],
    width: 1.15,
    fill,
  }
  const land = new Mesh(terrain.lines, lineMaterial(landLook))
  land.renderOrder = 2
  land.frustumCulled = false
  group.add(land)
  const GLOW = 0.34
  const landGlowMat = glowMaterial(landLook, 2.4, GLOW, 0.12)
  const landGlow = new Mesh(terrain.lines, landGlowMat)
  landGlow.renderOrder = 3
  landGlow.frustumCulled = false
  group.add(landGlow)

  const ropeLook: LineLook = {
    dayLo: PALETTE.blue,
    dayHi: PALETTE.blue,
    nightLo: PALETTE.nightBlue,
    nightHi: PALETTE.nightBlue,
    alphaLo: [1, 1],
    width: 1.5,
  }
  const rope = new Mesh(terrain.rope, lineMaterial(ropeLook))
  rope.renderOrder = 4
  rope.frustumCulled = false
  group.add(rope)
  const ropeGlow = new Mesh(terrain.rope, glowMaterial(ropeLook, 2.4, 0.3, 1))
  ropeGlow.renderOrder = 4
  ropeGlow.frustumCulled = false
  group.add(ropeGlow)

  // --- The shards --------------------------------------------------------------
  // Added last and drawn last: the glass looks through everything above.
  const glass = createGlass(shared, {
    ink: rgb(PALETTE.ink),
    graphite: rgb(PALETTE.graphite),
    hairline: rgb(PALETTE.hairline),
    paper: rgb(PALETTE.paper),
    night: rgb(PALETTE.night),
    nightGold: rgb(PALETTE.nightGold),
    nightBlue: rgb(PALETTE.nightBlue),
    nightText: rgb(PALETTE.nightText),
  })
  group.add(glass.group)

  // --- Their shadow -------------------------------------------------------------
  // One soft oval on the ground under them, drawn on the sheet before the
  // land's lines, so the lines stay crisp over it.
  const shadowMat = new ShaderMaterial({
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: {
      ...shared,
      uShadow: { value: new Vector4(0, 0, 1, 1) },
      uShade: { value: 0 },
      uInk: { value: rgb(PALETTE.ink) },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
  const shadow = new Mesh(spotsGeo, shadowMat)
  shadow.frustumCulled = false
  shadow.renderOrder = -9
  shadow.visible = false
  group.add(shadow)
  disposables.push(shadowMat)

  /** Loads the pictures the shards show. Safe to call again after `dispose`. */
  const load = () => glass.load(pictures)

  const update = (shot: Shot, f: Frame, companion: Companion, life: Life) => {
    glass.update(companion, life, f)
    shared.uDraw.value.x = f.drawn
    shared.uRes.value.set(f.width, f.height)
    shared.uDpr.value = f.dpr
    shared.uRise.value = shot.rise
    shared.uNightfall.value.x = shot.night
    shared.uBloom.value.x = shot.bloom
    shared.uFog.value.set(shot.fogNear, shot.fogFar)
    // The glow pass only exists once there is night on screen.
    landGlow.visible = ropeGlow.visible = shot.night > 0
    landGlowMat.uniforms.uGlow.value.y = GLOW * (1 - 0.6 * shot.fill)
    if (f.stacked) {
      shared.uQuietX.value.set(0, 1, 0)
      shared.uQuietY.value.set(0.33, 0.46, 0.88 * shot.quiet)
    } else {
      shared.uQuietX.value.set(f.columnEdge - 0.04, f.columnEdge + 0.12, 0.84 * shot.quiet)
      shared.uQuietY.value.set(0, 1, 0)
    }
    fill.value = shot.fill
    shared.uGround.value = shot.ground

    // In Research the gem throws a kaleidoscope on the sheet around it (the
    // stone most of all; the voice and the tower, a little less).
    const at = glass.centre
    const thrown = shot.bloom > 0 && shot.night < 1 ? lerp(0.8, 1, at.stone) * companion.prism * at.shown : 0
    shared.uFan.value.set(at.x, at.y, FAN_REACH * f.height, thrown)
    shared.uFanTurn.value = 0.45 * companion.u + life.spin / (Math.PI * 2)

    // Their shadow, by day and in the kaleidoscope. Seen from above they lie
    // on the sheet and it is their own shape, slipped out from under them
    // toward the lower right; in flight they float, and it is a flat oval on
    // the ground below their foot. The higher they float and the wider they
    // stand, the larger and fainter it is.
    shadow.visible = at.shown > 0 && shot.night < 1
    if (shadow.visible) {
      const lying = shot.fill
      const gap = at.gap * smoother(0, 1, companion.lift)
      const height = gap / Math.max(1, at.across)
      const rx = 0.56 * at.across * (1 + 1.2 * height)
      const ry = lerp(rx * FLAT, 1.1 * at.foot, lying)
      const su = shadowMat.uniforms
      su.uShadow.value.set(
        at.x + 0.14 * at.across * lying,
        at.y - lerp(at.foot + gap + 0.4 * ry, 0.16 * at.foot, lying),
        rx,
        ry,
      )
      su.uShade.value = (SHADE * at.shown) / ((1 + 2.2 * height) * (1 + (0.3 * at.across) / f.height))
    }
  }

  /**
   * What has to be drawn before the frame itself: the spots, while a scheme
   * is arriving.
   */
  const prepare = (renderer: WebGLRenderer) => {
    const night = shared.uNightfall.value.x
    const bloom = shared.uBloom.value.x
    // (The very first frame draws them whatever the story time, so that the
    // shader is ready long before it is needed.)
    if ((night > 0 && night < 1) || (bloom > 0 && bloom < 1) || spotsFor.width === 0) {
      const width = Math.max(4, shared.uRes.value.x >> 1)
      const height = Math.max(4, shared.uRes.value.y >> 1)
      const resized = spotsFor.width !== width || spotsFor.height !== height
      if (resized || spotsFor.night !== night || spotsFor.bloom !== bloom) {
        if (resized) spotsTarget.setSize(width, height)
        spotsFor.night = night
        spotsFor.bloom = bloom
        spotsFor.width = width
        spotsFor.height = height
        const target = renderer.getRenderTarget()
        renderer.setRenderTarget(spotsTarget)
        renderer.render(spots, spotsCamera)
        renderer.setRenderTarget(target)
      }
    }
  }

  /** Everything that is ever drawn, so the renderer can compile it up front. */
  const everything = () => {
    const hidden: { visible: boolean }[] = []
    group.traverse((o) => {
      if (!o.visible) {
        hidden.push(o)
        o.visible = true
      }
    })
    return () => {
      for (const o of hidden) o.visible = false
    }
  }

  const dispose = () => {
    glass.dispose()
    for (const d of disposables) d.dispose()
  }

  return {
    group,
    update,
    prepare,
    load,
    everything,
    dispose,
    set onChange(fn: () => void) {
      glass.onChange = fn
    },
    set onTexture(fn: (texture: Texture) => void) {
      glass.onTexture = fn
    },
  }
}

export type World = ReturnType<typeof createWorld>
