import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { common } from './shaders'
import { view } from './view'

// Chongqing at night, a few years on: skyways of flying vehicles weaving
// between the towers, marked by chasing guide lights, drones hanging over the
// river and searchlight beams sweeping the haze.

interface Lane {
  a: [number, number, number] // azimuth (deg), distance (m), height (m, from the eye)
  b: [number, number, number]
  cars: number
  speed: number // m/s
}

// Positions from the eye; the city is below and in front of us
const LANES: Lane[] = [
  { a: [-55, 1400, -40], b: [10, 1900, -25], cars: 14, speed: 70 },
  { a: [-20, 2600, 30], b: [50, 2300, 15], cars: 12, speed: 90 },
  { a: [5, 700, -70], b: [35, 3200, -10], cars: 9, speed: 60 },
  { a: [-60, 3400, 60], b: [60, 3600, 70], cars: 16, speed: 120 },
  { a: [25, 1200, -55], b: [-35, 900, -65], cars: 8, speed: 45 },
  { a: [-10, 4800, 110], b: [55, 5200, 140], cars: 10, speed: 150 },
]

const polar = ([az, dist, h]: [number, number, number]) => {
  const r = THREE.MathUtils.degToRad(az)
  return new THREE.Vector3(Math.cos(r) * dist, h, Math.sin(r) * dist)
}

const trafficVertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec3 aEnd;    // lane end (the lane starts at position)
  attribute vec4 aMove;   // laps per second, phase, direction (+1 / -1), kind (0 car, 1 guide light)
  attribute float aOffset; // along the lane (m): head and tail lights of one car
  varying vec3 vColor;
  void main() {
    vec3 a = position, b = aEnd;
    float len = length(b - a);
    float t;
    float k = 1.0;
    if (aMove.w < 0.5) {
      t = fract(aMove.y + uTime * aMove.x);
      if (aMove.z < 0.0) t = 1.0 - t;
      t += aOffset / len;
      k = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t);
      bool head = aOffset * aMove.z > 0.0;
      vColor = (head ? vec3(0.75, 0.95, 1.3) : vec3(1.3, 0.12, 0.35)) * 2.2 * k;
    } else {
      // Guide lights: a pulse chasing along the lane
      t = aMove.y;
      float chase = fract(t * 6.0 - uTime * 0.35);
      k = 0.15 + 0.85 * pow(1.0 - chase, 10.0);
      vColor = vec3(0.1, 0.9, 1.2) * k * 0.9;
    }
    vec3 p = mix(a, b, t);
    // A gentle rise and fall so the lanes are not ruled lines
    p.y += sin(t * 9.0 + aMove.y * 3.0) * 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aMove.w < 0.5 ? 5.0 : 3.0;
    gl_PointSize = k <= 0.01 ? 0.0 : clamp(size * uUnit * uProj / -mv.z, 1.2, 6.0);
  }
`

const glowFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    gl_FragColor = vec4(vColor * exp(-dot(q, q) * 14.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const droneVertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec4 aSeed;
  varying vec3 vColor;
  void main() {
    float t = uTime * 0.2 + aSeed.x * 20.0;
    vec3 p = position + vec3(sin(t) * 12.0, sin(t * 1.7) * 5.0, cos(t * 0.8) * 12.0);
    float blink = step(0.8, fract(uTime * (0.6 + aSeed.y * 0.5) + aSeed.z));
    vec3 c = aSeed.w < 0.33 ? vec3(1.2, 0.2, 1.0) : aSeed.w < 0.66 ? vec3(0.2, 1.1, 1.2) : vec3(1.2, 0.7, 0.2);
    vColor = c * (0.35 + 1.8 * blink);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(3.0 * uUnit * uProj / -mv.z, 1.0, 4.0);
  }
`

function makeTraffic() {
  const start: number[] = []
  const end: number[] = []
  const move: number[] = []
  const offset: number[] = []
  LANES.forEach((lane, li) => {
    const a = polar(lane.a)
    const b = polar(lane.b)
    const len = a.distanceTo(b)
    for (const dir of [1, -1]) {
      // Two decks, one each way, a few metres apart
      const lift = new THREE.Vector3(0, dir * 5, 0)
      for (let c = 0; c < lane.cars; c++) {
        const laps = (lane.speed * (0.8 + ((c * 37 + li * 11) % 10) / 25)) / len
        const phase = (c + ((li * 0.37 + c * 0.61) % 1) * 0.7) / lane.cars
        for (const o of [2.5, -2.5]) {
          start.push(a.x + lift.x, a.y + lift.y, a.z + lift.z)
          end.push(b.x + lift.x, b.y + lift.y, b.z + lift.z)
          move.push(laps, phase, dir, 0)
          offset.push(o)
        }
      }
    }
    // Guide lights every ~60 m along the lane
    const n = Math.floor(len / 60)
    for (let i = 0; i <= n; i++) {
      start.push(a.x, a.y - 9, a.z)
      end.push(b.x, b.y - 9, b.z)
      move.push(0, i / n, 1, 1)
      offset.push(0)
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(start, 3))
  geo.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 3))
  geo.setAttribute('aMove', new THREE.Float32BufferAttribute(move, 4))
  geo.setAttribute('aOffset', new THREE.Float32BufferAttribute(offset, 1))
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({ uniforms: view, vertexShader: trafficVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  points.frustumCulled = false
  points.renderOrder = -7
  return points
}

function makeDrones() {
  const pos: number[] = []
  const seed: number[] = []
  for (let i = 0; i < 46; i++) {
    const az = THREE.MathUtils.degToRad(-60 + Math.random() * 120)
    const dist = 600 + Math.random() * 2600
    pos.push(Math.cos(az) * dist, -50 + Math.random() * 140, Math.sin(az) * dist)
    seed.push(Math.random(), Math.random(), Math.random(), Math.random())
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4))
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({ uniforms: view, vertexShader: droneVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  points.frustumCulled = false
  points.renderOrder = -7
  return points
}

// Searchlights: long soft cones rising from the city into the haze
const beamVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRain;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Brightest at the source, fading upwards; soft at the silhouette
    float core = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.5);
    float a = pow(1.0 - vAlong, 2.2) * core * (1.0 + uRain * 0.8);
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const BEAMS = [
  { az: -38, dist: 2200, h: -90, colour: [0.05, 0.07, 0.1], speed: 0.21, tilt: 0.35 },
  { az: 12, dist: 3000, h: -80, colour: [0.07, 0.05, 0.1], speed: -0.16, tilt: 0.3 },
  { az: 48, dist: 2600, h: -85, colour: [0.05, 0.08, 0.09], speed: 0.13, tilt: 0.4 },
]

function makeBeams() {
  return BEAMS.map((b) => {
    const length = 2400
    const geo = new THREE.CylinderGeometry(90, 3, length, 24, 1, true)
    geo.translate(0, length / 2, 0) // pivot at the source
    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Vector3(...b.colour) }, uRain: view.uRain },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    )
    mesh.position.copy(polar([b.az, b.dist, b.h]))
    mesh.renderOrder = -8
    mesh.userData = b
    return mesh
  })
}

export function Skyways() {
  const { traffic, drones, beams } = useMemo(() => ({ traffic: makeTraffic(), drones: makeDrones(), beams: makeBeams() }), [])
  useEffect(
    () => () => {
      for (const o of [traffic, drones, ...beams]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [traffic, drones, beams],
  )
  useFrame(({ clock }) => {
    for (const m of beams) {
      const b = m.userData as (typeof BEAMS)[number]
      const t = clock.elapsedTime * b.speed
      m.rotation.set(Math.sin(t) * b.tilt, 0, Math.cos(t * 0.7) * b.tilt, 'YXZ')
    }
  })
  return (
    <>
      {beams.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
      <primitive object={traffic} />
      <primitive object={drones} />
    </>
  )
}
