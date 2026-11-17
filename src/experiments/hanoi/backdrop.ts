import * as THREE from "three"

/** The giant words, in page order. Index 0 is the opening. */
export const WORDS = ["Harrison Li", "About", "Research", "Projects", "Contact", "Your turn"] as const

export const FONT = '"Rubik Variable", system-ui, sans-serif'

export type WordTexture = { texture: THREE.Texture; aspect: number }

/**
 * Draw one word, white on transparent, into a canvas texture. The box is
 * centred on the middle of the cap height, so every word sits on the same
 * optical line regardless of ascenders or descenders.
 */
export function makeWordTexture(word: string, maxAnisotropy: number): WordTexture {
  const fs = 360
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const font = `820 ${fs}px ${FONT}`
  ctx.font = font
  ctx.letterSpacing = `${-0.045 * fs}px`
  const m = ctx.measureText(word)
  const pad = Math.round(fs * 0.06)
  const textW = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight)
  const half = fs * 0.64
  canvas.width = textW + pad * 2
  canvas.height = Math.ceil(half * 2)
  ctx.font = font
  ctx.letterSpacing = `${-0.045 * fs}px`
  ctx.fillStyle = "#fff"
  ctx.textBaseline = "alphabetic"
  // Cap height of Rubik is 0.7 em; put its middle on the canvas middle.
  const baseline = half + fs * 0.35
  ctx.fillText(word, pad + m.actualBoundingBoxLeft, baseline)
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = maxAnisotropy
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.needsUpdate = true
  return { texture, aspect: canvas.width / canvas.height }
}

const vertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  #include <common>
  #include <dithering_pars_fragment>
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform vec4 uRectA;
  uniform vec4 uRectB;
  uniform float uRollA;
  uniform float uRollB;
  uniform vec3 uBg;
  uniform vec3 uInk;
  uniform vec3 uSpot;   // x, y, radius in plane units
  uniform float uSpotGain;
  varying vec2 vP;

  float word(sampler2D t, vec4 r, float roll) {
    vec2 l = (vP - r.xy) / r.zw + 0.5;
    if (l.x < 0.0 || l.x > 1.0 || l.y < 0.0 || l.y > 1.0) return 0.0;
    vec2 uv = vec2(l.x, l.y - roll);
    if (uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(t, uv).a;
  }

  void main() {
    float a = max(word(uTexA, uRectA, uRollA), word(uTexB, uRectB, uRollB));
    // A soft pool of light behind the object, like a lit sweep in a studio.
    vec2 d = (vP - uSpot.xy) / uSpot.z;
    float pool = exp(-dot(d, d));
    vec3 bg = uBg * (1.0 + uSpotGain * pool);
    gl_FragColor = vec4(mix(bg, uInk, a), 1.0);
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }
`

export function makeBackdropMaterial() {
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  blank.needsUpdate = true
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    toneMapped: false,
    dithering: true,
    uniforms: {
      uTexA: { value: blank },
      uTexB: { value: blank },
      uRectA: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRectB: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRollA: { value: 0 },
      uRollB: { value: 2 },
      uBg: { value: new THREE.Color("#ECEDEF") },
      uInk: { value: new THREE.Color("#111318") },
      uSpot: { value: new THREE.Vector3(0, 0, 8) },
      uSpotGain: { value: 0.06 },
    },
  })
}
