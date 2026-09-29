import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { rainAmount } from '../weather'
import { dirVertex, lightsFragment, lightsVertex, photoFragment, skyFragment } from './shaders'

// The view out of the glass wall: "Manhattan at night south of Rockefeller
// Center" (Rhododendrites, CC BY-SA 4.0, Wikimedia Commons) wrapped on a
// band around the viewer, under a procedural sky, with animated lights on top.
// Everything is in metres around the eye and shrunk to fit the far plane; it
// follows the camera, which at these distances matches real parallax.

const UNIT = 1 / 40
export const PHOTO_URL = `${import.meta.env.BASE_URL}city/manhattan-night.webp`
const PHOTO = { width: 4096, height: 1980 }
// The panorama spans ~130 degrees; its horizon sits 31.5% down from the top
export const HALF_SPAN = THREE.MathUtils.degToRad(65)
const V_SPAN = 2 * HALF_SPAN * (PHOTO.height / PHOTO.width)
const HORIZON_FROM_TOP = 0.315
const HORIZON_EL = -0.02 // a touch below eye level: we are high up
export const EL_BOTTOM = HORIZON_EL - (1 - HORIZON_FROM_TOP) * V_SPAN
export const EL_TOP = EL_BOTTOM + V_SPAN
const PHOTO_R = 6500
/** The photo's sky colour (linear), shared with the rain on the glass. */
export const HAZE = new THREE.Vector3(0.029, 0.018, 0.013)
const SKY_R = 7000

// Spire tips in the photo (u across, v from the top) that carry red beacons
const BEACONS: [number, number][] = [
  [0.4985, 0.1418], // Empire State Building
  [0.7334, 0.0938], // One Vanderbilt
  [0.8547, 0.1396], // Bank of America Tower
]

// Stretches of avenue visible in the photo: near end (u, v) -> far end (u, v),
// v from the top, and how busy each one is (cars per lane)
interface Avenue {
  near: [number, number]
  far: [number, number]
  lane: [number, number] // (u, v) offset between the two directions
  cars: number
  size: [number, number] // light size in pixels, near and far
}
const AVENUES: Avenue[] = [
  // Sixth Avenue by Bryant Park, running away from the viewer
  { near: [0.6551, 0.7027], far: [0.6425, 0.6351], lane: [0.0028, 0], cars: 10, size: [4.0, 2.4] },
  // 42nd Street crossing it along the bottom of the park
  { near: [0.6184, 0.6973], far: [0.6551, 0.704], lane: [0, 0.0022], cars: 5, size: [3.4, 3.4] },
]

/** Direction (city space) of a point in the photo. */
function photoDirection(u: number, vFromTop: number) {
  const az = (u - 0.5) * 2 * HALF_SPAN
  const el = EL_BOTTOM + (1 - vFromTop) * V_SPAN
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
}

function makeLights(uniforms: Record<string, THREE.IUniform>) {
  const pos: number[] = []
  const a: number[] = []
  const b: number[] = []
  const col: number[] = []
  const kind: number[] = []
  const push = (p: number[], aa: number[], bb: number[], c: number[], k: number) => {
    pos.push(...p)
    a.push(...aa)
    b.push(...bb)
    col.push(...c)
    kind.push(k)
  }

  // Traffic: tail lights heading away on one side, headlights coming on the other
  AVENUES.forEach((av, i) => {
    for (const dir of [1, -1]) {
      const du = (dir * av.lane[0]) / 2
      const dv = (dir * av.lane[1]) / 2
      const colour = dir > 0 ? [1.0, 0.07, 0.03].map((c) => c * 2.2) : [1.0, 0.9, 0.72].map((c) => c * 2.4)
      for (let c = 0; c < av.cars; c++) {
        const lap = 1 / (22 + ((i * 7 + c * 13) % 17)) // one pass every 22-38 s
        push(
          [dir, 0, 0],
          [av.near[0] + du, av.near[1] + dv, av.far[0] + du, av.far[1] + dv],
          [lap, (c + ((i * 0.37 + c * 0.61) % 1) * 0.6) / av.cars, av.size[0], av.size[1]],
          colour,
          1,
        )
      }
    }
  })

  BEACONS.forEach(([u, v], i) => {
    const p = photoDirection(u, v).multiplyScalar(PHOTO_R * 0.98)
    push([p.x, p.y, p.z], [i * 0.37, 2.1 + i * 0.3, 0, 0], [0, 0, 0, 55], [1.0, 0.05, 0.02].map((c) => c * 3), 2)
  })

  // Aircraft crossing the sky, slowly
  const planes = [
    { c: [3200, 900, -600], dir: [-0.35, 1], speed: 70 },
    { c: [4600, 1250, 900], dir: [0.6, -1], speed: 80 },
    { c: [2600, 760, 300], dir: [1, 0.25], speed: 55 },
  ]
  for (const p of planes) {
    const aa = [p.c[0], p.c[1], p.c[2], p.speed]
    const bb = (size: number) => [p.dir[0], p.dir[1], 14000, size]
    push([-16, 0, 0], aa, bb(9), [1.0, 0.08, 0.05].map((v) => v * 2), 3) // port
    push([16, 0, 0], aa, bb(9), [0.1, 1.0, 0.3].map((v) => v * 2), 3) // starboard
    push([0, 1, 0], aa, bb(14), [1.4, 1.4, 1.5], 3) // strobe
    push([0, 0, 12], aa, bb(16), [1.0, 0.9, 0.75].map((v) => v * 1.8), 3) // landing light
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(a, 4))
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(b, 4))
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3))
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1))
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: lightsVertex,
      fragmentShader: lightsFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.frustumCulled = false // positions are animated on the GPU
  points.renderOrder = -8
  return points
}

export function City() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const group = useRef<THREE.Group>(null)
  const photo = useTexture(PHOTO_URL)
  const buffer = useMemo(() => new THREE.Vector2(), [])

  const city = useMemo(() => {
    photo.colorSpace = THREE.SRGBColorSpace
    photo.anisotropy = gl.capabilities.getMaxAnisotropy()
    const uniforms = {
      uTime: { value: 0 },
      uHaze: { value: HAZE }, // the photo's sky, linear
      uRain: rainAmount,
      uZenith: { value: new THREE.Vector3(0.004, 0.005, 0.012) },
      uMoon: { value: new THREE.Vector3(0.78, 0.5, -0.4).normalize() },
      uProj: { value: 800 },
      uUnit: { value: UNIT },
      uPhoto: { value: photo },
      uPhotoSize: { value: new THREE.Vector2(PHOTO.width, PHOTO.height) },
      uHalfSpan: { value: HALF_SPAN },
      uElevation: { value: new THREE.Vector2(EL_BOTTOM, EL_TOP) },
      uExposure: { value: 1.0 },
      uPhotoR: { value: PHOTO_R * 0.97 },
    }
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 48, 24),
      new THREE.ShaderMaterial({ uniforms, vertexShader: dirVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
    )
    sky.renderOrder = -10
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(PHOTO_R, 96, 48),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: dirVertex,
        fragmentShader: photoFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    )
    band.renderOrder = -9
    return { uniforms, objects: [sky, band, makeLights(uniforms)] as THREE.Object3D[] }
  }, [photo, gl])

  useEffect(
    () => () => {
      for (const o of city.objects) {
        const mesh = o as THREE.Mesh
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
    },
    [city],
  )

  useFrame((state) => {
    group.current?.position.copy(camera.position)
    city.uniforms.uTime.value = state.clock.elapsedTime
    const h = state.gl.getDrawingBufferSize(buffer).y
    city.uniforms.uProj.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  })

  return (
    <group ref={group} scale={UNIT}>
      {city.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  )
}

useTexture.preload(PHOTO_URL)
