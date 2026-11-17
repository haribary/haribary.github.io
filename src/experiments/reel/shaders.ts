/**
 * GLSL for Reel. The field mask is shared by the background and the name so
 * the name's letters change colour exactly where the new field passes under.
 */

const fieldMask = /* glsl */ `
  uniform vec2 uRes;
  uniform float uWipe;
  uniform float uTime;
  uniform float uWobble;

  // 1 inside the incoming field, 0 outside. Organic blob that grows from
  // below the bottom edge until it covers the screen.
  float fieldMask(vec2 frag) {
    vec2 p = (frag - vec2(0.5 * uRes.x, -0.32 * uRes.y)) / uRes.y;
    float a = atan(p.y, p.x);
    float t = uTime;
    float n = sin(a * 4.0 + t * 0.7) * 0.07
            + sin(a * 7.0 - t * 1.1 + 1.3) * 0.045
            + sin(a * 11.0 + t * 1.7 + 0.4) * 0.025 * (1.0 + 2.0 * uWobble);
    float far = length(vec2(0.5 * uRes.x / uRes.y, 1.32)) * 1.22;
    float r = uWipe * far;
    float d = length(p) - r * (1.0 + n);
    float aa = 1.5 / uRes.y;
    return 1.0 - smoothstep(-aa, aa, d);
  }
`

export const fieldVertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`

export const fieldFragment = /* glsl */ `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  ${fieldMask}
  void main() {
    float m = fieldMask(gl_FragCoord.xy);
    gl_FragColor = vec4(mix(uFrom, uTo, m), 1.0);
    #include <colorspace_fragment>
  }
`

export const nameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const nameFragment = /* glsl */ `
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform float uMix;
  uniform vec3 uInk;
  uniform vec3 uInkOnField;
  varying vec2 vUv;
  ${fieldMask}
  void main() {
    float a = mix(texture2D(uTexA, vUv).r, texture2D(uTexB, vUv).r, uMix);
    if (a < 0.002) discard;
    float m = fieldMask(gl_FragCoord.xy);
    gl_FragColor = vec4(mix(uInk, uInkOnField, m), a);
    #include <colorspace_fragment>
  }
`

export const cardVertex = /* glsl */ `
  uniform vec2 uSize;
  uniform float uBend;   // curvature along the helix, 1/world units
  uniform float uFlex;   // signed, from scroll velocity
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = vec3(position.x * uSize.x, position.y * uSize.y, 0.0);

    // Bend around the helix: wrap the card onto a cylinder of radius 1/uBend.
    if (abs(uBend) > 1e-4) {
      float th = p.x * uBend;
      p.z = (cos(th) - 1.0) / uBend;
      p.x = sin(th) / uBend;
    }

    // Flex with speed: the middle bows out and lags behind like paper in air.
    float across = sin(uv.x * 3.14159265);
    float bow = 1.0 - pow(uv.y * 2.0 - 1.0, 2.0);
    p.z += uFlex * uSize.y * 0.16 * bow * across;
    p.y += uFlex * uSize.y * 0.07 * across;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const cardFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSplit;
  uniform vec3 uBack;
  uniform float uReady;
  uniform float uFade;
  varying vec2 vUv;

  void main() {
    if (!gl_FrontFacing) {
      // The back of a print: the photograph mirrored, sunk into the field.
      vec3 bc = texture2D(uMap, vec2(1.0 - vUv.x, vUv.y)).rgb;
      gl_FragColor = vec4(mix(uBack, bc, 0.28 * uReady), 1.0);
      #include <colorspace_fragment>
      return;
    }
    vec2 off = vec2(0.0, uSplit);
    vec3 c;
    if (abs(uSplit) > 1e-5) {
      c.r = texture2D(uMap, clamp(vUv + off, 0.0, 1.0)).r;
      c.g = texture2D(uMap, vUv).g;
      c.b = texture2D(uMap, clamp(vUv - off, 0.0, 1.0)).b;
    } else {
      c = texture2D(uMap, vUv).rgb;
    }
    c = mix(uBack, c, uReady * (1.0 - uFade));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`
