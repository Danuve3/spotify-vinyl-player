import { useEffect, useMemo } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useLamp } from './lamp'
import { deckAudio } from '../audio/deckAudio'

// Pull cord hanging from the lamp's socket. A Verlet rope (fixed 240 Hz
// substeps, inextensible segments, a heavier brass bead at the end) hangs
// from a sprung switch: pull it down past the detent and the lamp toggles.
// Grab it anywhere, drag, let go and it swings.

// Off to one side under the shade (to the right as seen from the room), on a small switch box
// held by an arm from the lamp's stem
const ANCHOR = new THREE.Vector3(-1.545, 1.372, -0.028)
const STEM = new THREE.Vector3(-1.62, 1.372, 0.05)
const LENGTH = 0.36
const N = 26 // particles
const SEG = LENGTH / (N - 1)
const TRAVEL = 0.02 // switch travel (m)
const DETENT = 0.011 // it clicks this far down
const SPRING = 0.12 // how quickly the switch follows the pull / returns, per substep
const STEP = 1 / 240
const ITERATIONS = 14
const GRAVITY = new THREE.Vector3(0, -9.81, 0)
const DRAG = 0.4 // air damping (1/s)
const CORD_R = 0.0016
const BEAD_W = 0.12 // inverse mass of the bead relative to the cord

// Room bounds the cord cannot pass through (back wall, left wall, floor)
const MIN = new THREE.Vector3(-2.19, 0.005, -0.29)

export function LampCord() {
  const camera = useThree((s) => s.camera)
  const sim = useMemo(() => {
    const pos: THREE.Vector3[] = []
    const prev: THREE.Vector3[] = []
    const inv: number[] = []
    for (let i = 0; i < N; i++) {
      const p = ANCHOR.clone().add(new THREE.Vector3(0, -i * SEG, 0))
      pos.push(p)
      prev.push(p.clone())
      inv.push(i === 0 ? 0.5 : i === N - 1 ? BEAD_W : 1)
    }
    return { pos, prev, inv, accumulator: 0, grabbed: -1, target: new THREE.Vector3(), latched: false, switchY: ANCHOR.y }
  }, [])

  // --- visuals: cord segments (instanced), a brass bead, and a fat invisible grab zone ---
  const { cord, bead, grab, housing, arm } = useMemo(() => {
    const cordMat = new THREE.MeshStandardMaterial({ color: '#b9a27c', roughness: 0.8 })
    const cord = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), cordMat, N - 1)
    cord.frustumCulled = false
    cord.castShadow = true
    // Acorn-shaped bead, pointing down
    const profile = [
      [0, 0],
      [0.0048, 0.0014],
      [0.0076, 0.0085],
      [0.008, 0.017],
      [0.0066, 0.0238],
      [0.0038, 0.028],
      [0.002, 0.0308],
      [0, 0.0315],
    ].map(([x, y]) => new THREE.Vector2(x, y - 0.0315))
    const bead = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 24),
      new THREE.MeshStandardMaterial({ color: '#b8893f', metalness: 0.9, roughness: 0.32 }),
    )
    bead.castShadow = true
    const grab = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
      N - 1,
    )
    grab.frustumCulled = false
    // Switch box and the arm holding it from the stem
    const brass = new THREE.MeshStandardMaterial({ color: '#a8823f', metalness: 0.9, roughness: 0.35 })
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.016, 20), brass)
    housing.position.copy(ANCHOR).add(new THREE.Vector3(0, 0.009, 0))
    const armLen = ANCHOR.distanceTo(STEM)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, armLen, 10), brass)
    arm.position.addVectors(ANCHOR, STEM).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.012, 0))
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(ANCHOR, STEM).normalize())
    return { cord, bead, grab, housing, arm }
  }, [])

  useEffect(
    () => () => {
      for (const m of [cord, bead, grab, housing, arm]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    },
    [cord, bead, grab, housing, arm],
  )

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), d: new THREE.Vector3(), mid: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3() }),
    [],
  )

  const substep = () => {
    const { pos, prev, inv } = sim
    // Integrate (the anchor slides only vertically, inside the switch)
    for (let i = 0; i < N; i++) {
      if (i === sim.grabbed) {
        prev[i].copy(pos[i])
        pos[i].lerp(sim.target, 0.35)
        continue
      }
      const vel = tmp.v.subVectors(pos[i], prev[i]).multiplyScalar(1 - DRAG * STEP)
      prev[i].copy(pos[i])
      if (i === 0) {
        // The switch spring is far stiffer than the cord's weight: it only
        // gives when the cord is pulled further than its own length
        let pull = 0
        if (sim.grabbed > 0) pull = Math.max(0, sim.target.distanceTo(ANCHOR) - sim.grabbed * SEG)
        sim.switchY += (ANCHOR.y - Math.min(pull, TRAVEL) - sim.switchY) * SPRING
        pos[0].set(ANCHOR.x, sim.switchY, ANCHOR.z)
        continue
      }
      pos[i].add(vel).addScaledVector(GRAVITY, STEP * STEP)
    }
    // Inextensible segments
    for (let k = 0; k < ITERATIONS; k++) {
      for (let i = 0; i < N - 1; i++) {
        const a = pos[i], b = pos[i + 1]
        const wa = i === sim.grabbed || i === 0 ? 0 : inv[i]
        const wb = i + 1 === sim.grabbed ? 0 : inv[i + 1]
        const w = wa + wb
        if (w === 0) continue
        tmp.d.subVectors(b, a)
        const len = tmp.d.length() || 1e-9
        const corr = (len - SEG) / len / w
        a.addScaledVector(tmp.d, corr * wa)
        b.addScaledVector(tmp.d, -corr * wb)
      }
      for (let i = 1; i < N; i++) pos[i].max(MIN)
    }

    const travel = ANCHOR.y - pos[0].y
    if (!sim.latched && travel > DETENT) {
      sim.latched = true
      useLamp.getState().toggle()
      deckAudio().pullSwitch()
    } else if (sim.latched && travel < DETENT * 0.35) {
      sim.latched = false
      deckAudio().pullSwitch(true)
    }
  }

  useFrame((_, dt) => {
    sim.accumulator = Math.min(sim.accumulator + dt, 0.1)
    while (sim.accumulator >= STEP) {
      substep()
      sim.accumulator -= STEP
    }
    // Segments
    for (let i = 0; i < N - 1; i++) {
      const a = sim.pos[i], b = sim.pos[i + 1]
      tmp.d.subVectors(b, a)
      const len = tmp.d.length()
      tmp.mid.addVectors(a, b).multiplyScalar(0.5)
      tmp.q.setFromUnitVectors(tmp.up, tmp.d.normalize())
      cord.setMatrixAt(i, tmp.m.compose(tmp.mid, tmp.q, tmp.s.set(CORD_R, len + 0.0006, CORD_R)))
      grab.setMatrixAt(i, tmp.m.compose(tmp.mid, tmp.q, tmp.s.set(0.014, len, 0.014)))
    }
    cord.instanceMatrix.needsUpdate = true
    grab.instanceMatrix.needsUpdate = true
    // Bead hangs along the last segment
    const last = sim.pos[N - 1]
    tmp.d.subVectors(last, sim.pos[N - 2]).normalize()
    bead.position.copy(last)
    bead.quaternion.setFromUnitVectors(tmp.up, tmp.d.negate())
  })

  // --- dragging ---
  const plane = useMemo(() => new THREE.Plane(), [])
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    // Grab the particle nearest to where the cord was touched
    let best = N - 1
    let bestD = Infinity
    sim.pos.forEach((p, i) => {
      const d = p.distanceToSquared(e.point)
      if (i > 0 && d < bestD) {
        bestD = d
        best = i
      }
    })
    sim.grabbed = best
    sim.target.copy(sim.pos[best])
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp.v).negate(), sim.pos[best])
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    useLamp.setState({ dragging: true })
    document.body.style.cursor = 'grabbing'
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (sim.grabbed < 0) return
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return
    // The cord cannot reach further than its length plus the switch travel
    const reach = sim.grabbed * SEG + TRAVEL
    const from = tmp.v.subVectors(hit, ANCHOR)
    if (from.length() > reach) hit.copy(ANCHOR).addScaledVector(from.normalize(), reach)
    sim.target.copy(hit)
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (sim.grabbed < 0) return
    sim.grabbed = -1
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    useLamp.setState({ dragging: false })
    document.body.style.cursor = ''
  }

  return (
    <>
      <primitive object={housing} />
      <primitive object={arm} />
      <primitive object={cord} />
      <primitive object={bead} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
      <primitive
        object={grab}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          if (sim.grabbed < 0) document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => sim.grabbed < 0 && (document.body.style.cursor = '')}
      />
    </>
  )
}
