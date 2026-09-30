import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { common } from './shaders'
import { UNIT, view } from './view'

// Animated pieces shared by the themed landscapes. Most live on the photo:
// they are placed by (u, v from the top) in the night photo, which has the
// same framing as the day one, and drawn on a shell just inside it.

const R = 6200 // m: just in front of the photo band

/** From the photo's (u, v from the top) to a direction, in the vertex shader. */
const photoToDir = /* glsl */ `
  uniform float uHalfSpan;
  uniform vec2 uElevation;
  vec3 photoDir(vec2 uv) {
    float az = (uv.x - 0.5) * 2.0 * uHalfSpan;
    float el = uElevation.x + (1.0 - uv.y) * (uElevation.y - uElevation.x);
    return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  }
`

/** Seen by day, by night or both. */
export type When = 'day' | 'night' | 'both'
const WHEN = { day: 0, night: 1, both: 2 }
const whenGlsl = /* glsl */ `
  float shown(float when) {
    return when < 0.5 ? uDay : when < 1.5 ? 1.0 - uDay : 1.0;
  }
`

function useDisposable<T extends THREE.Object3D>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obj = useMemo(make, deps)
  useEffect(
    () => () => {
      obj.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        ;(m.material as THREE.Material | undefined)?.dispose()
      })
    },
    [obj],
  )
  return obj
}

function quad() {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

// --- Flying things: birds, bats, dragons and airships --------------------

export type FlyerKind = 'bird' | 'bat' | 'dragon' | 'airship' | 'gull'
const KIND = { bird: 0, gull: 1, bat: 2, dragon: 3, airship: 4 }

export interface Flock {
  kind: FlyerKind
  count: number
  /** Crossing from `from` to `to` (u, v from the top), or circling round `from` with radius `orbit` (u, v). */
  from: [number, number]
  to?: [number, number]
  orbit?: [number, number]
  /** Seconds for one pass (or one lap). */
  period: number
  /** Angular size in degrees. */
  size: number
  /** How far the members spread (u, v). */
  spread?: [number, number]
  when?: When
}

const flyerVertex = /* glsl */ `
  ${common}
  ${photoToDir}
  ${whenGlsl}
  uniform float uUnit;
  attribute vec4 aPath;   // from (u, v), to (u, v) — or centre and radius when orbiting
  attribute vec4 aMove;   // period, phase, mode (0 line, 1 orbit), kind
  attribute vec4 aExtra;  // size (deg), seed, offset u, offset v
  attribute float aWhen;
  varying vec2 vP;
  varying float vKind;
  varying float vSeed;
  varying float vShown;
  varying float vFlip;
  varying vec3 vDir;
  void main() {
    float t = fract(uTime / aMove.x + aMove.y);
    vec2 uv;
    vec2 dir;
    if (aMove.z < 0.5) {
      uv = mix(aPath.xy, aPath.zw, t);
      dir = aPath.zw - aPath.xy;
    } else {
      float a = t * 6.2832;
      uv = aPath.xy + vec2(cos(a), sin(a) * 0.35) * aPath.zw;
      dir = vec2(-sin(a), cos(a));
    }
    // Each member of a flock keeps its place, drifting a little
    uv += aExtra.zw + vec2(sin(uTime * 0.7 + aExtra.y * 40.0), cos(uTime * 0.5 + aExtra.y * 30.0)) * 0.002;
    vFlip = dir.x < 0.0 ? -1.0 : 1.0;
    vShown = shown(aWhen) * (aMove.z > 0.5 ? 1.0 : smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t));
    vKind = aMove.w;
    vSeed = aExtra.y;
    vP = position.xy;
    // A card facing the eye (the origin), built around the direction
    vec3 d = photoDir(uv);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), d));
    vec3 up = cross(d, right);
    float halfSize = tan(radians(aExtra.x) * 0.5) * ${R.toFixed(1)};
    float aspect = aMove.w > 3.5 ? 0.45 : aMove.w > 2.5 ? 0.7 : 0.6;
    vec3 p = d * ${R.toFixed(1)} - right * position.x * halfSize + up * position.y * halfSize * aspect;
    vDir = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    if (vShown < 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

const flyerFragment = /* glsl */ `
  ${common}
  uniform sampler2D uPhoto;
  uniform float uHalfSpan;
  uniform vec2 uElevation;
  uniform float uOcclude;
  varying vec3 vDir;
  varying vec2 vP;
  varying float vKind;
  varying float vSeed;
  varying float vShown;
  varying float vFlip;

  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }
  float sdEllipse(vec2 p, vec2 r) {
    return (length(p / r) - 1.0) * min(r.x, r.y);
  }

  // Wings of a bird seen from the side / below: two bent strokes that flap
  float bird(vec2 p, float flap, float thick) {
    vec2 q = vec2(abs(p.x), p.y);
    vec2 elbow = vec2(0.45, 0.22 * flap);
    vec2 tip = vec2(0.95, 0.05 + 0.5 * flap);
    float w = min(sdSegment(q, vec2(0.0), elbow), sdSegment(q, elbow, tip)) - thick * (1.0 - q.x * 0.6);
    return min(w, sdEllipse(p - vec2(0.0, -0.02), vec2(0.18, 0.07)));
  }

  float bat(vec2 p, float flap) {
    vec2 q = vec2(abs(p.x), p.y);
    float top = 0.25 * flap + q.x * 0.35 * flap;
    // Scalloped trailing edge
    float scallop = -0.15 + 0.12 * abs(sin(q.x * 9.0)) + top * 0.6;
    float inside = step(q.x, 0.95) * step(scallop, q.y) * step(q.y, top + 0.05);
    float d = inside > 0.5 ? -0.01 : 0.05;
    return min(d, sdEllipse(p, vec2(0.12, 0.09)));
  }

  bool inTri(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    float c0 = e0.x * (p - a).y - e0.y * (p - a).x;
    float c1 = e1.x * (p - b).y - e1.y * (p - b).x;
    float c2 = e2.x * (p - c).y - e2.y * (p - c).x;
    return (c0 >= 0.0 && c1 >= 0.0 && c2 >= 0.0) || (c0 <= 0.0 && c1 <= 0.0 && c2 <= 0.0);
  }

  // A bat-like wing: arm to the wrist, fingers fanning to the tips, and a
  // membrane between them scalloped along its trailing edge
  float wing(vec2 p, vec2 shoulder, vec2 back, vec2 wrist, vec2 tip1, vec2 tip2, vec2 tip3) {
    bool m = inTri(p, shoulder, wrist, back) || inTri(p, wrist, tip1, tip2) || inTri(p, wrist, tip2, tip3) || inTri(p, wrist, tip3, back);
    float d = m ? -0.004 : 1.0;
    // Scallops: bites out of the trailing edge between the fingers
    for (int i = 0; i < 3; i++) {
      vec2 a = i == 0 ? tip1 : i == 1 ? tip2 : tip3;
      vec2 b = i == 0 ? tip2 : i == 1 ? tip3 : back;
      vec2 mid = (a + b) * 0.5;
      vec2 n = normalize(mid - wrist);
      if (length(p - (mid + n * length(b - a) * 0.3)) < length(b - a) * 0.42) d = 1.0;
    }
    // Bones: the arm and the fingers
    float bones = min(sdSegment(p, shoulder, wrist), min(sdSegment(p, wrist, tip1), min(sdSegment(p, wrist, tip2), sdSegment(p, wrist, tip3)))) - 0.01;
    return min(d, bones);
  }

  float dragon(vec2 p, float flap, out float head) {
    // Side view, facing +x: body, neck, head with horns, long tail, legs tucked
    float body = sdEllipse(p - vec2(0.0, 0.0), vec2(0.27, 0.075));
    float neck = sdSegment(p, vec2(0.2, 0.02), vec2(0.46, 0.1)) - 0.032;
    float hd = sdEllipse(p - vec2(0.53, 0.1), vec2(0.075, 0.032));
    hd = min(hd, sdSegment(p, vec2(0.5, 0.12), vec2(0.44, 0.17)) - 0.008); // horn
    float tail = sdSegment(p, vec2(-0.24, 0.0), vec2(-0.58, -0.05)) - 0.024;
    tail = min(tail, sdSegment(p, vec2(-0.58, -0.05), vec2(-0.93, 0.03 + 0.05 * sin(uTime * 2.0 + vSeed * 9.0))) - 0.01);
    float legs = min(sdSegment(p, vec2(0.08, -0.05), vec2(0.02, -0.13)), sdSegment(p, vec2(-0.14, -0.05), vec2(-0.2, -0.12))) - 0.014;
    // Near wing sweeps from well above to below the body; the far one lags a little
    vec2 sh = vec2(0.08, 0.04), bk = vec2(-0.2, 0.02);
    vec2 wr = vec2(-0.02, 0.05) + vec2(0.05, 0.42) * flap;
    float spread = 0.55 + 0.45 * abs(flap);
    vec2 t1 = wr + vec2(-0.05, 0.42) * vec2(spread, flap);
    vec2 t2 = wr + vec2(-0.32, 0.3) * vec2(spread, flap);
    vec2 t3 = wr + vec2(-0.5, 0.08) * vec2(spread, flap);
    float near = wing(p, sh, bk, wr, t1, t2, t3);
    float flap2 = sin(uTime * 1.6 + vSeed * 10.0 - 0.35) * 0.85;
    vec2 wr2 = vec2(0.02, 0.06) + vec2(0.04, 0.34) * flap2;
    float far = wing(p, vec2(0.1, 0.05), vec2(-0.16, 0.03), wr2, wr2 + vec2(-0.04, 0.34) * vec2(1.0, flap2), wr2 + vec2(-0.26, 0.24) * vec2(1.0, flap2), wr2 + vec2(-0.4, 0.06) * vec2(1.0, flap2));
    head = hd;
    return min(min(min(body, neck), min(hd, tail)), min(min(near, far), legs));
  }

  void main() {
    if (vShown < 0.001) discard;
    // Behind the skyline: the night photo's alpha is the ground
    if (uOcclude > 0.5) {
      vec3 d = normalize(vDir);
      vec2 puv = vec2(0.5 + atan(d.z, d.x) / (2.0 * uHalfSpan), (asin(clamp(d.y, -1.0, 1.0)) - uElevation.x) / (uElevation.y - uElevation.x));
      if (puv.x > 0.0 && puv.x < 1.0 && puv.y < 1.0 && texture(uPhoto, puv).a > 0.5) discard;
    }
    vec2 p = vP;
    p.x *= vFlip;
    float kind = vKind;
    float a = 0.0;
    vec3 col = mix(vec3(0.05, 0.045, 0.045), uHaze * 0.7, 0.35 * uDay);
    float glow = 0.0;
    vec3 glowCol = vec3(0.0);
    if (kind < 1.5) {
      // Birds and gulls: gulls glide more and are pale
      float rate = kind < 0.5 ? 7.0 : 3.0;
      float flap = sin(uTime * rate + vSeed * 30.0);
      if (kind > 0.5) flap = mix(0.3, flap, step(0.6, fract(uTime * 0.13 + vSeed)));
      float d = bird(p, flap, 0.05);
      a = smoothstep(0.03, -0.01, d);
      if (kind > 0.5) col = mix(vec3(0.75, 0.76, 0.78) * (0.3 + 0.7 * uDay), col, 0.4);
    } else if (kind < 2.5) {
      float flap = sin(uTime * 14.0 + vSeed * 40.0);
      a = smoothstep(0.03, -0.01, bat(p, flap));
      col = vec3(0.015, 0.012, 0.014);
    } else if (kind < 3.5) {
      float flap = sin(uTime * 1.6 + vSeed * 10.0);
      float head;
      float d = dragon(p, flap, head);
      a = smoothstep(0.02, -0.005, d);
      col = mix(vec3(0.04, 0.035, 0.035), uHaze * 0.55, 0.3 * uDay);
      // Now and then a breath of fire, most striking at night
      float breath = smoothstep(0.85, 1.0, sin(uTime * 0.21 + vSeed * 17.0));
      vec2 f = p - vec2(0.62, 0.1);
      float flame = breath * exp(-pow(f.y / (0.02 + f.x * 0.25), 2.0)) * smoothstep(0.0, 0.05, f.x) * smoothstep(0.38, 0.1, f.x);
      glow = flame * (0.7 + 0.3 * noise(vec2(f.x * 40.0 - uTime * 20.0, vSeed)));
      glowCol = vec3(3.0, 1.2, 0.3);
    } else {
      // Airship: a lit envelope, a gondola with warm windows, fins and blinking lights
      float env = sdEllipse(p, vec2(0.9, 0.32));
      float gondola = max(abs(p.x + 0.05) - 0.22, abs(p.y + 0.42) - 0.06);
      float strut = min(sdSegment(p, vec2(-0.2, -0.3), vec2(-0.15, -0.38)), sdSegment(p, vec2(0.1, -0.3), vec2(0.05, -0.38))) - 0.01;
      float fin = max(abs(p.x + 0.82) - 0.1, abs(p.y) - 0.3 + (p.x + 0.9) * 0.8);
      float d = min(min(env, gondola), min(strut, fin));
      a = smoothstep(0.02, -0.01, d);
      float shade = 0.35 + 0.65 * smoothstep(-0.3, 0.3, p.y) * (1.0 - smoothstep(0.1, 0.32, -env));
      // Canvas ribs
      shade *= 0.85 + 0.15 * step(0.5, fract((p.x + 1.0) * 7.0));
      vec3 canvas = vec3(0.55, 0.47, 0.36);
      col = mix(canvas * shade * mix(0.08, 1.0, uDay), uHaze * 0.8, 0.25 * uDay);
      if (gondola < 0.0) {
        col = vec3(0.12, 0.08, 0.05) * mix(0.3, 1.0, uDay);
        float win = step(0.5, fract((p.x + 1.0) * 18.0)) * step(abs(p.y + 0.41), 0.02);
        glow = win * (1.0 - uDay) * 1.5;
        glowCol = vec3(1.6, 1.0, 0.45);
      }
      // Navigation lights
      float nav = exp(-dot(p - vec2(0.85, 0.0), p - vec2(0.85, 0.0)) * 900.0) + exp(-dot(p - vec2(-0.85, 0.05), p - vec2(-0.85, 0.05)) * 900.0);
      float blink = step(0.8, fract(uTime * 0.7 + vSeed));
      glow += nav * blink * (1.0 - uDay * 0.7) * 4.0;
      glowCol = mix(glowCol, vec3(3.0, 0.4, 0.2), nav * blink);
    }
    float alpha = max(a, clamp(glow, 0.0, 1.0)) * vShown;
    if (alpha < 0.003) discard;
    vec3 c = col * a + glowCol * glow;
    gl_FragColor = vec4(c / max(alpha, 0.001) * vShown, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** `occlude`: hidden behind the skyline (needs a night photo with its sky cut out). */
export function Flyers({ flocks, occlude = true }: { flocks: Flock[]; occlude?: boolean }) {
  const mesh = useDisposable(() => {
    const path: number[] = []
    const move: number[] = []
    const extra: number[] = []
    const when: number[] = []
    flocks.forEach((f, fi) => {
      const spread = f.spread ?? [0.02, 0.015]
      for (let i = 0; i < f.count; i++) {
        const seed = Math.random()
        if (f.orbit) path.push(f.from[0], f.from[1], f.orbit[0], f.orbit[1])
        else path.push(f.from[0], f.from[1], f.to![0], f.to![1])
        // Flocks travel together (same phase); each orbiting creature on its own
        const phase = f.orbit ? i / f.count + fi * 0.13 : fi * 0.37
        move.push(f.period * (f.orbit ? 1 + seed * 0.3 : 1), phase, f.orbit ? 1 : 0, KIND[f.kind])
        const size = f.size * (0.75 + Math.random() * 0.5)
        extra.push(size, seed, (Math.random() - 0.5) * spread[0] * 2, (Math.random() - 0.5) * spread[1] * 2)
        when.push(WHEN[f.when ?? 'both'])
      }
    })
    const g = quad()
    g.setAttribute('aPath', new THREE.InstancedBufferAttribute(new Float32Array(path), 4))
    g.setAttribute('aMove', new THREE.InstancedBufferAttribute(new Float32Array(move), 4))
    g.setAttribute('aExtra', new THREE.InstancedBufferAttribute(new Float32Array(extra), 4))
    g.setAttribute('aWhen', new THREE.InstancedBufferAttribute(new Float32Array(when), 1))
    g.instanceCount = when.length
    const m = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: { ...view, uOcclude: { value: occlude ? 1 : 0 } },
        vertexShader: flyerVertex,
        fragmentShader: flyerFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    m.frustumCulled = false
    m.renderOrder = -7
    return m
  }, [flocks, occlude])
  return <primitive object={mesh} />
}

// --- Tumbleweeds rolling across the ground --------------------------------

export interface Roller {
  /** Ground height in the photo (v from the top) and angular size there (deg). */
  v: number
  size: number
  period: number
  phase: number
  /** +1 rolls to the right. */
  dir: number
}

const rollerVertex = /* glsl */ `
  ${common}
  ${photoToDir}
  uniform float uUnit;
  attribute vec4 aRoll; // v, size (deg), period, phase
  attribute float aDir;
  varying vec2 vL;      // local coords in ball radii: ground contact at (0, 0)
  varying float vAngle;
  varying float vHop;
  varying float vFade;
  varying float vSeed;
  void main() {
    float t = fract(uTime / aRoll.z + aRoll.w);
    float u = aDir > 0.0 ? mix(-0.05, 1.05, t) : mix(1.05, -0.05, t);
    float radius = tan(radians(aRoll.y) * 0.5) * ${R.toFixed(1)};
    // Rolling: the angle follows the distance travelled; it hops on the bumps
    float travelled = t * 1.1 * 2.0 * uHalfSpan * ${R.toFixed(1)};
    vAngle = -aDir * travelled / radius;
    vHop = abs(sin(t * 38.0 + aRoll.w * 20.0)) * 0.35 + abs(sin(t * 9.0 + aRoll.w * 7.0)) * 0.3;
    vFade = smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.97, t);
    vSeed = aRoll.w;
    vL = vec2(position.x * 1.1, (position.y + 1.0) * 0.5 * 2.9 - 0.3);
    vec4 mv = modelViewMatrix * vec4(photoDir(vec2(u, aRoll.x)) * ${R.toFixed(1)}, 1.0);
    mv.xy += vL * radius * uUnit;
    gl_Position = projectionMatrix * mv;
  }
`

const rollerFragment = /* glsl */ `
  ${common}
  varying vec2 vL;
  varying float vAngle;
  varying float vHop;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec2 b = vL - vec2(0.0, 1.0 + vHop);
    float r = length(b);
    float alpha = 0.0;
    vec3 col = vec3(0.0);
    if (r < 1.0) {
      // Tangled twigs: ridged noise in the ball's own rotating frame
      float c = cos(vAngle), s = sin(vAngle);
      vec2 q = mat2(c, -s, s, c) * b;
      float n = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 qq = q * (3.0 + fi * 2.5) + vSeed * 17.0 + fi * 5.1;
        n += (1.0 - abs(noise(qq) * 2.0 - 1.0)) * (0.5 - fi * 0.12);
      }
      float twig = smoothstep(0.62, 0.8, n);
      alpha = twig * smoothstep(1.0, 0.82, r) * (0.55 + 0.45 * smoothstep(1.0, 0.3, r));
      float light = 0.45 + 0.55 * smoothstep(-0.8, 0.8, b.y - b.x * 0.3);
      col = vec3(0.55, 0.42, 0.26) * light * mix(0.05, 1.0, uDay);
    }
    // Its shadow on the ground, fainter while it is in the air
    vec2 sp = vec2(vL.x / 0.85, vL.y / 0.1);
    float shadow = exp(-dot(sp, sp) * 1.5) * 0.45 * (1.0 - vHop * 0.8) * (0.3 + 0.7 * uDay);
    float a = (alpha + shadow * (1.0 - alpha)) * vFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * alpha / max(alpha + shadow * (1.0 - alpha), 0.001), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Tumbleweeds({ rollers }: { rollers: Roller[] }) {
  const mesh = useDisposable(() => {
    const g = quad()
    g.setAttribute('aRoll', new THREE.InstancedBufferAttribute(new Float32Array(rollers.flatMap((r) => [r.v, r.size, r.period, r.phase])), 4))
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(rollers.map((r) => r.dir)), 1))
    g.instanceCount = rollers.length
    const m = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({ uniforms: view, vertexShader: rollerVertex, fragmentShader: rollerFragment, transparent: true, depthWrite: false }),
    )
    m.frustumCulled = false
    m.renderOrder = -7
    return m
  }, [rollers])
  return <primitive object={mesh} />
}

// --- Sparks: molten rock thrown up by lava fountains -----------------------

const sparkVertex = /* glsl */ `
  ${common}
  ${photoToDir}
  uniform float uProj;
  attribute vec4 aSpark; // base u, base v, spread, seed
  attribute float aHeight;
  varying float vHeat;
  void main() {
    float period = 1.6 + fract(aSpark.w * 13.0) * 1.8;
    float t = fract(uTime / period + aSpark.w);
    float vx = (fract(aSpark.w * 71.0) - 0.5) * aSpark.z;
    float vy = aHeight * (0.7 + 0.6 * fract(aSpark.w * 29.0));
    // Thrown up and falling back (v measured from the top: up is negative)
    vec2 uv = vec2(aSpark.x + vx * t, aSpark.y - (vy * t - vy * t * t));
    vHeat = (1.0 - t) * (0.6 + 0.4 * fract(aSpark.w * 97.0));
    vec4 mv = modelViewMatrix * vec4(photoDir(uv) * ${R.toFixed(1)}, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = mix(1.2, 3.5, vHeat) * uProj / 800.0;
  }
`

const sparkFragment = /* glsl */ `
  varying float vHeat;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 14.0);
    vec3 c = mix(vec3(1.2, 0.15, 0.02), vec3(3.0, 1.6, 0.5), vHeat);
    gl_FragColor = vec4(c * a * vHeat, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface Fountain {
  /** Base of the fountain (u, v from the top), how wide it throws and how high (in v). */
  u: number
  v: number
  width: number
  height: number
  count: number
}

export function Sparks({ fountains }: { fountains: Fountain[] }) {
  const points = useDisposable(() => {
    const spark: number[] = []
    const height: number[] = []
    for (const f of fountains) {
      for (let i = 0; i < f.count; i++) {
        spark.push(f.u + (Math.random() - 0.5) * f.width, f.v, f.width * 0.8, Math.random())
        height.push(f.height)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(height.length * 3), 3))
    g.setAttribute('aSpark', new THREE.Float32BufferAttribute(spark, 4))
    g.setAttribute('aHeight', new THREE.Float32BufferAttribute(height, 1))
    const p = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: view, vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    p.frustumCulled = false
    p.renderOrder = -6
    return p
  }, [fountains])
  return <primitive object={points} />
}

// --- Holograms over the city ----------------------------------------------

export interface Hologram {
  u: number
  v: number
  /** Width and height in degrees. */
  w: number
  h: number
  hue: number
}

const holoVertex = /* glsl */ `
  ${common}
  ${photoToDir}
  uniform float uUnit;
  attribute vec4 aHolo; // u, v, width (deg), height (deg)
  attribute float aHue;
  varying vec2 vP;
  varying float vHue;
  varying float vSeed;
  void main() {
    vP = position.xy;
    vHue = aHue;
    vSeed = aHolo.x * 13.0 + aHolo.y * 7.0;
    vec4 mv = modelViewMatrix * vec4(photoDir(aHolo.xy) * ${R.toFixed(1)}, 1.0);
    mv.xy += position.xy * vec2(tan(radians(aHolo.z) * 0.5), tan(radians(aHolo.w) * 0.5)) * ${R.toFixed(1)} * uUnit;
    gl_Position = projectionMatrix * mv;
  }
`

const holoFragment = /* glsl */ `
  ${common}
  varying vec2 vP;
  varying float vHue;
  varying float vSeed;
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    vec2 p = vP * 0.5 + 0.5;
    // Glitch: now and then a band slips sideways, or the whole sign drops out
    float slot = floor(uTime * 1.3 + vSeed);
    float glitch = step(0.93, hash(vec3(slot, vSeed, 1.0)));
    p.x += glitch * (hash(vec3(floor(p.y * 12.0), slot, 2.0)) - 0.5) * 0.15;
    float on = step(0.04, hash(vec3(floor(uTime * 0.4 + vSeed), vSeed, 3.0)));
    // Content: scrolling blocks of "glyphs", a frame and a slow colour shift
    vec2 g = vec2(p.x * 10.0, p.y * 6.0 - uTime * 0.6);
    float glyph = step(0.45, hash(vec3(floor(g), floor(uTime * 0.5 + vSeed))));
    vec2 cell = fract(g);
    glyph *= step(0.15, cell.x) * step(cell.x, 0.85) * step(0.2, cell.y) * step(cell.y, 0.8);
    float frame = 1.0 - step(0.03, p.x) * step(p.x, 0.97) * step(0.04, p.y) * step(p.y, 0.96);
    float scan = 0.75 + 0.25 * sin(p.y * 160.0 - uTime * 8.0);
    vec3 c = hue(vHue + 0.08 * sin(uTime * 0.2 + vSeed)) * (glyph * 0.9 + frame * 1.4 + 0.12) * scan;
    float edge = smoothstep(0.0, 0.02, p.x) * smoothstep(1.0, 0.98, p.x) * smoothstep(0.0, 0.02, p.y) * smoothstep(1.0, 0.98, p.y);
    float strength = mix(1.6, 0.35, uDay) * on * edge;
    gl_FragColor = vec4(c * strength, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Holograms({ signs }: { signs: Hologram[] }) {
  const mesh = useDisposable(() => {
    const g = quad()
    g.setAttribute('aHolo', new THREE.InstancedBufferAttribute(new Float32Array(signs.flatMap((s) => [s.u, s.v, s.w, s.h])), 4))
    g.setAttribute('aHue', new THREE.InstancedBufferAttribute(new Float32Array(signs.map((s) => s.hue)), 1))
    g.instanceCount = signs.length
    const m = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({ uniforms: view, vertexShader: holoVertex, fragmentShader: holoFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    m.frustumCulled = false
    m.renderOrder = -6
    return m
  }, [signs])
  return <primitive object={mesh} />
}

// --- Near particles: snow, ash, embers, will-o'-the-wisps ------------------

export interface DriftProps {
  count: number
  /** Linear colour; `glow` makes them additive lights. */
  colour: [number, number, number]
  /** m/s: negative falls, positive rises. */
  speed: number
  /** Metres. */
  size: number
  glow?: boolean
  /** Sideways wind (m/s). */
  wind?: number
  /** How much they wander (m). */
  wander?: number
  /** Pulsing like fireflies. */
  pulse?: boolean
  when?: When
  /** Height of the layer above the eye (m). */
  low?: number
  high?: number
}

const driftVertex = /* glsl */ `
  ${common}
  ${whenGlsl}
  uniform float uProj;
  uniform float uSpeed;
  uniform float uWind;
  uniform float uWander;
  uniform float uSize;
  uniform float uPulse;
  uniform float uWhen;
  uniform vec2 uLayer;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    float span = uLayer.y - uLayer.x;
    float h = mod(position.y + uTime * uSpeed + aSeed.x * span, span) + uLayer.x;
    vec3 p = vec3(position.x, h, position.z);
    float t = uTime * (0.3 + aSeed.y * 0.3);
    p.xz += vec2(sin(t + aSeed.z * 6.0), cos(t * 0.8 + aSeed.x * 6.0)) * uWander;
    p.z += uTime * uWind;
    p.z = mod(p.z + 40.0, 80.0) - 40.0;
    float pulse = uPulse > 0.5 ? smoothstep(0.0, 0.15, fract(uTime / (3.0 + aSeed.w * 4.0) + aSeed.y)) * (1.0 - smoothstep(0.2, 0.6, fract(uTime / (3.0 + aSeed.w * 4.0) + aSeed.y))) : 1.0;
    vAlpha = pulse * shown(uWhen) * (1.0 - uRain * 0.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vAlpha < 0.01 ? 0.0 : clamp(uSize * (0.6 + aSeed.w * 0.8) * uProj / -mv.z, 1.0, 12.0);
  }
`

const driftFragment = /* glsl */ `
  uniform vec3 uColour;
  uniform float uGlow;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 12.0) * vAlpha;
    if (uGlow > 0.5) gl_FragColor = vec4(uColour * a, 1.0);
    else gl_FragColor = vec4(uColour, a * 0.8);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Drift(props: DriftProps) {
  const { count, colour, speed, size, glow = false, wind = 0, wander = 1, pulse = false, when = 'both', low = -6, high = 10 } = props
  const points = useDisposable(() => {
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      // Outside the glass (+x), spread across the view, nearer ones denser
      const dist = 4 + Math.pow(Math.random(), 1.4) * 70
      const az = (Math.random() - 0.5) * 2.4
      pos.set([Math.cos(az) * dist, 0, Math.sin(az) * dist], i * 3)
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const p = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          ...view,
          uUnit: { value: 1 },
          uSpeed: { value: speed },
          uWind: { value: wind },
          uWander: { value: wander },
          uSize: { value: size },
          uPulse: { value: pulse ? 1 : 0 },
          uWhen: { value: WHEN[when] },
          uLayer: { value: new THREE.Vector2(low, high) },
          uColour: { value: new THREE.Vector3(...colour) },
          uGlow: { value: glow ? 1 : 0 },
        },
        vertexShader: driftVertex,
        fragmentShader: driftFragment,
        transparent: true,
        depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    )
    p.frustumCulled = false
    p.renderOrder = -5
    return p
  }, [count, colour.join(), speed, size, glow, wind, wander, pulse, when, low, high])
  // Close by, so at true scale: outside the glass, not inside the room
  return (
    <group scale={1 / UNIT}>
      <primitive object={points} />
    </group>
  )
}
