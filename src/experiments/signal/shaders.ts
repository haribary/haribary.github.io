import { DISCS } from "../hanoi/solver"
import { COVER, PHOTO, VOICE } from "./shards"
import { SPOTS_GLSL } from "./spots"

/**
 * GLSL for the scene. Colours are passed and blended as plain sRGB values and
 * written straight to the canvas, so every hex in the palette lands exactly.
 */

/**
 * Shared by every fragment shader: which of the page's three schemes a place
 * on screen is in, and where the drawing gives way to the text. Day gives way
 * to the kaleidoscope (Research), and that to night, and each arrives as
 * spots (spots.ts). The pattern is too dear to work out again for every
 * fragment of every line, so while one is arriving it is drawn once a frame
 * into a small target (SPOTS_FRAG) and read from there.
 */
const SCREEN = /* glsl */ `
  uniform vec2 uRes;
  uniform vec2 uNightfall; // x: how far night has come (0..1), y: which pattern of spots
  uniform vec2 uBloom;     // the same for the kaleidoscope
  uniform sampler2D uSpots; // r: night, g: the kaleidoscope
  uniform vec3 uQuietX;  // from, to (fractions of the width), strength
  uniform vec3 uQuietY;  // from, to (fractions of the height, from the top), strength
  float nightAt(vec2 uv) {
    if (uNightfall.x <= 0.0) return 0.0;
    if (uNightfall.x >= 1.0) return 1.0;
    return texture2D(uSpots, uv).r;
  }
  float bloomAt(vec2 uv) {
    if (uBloom.x <= 0.0) return 0.0;
    if (uBloom.x >= 1.0) return 1.0;
    return texture2D(uSpots, uv).g;
  }
  float quietAt(vec2 uv) {
    float qx = 1.0 - uQuietX.z * (1.0 - smoothstep(uQuietX.x, uQuietX.y, uv.x));
    float qy = 1.0 - uQuietY.z * smoothstep(uQuietY.x, uQuietY.y, 1.0 - uv.y);
    return qx * qy;
  }
`

/** Both sets of spots over the whole screen, for the target the others read. */
export const SPOTS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export const SPOTS_FRAG = /* glsl */ `
  uniform vec2 uRes;
  uniform vec2 uNightfall;
  uniform vec2 uBloom;
  varying vec2 vUv;
  ${SPOTS_GLSL}
  void main() {
    float aspect = uRes.x / uRes.y;
    gl_FragColor = vec4(
      spotsAt(vUv, aspect, uNightfall.x, uNightfall.y),
      spotsAt(vUv, aspect, uBloom.x, uBloom.y),
      0.0,
      1.0
    );
  }
`

const vec3 = (hex: string) =>
  `vec3(${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(", ")})`

/**
 * The spectrum of the Research chapter: the five colours of the Hanoi discs,
 * run together into a wheel. Everything prismatic takes its colour from here.
 */
const SPECTRUM = /* glsl */ `
  const vec3 PRISM[5] = vec3[5](${DISCS.map((d) => vec3(d.hue)).join(", ")});
  vec3 spectrum(float h) {
    float x = fract(h) * 5.0;
    int i = int(x);
    float f = fract(x);
    return mix(PRISM[i], PRISM[i == 4 ? 0 : i + 1], f * f * (3.0 - 2.0 * f));
  }
`

/**
 * The kaleidoscope the prismatic gem throws on the sheet around it. The plane
 * round the gem's place on screen is folded into twelve mirrored wedges, and
 * the one wedge they all show is cut into facets, each a colour of the
 * spectrum: light through a cut crystal, fallen on white paper. It is
 * strongest by the gem and fades with distance; it turns with the gem, and as
 * the page scrolls the facets slide through the mirrors.
 */
const FAN = /* glsl */ `
  uniform vec4 uFan;       // where the gem is (px), how far its light reaches (px), strength
  uniform float uFanTurn;  // turns
  /** The colour that falls at a place (rgb) and how strongly (a). */
  vec4 fan(vec2 px) {
    if (uFan.w <= 0.0) return vec4(0.0);
    vec2 d = (px - uFan.xy) / uFan.z;
    float r = length(d);
    float fall = uFan.w * (0.9 * exp(-1.25 * r * r) + 0.1 * exp(-0.25 * r * r));
    // (Paler right behind the gem itself, which has colours of its own to show.)
    fall *= 0.3 + 0.7 * smoothstep(0.1, 0.4, r);
    if (fall < 0.004) return vec4(0.0);
    float turns = atan(d.y, d.x) / 6.2831853 + 0.21 * uFanTurn;
    float fold = abs(fract(turns * 6.0) - 0.5) * 2.0;
    float angle = fold * 0.5235988;
    vec2 q = r * vec2(cos(angle), sin(angle));
    // Facets: triangles laid over the folded wedge, moving outward with the turn.
    vec2 s = vec2(q.x - q.y * 0.57735, q.y * 1.1547) * 3.7 + vec2(-0.9 * uFanTurn, 0.37 * uFanTurn);
    vec2 cell = floor(s);
    vec2 f = s - cell;
    float upper = step(1.0, f.x + f.y);
    vec3 e = upper > 0.5 ? vec3(1.0 - f.x, 1.0 - f.y, f.x + f.y - 1.0) : vec3(f.x, f.y, 1.0 - f.x - f.y);
    float seam = smoothstep(0.0, 0.035, min(e.x, min(e.y, e.z)));
    float h = fract(sin(dot(cell + 0.5 * upper, vec2(12.9898, 78.233))) * 43758.5453);
    float g = fract(h * 57.31);
    vec3 colour = spectrum(0.19 * cell.x + 0.31 * cell.y + 0.4 * upper + 0.3 * h);
    return vec4(colour, clamp(fall * (0.3 + 0.7 * g) * (0.45 + 0.55 * seam), 0.0, 1.0));
  }
`

/**
 * Lines as screen-space ribbons. Each vertex knows its neighbours along the
 * line, projects all three, and steps sideways along the line's normal on
 * screen. The same pass draws the opening figure: there the width of a stroke
 * is its energy, so the strokes read as tone.
 */
export const LINE_VERT = /* glsl */ `
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute float aSide;
  attribute vec4 aInfo;   // level, figure weight, prominence, dHeight/dX

  uniform vec2 uRes;
  uniform float uDpr;
  uniform float uRise;
  uniform float uFill;
  uniform float uDX;
  uniform float uMinGap;  // closest two neighbouring lines may come, CSS px
  uniform float uWidth;   // CSS px
  uniform float uPad;     // extra ribbon half-width (the glow pass), CSS px
  uniform float uBias;    // how far the ribbon floats toward the eye, in ribbon half-widths
  uniform float uNightFigure; // stroke weight of the figure at night, relative to day
  uniform vec2 uFog;
  uniform float uOpacity;
  uniform vec2 uDraw;     // x: how much of the drawing has been plotted (0..1), y: its length

  varying float vEdge;
  varying vec2 vHalf;     // half the stroke's width by day, and by night
  varying float vAlpha;
  varying float vProm;
  varying float vInk;

  vec4 view(vec3 p) {
    return modelViewMatrix * vec4(p.x, p.y * uRise, p.z, 1.0);
  }

  void main() {
    const float EPS = 0.02;
    vec4 mv = view(position);
    vec4 c = projectionMatrix * mv;
    vec4 cp = projectionMatrix * view(aPrev);
    vec4 cn = projectionMatrix * view(aNext);
    // The same point on the next time slice, to measure how crowded lines are here.
    vec4 cq = projectionMatrix * view(position + vec3(uDX, aInfo.w * uDX, 0.0));

    float front = step(EPS, c.w);
    if (c.w > EPS) {
      if (cp.w < EPS) cp = mix(c, cp, (c.w - EPS) / (c.w - cp.w));
      if (cn.w < EPS) cn = mix(c, cn, (c.w - EPS) / (c.w - cn.w));
      if (cq.w < EPS) cq = mix(c, cq, (c.w - EPS) / (c.w - cq.w));
    }
    vec2 hres = 0.5 * uRes;
    vec2 s = c.xy / max(c.w, EPS) * hres;
    // Mitre the join: step along the bisector of the two segments that meet
    // here, far enough that both keep their full width.
    vec2 d1 = s - cp.xy / max(cp.w, EPS) * hres;
    vec2 d2 = cn.xy / max(cn.w, EPS) * hres - s;
    float l1 = length(d1);
    float l2 = length(d2);
    d1 = l1 > 1e-4 ? d1 / l1 : vec2(0.0);
    d2 = l2 > 1e-4 ? d2 / l2 : vec2(0.0);
    vec2 along = l1 > 1e-4 ? d1 : d2;
    vec2 dir = d1 + d2;
    float len = length(dir);
    dir = len > 1e-3 ? dir / len : (l1 + l2 > 1e-4 ? along : vec2(1.0, 0.0));
    vec2 nrm = vec2(-dir.y, dir.x);
    float across = abs(dot(nrm, vec2(-along.y, along.x)));

    // Level of detail: as neighbouring slices close in on each other, every
    // other line fades out, then every other of the rest, and so on.
    vec2 dq = cq.xy / max(cq.w, EPS) * hres - s;
    float gap = max(abs(dot(dq, nrm)), 1e-3) / uDpr;
    // Flat ground thins out sooner than the hills, so the ranges carry the tone.
    // The figure keeps every stroke for as long as there is room to draw it.
    float lod = max(0.0, log2(uMinGap * mix(mix(1.6, 1.0, aInfo.z), 0.8, uFill) / gap));
    float vis = clamp(aInfo.x + 1.0 - lod, 0.0, 1.0);

    float spacing = min(gap * exp2(min(lod, 12.0)), uMinGap * 3.0);
    // Gold strokes on blue want less weight than ink on paper. Which it is
    // here is decided per pixel (night comes as spots), so the ribbon is made
    // wide enough for day and the fragment shader trims it.
    float wFigure = aInfo.y * spacing * 0.92;
    float wLine = uWidth * mix(0.82, 1.0, aInfo.z);
    float halfW = 0.5 * mix(wLine, wFigure, uFill) * uDpr;
    float reach = halfW + (1.0 + uPad) * uDpr;
    float off = reach * aSide;
    // The mitre keeps both segments at full width through a bend. Where a line
    // doubles back on itself on screen (it does at every ridge it crosses), a
    // mitre would shoot out as a barb, so there the ribbon tapers to a point.
    float mitre = min(1.0 / max(across, 1e-3), uPad > 0.0 ? 1.18 : 2.0) * smoothstep(0.12, 0.45, across);
    // A ribbon wider than its segments are long would also fold over itself on
    // the inside of a bend, and the overlap shows as a tick across the line.
    // There it is narrowed until its inner edge just stays in order.
    float shortest = max(min(l1 > 1e-4 ? l1 : l2, l2 > 1e-4 ? l2 : l1), 1e-3);
    float bend = sqrt(max(0.0, 1.0 - across * across)) / max(across, 1e-3);
    float squeeze = min(1.0, 0.5 * shortest / max(reach * bend, 1e-4));

    // Lift the ribbon off the surface it lies on by about its own width, along
    // the view ray, so the surface cannot cut into it. Screen position is unchanged.
    float focal = projectionMatrix[1][1] * hres.y;
    gl_Position = projectionMatrix * vec4(mv.xyz * (1.0 - uBias * reach / focal), 1.0);
    gl_Position.xy += nrm * (off * mitre * squeeze) / hres * gl_Position.w * front;

    vEdge = off;
    vHalf = vec2(halfW, 0.5 * mix(wLine, wFigure * uNightFigure, uFill) * uDpr);
    vProm = aInfo.z;
    // Strokes of the figure are solid ink; flat ground has none until it is revealed.
    vInk = max(aInfo.z, min(1.0, aInfo.y * 12.0) * uFill);
    vAlpha = vis * (1.0 - smoothstep(uFog.x, uFog.y, length(mv.xyz))) * uOpacity * front;
    // On load the figure is plotted from its first frame to its last.
    vAlpha *= smoothstep(0.0, 0.1, uDraw.x * 1.12 - position.x / uDraw.y);
    // Flat ground that has crowded together is drawn lighter, and in the glow
    // pass gives no light at all, or the far plain smears into a band of haze
    // instead of staying a field of lines.
    float crowd = smoothstep(2.0, 9.0, gap);
    vAlpha *= mix(uPad > 0.0 ? crowd : mix(0.5, 1.0, crowd), 1.0, max(aInfo.z, uFill));
  }
`

export const LINE_FRAG = /* glsl */ `
  ${SCREEN}
  ${SPECTRUM}
  ${FAN}
  uniform vec3 uDayLo;
  uniform vec3 uDayHi;
  uniform vec3 uDayFigure;
  uniform vec3 uNightLo;
  uniform vec3 uNightHi;
  uniform vec2 uAlphaLo;   // opacity of flat-ground lines: day, night
  uniform float uGround;   // 0 while the sheet is still paper, 1 once it is ground
  uniform float uFill;

  varying float vEdge;
  varying vec2 vHalf;
  varying float vAlpha;
  varying float vProm;
  varying float vInk;

  void main() {
    float d = abs(vEdge);
    vec2 uv = gl_FragCoord.xy / uRes;
    float n = nightAt(uv);
    // Box-filtered coverage of a ribbon this wide: crisp at any width.
    float halfW = mix(vHalf.x, vHalf.y, n);
    float core = clamp(min(halfW + 0.5 - d, 2.0 * halfW), 0.0, 1.0);

    vec3 day = mix(mix(uDayLo, uDayHi, vProm), uDayFigure, uFill);
    // In the kaleidoscope the lines near the gem are drawn in its colours, as
    // coloured ink, and stand out more.
    float k = bloomAt(uv) * (1.0 - n);
    float lit = 0.0;
    if (k > 0.0) {
      vec4 thrown = fan(gl_FragCoord.xy);
      lit = min(1.0, 1.9 * thrown.a * k);
      day = mix(day, thrown.rgb * 0.8, lit);
    }
    vec3 night = mix(uNightLo, uNightHi, vInk);
    float lo = mix(mix(mix(uAlphaLo.x, 1.0, 0.55 * lit), uAlphaLo.y, n) * uGround, 1.0, vInk);

    float a = core * lo * vAlpha * quietAt(uv);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(day, night, n) * a, a);
  }
`

/** The glow: the same ribbons drawn wider, adding light, only where it is night. */
export const GLOW_FRAG = /* glsl */ `
  ${SCREEN}
  uniform vec3 uNightHi;
  uniform vec3 uGlow;      // radius (CSS px), strength, share kept by flat-ground lines
  uniform float uDpr;
  uniform float uGround;
  uniform float uFill;

  varying float vEdge;
  varying vec2 vHalf;
  varying float vAlpha;
  varying float vProm;
  varying float vInk;

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float n = nightAt(uv);
    if (n <= 0.0) discard;
    float g = max(0.0, abs(vEdge) - vHalf.y) / (uGlow.x * uDpr);
    float weight = mix(uGlow.z * uGround, 1.0, vInk) * mix(1.0, min(1.0, vHalf.y), uFill);
    float halo = uGlow.y * n * exp(-g * g) * weight * vAlpha * quietAt(uv);
    if (halo < 0.004) discard;
    gl_FragColor = vec4(uNightHi * halo, 0.0);
  }
`

/**
 * The sheet itself: cool paper by day; in Research a warmer white with the
 * gem's kaleidoscope on it, which gives way under the text; deep blue once
 * night has come over it.
 */
export const BACK_VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export const BACK_FRAG = /* glsl */ `
  ${SCREEN}
  ${SPECTRUM}
  ${FAN}
  uniform vec3 uPaper;
  uniform vec3 uWarm;
  uniform vec3 uNightGround;

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float n = nightAt(uv);
    float k = bloomAt(uv);
    vec3 ground = mix(uPaper, uWarm, k);
    if (k > 0.0 && n < 1.0) {
      vec4 thrown = fan(gl_FragCoord.xy);
      // Pastel: the colour is laid on thinly, as light is on paper.
      ground = mix(ground, thrown.rgb, 0.38 * thrown.a * k * quietAt(uv));
    }
    gl_FragColor = vec4(mix(ground, uNightGround, n), 1.0);
  }
`

/** The land as a surface that writes depth only, so near hills hide far lines. */
export const OCCLUDER_VERT = /* glsl */ `
  uniform float uRise;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y * uRise - 0.004, position.z, 1.0);
  }
`

export const OCCLUDER_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0);
  }
`

/**
 * The shards live in the camera's own space rather than in the land: they are
 * placed by screen position, in device pixels (x right, y up, z toward the
 * eye), and projected here with a gentle perspective of their own. So their
 * framing never depends on where the camera is or how tall the window is.
 */
const PLACED = /* glsl */ `
  uniform vec2 uRes;
  uniform vec3 uView;     // xy: the point the perspective converges on (px), z: 1 / viewing distance

  vec4 placed(vec3 p) {
    float w = max(0.2, 1.0 - p.z * uView.z);
    vec2 s = uView.xy + (p.xy - uView.xy) / w;
    return vec4((s / uRes * 2.0 - 1.0) * w, clamp(-p.z / (4.0 * uRes.y), -0.95, 0.95) * w, w);
  }
`

const QUAT = /* glsl */ `
  vec3 qrot(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  vec4 qmul(vec4 a, vec4 b) {
    return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
  }
  vec4 qaxis(vec3 axis, float angle) {
    return vec4(axis * sin(0.5 * angle), cos(0.5 * angle));
  }
`

const VOICE_PITCH = 1 / (VOICE.bars + VOICE.pause * (VOICE.groups.length - 1))

/**
 * All 96 shards in one draw. A vertex only says which shard it belongs to and
 * which corner it is; where that shard is, how it is turned and what shape it
 * has in each formation comes from a table (see shards.ts). uMix carries
 * every shard from one formation to another: each sets off at its own moment,
 * flies as a rigid body on an arc about the line of sight, tumbling, and eases
 * its shape on the way. What a formation does on its own (tiles turning over,
 * discs moving, the voice breaking down) is applied where the shard is read
 * from the table. Apart from the slow drift of a sheet's loose rim, nothing
 * here depends on time, so every change can be scrubbed both ways and stopped
 * anywhere.
 */
export const SHARD_VERT = /* glsl */ `
  ${PLACED}
  ${QUAT}
  ${SPECTRUM}
  // position: which shard, which corner (0..2 outer, 3..5 inner), which face (0 outer, 1 inner, 2 side)
  attribute vec3 aBary;
  attribute vec3 aEdges;  // for the inner face and the sides: which edges are true edges
  attribute vec4 aRand;

  uniform highp sampler2D uTable;
  uniform vec2 uForms;    // the two formations: 0 stone, 1 photo sheet, 2 voice, 3 tower, 4 cover sheet
  uniform float uMix;     // 0 the first .. 1 the second
  uniform vec4 uPlaceA;   // centre (px), px per unit
  uniform vec4 uRotA;
  uniform vec4 uPlaceB;
  uniform vec4 uRotB;
  uniform vec3 uPivot;    // the tower: what its shards turn about, from its place (px)
  uniform vec4 uDisc[4];  // x, y, lean of each disc, in tower units
  uniform vec3 uDiscTint[4];
  uniform float uFlip;    // 0..1 through the current turn of the tiles
  uniform float uDecay;   // 0..1: how far the voice has broken down
  uniform vec2 uLoose;    // x: how far a sheet's rim tiles float off it (0..1), y: the clock they drift by
  uniform vec4 uMotion;   // swirl (radians), burst (px), tumbling (0 or 1), stagger

  varying vec3 vP;
  varying vec3 vBary;
  varying vec3 vCrease;
  varying vec2 vUv;
  varying vec4 vShard;    // photo weight, which photo, how much of the stone, how dim
  varying vec4 vTint;     // a colour of its own, and how much of it
  varying vec3 vRand;
  varying vec2 vFace;     // which face, how much of a sheet

  const float PI = 3.14159265;
  const vec2 PHOTO_HALF = vec2(${(PHOTO.w / 2).toFixed(4)}, ${(PHOTO.h / 2).toFixed(4)});
  const vec2 COVER_HALF = vec2(${(COVER.w / 2).toFixed(4)}, ${(COVER.h / 2).toFixed(4)});
  /** The turn of the tiles travels across a sheet in this direction. */
  const vec2 WAVE = vec2(0.81, -0.59);

  struct Piece {
    vec3 c;       // centre
    vec4 q;       // orientation
    vec3 s;       // this corner, in the shard's own frame
    vec3 crease;  // how firmly each edge of the outer face is drawn
    float order;  // when it sets off toward this formation
    vec2 uv;      // on a sheet: where in the picture this corner is
    float second; // on a sheet: 1 once the tile shows the next picture
    float sheet;
    float dim;
    vec4 tint;
  };

  vec4 cell(float form, float k) {
    return texelFetch(uTable, ivec2(int(form + 0.5) * 8 + int(k + 0.5), int(position.x + 0.5)), 0);
  }
  float hash(float x) {
    return fract(sin(x * 12.9898 + 4.1) * 43758.5453);
  }
  vec3 turn(vec3 v, vec3 axis, float angle) {
    return qrot(qaxis(axis, angle), v);
  }

  Piece formed(float form) {
    Piece p;
    vec4 centre = cell(form, 0.0);
    p.c = centre.xyz;
    p.order = centre.w;
    p.q = cell(form, 1.0);
    p.s = cell(form, 2.0 + position.y).xyz;
    p.crease = vec3(cell(form, 2.0).w, cell(form, 3.0).w, cell(form, 4.0).w);
    float tag = cell(form, 5.0).w;
    p.uv = vec2(0.0);
    p.second = 0.0;
    p.sheet = 0.0;
    p.dim = 0.0;
    p.tint = vec4(0.0);

    if (form > 0.5 && form < 1.5 || form > 3.5) {
      // --- A sheet. The picture is printed on the tiles as they lie flat.
      vec2 half_ = form < 1.5 ? PHOTO_HALF : COVER_HALF;
      p.uv = (p.c.xy + qrot(p.q, p.s).xy) / (2.0 * half_) + 0.5;
      p.sheet = 1.0;
      // A tile turns over about the line of the wave front. Past edge-on it
      // is drawn coming round from the other side with the next picture on
      // it, so a tile of any shape lands back in its own outline.
      vec2 r = p.c.xy / half_;
      float along = clamp(0.5 + 0.5 * dot(r, WAVE) / 1.4, 0.0, 1.0);
      float f = clamp((uFlip - along * 0.6 - aRand.x * 0.07) / 0.33, 0.0, 1.0);
      float angle = PI * f * f * (3.0 - 2.0 * f);
      p.second = step(0.5 * PI, angle);
      vec3 axis = normalize(vec3(-WAVE.y, WAVE.x, 0.0) + vec3(aRand.yz - 0.5, 0.0) * 0.3);
      // The rim is broken: tiles on it (tag 1) and next to it (0.5) hang a
      // little off the sheet, each its own way, and drift.
      float loose = tag * uLoose.x;
      vec2 out2 = abs(r.x) > abs(r.y) ? vec2(sign(r.x), 0.0) : vec2(0.0, sign(r.y));
      out2 = normalize(out2 + 0.5 * r);
      vec3 drift = vec3(
        sin(uLoose.y * (0.5 + aRand.x) + 6.28 * aRand.y),
        cos(uLoose.y * (0.4 + aRand.z) + 6.28 * aRand.w),
        sin(uLoose.y * (0.45 + aRand.w) + 6.28 * aRand.x));
      float push = 0.003 + 0.016 * aRand.w * aRand.w * aRand.w;
      p.c.xy += (out2 * push + drift.xy * 0.0025) * loose;
      p.c.z += ((aRand.y - 0.35) * 0.04 + drift.z * 0.008) * loose + 0.05 * sin(angle);
      vec4 askew = qaxis(normalize(aRand.zxy - 0.5), ((aRand.x - 0.5) * 0.09 + drift.x * 0.016) * loose);
      p.q = qmul(qaxis(axis, angle - PI * p.second), qmul(askew, p.q));
    } else if (form > 1.5 && form < 2.5) {
      // --- The voice: a bar of the row, breaking down by degrees.
      float bar = mod(tag, 64.0);
      float group = floor(tag / 64.0);
      float h1 = hash(bar);
      float h2 = hash(bar + 71.0);
      float h3 = hash(bar + 151.0);
      vec3 mid = vec3(-0.5 + (bar + ${VOICE.pause.toFixed(2)} * group + 0.5) * ${VOICE_PITCH.toFixed(6)}, 0.0, 0.0);
      vec3 arm = p.c - mid;
      // First the pauses open: the syllables slide apart, unevenly.
      float pauses = smoothstep(0.0, 0.42, uDecay);
      float apart = (group - 2.0) * 0.05 + (group > 2.5 ? 0.04 : 0.0) - (group < 0.5 ? 0.015 : 0.0);
      // Then sounds go wrong: some bars slip out of line and change height.
      float wrong = smoothstep(0.3, 0.74, uDecay) * step(0.6, h1);
      float tall = mix(1.0, 0.5 + 0.72 * h3, wrong);
      // Last, words are lost: most of one syllable and a few bars elsewhere
      // drop away and dim.
      float lost = smoothstep(0.62, 1.0, uDecay) * (abs(group - 2.0) < 0.5 ? step(0.22, h3) : step(0.88, h2));
      vec4 roll = qaxis(vec3(0.0, 0.0, 1.0), wrong * (h2 - 0.5) * 0.2 + lost * lost * (h1 - 0.5) * 1.3);
      vec3 shape = qrot(p.q, p.s);
      shape.y *= tall;
      arm.y *= tall;
      p.s = qrot(vec4(-p.q.xyz, p.q.w), shape);
      p.c = mid + qrot(roll, arm);
      p.c.x += pauses * apart;
      p.c.y += wrong * (h3 - 0.5) * 0.07 - lost * lost * (0.06 + 0.07 * h1);
      p.c.z -= lost * 0.06;
      p.q = qmul(roll, p.q);
      p.dim = 0.86 * lost;
      p.tint = vec4(spectrum(0.02 + 0.76 * bar / ${(VOICE.bars - 1).toFixed(1)}), 1.0);
    } else if (form > 2.5 && form < 3.5) {
      // --- The tower: the shard goes wherever its disc is.
      int d = int(tag + 0.5);
      vec4 disc = uDisc[d];
      vec4 lean = qaxis(vec3(0.0, 0.0, 1.0), disc.z);
      p.c = vec3(disc.xy, 0.0) + qrot(lean, p.c);
      p.q = qmul(lean, p.q);
      p.tint = vec4(uDiscTint[d], 1.0);
    }
    return p;
  }

  void main() {
    Piece A = formed(uForms.x);
    Piece B = formed(uForms.y);
    float t = clamp(uMix * (1.0 + uMotion.w) - B.order * uMotion.w, 0.0, 1.0);
    float e = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    float arc = sin(PI * e);

    // --- Each formation in its place.
    vec3 pivotA = uForms.x > 2.5 && uForms.x < 3.5 ? uPivot : vec3(0.0);
    vec3 pivotB = uForms.y > 2.5 && uForms.y < 3.5 ? uPivot : vec3(0.0);
    vec3 a = qrot(uRotA, A.c) * uPlaceA.w - pivotA;
    vec3 b = qrot(uRotB, B.c) * uPlaceB.w - pivotB;
    vec4 qa = qmul(uRotA, A.q);
    vec4 qb = qmul(uRotB, B.q);

    // --- The flight between them.
    const vec3 SIGHT = vec3(0.0, 0.0, 1.0);
    vec3 rel = turn(mix(turn(a, SIGHT, uMotion.x), b, e), SIGHT, -uMotion.x * (1.0 - e));
    vec3 away = normalize(rel + vec3(1e-3, 2e-3, 1e-3));
    rel += (away * (0.55 + 0.9 * aRand.y) + (aRand.xyz - 0.5) * 0.9) * uMotion.y * arc;
    vec3 centre = mix(uPlaceA.xyz + pivotA, uPlaceB.xyz + pivotB, e);

    if (dot(qa, qb) < 0.0) qb = -qb;
    vec4 q = normalize(mix(qa, qb, e));
    float turns = (aRand.z < 0.5 ? 1.0 : -1.0) * (1.0 + step(0.72, aRand.w));
    q = qmul(qaxis(normalize(aRand.yzx - 0.5), 2.0 * PI * turns * e * uMotion.z), q);

    vec3 shape = mix(A.s * uPlaceA.w, B.s * uPlaceB.w, e);
    vec3 p = centre + rel + qrot(q, shape);

    vP = p;
    vBary = aBary;
    // The outer face takes its edges from the formation it is in; in flight,
    // when a shard is on its own, every edge of it is an edge.
    bool outer = position.z < 0.5;
    vec3 crease = mix(outer ? A.crease : aEdges, outer ? B.crease : aEdges, smoothstep(0.1, 0.9, e));
    vCrease = max(crease, vec3(smoothstep(0.02, 0.25, arc)));
    // The picture is printed on the front of a tile, and comes off it in flight.
    float photo = outer ? A.sheet * (1.0 - smoothstep(0.04, 0.5, e)) + B.sheet * smoothstep(0.5, 0.96, e) : 0.0;
    vUv = A.sheet > 0.5 ? A.uv : B.uv;
    float whole = (uForms.x < 0.5 ? 1.0 - e : 0.0) + (uForms.y < 0.5 ? e : 0.0);
    vShard = vec4(photo, A.sheet > 0.5 ? A.second : B.second, whole, mix(A.dim, B.dim, e));
    vTint = mix(A.tint, B.tint, e);
    vRand = aRand.xyz;
    vFace = vec2(position.z, mix(A.sheet, B.sheet, e));
    gl_Position = placed(p);
  }
`

/**
 * Cut glass, drawn last and opaque. Just before this pass the frame so far is
 * copied into uScene; each facet shows that picture displaced along its own
 * normal, split slightly by colour, so the lines of the land are seen bent and
 * broken through the stone. The facet normal comes from screen derivatives, so
 * the morph needs no normals. Colours here are plain sRGB values like the rest
 * of the scene: the copied frame is already display-encoded, and so are the
 * pictures.
 *
 * In Research (uPrism, and where the kaleidoscope's spots have reached) the
 * stone is a prism on white paper: every facet holds a turned, mirrored copy
 * of what is behind it, spread into the spectrum, and is crossed by bands of
 * colour that shift as it turns. The colour is in the light that comes
 * through it, not a glow of its own.
 */
export const SHARD_FRAG = /* glsl */ `
  ${SCREEN}
  ${SPECTRUM}
  uniform sampler2D uScene;
  uniform sampler2D uPhotoA;
  uniform sampler2D uPhotoB;
  uniform vec4 uCropA;     // uv scale xy, offset zw
  uniform vec4 uCropB;
  uniform vec3 uView;      // xy: the middle of the shards on screen (px)
  uniform float uAppear;   // 0 not there yet .. 1
  uniform vec3 uGlass;     // how far a facet displaces what is behind it (px), device px per CSS px, colour split 0..1
  uniform vec2 uPrism;     // how prismatic (0..1), where its colours are in their cycle (turns)
  uniform vec4 uSheen;     // a band of light across a sheet: its direction (xy), where it is (px), how wide (px)
  uniform vec3 uInk;
  uniform vec3 uGraphite;
  uniform vec3 uHairline;
  uniform vec3 uPaper;
  uniform vec3 uNight;
  uniform vec3 uNightGold;
  uniform vec3 uNightBlue;
  uniform vec3 uNightText;

  varying vec3 vP;
  varying vec3 vBary;
  varying vec3 vCrease;
  varying vec2 vUv;
  varying vec4 vShard;
  varying vec4 vTint;
  varying vec3 vRand;
  varying vec2 vFace;

  vec3 scene(vec2 px) {
    return texture2D(uScene, px / uRes).rgb;
  }
  /** One view through the glass, each colour bent a little differently. */
  vec3 through(vec2 px, vec2 bend, vec2 split) {
    return vec3(scene(px + bend - split).r, scene(px + bend).g, scene(px + bend + split).b);
  }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec2 uv = px / uRes;
    float night = nightAt(uv);

    vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
    if (n.z < 0.0) n = -n;
    float fresnel = pow(1.0 - n.z, 2.0);
    float whole = vShard.z;
    float prism = uPrism.x * bloomAt(uv) * (1.0 - night);
    float kaleido = prism * whole;

    // What is behind, seen through this facet: moved along the facet's lean,
    // and in the stone also turned and drawn a little larger, as through a
    // paperweight, so every facet holds its own piece of the picture. The
    // kaleidoscope turns each piece much further and mirrors every other one.
    vec2 rel = (px - uView.xy) * (1.0 - (0.1 + 0.3 * (1.0 - n.z)) * whole);
    if (n.x * n.y > 0.0) rel.x *= 1.0 - 2.0 * kaleido;
    float turn = 0.75 * n.x * whole + (2.6 * n.x - 1.9 * n.y) * kaleido;
    vec2 seen = uView.xy + vec2(rel.x * cos(turn) - rel.y * sin(turn), rel.x * sin(turn) + rel.y * cos(turn));
    vec2 bend = -n.xy * uGlass.x * (1.0 + 0.7 * kaleido);
    vec2 dir = length(n.xy) > 1e-4 ? normalize(n.xy) : vec2(0.0);
    // The colours part company only on facets that lean well away, and not
    // at all while the stone lies on the engraving: over strokes that fine
    // the split would only shimmer with false colour.
    float lean = length(n.xy);
    vec3 col = through(seen, bend, dir * 0.05 * length(bend) * smoothstep(0.3, 0.65, lean) * uGlass.z);
    if (prism > 0.0) {
      // Dispersion: six views of the scene, each bent a little further and
      // each in its own colour, summing back to white where nothing is behind.
      vec3 sum = vec3(0.0);
      vec3 total = vec3(0.0);
      for (int k = 0; k < 6; k++) {
        float s = (float(k) + 0.5) / 6.0;
        vec3 w = spectrum(0.84 * s);
        sum += w * scene(seen + bend * (1.0 + 1.5 * (s - 0.5)) + dir * (s - 0.5) * 16.0 * uGlass.y);
        total += w;
      }
      col = mix(col, sum / total, prism);
    }
    // A second, far more bent view that only the steep facets pick up, as
    // light does inside a cut stone.
    vec2 far = (n.xy * 2.4 + (vRand.xy - 0.5) * 1.2) * uGlass.x;
    vec3 inner = through(px, far, dir * 1.6 * uGlass.y * uGlass.z);
    col = mix(col, inner, 0.5 * fresnel);

    // Distance to each edge of the face, in CSS px. A true edge is a drawn
    // line; a crack across a flat face is not drawn at all, so a face of the
    // assembled stone reads as one piece.
    vec3 dist = vBary / max(fwidth(vBary), vec3(1e-5)) / uGlass.y;
    vec3 firm = min(vCrease, vec3(1.0));
    vec3 lines = (1.0 - smoothstep(0.15, 1.05, dist)) * firm;
    float cut = max(lines.x, max(lines.y, lines.z));
    vec3 soft = (1.0 - smoothstep(0.0, 7.0, dist)) * firm;
    float bevel = max(soft.x, max(soft.y, soft.z));

    // Two fixed lights: a small hard glint and a broad soft one.
    float glint = pow(max(0.0, dot(n, normalize(vec3(-0.42, 0.55, 0.72)))), 60.0)
      + 0.4 * pow(max(0.0, dot(n, normalize(vec3(0.5, 0.3, 0.8)))), 18.0);
    float shade = 0.5 - 0.5 * dot(n, normalize(vec3(-0.5, 0.6, 0.62)));
    float sheen = pow(max(0.0, dot(n, normalize(vec3(-0.5, 0.6, 0.62)))), 4.0);
    float up = max(0.0, n.y);
    float down = max(0.0, -n.y);

    // By day: clear and cool, a little denser on the facets that turn from
    // the light, with ink where it is cut.
    vec3 day = mix(col, uHairline, 0.02 + 0.17 * shade + 0.08 * fresnel);
    day = mix(day, uGraphite, 0.08 * shade * shade + 0.06 * bevel);
    day = mix(day, uPaper, min(1.0, glint) * 0.85);
    day = mix(day, uInk, cut * 0.72);

    // At night: gold along the cuts and around the rim, and a faint blue
    // body. The glass is a shade darker than the night, so what shows through
    // it is dimmer than what shows beside it; the facets that look up take a
    // little of the sky, the ones that look down a little of the lit land.
    vec3 body = mix(col, uNight * 0.6, 0.16 + 0.14 * shade);
    vec3 dark = mix(body, uNightBlue, 0.02 + 0.09 * sheen * (0.4 + 0.6 * vRand.z) + 0.14 * up * up);
    dark += uNightGold * (0.4 * fresnel * fresnel + 0.14 * bevel + 0.2 * down * sqrt(down));
    dark = mix(dark, uNightText, min(1.0, glint) * 0.7);
    dark = mix(dark, uNightGold, cut * 0.85);

    if (kaleido > 0.0) {
      // The prism: clear glass crossed by bands of colour. Each facet has its
      // own, lying its own way; along a band the colour runs through the
      // spectrum, and all of it moves as the facet turns and as the page
      // scrolls. The light is coloured on its way through, so on white paper
      // the bands are colour, not glow.
      float lie = 2.3 * n.x - 1.7 * n.y + 0.9 * n.z;
      float along = dot(px - uView.xy, vec2(cos(lie), sin(lie))) / (5.9 * uGlass.x);
      float key = dot(n, vec3(1.3, 0.9, 0.7)) + uPrism.y;
      vec3 fire = spectrum(2.0 * along + key);
      float band = 0.5 + 0.5 * cos(6.2831853 * (2.7 * along + 2.0 * key));
      band = band * band;
      vec3 jewel = mix(col, uHairline, 0.03 + 0.1 * shade);
      jewel *= mix(vec3(1.0), fire, min(1.0, 0.2 + band * (0.6 + 0.25 * fresnel) + 0.3 * fresnel * fresnel));
      jewel = mix(jewel, vec3(1.0), min(1.0, glint) * 0.9);
      jewel = mix(jewel, mix(uInk, fire * 0.55, 0.5), cut * 0.74);
      day = mix(day, jewel, kaleido);
    }

    col = mix(day, dark, night);

    // A shard with a colour of its own (a disc of the tower, a bar of the
    // voice): tinted glass, with bright rims in its colour and white glints.
    if (vTint.a > 0.0) {
      // On white, coloured acrylic: what is behind is seen through the
      // colour, which is denser where the piece turns from the light and
      // along its edges; the light it catches is white.
      vec3 behind = mix(col, vec3(1.0), 0.12) * mix(vec3(1.0), vTint.rgb, 0.8 + 0.12 * shade);
      vec3 acrylic = mix(behind, vTint.rgb * 0.7, 0.2 * bevel + 0.22 * fresnel);
      acrylic = mix(acrylic, vec3(1.0), min(1.0, glint) * 0.9 + 0.16 * up * up * sheen);
      acrylic = mix(acrylic, vTint.rgb * 0.46, cut * 0.82);
      // At night: the glass glows a little with its colour, most where a
      // face looks up and along its edges.
      vec3 glass = body * mix(vec3(1.0), 1.7 * vTint.rgb, 0.65);
      glass += vTint.rgb * (0.13 + 0.17 * up * up + 0.12 * sheen + 0.34 * bevel + 0.3 * fresnel * fresnel);
      glass = mix(glass, uNightText, min(1.0, glint));
      glass = mix(glass, mix(vTint.rgb, uNightText, 0.45), cut);
      col = mix(col, mix(acrylic, glass, night), vTint.a);
    }

    // The picture, printed on the tile: crisp, with only a hairline where it
    // is cracked. The sheet has some body: its rim catches the light, and a
    // soft band of light lies across it and moves as the page does.
    if (vShard.x > 0.0) {
      vec3 photo = mix(
        texture2D(uPhotoA, vUv * uCropA.xy + uCropA.zw, -0.4).rgb,
        texture2D(uPhotoB, vUv * uCropB.xy + uCropB.zw, -0.4).rgb,
        vShard.y
      );
      vec3 light = mix(uPaper, uNightText, night);
      float seam = 1.0 - smoothstep(0.0, 0.75, min(dist.x, min(dist.y, dist.z)));
      vec3 rims = (1.0 - smoothstep(0.0, 2.2, dist)) * step(vec3(1.5), vCrease);
      float rim = max(rims.x, max(rims.y, rims.z));
      float band = dot(px - uView.xy, uSheen.xy) - uSheen.z + dot(n.xy, uSheen.xy) * 2.2 * uSheen.w;
      float shine = exp(-band * band / (uSheen.w * uSheen.w));
      photo = mix(photo, light, max(seam * 0.3, rim * 0.6) + 0.06 * fresnel + 0.09 * shine);
      col = mix(col, photo, vShard.x);
    } else if (vFace.y > 0.5 && vFace.x > 1.5) {
      // The side of a tile: the thickness of the sheet, seen as a pale edge.
      col = mix(col, mix(uPaper, uNightText, night), 0.45);
    }

    col = mix(scene(px), col, uAppear * (1.0 - vShard.w));
    gl_FragColor = vec4(col, 1.0);
  }
`

/**
 * The shards' shadow: one soft oval on the ground under them, the same for
 * every formation. It is a gaussian, so it has no edge anywhere. By night
 * there is none (see the halo).
 */
export const SHADOW_VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform vec4 uShadow;    // centre (px), radii (px)
  varying vec2 vAt;
  void main() {
    vAt = position.xy * 2.3;
    gl_Position = vec4((uShadow.xy + vAt * uShadow.zw) / uRes * 2.0 - 1.0, 0.0, 1.0);
  }
`

export const SHADOW_FRAG = /* glsl */ `
  ${SCREEN}
  uniform float uShade;
  uniform vec3 uInk;
  varying vec2 vAt;

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float a = uShade * exp(-2.5 * dot(vAt, vAt)) * (1.0 - nightAt(uv)) * quietAt(uv);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uInk * a, a);
  }
`

/** At night the shards have a soft halo behind them instead of a shadow. */
export const HALO_VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform vec4 uHalo;      // centre (px), radius (px), strength
  varying vec2 vAt;
  void main() {
    vAt = position.xy * 2.4;
    gl_Position = vec4((uHalo.xy + vAt * uHalo.z) / uRes * 2.0 - 1.0, 0.0, 1.0);
  }
`

export const HALO_FRAG = /* glsl */ `
  ${SCREEN}
  uniform vec4 uHalo;
  uniform vec3 uColor;
  varying vec2 vAt;

  void main() {
    float halo = uHalo.w * exp(-2.4 * dot(vAt, vAt)) * nightAt(gl_FragCoord.xy / uRes);
    if (halo < 0.003) discard;
    gl_FragColor = vec4(uColor * halo, 0.0);
  }
`

/**
 * The tower's three pegs and its base: hairlines in the same space as the
 * shards, each drawn from its foot up to uGrow of its length.
 */
export const PEG_VERT = /* glsl */ `
  ${PLACED}
  ${QUAT}
  attribute vec3 aFoot;    // where this line starts, in tower units
  attribute vec2 aSide;    // x: -1 or 1 across the line, y: 0 at the foot, 1 at the tip

  uniform vec4 uPlace;
  uniform vec4 uRot;
  uniform float uGrow;
  uniform float uWidth;    // device px

  varying float vEdge;
  varying float vHalf;

  void main() {
    vec3 tip = mix(aFoot, position, uGrow);
    vec4 a = placed(uPlace.xyz + qrot(uRot, aFoot) * uPlace.w);
    vec4 b = placed(uPlace.xyz + qrot(uRot, tip) * uPlace.w);
    vec2 sa = a.xy / a.w * 0.5 * uRes;
    vec2 sb = b.xy / b.w * 0.5 * uRes;
    vec2 d = sb - sa;
    float l = length(d);
    vec2 nrm = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
    vec4 c = aSide.y < 0.5 ? a : b;
    vHalf = 0.5 * uWidth;
    vEdge = (vHalf + 1.0) * aSide.x;
    c.xy += nrm * vEdge / (0.5 * uRes) * c.w;
    gl_Position = c;
  }
`

export const PEG_FRAG = /* glsl */ `
  ${SCREEN}
  uniform vec3 uInk;
  uniform vec3 uColor;     // at night
  uniform float uOpacity;
  varying float vEdge;
  varying float vHalf;

  void main() {
    float core = clamp(min(vHalf + 0.5 - abs(vEdge), 2.0 * vHalf), 0.0, 1.0);
    float a = core * uOpacity;
    if (a < 0.003) discard;
    vec2 uv = gl_FragCoord.xy / uRes;
    gl_FragColor = vec4(mix(uInk, uColor, nightAt(uv)) * a, a);
  }
`
