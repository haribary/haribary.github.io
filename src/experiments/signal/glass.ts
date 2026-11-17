import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FloatType,
  FramebufferTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Texture,
} from "three"

import { DISCS } from "../hanoi/solver"
import type { Companion, Place } from "./companion"
import { lerp, smooth } from "./math"
import { HALO_FRAG, HALO_VERT, PEG_FRAG, PEG_VERT, SHARD_FRAG, SHARD_VERT } from "./shaders"
import { buildShards, COVER, FORM, PHOTO, SWIRL_SHEET, SWIRL_VOICE, TOWER, type Form } from "./shards"
import { TOWER_FEED, towerPoses } from "./tower"

/**
 * What runs on time rather than on scroll, kept by the scene and laid over
 * the companion's pure pose: the fade-in after the opening, the slow idle
 * turn, the lean toward the pointer, the lag behind a fast scroll, the drift
 * of a sheet's loose rim.
 */
export type Life = {
  /** 0 not there yet .. 1. */
  appear: number
  /** The idle turn so far, in radians. */
  spin: number
  /** Seconds a sheet's loose tiles have been drifting. */
  clock: number
  /** The eased pointer, -1..1 on both axes. */
  leanX: number
  leanY: number
  /** How far a fast scroll has left it behind, in CSS px (down is positive). */
  drag: number
  reduced: boolean
}

type GlassFrame = { width: number; height: number; dpr: number }
/** The pictures the two sheets show: any lists of image URLs. */
export type Pictures = { photos: readonly string[]; covers: readonly string[] }

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

/** A hex colour as plain sRGB numbers, as everywhere in the scene's shaders. */
const hex = (h: string) =>
  new Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

/**
 * What a formation is like to the eye, per unit of its size: how far across
 * it is, how its glass behaves, and for its shadow how far below its centre
 * its foot is, how wide it stands and how far off the ground it floats.
 */
type Look = { extent: number; bend: number; split: number; far: number; foot: number; across: number; gap: number }
const LOOK: Record<Form, Look> = {
  [FORM.stone]: { extent: 1, bend: 0.17, split: 1, far: 4.2, foot: 0.5, across: 0.68, gap: 0.2 },
  [FORM.photo]: { extent: 1, bend: 0.06, split: 1, far: 4.2, foot: 0.5, across: 0.8, gap: 0.08 },
  [FORM.voice]: { extent: 0.62, bend: 0.03, split: 0.5, far: 3.4, foot: 0.2, across: 1, gap: 0.12 },
  [FORM.tower]: { extent: 0.7, bend: 0.034, split: 0.25, far: 5.9, foot: 0.17, across: 1, gap: 0.07 },
  [FORM.cover]: { extent: 1.3, bend: 0.06, split: 1, far: 6, foot: 0.5, across: 1.76, gap: 0.08 },
}

/**
 * The shards as objects in the scene: one mesh for all 96, a soft halo behind
 * them at night, and the hairlines of the tower's pegs. They are drawn after
 * everything else. Just before the shards themselves, the frame so far is
 * copied to a texture for the glass to look through and the depth buffer is
 * cleared, so the land can neither hide nor cut them. (Their shadow is the
 * world's to draw: see `centre`, which says where they stand.)
 */
export function createGlass(shared: Record<string, IUniform>, palette: Record<string, Vector3>) {
  const group = new Group()
  const disposables: { dispose: () => void }[] = []
  let alive = true
  let onChange = () => {}
  let onTexture: (texture: Texture) => void = () => {}

  // --- The shards ------------------------------------------------------------
  const data = buildShards(TOWER_FEED)
  const geo = new BufferGeometry()
  geo.setAttribute("position", new BufferAttribute(data.position, 3))
  geo.setAttribute("aBary", new BufferAttribute(data.bary, 3))
  geo.setAttribute("aEdges", new BufferAttribute(data.edges, 3))
  geo.setAttribute("aRand", new BufferAttribute(data.rand, 4))
  // Where every shard is in every formation: read by row and column, never filtered.
  const table = new DataTexture(data.table, data.tableWidth, data.tableHeight, RGBAFormat, FloatType)
  table.minFilter = table.magFilter = NearestFilter
  table.generateMipmaps = false
  table.needsUpdate = true

  const view = { value: new Vector3(0, 0, 0.001) }
  const discs = new Float32Array(16)
  const uniforms = {
    ...shared,
    uView: view,
    uTable: { value: table },
    uScene: { value: null as Texture | null },
    uPhotoA: { value: null as Texture | null },
    uPhotoB: { value: null as Texture | null },
    uCropA: { value: new Vector4(1, 1, 0, 0) },
    uCropB: { value: new Vector4(1, 1, 0, 0) },
    uForms: { value: new Vector2(0, 1) },
    uMix: { value: 0 },
    uPlaceA: { value: new Vector4(0, 0, 0, 100) },
    uRotA: { value: new Quaternion() },
    uPlaceB: { value: new Vector4(0, 0, 0, 100) },
    uRotB: { value: new Quaternion() },
    uPivot: { value: new Vector3() },
    uDisc: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
    uDiscTint: { value: DISCS.slice(0, TOWER.discs).map((d) => hex(d.hue)) },
    uFlip: { value: 0 },
    uDecay: { value: 0 },
    uLoose: { value: new Vector2(1, 0) },
    uMotion: { value: new Vector4() },
    uAppear: { value: 0 },
    uGlass: { value: new Vector3(24, 1, 1) },
    uPrism: { value: new Vector2() },
    uSheen: { value: new Vector4(0.8, 0.6, 0, 100) },
    uInk: { value: palette.ink },
    uGraphite: { value: palette.graphite },
    uHairline: { value: palette.hairline },
    uPaper: { value: palette.paper },
    uNight: { value: palette.night },
    uNightGold: { value: palette.nightGold },
    uNightBlue: { value: palette.nightBlue },
    uNightText: { value: palette.nightText },
  }
  const mat = new ShaderMaterial({
    vertexShader: SHARD_VERT,
    fragmentShader: SHARD_FRAG,
    uniforms,
    // Listed with the see-through things so it is drawn after all of them, but
    // it writes every pixel it covers and sorts its own shards by depth.
    transparent: true,
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
  })
  const shards = new Mesh(geo, mat)
  shards.renderOrder = 30
  shards.frustumCulled = false
  shards.visible = false
  let backdrop: FramebufferTexture | null = null
  shards.onBeforeRender = (renderer) => {
    if (!backdrop) return
    // The copy lands in whatever texture is bound on the active unit, and
    // three only makes unit 0 active when it has to rebind it. Make it so
    // here, or the frame would be copied into some other texture.
    renderer.state.activeTexture(renderer.getContext().TEXTURE0)
    renderer.copyFramebufferToTexture(backdrop)
    renderer.clearDepth()
  }
  disposables.push(geo, mat, table)

  // --- A halo by night ---------------------------------------------------------
  const haloGeo = new BufferGeometry()
  const corners = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]
  haloGeo.setAttribute("position", new BufferAttribute(new Float32Array(corners), 3))
  const haloMat = new ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: {
      ...shared,
      uHalo: { value: new Vector4(0, 0, 1, 0) },
      uColor: { value: new Vector3() },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
  const halo = new Mesh(haloGeo, haloMat)
  halo.renderOrder = 28
  halo.frustumCulled = false
  halo.visible = false
  disposables.push(haloGeo, haloMat)

  // --- The pegs and the base of the tower ------------------------------------
  const lines: [Vector3, Vector3][] = []
  const at = (x: number, y: number) => new Vector3(x, y - TOWER.mid, 0).multiplyScalar(TOWER.unit)
  for (const x of TOWER.pegX) lines.push([at(x, -0.03), at(x, TOWER.pegTop)])
  // The base is drawn from the middle outward, both ways.
  lines.push([at(0, -0.03), at(-TOWER.baseHalf, -0.03)], [at(0, -0.03), at(TOWER.baseHalf, -0.03)])
  const pegPos = new Float32Array(lines.length * 4 * 3)
  const pegFoot = new Float32Array(lines.length * 4 * 3)
  const pegSide = new Float32Array(lines.length * 4 * 2)
  const pegIndex: number[] = []
  lines.forEach(([foot, tip], i) => {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k
      tip.toArray(pegPos, v * 3)
      foot.toArray(pegFoot, v * 3)
      pegSide[v * 2] = k % 2 === 0 ? -1 : 1
      pegSide[v * 2 + 1] = k < 2 ? 0 : 1
    }
    const o = i * 4
    pegIndex.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
  })
  const pegGeo = new BufferGeometry()
  pegGeo.setAttribute("position", new BufferAttribute(pegPos, 3))
  pegGeo.setAttribute("aFoot", new BufferAttribute(pegFoot, 3))
  pegGeo.setAttribute("aSide", new BufferAttribute(pegSide, 2))
  pegGeo.setIndex(pegIndex)
  const pegMat = new ShaderMaterial({
    vertexShader: PEG_VERT,
    fragmentShader: PEG_FRAG,
    uniforms: {
      ...shared,
      uView: view,
      uPlace: { value: new Vector4() },
      uRot: { value: new Quaternion() },
      uGrow: { value: 0 },
      uWidth: { value: 1.2 },
      uOpacity: { value: 1 },
      uInk: { value: palette.ink },
      // Pale, not gold: in the prism chapter the colour belongs to the discs.
      uColor: { value: palette.nightText },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    // A ribbon's winding depends on which way its line runs across the screen.
    side: DoubleSide,
    forceSinglePass: true,
  })
  const pegs = new Mesh(pegGeo, pegMat)
  pegs.renderOrder = 29
  pegs.frustumCulled = false
  pegs.visible = false
  disposables.push(pegGeo, pegMat)

  group.add(halo, pegs, shards)

  // --- Pictures -----------------------------------------------------------------
  type Picture = { texture: Texture; crop: Vector4 }
  const pictures: Record<number, (Picture | null)[]> = { [FORM.photo]: [], [FORM.cover]: [] }

  /** Loads the pictures the two sheets show, in order. */
  const load = ({ photos, covers }: Pictures) => {
    alive = true
    const loader = new TextureLoader()
    const fetch = (form: Form, urls: readonly string[], sheet: { w: number; h: number }) => {
      const list: (Picture | null)[] = urls.map(() => null)
      pictures[form] = list
      urls.forEach((url, i) => {
        loader.load(url, (tex) => {
          if (!alive) {
            tex.dispose()
            return
          }
          tex.minFilter = LinearMipmapLinearFilter
          tex.magFilter = LinearFilter
          tex.anisotropy = 8
          const img = tex.image as { width: number; height: number }
          const a = img.width / img.height
          const p = sheet.w / sheet.h
          // Cover-fit the image into the sheet.
          const crop = a > p ? new Vector4(p / a, 1, (1 - p / a) / 2, 0) : new Vector4(1, a / p, 0, (1 - a / p) / 2)
          list[i] = { texture: tex, crop }
          disposables.push(tex)
          // Upload now, while nothing is moving, rather than when the sheet first forms.
          onTexture(tex)
          onChange()
        })
      })
    }
    fetch(FORM.photo, photos, PHOTO)
    fetch(FORM.cover, covers, COVER)
    onTexture(table)
  }

  // --- One frame ---------------------------------------------------------------
  const q = new Quaternion()
  const qA = new Quaternion()
  const qB = new Quaternion()
  const pivot = new Vector3()
  /**
   * Where the shards are on screen this frame (device px, y up) and how far
   * across; how far down their foot is, how wide they stand and how far off
   * the ground they float (all px); how much they are there, and how much of
   * them is the stone.
   */
  const centre = { x: 0, y: 0, extent: 100, foot: 50, across: 70, gap: 0, shown: 0, stone: 1 }
  const attitude = (out: Quaternion, p: Place, yaw: number, pitch: number) => {
    out.setFromAxisAngle(Y, p.yaw + yaw)
    out.premultiply(q.setFromAxisAngle(Z, p.roll))
    out.premultiply(q.setFromAxisAngle(X, p.pitch + pitch))
    return out
  }

  const update = (c: Companion, life: Life, f: GlassFrame) => {
    const on = life.appear > 0.001
    shards.visible = on
    centre.shown = on ? life.appear : 0
    if (!on) {
      halo.visible = pegs.visible = false
      return
    }
    if (!backdrop || backdrop.image.width !== f.width || backdrop.image.height !== f.height) {
      backdrop?.dispose()
      backdrop = new FramebufferTexture(f.width, f.height)
      backdrop.minFilter = backdrop.magFilter = LinearFilter
      uniforms.uScene.value = backdrop
      onTexture(backdrop)
    }

    const dpr = f.dpr
    const px = (x: number) => x * dpr
    const py = (y: number) => f.height - y * dpr
    const places: Record<Form, Place> = {
      [FORM.stone]: c.stone,
      [FORM.photo]: c.photo,
      [FORM.voice]: c.voice,
      [FORM.tower]: c.tower,
      [FORM.cover]: c.cover,
    }
    const { from, to, mix } = c
    const u = uniforms
    u.uForms.value.set(from, to)
    u.uMix.value = mix
    // With reduced motion a change of formation is a short straight morph,
    // and the glass thins out through the middle of it, so it reads as one
    // thing giving way to another rather than as pieces crossing.
    const ghost = life.reduced ? 1 - 0.7 * Math.sin(Math.PI * mix) ** 2 : 1
    u.uAppear.value = life.appear * ghost
    u.uFlip.value = 0
    u.uDecay.value = c.decay
    u.uLoose.value.set(1, life.clock)

    // Each formation in its place. The stone's own slow turn (about its long
    // axis) and its lean toward the pointer unwind as it starts to break up,
    // so the shards always leave from the same attitude. A sheet turns a
    // little toward the pointer too; the voice and the tower stay square to
    // the page, or a level line in them would stop being level.
    const set = (form: Form, place: Vector4, rot: Quaternion, quat: Quaternion, share: number) => {
      const p = places[form]
      const drag = form === FORM.stone ? life.drag : life.drag * 0.5
      place.set(px(p.x), py(p.y + drag), 0, px(p.size))
      if (form === FORM.stone) attitude(quat, p, (life.spin + 0.3 * life.leanX) * share, 0.22 * life.leanY * share)
      else if (form === FORM.photo || form === FORM.cover) attitude(quat, p, 0.07 * life.leanX, 0.05 * life.leanY)
      else attitude(quat, p, 0, 0)
      rot.copy(quat)
    }
    set(from, u.uPlaceA.value, u.uRotA.value, qA, 1 - smooth(0, 0.3, mix))
    set(to, u.uPlaceB.value, u.uRotB.value, qB, smooth(0.7, 1, mix))
    const sA = u.uPlaceA.value.w
    const sB = u.uPlaceB.value.w

    // The tower's discs, and the point its shards gather about: wherever the discs are.
    pivot.set(0, 0, 0)
    const towering = from === FORM.tower || to === FORM.tower
    if (towering) {
      towerPoses(c.moves, discs)
      for (let d = 0; d < 4; d++) {
        u.uDisc.value[d].set(discs[d * 4], discs[d * 4 + 1], discs[d * 4 + 2], 0)
        pivot.x += discs[d * 4] / 4
        pivot.y += discs[d * 4 + 1] / 4
      }
      pivot.applyQuaternion(from === FORM.tower ? qA : qB).multiplyScalar(from === FORM.tower ? sA : sB)
    }
    u.uPivot.value.copy(pivot)

    // Which two pictures the tiles of a sheet are turning between.
    const list = to === FORM.photo || to === FORM.cover ? pictures[to] : []
    if (list.length) {
      const k = Math.min(Math.max(0, list.length - 2), Math.floor(c.flip))
      const a = list[k] ?? null
      const b = list[Math.min(list.length - 1, k + 1)] ?? a
      u.uFlip.value = a && b ? c.flip - k : 0
      u.uPhotoA.value = a?.texture ?? null
      u.uPhotoB.value = b?.texture ?? null
      if (a) u.uCropA.value.copy(a.crop)
      if (b) u.uCropB.value.copy(b.crop)
    }

    // How it flies: an arc about the line of sight, a push outward, tumbling,
    // and a spread of departures. With reduced motion, a plain straight morph.
    const lookA = LOOK[from]
    const lookB = LOOK[to]
    const extentA = lookA.extent * sA
    const extentB = lookB.extent * sB
    if (life.reduced) u.uMotion.value.set(0, 0, 0, 0)
    else {
      const sheets = to === FORM.photo || to === FORM.cover
      const swirl = from !== FORM.stone ? (from === FORM.tower ? 0.9 : 0) : sheets ? SWIRL_SHEET : SWIRL_VOICE
      const stagger = from === FORM.voice ? 0.5 : 0.8
      u.uMotion.value.set(swirl, 0.2 * Math.max(extentA, 0.6 * extentB), 1, stagger)
    }

    // The perspective converges on the middle of whichever formation it is;
    // `centre` is where the shards themselves are (in the tower, wherever its
    // discs are stacked).
    const blend = smooth(0, 1, mix)
    const pivotA = from === FORM.tower ? 1 : 0
    const pivotB = to === FORM.tower ? 1 : 0
    centre.x = lerp(u.uPlaceA.value.x + pivot.x * pivotA, u.uPlaceB.value.x + pivot.x * pivotB, blend)
    centre.y = lerp(u.uPlaceA.value.y + pivot.y * pivotA, u.uPlaceB.value.y + pivot.y * pivotB, blend)
    centre.extent = lerp(extentA, extentB, blend)
    centre.foot = lerp(lookA.foot * sA, lookB.foot * sB, blend)
    centre.across = lerp(lookA.across * sA, lookB.across * sB, blend)
    centre.gap = lerp(lookA.gap * sA, lookB.gap * sB, blend)
    centre.stone = from === FORM.stone ? 1 - blend : 0
    view.value.set(
      lerp(u.uPlaceA.value.x, u.uPlaceB.value.x, blend),
      lerp(u.uPlaceA.value.y, u.uPlaceB.value.y, blend),
      1 / lerp(lookA.far * sA, lookB.far * sB, blend),
    )
    // How strongly a facet bends what is behind it, and how far it splits the
    // colours: not at all while the stone lies on the engraving, and only a
    // little in the tower, whose level tops would otherwise each show the
    // base line as a small rainbow.
    const splitA = from === FORM.stone ? c.lift : lookA.split
    u.uGlass.value.set(lerp(lookA.bend * sA, lookB.bend * sB, blend), dpr, lerp(splitA, lookB.split, blend))
    // The prism: how far in, and where its colours stand in their cycle,
    // which moves on as the page scrolls.
    u.uPrism.value.set(c.prism, 1.3 * c.u)
    // A band of light lies across a sheet and shifts with the page and the pointer.
    const tall = Math.max(sA, sB)
    u.uSheen.value.set(0.8, 0.6, tall * (0.3 * Math.sin(3.7 * c.u) + 0.4 * life.leanX - 0.12), 0.24 * tall)

    // At night a halo stands in for the shadow.
    const hm = haloMat.uniforms
    hm.uHalo.value.set(centre.x, centre.y, lerp(extentA, 0.9 * extentB, blend), 0.17 * life.appear)
    hm.uColor.value.copy(palette.nightGold).lerp(palette.nightText, 0.75 * c.prism)
    halo.visible = true

    const pegsAt = from === FORM.tower ? u.uPlaceA.value : u.uPlaceB.value
    pegs.visible = towering && c.pegs > 0.001
    if (pegs.visible) {
      const pm = pegMat.uniforms
      pm.uPlace.value.copy(pegsAt)
      pm.uRot.value.copy(from === FORM.tower ? qA : qB)
      pm.uGrow.value = c.pegs
      pm.uOpacity.value = 0.62 * smooth(0, 0.3, c.pegs)
      pm.uWidth.value = 1.2 * dpr
    }
  }

  const dispose = () => {
    alive = false
    backdrop?.dispose()
    backdrop = null
    uniforms.uScene.value = null
    for (const d of disposables) d.dispose()
  }

  return {
    group,
    update,
    load,
    dispose,
    centre,
    set onChange(fn: () => void) {
      onChange = fn
    },
    set onTexture(fn: (texture: Texture) => void) {
      onTexture = fn
    },
  }
}

export type Glass = ReturnType<typeof createGlass>
