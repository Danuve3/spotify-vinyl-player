import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { common } from './shaders'
import { UNIT, view } from './view'
import { Meteors } from './Meteors'

// The countryside by moonlight: the grass stirs in the wind (in the photo
// shader), a few distant lights twinkle, fireflies drift over the field and
// now and then a shooting star crosses the sky.

const FIREFLIES = 140
const GROUND = -1.6 // m below the eye

const vertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec4 aSeed;
  varying float vGlow;
  void main() {
    // Wandering slowly around their spot, a little up and down
    float t = uTime * (0.12 + aSeed.w * 0.1);
    vec3 p = position + vec3(sin(t * 1.3 + aSeed.x * 6.0), sin(t * 0.9 + aSeed.y * 6.0) * 0.35, cos(t * 1.1 + aSeed.z * 6.0)) * (0.6 + aSeed.w);
    // A slow pulse every few seconds, each on its own rhythm
    float phase = fract(uTime / (2.5 + aSeed.x * 4.0) + aSeed.y);
    vGlow = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.18, 0.55, phase)) * (1.0 - uRain) * (1.0 - uDay);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vGlow <= 0.01 ? 0.0 : clamp(0.09 * uUnit * uProj / -mv.z, 1.5, 9.0);
  }
`

const fragment = /* glsl */ `
  varying float vGlow;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 16.0);
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.28) * vGlow * a * 3.0, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function makeFireflies() {
  const pos = new Float32Array(FIREFLIES * 3)
  const seed = new Float32Array(FIREFLIES * 4)
  for (let i = 0; i < FIREFLIES; i++) {
    // Over the field in front, most of them fairly close
    const dist = 6 + Math.pow(Math.random(), 1.8) * 70
    const az = (Math.random() - 0.5) * 2.2
    pos.set([Math.cos(az) * dist, GROUND + 0.3 + Math.random() * 1.6, Math.sin(az) * dist], i * 3)
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { ...view, uUnit: { value: 1 } }, // placed in real metres, see below
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.frustumCulled = false
  points.renderOrder = -7
  return points
}

export function CountrysideLife() {
  const fireflies = useMemo(makeFireflies, [])
  useEffect(
    () => () => {
      fireflies.geometry.dispose()
      ;(fireflies.material as THREE.Material).dispose()
    },
    [fireflies],
  )
  return (
    <>
      {/* Close by, so at true scale: outside the glass, not inside the room */}
      <group scale={1 / UNIT}>
        <primitive object={fireflies} />
      </group>
      <Meteors every={16} />
    </>
  )
}
