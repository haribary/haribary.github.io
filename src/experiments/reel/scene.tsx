import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

import { photos } from "@/lab/content"
import {
  CARD_COUNT,
  PALETTE,
  clamp,
  lerp,
  motion,
  restWidth,
  smoothstep,
  spiralState,
  breathingWidth,
} from "./motion"
import { layoutName, renderName, WIDTH_STEPS } from "./name-texture"
import {
  cardFragment,
  cardVertex,
  fieldFragment,
  fieldVertex,
  nameFragment,
  nameVertex,
} from "./shaders"
import { photoSrc } from "./assets"

/** World units: the visible height at z = 0 is always 10. */
const FOV = 30
const VIEW_H = 10
const DIST = VIEW_H / 2 / Math.tan((FOV / 2) * (Math.PI / 180))

const color = (hex: string) => new THREE.Color(hex)

export type AdvanceRef = MutableRefObject<((now: number) => void) | null>

export function ReelScene({ advanceRef }: { advanceRef: AdvanceRef }) {
  return (
    <Canvas
      frameloop="never"
      flat
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: FOV, near: 0.5, far: 80, position: [0, 0, DIST] }}
    >
      <Rig advanceRef={advanceRef} />
    </Canvas>
  )
}

function Rig({ advanceRef }: { advanceRef: AdvanceRef }) {
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    advanceRef.current = (now) => advance(now)
    return () => {
      advanceRef.current = null
    }
  }, [advance, advanceRef])

  return (
    <>
      <Field />
      <Name />
      <Cards />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shared uniforms for the field mask (background and name both read it). */

const maskUniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uWipe: { value: 0 },
  uTime: { value: 0 },
  uWobble: { value: 0 },
}

function Field() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: fieldVertex,
        fragmentShader: fieldFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...maskUniforms,
          uFrom: { value: color(PALETTE.butter) },
          uTo: { value: color(PALETTE.forest) },
        },
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const { intro } = spiralState(motion.scroll, motion.vh, motion.spiralTop, motion.spiralHeight)
    state.gl.getDrawingBufferSize(maskUniforms.uRes.value)
    // The cut to forest starts as soon as the page moves and is complete just
    // as the first photograph arrives at the front.
    maskUniforms.uWipe.value = smoothstep(0.04, 0.92, intro)
    maskUniforms.uTime.value = motion.time
    maskUniforms.uWobble.value = motion.speed
  })

  return (
    <mesh frustumCulled={false} renderOrder={-10} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */

function Name() {
  const size = useThree((s) => s.size)
  const viewport = useThree((s) => s.viewport)
  const texturesRef = useRef<(THREE.DataTexture | null)[]>([])
  const meshRef = useRef<THREE.Mesh>(null)
  const empty = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat)
    t.needsUpdate = true
    return t
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: nameVertex,
        fragmentShader: nameFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          ...maskUniforms,
          uTexA: { value: empty },
          uTexB: { value: empty },
          uMix: { value: 0 },
          uInk: { value: color(PALETTE.forest) },
          uInkOnField: { value: color(PALETTE.butter) },
        },
      }),
    [empty],
  )
  useEffect(() => () => material.dispose(), [material])

  // Rasterise the name for the current viewport: rest width first, the
  // breathing widths a frame at a time afterwards.
  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const made: THREE.DataTexture[] = []
    const start = window.setTimeout(async () => {
      const layout = await layoutName(size.width, size.height, window.devicePixelRatio || 1)
      motion.nameBottom = layout.bottom / layout.vh
      const next: (THREE.DataTexture | null)[] = WIDTH_STEPS.map(() => null)
      for (let i = 0; i < WIDTH_STEPS.length; i++) {
        if (cancelled) return
        const tex = await renderName(layout, WIDTH_STEPS[i])
        if (cancelled) {
          tex.dispose()
          return
        }
        made.push(tex)
        next[i] = tex
        if (i === 0) {
          const old = texturesRef.current
          texturesRef.current = next
          old.forEach((t) => t?.dispose())
        }
        await new Promise<void>((r) => timers.push(window.setTimeout(r, 40)))
      }
    }, 60)
    return () => {
      cancelled = true
      window.clearTimeout(start)
      timers.forEach((t) => window.clearTimeout(t))
      // Textures in use are disposed when replaced or on unmount.
      if (texturesRef.current.every((t) => !made.includes(t as THREE.DataTexture))) {
        made.forEach((t) => t.dispose())
      }
    }
  }, [size.width, size.height])

  useEffect(
    () => () => {
      texturesRef.current.forEach((t) => t?.dispose())
      texturesRef.current = []
      empty.dispose()
    },
    [empty],
  )

  useFrame(() => {
    const textures = texturesRef.current
    const mesh = meshRef.current
    if (!mesh) return
    if (!textures[0]) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    // Pick the two nearest rasterised widths and crossfade.
    const w = breathingWidth(motion.speed)
    let i = 0
    while (i < WIDTH_STEPS.length - 2 && w > WIDTH_STEPS[i + 1]) i++
    let t = clamp((w - WIDTH_STEPS[i]) / (WIDTH_STEPS[i + 1] - WIDTH_STEPS[i]))
    let a = textures[i]
    let b = textures[i + 1]
    if (!a || !b) {
      a = textures[0]
      b = textures[0]
      t = 0
    }
    if (w <= restWidth + 0.05) {
      b = a
      t = 0
    }
    material.uniforms.uTexA.value = a
    material.uniforms.uTexB.value = b
    // Snap to the nearest rasterised width: the steps are close enough that
    // switching reads as continuous, and a blend would show a double edge.
    material.uniforms.uMix.value = t < 0.5 ? 0 : 1
  })

  // Plane exactly covers the view at z = 0 when the camera is at the top.
  const w = (viewport.width / viewport.height) * VIEW_H
  return (
    <mesh ref={meshRef} material={material} renderOrder={5} position={[0, 0, 0]}>
      <planeGeometry args={[w, VIEW_H]} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */

type CardRuntime = {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  aspect: number
}

function Cards() {
  const viewport = useThree((s) => s.viewport)
  const gl = useThree((s) => s.gl)
  const groupRef = useRef<THREE.Group>(null)
  const cards = useRef<CardRuntime[]>([])
  const spin = useRef(0)

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1, 48, 32), [])
  const materials = useMemo(
    () =>
      photos.map(
        () =>
          new THREE.ShaderMaterial({
            vertexShader: cardVertex,
            fragmentShader: cardFragment,
            side: THREE.DoubleSide,
            uniforms: {
              uMap: { value: null },
              uSize: { value: new THREE.Vector2(1, 1) },
              uBend: { value: 0 },
              uFlex: { value: 0 },
              uSplit: { value: 0 },
              uReady: { value: 0 },
              uFade: { value: 0 },
              uBack: { value: color(PALETTE.forest) },
            },
          }),
      ),
    [],
  )

  // Load the photographs without suspending, so the field and name show at once.
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const loaded: THREE.Texture[] = []
    let cancelled = false
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
    photos.forEach((p, i) => {
      loader.load(photoSrc(p.src), (tex) => {
        if (cancelled) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = aniso
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.generateMipmaps = true
        loaded.push(tex)
        const img = tex.image as HTMLImageElement
        const m = materials[i]
        m.uniforms.uMap.value = tex
        if (cards.current[i]) cards.current[i].aspect = img.width / img.height
        // Upload now rather than mid-scroll.
        gl.initTexture(tex)
        m.uniforms.uReady.value = 1
      })
    })
    return () => {
      cancelled = true
      loaded.forEach((t) => t.dispose())
    }
  }, [gl, materials])

  useEffect(
    () => () => {
      geometry.dispose()
      materials.forEach((m) => m.dispose())
    },
    [geometry, materials],
  )

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    const { intro, slot, exit } = spiralState(
      motion.scroll,
      motion.vh,
      motion.spiralTop,
      motion.spiralHeight,
    )
    const aspect = viewport.width / viewport.height
    const W0 = VIEW_H * aspect // visible width at z = 0
    const portrait = aspect < 0.85
    const k = smoothstep(0.02, 0.98, intro)
    const vel = motion.vel
    const speed = motion.speed

    // The opening orbit runs on time and fades out as the spiral takes over.
    spin.current += Math.min(delta, 0.05) * 0.16 * (1 - k)
    if (spin.current > Math.PI) spin.current -= Math.PI * 2
    const spinOffset = spin.current * (1 - k)

    // Helix geometry, opening pose -> travel pose.
    const R = lerp(portrait ? W0 * 0.36 : Math.min(W0 * 0.36, 6.4), portrait ? 2.2 : 5.2, k)
    const step = lerp(Math.PI * 2 * 0.37, (Math.PI * 2) / 5, k) * (1 + 0.32 * vel)
    const pitch = portrait ? 3.1 : 3.4
    const zFront = R
    const frontScale = (DIST - zFront) / DIST // view height at the front card, in units of VIEW_H
    const unitPerVh = VIEW_H * frontScale

    // Camera: in the opening it moves exactly with the page, so the name
    // scrolls like type; down the spiral it descends one pitch per card; after
    // the last card it again matches the page so the helix leaves upward.
    const camOpen = -intro * (motion.spiralTop / motion.vh) * VIEW_H
    const camY = camOpen - slot * pitch - exit * unitPerVh
    state.camera.position.set(0, camY, DIST)
    state.camera.lookAt(0, camY, 0)

    const topY = camOpen // card 0 sits at the camera height when the spiral starts

    // Free band below the name on narrow screens (world units at z = 0).
    const bandTop = VIEW_H / 2 - VIEW_H * (motion.nameBottom + 0.03)
    const bandBottom = VIEW_H / 2 - VIEW_H * 0.8
    const bandY = (bandTop + bandBottom) / 2
    const nearScale = DIST / (DIST - R)
    const hOpenPortrait = clamp(((bandTop - bandBottom) * 0.82) / nearScale, 0.8, 1.5)

    // Card height at the front, fitted to the screen.
    const visWFront = VIEW_H * frontScale * aspect
    const visHFront = VIEW_H * frontScale

    for (let i = 0; i < CARD_COUNT; i++) {
      const card = cards.current[i]
      if (!card) continue
      const { mesh, material } = card
      const ar = card.aspect

      // Opening pose: a loose orbit around the name.
      // On narrow screens two cards circle in the band between the name and
      // the role line, so the whole name reads at rest; the rest wait below.
      let aOpen = Math.PI / 2 + i * Math.PI * 2 * 0.37 + spinOffset + 0.5
      let yOpen = 2.7 - i * 1.9 - (i >= 4 ? 3 : 0)
      if (portrait) {
        aOpen = Math.PI / 2 + i * Math.PI + spinOffset * 1.6 + 0.9
        yOpen = i < 2 ? bandY - 0.18 * i : bandY - 4.2 - (i - 2) * 1.6
      }
      // Travel pose.
      const rel = i - slot
      const aTravel = Math.PI / 2 + rel * step
      const yTravel = topY - i * pitch

      const angle = lerp(aOpen, aTravel, k)
      const y = lerp(yOpen, yTravel, k)
      const radius = R * (1 + 0.06 * speed)

      mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)

      // Face outward, partly turned toward the camera.
      let yaw = Math.PI / 2 - angle
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
      mesh.rotation.set(0, yaw * lerp(0.24, 0.78, k), 0)

      // Size: smaller while orbiting, screen-filling at the front.
      const hOpen = portrait ? hOpenPortrait : 2.8
      let hTravel = Math.min(visHFront * 0.6, (visWFront * (portrait ? 0.84 : 0.56)) / ar)
      if (!portrait) hTravel = Math.min(hTravel, visHFront * 0.62)
      // Narrow screens: neighbours shrink and sink into the field so the
      // front photograph has the screen to itself.
      const side = portrait ? clamp(Math.abs(rel)) * k : 0
      const h = lerp(hOpen, hTravel, k) * (1 - 0.34 * side)
      material.uniforms.uFade.value = 0.42 * side
      material.uniforms.uSize.value.set(h * ar, h)

      // Bend: cards away from the front wrap around the helix; the front card
      // at rest is perfectly flat.
      const away = clamp(Math.abs(rel) * k)
      const bend = (away * 0.85 + speed * 0.9) / Math.max(1.5, radius)
      material.uniforms.uBend.value = motion.reduced ? 0 : bend
      material.uniforms.uFlex.value = motion.reduced ? 0 : vel
      material.uniforms.uSplit.value = motion.reduced ? 0 : vel * 0.009
    }

    group.visible = true
  })

  return (
    <group ref={groupRef}>
      {materials.map((m, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={m}
          frustumCulled={false}
          ref={(mesh) => {
            if (mesh) {
              const prev = cards.current[i]
              cards.current[i] = { mesh, material: m, aspect: prev?.aspect ?? 1.33 }
              const map = m.uniforms.uMap.value as THREE.Texture | null
              if (map?.image) {
                const img = map.image as HTMLImageElement
                cards.current[i].aspect = img.width / img.height
              }
            }
          }}
        />
      ))}
    </group>
  )
}
