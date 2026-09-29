import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { EL_BOTTOM, EL_TOP, HALF_SPAN, HAZE, PHOTO_URL } from './city/City'
import { rainAmount, useWeather } from './weather'
import { rainAudio } from '../audio/rainAudio'

// Steady rain (not a storm): thin streaks falling outside the glass wall and
// drops on the pane that bead, run and refract the city behind them. The
// level eases in and out through the shared `rainAmount` uniform.

const GLASS = { x: 2.233, y0: 0.035, y1: 2.54, z0: -0.3, z1: 3.4 } // outer face
const STREAKS = 1800
const VOLUME = { x0: 2.5, x1: 14, z0: -5, z1: 9 }

const hashGlsl = /* glsl */ `
  uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }
  float hash(vec3 p) {
    uvec3 u = uvec3(ivec3(floor(p)));
    return float(pcg(u.x + pcg(u.y + pcg(u.z)))) / 4294967295.0;
  }
`

const dropsVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const dropsFragment = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform sampler2D uPhoto;
  uniform float uHalfSpan;
  uniform vec2 uElevation;
  uniform vec3 uHaze;
  varying vec3 vWorld;
  ${hashGlsl}

  // What a drop shows: the city photo (or the sky above it) in direction d
  vec3 cityColour(vec3 d) {
    float az = atan(d.z, d.x);
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + az / (2.0 * uHalfSpan), (el - uElevation.x) / (uElevation.y - uElevation.x));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uHaze * 1.2;
    return texture(uPhoto, clamp(uv, vec2(0.0), vec2(1.0)), 0.6).rgb;
  }

  // Round beads that form and evaporate: xy = lens normal, z = coverage
  vec3 beads(vec2 p, float cell, float t, float share, float seed) {
    vec2 g = p / cell;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h0 = hash(vec3(id, seed)), h1 = hash(vec3(id, seed + 1.0)), h2 = hash(vec3(id, seed + 2.0));
    if (h1 > share) return vec3(0.0);
    vec2 c = (vec2(h0, h2) - 0.5) * 0.6;
    float life = fract(t * (0.03 + 0.04 * h2) + h0 * 9.1);
    float r = (0.14 + 0.2 * h2) * smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.8, 1.0, life));
    vec2 d = f - c;
    d.y *= 1.1;
    float dist = length(d);
    float aa = fwidth(dist) + 1e-4;
    float m = 1.0 - smoothstep(r - aa, r + aa, dist);
    return vec3(d / max(r, 1e-4) * m, m);
  }

  // Heavier drops that let go and run down, leaving a beaded trail behind
  vec3 runners(vec2 p, float t) {
    const float W = 0.08; // column width (m)
    const float L = 1.3;  // repeat length (m)
    float col = floor(p.x / W);
    float hc = hash(vec3(col, 21.0, 0.0));
    if (hc > 0.2) return vec3(0.0);
    float speed = 0.035 + 0.07 * hash(vec3(col, 22.0, 0.0));
    float tt = t * speed + hc * 13.0;
    float slide = tt + 0.1 * sin(tt * 6.2832 * 1.3 + hc * 10.0); // hesitates, then runs
    float local = fract(p.y / L + slide) * L;
    float x = col * W + W * (0.25 + 0.5 * hash(vec3(col, 23.0, 0.0))) + 0.004 * sin(p.y * 9.0 + hc * 20.0);
    float r = 0.004 + 0.003 * hash(vec3(col, 24.0, 0.0));
    vec2 d = vec2(p.x - x, (local - 0.3 * L) * 0.85);
    float dist = length(d);
    float aa = fwidth(dist) + 1e-4;
    float m = 1.0 - smoothstep(r - aa, r + aa, dist);
    vec3 drop = vec3(d / r * m, m);

    // Trail: tiny beads that stay where the drop passed, fading behind it
    float above = local - 0.3 * L;
    float zone = step(r, above) * (1.0 - smoothstep(0.08, 0.45, above));
    float cy = floor(p.y / 0.007);
    float hb = hash(vec3(col, cy, 25.0));
    vec2 bc = vec2(x + (hb - 0.5) * 0.003, (cy + 0.5) * 0.007);
    float br = 0.0009 + 0.0012 * hash(vec3(col, cy, 26.0));
    vec2 bd = p - bc;
    float bdist = length(bd);
    float bm = (1.0 - smoothstep(br - aa, br + aa, bdist)) * zone * step(0.35, hb);
    return drop + vec3(bd / br * bm, bm);
  }

  void main() {
    vec2 p = vec2(vWorld.z, vWorld.y); // metres across and up the glass
    vec3 a = beads(p, 0.012, uTime, 0.2, 11.0);
    vec3 b = beads(p + 3.1, 0.022, uTime * 0.8, 0.12, 31.0);
    vec3 c = runners(p, uTime);
    float m = max(max(a.z, b.z), c.z) * uRain;
    if (m < 0.004) discard;
    vec2 n = a.xy + b.xy + c.xy;

    // A drop is a tiny lens: it shows what is behind it shrunk and upside down
    vec3 v = normalize(vWorld - cameraPosition);
    vec3 dir = normalize(v - vec3(0.0, n.y, n.x) * 0.45);
    vec3 col = cityColour(dir) * 0.72;
    float edge = smoothstep(0.55, 1.0, length(n));
    col *= 1.0 - 0.6 * edge; // dark rim where the surface turns away
    // Faint warm glint of the lamp behind the viewer
    col += vec3(1.0, 0.82, 0.62) * pow(max(dot(normalize(n + 1e-5), normalize(vec2(-0.5, 0.7))), 0.0), 8.0) * 0.08 * (1.0 - edge);

    gl_FragColor = vec4(col, m);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const streakVertex = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  attribute vec4 aSeed; // x, start height, z, random
  varying float vAlong;
  varying float vAlpha;
  const vec3 FALL = vec3(0.0, -0.995, 0.1);

  void main() {
    float speed = 6.5 + 2.0 * aSeed.w;
    float y = mod(aSeed.y - uTime * speed, 12.0) - 6.0 + cameraPosition.y;
    vec3 base = vec3(aSeed.x, y, aSeed.z);
    float len = 0.28 + 0.2 * aSeed.w;
    vec3 view = normalize(base - cameraPosition);
    vec3 side = normalize(cross(FALL, view));
    // Keep far streaks at least ~a pixel wide, dimming them to match
    float width = max(0.0022, length(base - cameraPosition) * 0.0011);
    vec3 p = base + FALL * (position.y * len) + side * (position.x * width);
    vAlong = position.y;
    vAlpha = uRain * (0.0022 / width) * 0.22 * (0.6 + 0.4 * aSeed.w);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const streakFragment = /* glsl */ `
  varying float vAlong;
  varying float vAlpha;
  void main() {
    float a = vAlpha * sin(vAlong * 3.14159);
    gl_FragColor = vec4(vec3(0.72, 0.75, 0.84) * a, 1.0);
    #include <colorspace_fragment>
  }
`

export function Rain() {
  const rain = useWeather((s) => s.rain)
  const photo = useTexture(PHOTO_URL)

  const { drops, streaks, uniforms } = useMemo(() => {
    const uniforms = {
      uTime: { value: 0 },
      uRain: rainAmount,
      uPhoto: { value: photo },
      uHalfSpan: { value: HALF_SPAN },
      uElevation: { value: new THREE.Vector2(EL_BOTTOM, EL_TOP) },
      uHaze: { value: HAZE },
    }

    const w = GLASS.z1 - GLASS.z0
    const h = GLASS.y1 - GLASS.y0
    const drops = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.ShaderMaterial({ uniforms, vertexShader: dropsVertex, fragmentShader: dropsFragment, transparent: true, depthWrite: false }),
    )
    drops.rotation.y = -Math.PI / 2 // facing into the room
    drops.position.set(GLASS.x, (GLASS.y0 + GLASS.y1) / 2, (GLASS.z0 + GLASS.z1) / 2)
    drops.renderOrder = 4

    // Streaks: one thin quad each, placed and animated in the vertex shader
    const quad = new THREE.InstancedBufferGeometry()
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
    quad.setIndex([0, 1, 2, 0, 2, 3])
    const seeds = new Float32Array(STREAKS * 4)
    for (let i = 0; i < STREAKS; i++) {
      seeds.set(
        [
          VOLUME.x0 + Math.random() * (VOLUME.x1 - VOLUME.x0),
          Math.random() * 12,
          VOLUME.z0 + Math.random() * (VOLUME.z1 - VOLUME.z0),
          Math.random(),
        ],
        i * 4,
      )
    }
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    quad.instanceCount = STREAKS
    const streaks = new THREE.Mesh(
      quad,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: streakVertex,
        fragmentShader: streakFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    )
    streaks.frustumCulled = false
    streaks.renderOrder = 3
    return { drops, streaks, uniforms }
  }, [photo])

  useEffect(
    () => () => {
      for (const o of [drops, streaks]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [drops, streaks],
  )

  // Sound follows the switch; browsers only start audio after a gesture
  useEffect(() => {
    if (!rain) {
      if (rainAudioStarted) rainAudio().set(false)
      return
    }
    const start = () => {
      rainAudioStarted = true
      rainAudio().set(true)
    }
    start()
    if (rainAudio().running) return
    window.addEventListener('pointerdown', start, { once: true })
    return () => window.removeEventListener('pointerdown', start)
  }, [rain])

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime
    rainAmount.value = THREE.MathUtils.damp(rainAmount.value, rain ? 1 : 0, 0.7, Math.min(dt, 0.1))
    const visible = rainAmount.value > 0.002
    drops.visible = streaks.visible = visible
  })

  return (
    <>
      <primitive object={drops} />
      <primitive object={streaks} />
    </>
  )
}

let rainAudioStarted = false
