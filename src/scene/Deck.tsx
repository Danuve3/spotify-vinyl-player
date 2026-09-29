import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useDeck } from '../deck/store'
import { measureArm, radiusAtYaw, yawForRadius, type ArmGeometry } from '../deck/tonearm'
import { circularAnisotropyMap, createSideTextures } from '../vinyl/textures'
import { backCoverTexture, coverTexture } from '../vinyl/sleeveTextures'
import { brushedLinearMaps } from './brushed'

// The PS 500 rig: loads the Blender model and animates it towards the state
// in the deck store. All motion is damped so it feels mechanical, not snappy.

const BASE = import.meta.env.BASE_URL
const TURNTABLE_URL = `${BASE}models/turntable.glb`
const RECORD_URL = `${BASE}models/record.glb`

const OMEGA = { 33: (33.333 / 60) * Math.PI * 2, 45: (45 / 60) * Math.PI * 2 }
const LIFT_UP = -0.075 // rad; negative raises the headshell
const DISC_EDGE = 0.1505
const R_DISC = 0.1524

const damp = THREE.MathUtils.damp

type Nodes = Record<string, THREE.Object3D>

function byName(root: THREE.Object3D): Nodes {
  const out: Nodes = {}
  root.traverse((o) => (out[o.name] = o))
  return out
}

function materialsNamed(root: THREE.Object3D, name: string): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.name === name) found.add(m as THREE.MeshStandardMaterial)
    }
  })
  return [...found]
}

/** Swap a material for a physical one (clearcoat, transmission, anisotropy). */
function upgrade(root: THREE.Object3D, name: string, params: THREE.MeshPhysicalMaterialParameters) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const swap = (m: THREE.Material) => {
      if (m.name !== name) return m
      const old = m as THREE.MeshStandardMaterial
      const phys = new THREE.MeshPhysicalMaterial({
        name,
        color: old.color,
        map: old.map,
        normalMap: old.normalMap,
        roughness: old.roughness,
        metalness: old.metalness,
        ...params,
      })
      return phys
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
}

// Actions triggered by clicking parts of the deck, keyed by mesh name prefix
const CLICKS: [string, () => void][] = [
  ['Lid', () => useDeck.getState().toggleLid()],
  ['Start_', () => useDeck.getState().toggleStart()],
  ['Speed_Knob', () => useDeck.getState().toggleSpeed()],
  ['Cue_Lever', () => useDeck.getState().toggleCue()],
  ['Platter', () => useDeck.getState().placeOnPlatter()],
  ['Mat', () => useDeck.getState().placeOnPlatter()],
]
const ARM_PARTS = ['Tonearm_Tube', 'Headshell', 'Finger_Lift', 'Cartridge', 'Tonearm_Counterweight', 'Tonearm_Gimbal', 'Tonearm_Stub']

export function Deck() {
  const viewer = useThree((st) => st.camera)
  const deckGltf = useGLTF(TURNTABLE_URL)
  const recordGltf = useGLTF(RECORD_URL)
  const n = useMemo(() => byName(deckGltf.scene), [deckGltf.scene])
  const r = useMemo(() => byName(recordGltf.scene), [recordGltf.scene])
  const arm = useRef<ArmGeometry | null>(null)
  const contactLift = useRef(0.05)
  const leadInYaw = useRef(0)
  const s = useRef({ omega: 0, yaw: 0, lift: 0, lid: 0, start: 0, speedKnob: 0, cue: 0, flip: 0, handBlend: 0, onPlatter: 0 })
  const dragging = useRef(false)

  // Poses for the vinyl, captured once from the Blender layout
  const poses = useMemo(() => {
    // Idempotent: StrictMode runs memos twice and the vinyl can only have one holder
    const cached = recordGltf.scene.userData.poses
    if (cached) return cached as { holder: THREE.Group; onPlatterLocal: THREE.Matrix4; inSleeve: THREE.Vector3; vinylBottomY: number }
    const vinyl = r.Vinyl
    const sleeve = r.Sleeve
    vinyl.updateWorldMatrix(true, false)
    // Vinyl pivots around its mid-plane so flipping keeps it in place
    const holder = new THREE.Group()
    recordGltf.scene.add(holder)
    const onPlatterLocal = new THREE.Matrix4()
    n.Platter.updateWorldMatrix(true, false)
    const vw = vinyl.getWorldPosition(new THREE.Vector3())
    const vinylBottomY = vw.y
    const centre = n.Platter.worldToLocal(vw.clone().add(new THREE.Vector3(0, 0.0009, 0)))
    onPlatterLocal.makeTranslation(centre.x, centre.y, centre.z)
    holder.add(vinyl)
    vinyl.position.set(0, -0.0009, 0)
    vinyl.rotation.set(0, 0, 0)

    const inSleeve = sleeve.getWorldPosition(new THREE.Vector3())
    holder.position.copy(inSleeve)
    holder.userData.inSleeve = true
    const result = { holder, onPlatterLocal, inSleeve, vinylBottomY }
    recordGltf.scene.userData.poses = result
    return result
  }, [r, n, recordGltf.scene])

  // --- one-time material and geometry setup ---
  useEffect(() => {
    const root = deckGltf.scene
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    const circular = circularAnisotropyMap(512, 0)
    const linear = brushedLinearMaps()
    upgrade(root, 'PS500_Deck', { anisotropy: 0.6, roughnessMap: linear.roughness, normalMap: linear.normal, normalScale: new THREE.Vector2(0.15, 0.15) })
    upgrade(root, 'PS500_Platter', { anisotropy: 0.85, anisotropyMap: circular })
    upgrade(root, 'Alu_Satin', { anisotropy: 0.5, anisotropyMap: circular })
    upgrade(root, 'PS500_Plinth', { clearcoat: 0.6, clearcoatRoughness: 0.15 })
    upgrade(root, 'Acrylic_Smoked', {
      transmission: 1,
      thickness: 0.004,
      roughness: 0.04,
      ior: 1.49,
      color: new THREE.Color('#8a7a6c'),
      attenuationColor: new THREE.Color('#4a3a2e'),
      attenuationDistance: 0.02,
      metalness: 0,
    })
    for (const m of materialsNamed(root, 'Chrome')) {
      m.roughness = 0.08
      m.metalness = 1
    }
    // Physical arm geometry measured in the deck's own space
    arm.current = measureArm(n.Tonearm_Yaw, n.Stylus, n.Spindle, root)
    // Lowering angle that brings the stylus down onto the record surface
    const stylusY = new THREE.Vector3()
    n.Stylus.getWorldPosition(stylusY)
    const drop = stylusY.y - (poses.vinylBottomY + 0.0019)
    const reach = Math.hypot(arm.current.offset.x, arm.current.offset.y)
    contactLift.current = Math.asin(THREE.MathUtils.clamp(drop / reach, -0.3, 0.3))
    leadInYaw.current = yawForRadius(arm.current, DISC_EDGE)

    // 1) Vinyl materials are upgraded once; album changes only swap their maps
    const aniso = circularAnisotropyMap()
    for (const side of ['Vinyl_SideA', 'Vinyl_SideB']) {
      upgrade(recordGltf.scene, side, { clearcoat: 0.4, clearcoatRoughness: 0.25, anisotropy: 0.9, anisotropyMap: aniso })
    }
  }, [deckGltf.scene, recordGltf.scene, n, poses])

  // --- record set: vinyl + sleeves with the current album's artwork ---
  const album = useDeck((st) => st.album)
  const sides = useDeck((st) => st.sides)
  const sideIndex = useDeck((st) => st.sideIndex)
  const record = Math.floor(sideIndex / 2)

  useEffect(() => {
    const [front] = materialsNamed(recordGltf.scene, 'Sleeve_Front')
    const [back] = materialsNamed(recordGltf.scene, 'Sleeve_Back')
    if (!album) return
    front.map = coverTexture(album.coverUrl)
    front.color.set('#ffffff')
    front.needsUpdate = true
    const backTex = backCoverTexture(album, sides)
    back.map = backTex
    back.color.set('#ffffff')
    back.needsUpdate = true
    return () => backTex.dispose()
  }, [album, sides, recordGltf.scene])

  useEffect(() => {
    if (!album) return
    let cancelled = false
    const disposables: THREE.Texture[] = []
    Promise.all(
      [sides[record * 2], sides[record * 2 + 1]].map((side) =>
        side ? createSideTextures(side, album.coverUrl, album.name, album.artist) : Promise.resolve(null),
      ),
    ).then((tex) => {
      if (cancelled) return
      // Looked up here so we get the physical materials created at setup
      const [a] = materialsNamed(recordGltf.scene, 'Vinyl_SideA')
      const [b] = materialsNamed(recordGltf.scene, 'Vinyl_SideB')
      ;[a, b].forEach((mat, i) => {
        const t = tex[i]
        if (!t) return
        disposables.push(t.map, t.roughnessMap)
        const phys = mat as unknown as THREE.MeshPhysicalMaterial
        phys.map = t.map
        phys.roughnessMap = t.roughnessMap
        phys.color.set('#ffffff')
        phys.roughness = 1
        phys.needsUpdate = true
      })
    })
    return () => {
      cancelled = true
      disposables.forEach((t) => t.dispose())
    }
  }, [album, sides, record, recordGltf.scene])

  // --- per-frame animation ---
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      q2: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      e: new THREE.Euler(),
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const st = useDeck.getState()
    const v = s.current
    const g = arm.current
    if (!g) return

    // Platter: belt drive takes ~1.5 s to reach speed and coasts down slowly
    const targetOmega = st.motorOn ? OMEGA[st.speed] : 0
    v.omega = damp(v.omega, targetOmega, st.motorOn ? 2.2 : 0.9, dt)
    n.Platter.rotation.y -= v.omega * dt
    st.setAtSpeed(st.motorOn && Math.abs(v.omega - targetOmega) < 0.08)

    // Controls
    v.lid = damp(v.lid, st.lidOpen ? 1 : 0, 3, dt)
    n.Lid_Hinge.rotation.x = -THREE.MathUtils.degToRad(80) * v.lid
    v.start = damp(v.start, st.motorOn ? 1 : 0, 12, dt)
    n.Start_Lever.userData.z0 ??= n.Start_Lever.position.z
    n.Start_Lever.position.z = n.Start_Lever.userData.z0 - 0.02 * v.start
    v.speedKnob = damp(v.speedKnob, st.speed === 45 ? 1 : 0, 12, dt)
    n.Speed_Knob.rotation.y = -0.7 * v.speedKnob
    const cueUp = st.arm === 'lifted' || st.arm === 'auto-in' || st.arm === 'auto-return'
    v.cue = damp(v.cue, cueUp ? 1 : 0, 10, dt)
    n.Cue_Lever.rotation.x = -0.5 * v.cue

    // --- Tonearm ---
    const restYaw = 0
    const leadIn = leadInYaw.current
    let targetYaw = v.yaw
    let targetLift = v.lift
    let liftRate = 3.5 // viscous cue damping
    const overRecord = radiusAtYaw(g, v.yaw) < R_DISC && st.vinyl === 'platter'

    switch (st.arm) {
      case 'rest':
        targetYaw = restYaw
        targetLift = 0
        break
      case 'lifted':
        targetLift = LIFT_UP
        if (dragging.current) targetYaw = st.armYaw
        break
      case 'auto-in': {
        targetLift = LIFT_UP
        if (Math.abs(v.lift - LIFT_UP) < 0.01) targetYaw = leadIn
        if (Math.abs(v.yaw - leadIn) < 0.004) st.armArrived('down')
        break
      }
      case 'auto-return':
        targetLift = LIFT_UP
        if (Math.abs(v.lift - LIFT_UP) < 0.01) targetYaw = restYaw
        if (Math.abs(v.yaw - restYaw) < 0.004) st.armArrived('rest')
        break
      case 'down':
        if (!overRecord) {
          // Nothing under the stylus: settle on the rest or stay raised
          if (Math.abs(v.yaw - restYaw) < 0.06) st.armArrived('rest')
          else {
            st.armArrived('lifted')
            st.say('Coloca la aguja sobre el disco')
          }
          break
        }
        targetLift = contactLift.current
        liftRate = 2.2
        if (st.contact && st.stylusRadius !== null) targetYaw = yawForRadius(g, st.stylusRadius)
        break
    }

    v.lift = damp(v.lift, targetLift, liftRate, dt)
    // Swinging is quick when automatic, instant-follow when tracking the groove
    const yawRate = st.contact ? 30 : st.arm === 'lifted' ? 14 : 2.4
    v.yaw = damp(v.yaw, targetYaw, yawRate, dt)
    n.Tonearm_Yaw.rotation.y = v.yaw
    n.Tonearm_Lift.rotation.x = v.lift

    const touching = st.arm === 'down' && overRecord && Math.abs(v.lift - contactLift.current) < 0.002
    if (touching && !st.contact) st.setStylusRadius(radiusAtYaw(g, v.yaw))
    st.setContact(touching)
    if (!st.contact && st.arm !== 'rest') {
      const rNow = radiusAtYaw(g, v.yaw)
      if (Math.abs((st.stylusRadius ?? 0) - rNow) > 0.0005) st.setStylusRadius(rNow)
    }

    // --- Vinyl: sleeve -> hand -> platter ---
    const holder = poses.holder
    holder.visible = !!st.album
    r.Sleeve.visible = r.Inner_Sleeve.visible = !!st.album
    v.flip = damp(v.flip, sideIndex % 2 ? Math.PI : 0, 6, dt)

    // Target transform for each place
    if (st.vinyl === 'platter') {
      tmp.m.copy(n.Platter.matrixWorld).multiply(poses.onPlatterLocal)
      tmp.m.decompose(tmp.pos, tmp.q, tmp.scale)
    } else if (st.vinyl === 'hand') {
      // Held up in front of the viewer, tilted towards them
      const plat = n.Platter.getWorldPosition(new THREE.Vector3())
      const toCam = viewer.position.clone().sub(plat).setY(0).normalize()
      tmp.pos.copy(plat).addScaledVector(toCam, 0.16).add(new THREE.Vector3(0, 0.2, 0))
      tmp.q.setFromEuler(tmp.e.set(Math.PI / 2 - 0.5, Math.atan2(toCam.x, toCam.z), 0, 'YXZ'))
    } else {
      tmp.pos.copy(poses.inSleeve)
      tmp.q.identity()
    }
    tmp.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), v.flip)
    tmp.q.multiply(tmp.q2)

    const slidingOut = st.vinyl !== 'sleeve' && holder.userData.inSleeve
    if (slidingOut) {
      // First slide the record out of the open edge of the sleeve
      const out = poses.inSleeve.clone().add(new THREE.Vector3(0.24, 0.12, 0))
      holder.position.lerp(out, 1 - Math.exp(-6 * dt))
      if (holder.position.distanceTo(out) < 0.01) holder.userData.inSleeve = false
    } else {
      const rate = st.vinyl === 'platter' && holder.userData.seated ? 1000 : 5
      holder.position.lerp(tmp.pos, 1 - Math.exp(-rate * dt))
      holder.quaternion.slerp(tmp.q, 1 - Math.exp(-rate * dt))
      holder.userData.seated = st.vinyl === 'platter' && holder.position.distanceTo(tmp.pos) < 0.0005
      if (st.vinyl === 'sleeve' && holder.position.distanceTo(tmp.pos) < 0.002) holder.userData.inSleeve = true
    }
  })

  // --- pointer interaction ---
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const name = e.object.name
    const st = useDeck.getState()
    if (ARM_PARTS.some((p) => name.startsWith(p))) {
      if (st.arm === 'rest' || st.arm === 'down') st.say('Usa la palanca de elevación para levantar el brazo')
      e.stopPropagation()
      return
    }
    for (const [prefix, action] of CLICKS) {
      if (name.startsWith(prefix)) {
        action()
        e.stopPropagation()
        return
      }
    }
  }

  const armPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const onArmDown = (e: ThreeEvent<PointerEvent>) => {
    if (!ARM_PARTS.some((p) => e.object.name.startsWith(p))) return
    if (useDeck.getState().arm !== 'lifted') return
    e.stopPropagation()
    dragging.current = true
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const y = n.Tonearm_Yaw.getWorldPosition(new THREE.Vector3()).y
    armPlane.constant = -y
  }
  const onArmMove = (e: ThreeEvent<PointerEvent>) => {
    const g = arm.current
    if (!dragging.current || !g) return
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(armPlane, hit)) return
    deckGltf.scene.worldToLocal(hit)
    const ang = (x: number, y: number) => Math.atan2(x, y)
    const toHit = new THREE.Vector2(hit.x, hit.z).sub(g.pivot)
    let yaw = ang(toHit.x, toHit.y) - ang(g.offset.x, g.offset.y)
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
    const inner = yawForRadius(g, 0.052)
    yaw = THREE.MathUtils.clamp(yaw, Math.min(0, inner), Math.max(0, inner))
    useDeck.getState().dragArm(yaw)
  }
  const onArmUp = () => {
    dragging.current = false
  }

  // Vinyl and sleeve interactions
  const onRecordClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const st = useDeck.getState()
    const name = e.object.name
    if (name.startsWith('Vinyl')) {
      if (st.vinyl === 'hand') st.flipVinyl()
      else st.takeVinyl()
    } else if (name.startsWith('Sleeve') || name.startsWith('Inner_Sleeve')) {
      if (st.vinyl === 'hand') st.sleeveVinyl()
      else if (st.vinyl === 'sleeve') st.takeVinyl()
    }
  }

  useEffect(() => {
    poses.holder.userData.inSleeve = true
  }, [poses, album])

  return (
    <>
      <primitive
        object={deckGltf.scene}
        onClick={onClick}
        onPointerDown={onArmDown}
        onPointerMove={onArmMove}
        onPointerUp={onArmUp}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      />
      <primitive object={recordGltf.scene} onClick={onRecordClick} />
    </>
  )
}

useGLTF.preload(TURNTABLE_URL)
useGLTF.preload(RECORD_URL)
