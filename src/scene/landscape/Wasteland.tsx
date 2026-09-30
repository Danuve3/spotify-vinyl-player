import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { common } from './shaders'
import { LANDSCAPES } from './landscapes'
import { PHOTO_R, UNIT, view } from './view'

// After the end: Pripyat (from a rooftop, the Chernobyl plant on the horizon)
// at dusk under a ceiling of smoke. Fires burn in the ruins, lighting what is
// around them and sending up smoke (both in the photo shader); ash drifts down past the glass, embers
// rise, and lightning flickers inside the smoke.

// Fires in the photo: u, v from the top, size (m), how much they light around
const FIRES: [number, number, number, number][] = [
  [0.33, 0.44, 40, 1.0], // windows of the big block
  [0.905, 0.43, 30, 0.8], // tower on the right
  [0.63, 0.77, 55, 1.2], // roof of the long block in front
  [0.12, 0.56, 45, 0.9], // the trees on the left
  [0.47, 0.265, 22, 0.5], // far off
  [0.8, 0.6, 30, 0.6],
  [0.72, 0.3, 20, 0.45],
]

const { halfSpan: HALF_SPAN, elBottom: EL_BOTTOM, elTop: EL_TOP } = LANDSCAPES.wasteland.photo

function photoDirection(u: number, vFromTop: number) {
  const az = (u - 0.5) * 2 * HALF_SPAN
  const el = EL_BOTTOM + (1 - vFromTop) * (EL_TOP - EL_BOTTOM)
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
}

const fireVertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec2 aFire; // size (m), seed
  varying float vFlicker;
  varying float vSeed;
  void main() {
    vSeed = aFire.y;
    vFlicker = (0.7 + 0.3 * noise(vec2(uTime * 6.0, aFire.y * 40.0)) + 0.2 * sin(uTime * 19.0 + aFire.y * 9.0)) * (1.0 - uDay * 0.55);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aFire.x * vFlicker * uUnit * uProj / -mv.z, 2.0, 40.0);
  }
`

const fireFragment = /* glsl */ `
  varying float vFlicker;
  varying float vSeed;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    q.y *= 0.8;
    float r2 = dot(q, q) * 4.0; // 0 at the centre, 1 at the edge
    float core = exp(-r2 * 14.0);
    float halo = exp(-r2 * 4.0) * (1.0 - r2);
    vec3 c = vec3(1.6, 0.55, 0.12) * halo * 0.8 + vec3(2.2, 1.4, 0.6) * core;
    gl_FragColor = vec4(c * vFlicker, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Ash and embers close to the glass
const ASH = 700
const particleVertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec4 aSeed;
  varying float vEmber;
  varying float vAlpha;
  void main() {
    float ember = step(0.93, aSeed.w);
    vEmber = ember;
    // Ash falls slowly, swirling; embers rise
    float speed = ember > 0.5 ? 0.9 : -0.35 - aSeed.y * 0.3;
    float h = mod(position.y + uTime * speed + aSeed.x * 20.0, 20.0) - 8.0;
    vec3 p = vec3(position.x, h, position.z);
    p.xz += vec2(sin(uTime * 0.4 + aSeed.z * 6.0), cos(uTime * 0.33 + aSeed.x * 6.0)) * (1.0 + aSeed.y * 2.0);
    p.x += uTime * 0.6; // a slow wind
    p.x = mod(p.x - 4.0, 70.0) + 4.0;
    vAlpha = ember > 0.5 ? 0.6 + 0.4 * sin(uTime * 8.0 + aSeed.z * 30.0) : 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((ember > 0.5 ? 0.05 : 0.035 + aSeed.y * 0.03) * uUnit * uProj / -mv.z, 1.0, 5.0);
  }
`

const particleFragment = /* glsl */ `
  varying float vEmber;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 12.0) * vAlpha;
    vec3 c = vEmber > 0.5 ? vec3(2.5, 0.8, 0.2) : vec3(0.05, 0.045, 0.045);
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function build() {
  const r = PHOTO_R * 0.97
  // Fires
  const firePos: number[] = []
  const fireData: number[] = []
  FIRES.forEach(([u, v, size], i) => {
    const p = photoDirection(u, v).multiplyScalar(r)
    firePos.push(p.x, p.y, p.z)
    fireData.push(size * 7, i * 0.137)
  })
  const fireGeo = new THREE.BufferGeometry()
  fireGeo.setAttribute('position', new THREE.Float32BufferAttribute(firePos, 3))
  fireGeo.setAttribute('aFire', new THREE.Float32BufferAttribute(fireData, 2))
  const fires = new THREE.Points(
    fireGeo,
    new THREE.ShaderMaterial({ uniforms: view, vertexShader: fireVertex, fragmentShader: fireFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  fires.frustumCulled = false
  fires.renderOrder = -6

  // Ash and embers in front of the glass
  const ashPos = new Float32Array(ASH * 3)
  const ashSeed = new Float32Array(ASH * 4)
  for (let i = 0; i < ASH; i++) {
    const az = (Math.random() - 0.5) * 2.4
    const dist = 4 + Math.pow(Math.random(), 1.5) * 60
    ashPos.set([Math.cos(az) * dist, Math.random() * 20, Math.sin(az) * dist], i * 3)
    ashSeed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
  }
  const ashGeo = new THREE.BufferGeometry()
  ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3))
  ashGeo.setAttribute('aSeed', new THREE.BufferAttribute(ashSeed, 4))
  const ash = new THREE.Points(
    ashGeo,
    new THREE.ShaderMaterial({ uniforms: { ...view, uUnit: { value: 1 } }, vertexShader: particleVertex, fragmentShader: particleFragment, transparent: true, depthWrite: false }),
  )
  ash.frustumCulled = false
  ash.renderOrder = -5

  return { far: [fires], ash }
}

export function Wasteland() {
  const { far, ash } = useMemo(build, [])
  const objects = useMemo(() => [...far, ash], [far, ash])
  const flash = useMemo(() => ({ next: 4, start: -10, pulses: [0, 0.09, 0.22] }), [])

  useEffect(() => {
    // The fires light up the ruins around them (see the photo shader)
    FIRES.forEach(([u, v, size, strength], i) => view.uFires.value[i].set(u, v, 0.02 + size * 0.0006, strength * 0.6))
    return () => {
      for (const f of view.uFires.value) f.set(0, 0, 0, 0)
      for (const o of objects) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    }
  }, [objects])

  // Lightning: two or three quick flickers every 8-25 s
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (t > flash.next) {
      flash.start = t
      flash.pulses = [0, 0.07 + Math.random() * 0.06, 0.2 + Math.random() * 0.15].slice(0, 2 + Math.round(Math.random()))
      flash.next = t + 8 + Math.random() * 17
    }
    const dt = t - flash.start
    let f = 0
    for (const p of flash.pulses) f = Math.max(f, Math.exp(-Math.max(dt - p, 0) * 18) * (dt >= p ? 1 : 0))
    view.uFlash.value = f * (1 - view.uRain.value * 0.3)
  })

  return (
    <>
      {far.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
      {/* Ash and embers are close by, so at true scale: outside the glass */}
      <group scale={1 / UNIT}>
        <primitive object={ash} />
      </group>
    </>
  )
}
