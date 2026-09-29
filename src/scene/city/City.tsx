import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildLayout, EYE, mulberry32, R_MAX, STREET, streetLines, toCity, visible } from './layout'
import {
  buildingFragment,
  buildingVertex,
  groundFragment,
  groundVertex,
  lightsFragment,
  lightsVertex,
  skyFragment,
  skyVertex,
} from './shaders'

// The skyline outside the glass wall. Authored in metres and shrunk so the
// whole city fits inside the camera's far plane; it follows the camera, which
// at these distances is indistinguishable from real parallax.
const UNIT = 1 / 40

function makeCity() {
  const uniforms = {
    uTime: { value: 0 },
    uHaze: { value: new THREE.Vector3(0.085, 0.05, 0.047) },
    uProj: { value: 800 },
    uUnit: { value: UNIT },
    uMoon: { value: new THREE.Vector3(0.82, 0.3, -0.48).normalize() },
  }
  const objects: THREE.Object3D[] = []
  const { boxes, beacons } = buildLayout()

  // Buildings: one instanced box, facades drawn in the shader
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const dims = new Float32Array(boxes.length * 4)
  const info = new Float32Array(boxes.length * 4)
  box.setAttribute('aDims', new THREE.InstancedBufferAttribute(dims, 4))
  box.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4))
  const buildings = new THREE.InstancedMesh(
    box,
    new THREE.ShaderMaterial({ uniforms, vertexShader: buildingVertex, fragmentShader: buildingFragment }),
    boxes.length,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  boxes.forEach((b, i) => {
    q.setFromAxisAngle(up, -b.rot)
    m.compose(new THREE.Vector3(b.x, b.base - EYE, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
    buildings.setMatrixAt(i, m)
    dims.set([b.w, b.h, b.d, b.base], i * 4)
    info.set([b.seed, b.style, b.top, 0], i * 4)
  })
  buildings.computeBoundingSphere()
  objects.push(buildings)

  // Ground: streets, river and embankments
  const ground = new THREE.PlaneGeometry(R_MAX * 1.1, R_MAX * 2.2).rotateX(-Math.PI / 2).translate(R_MAX * 0.55, -EYE, 0)
  objects.push(
    new THREE.Mesh(ground, new THREE.ShaderMaterial({ uniforms, vertexShader: groundVertex, fragmentShader: groundFragment })),
  )

  // Sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 48, 24),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
  )
  sky.renderOrder = -10
  objects.push(sky)

  // Point lights: street lamps, traffic, beacons, aircraft
  const rand = mulberry32(42)
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

  const LAMP_R = 2700
  for (const line of streetLines(LAMP_R)) {
    const led = rand() < 0.3
    const lamp = led ? [0.75, 0.85, 1.0].map((v) => v * 0.9) : [1.0, 0.55, 0.22].map((v) => v * 1.2)
    for (let s = -LAMP_R; s < LAMP_R; s += 60) {
      for (const side of [-1, 1]) {
        const off = line.at + side * (STREET / 2 - 1.5)
        const [x, z] = line.axis === 0 ? toCity(off, s) : toCity(s, off)
        if (!visible(x, z, 140, LAMP_R)) continue
        push([x, 5 - EYE, z], [0, 0, 0, 0], [0, 0, 0, 3.2], lamp, 0)
      }
    }
  }

  const CAR_R = 2600
  for (const line of streetLines(CAR_R)) {
    const busy = 0.5 + rand() * 0.9
    for (const [lane, dir, c] of [
      [3.5, 1, [1.0, 0.9, 0.72].map((v) => v * 2.4)],
      [-3.5, -1, [1.0, 0.08, 0.03].map((v) => v * 2.2)],
    ] as const) {
      const count = Math.round((8 + rand() * 14) * busy)
      for (let i = 0; i < count; i++) {
        const speed = 7 + rand() * 9
        push([0, 0, 0], [line.axis, line.at, lane, dir], [speed, rand() * CAR_R * 2, CAR_R * 2, 4.6], [...c], 1)
      }
    }
  }

  for (const bc of beacons) push([bc.x, bc.y, bc.z], [bc.phase, 0, 0, 0], [0, 0, 0, 6], [1.0, 0.04, 0.02].map((v) => v * 3), 2)

  // Aircraft crossing the sky, slowly
  const planes = [
    { c: [3200, 780, -600], dir: [-0.35, 1], speed: 70 },
    { c: [4600, 1050, 900], dir: [0.6, -1], speed: 80 },
    { c: [2400, 620, 400], dir: [1, 0.25], speed: 55 },
  ]
  for (const p of planes) {
    const aa = [p.c[0], p.c[1], p.c[2], p.speed]
    const bb = (size: number) => [p.dir[0], p.dir[1], 14000, size]
    push([-16, 0, 0], aa, bb(9), [1.0, 0.08, 0.05].map((v) => v * 2), 3) // port
    push([16, 0, 0], aa, bb(9), [0.1, 1.0, 0.3].map((v) => v * 2), 3) // starboard
    push([0, 1, 0], aa, bb(14), [1.4, 1.4, 1.5], 3) // strobe
    push([0, 0, 12], aa, bb(16), [1.0, 0.9, 0.75].map((v) => v * 1.8), 3) // landing light
  }

  const lights = new THREE.BufferGeometry()
  lights.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  lights.setAttribute('aA', new THREE.Float32BufferAttribute(a, 4))
  lights.setAttribute('aB', new THREE.Float32BufferAttribute(b, 4))
  lights.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3))
  lights.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1))
  const points = new THREE.Points(
    lights,
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
  objects.push(points)

  return { objects, uniforms }
}

export function City() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const group = useRef<THREE.Group>(null)
  const city = useMemo(makeCity, [])
  const buffer = useMemo(() => new THREE.Vector2(), [])

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
