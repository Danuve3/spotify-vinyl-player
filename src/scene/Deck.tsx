import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useDeck } from '../deck/store'
import { measureArm, radiusAtYaw, yawForRadius, type ArmGeometry } from '../deck/tonearm'
import { circularAnisotropyMap, createSideTextures } from '../vinyl/textures'
import { backCoverTexture, coverTexture, finishSleeve } from '../vinyl/sleeveTextures'
import { brushedLinearMaps } from './brushed'
import { STAND_SLEEVE, standDirection } from './SleeveStand'
import { deckAudio } from '../audio/deckAudio'

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

// Taking the record out of its sleeve, at hand speed
const SLIDE_DISTANCE = 0.32 // a diameter plus a little
const SLIDE_OUT_S = 1.3
const SLIDE_IN_S = 1.1
type SleevePhase = 'in' | 'sliding-out' | 'lifting' | 'free' | 'returning' | 'aligning' | 'sliding-in'

type Nodes = Record<string, THREE.Object3D>

interface Poses {
  holder: THREE.Group
  onPlatterLocal: THREE.Matrix4
  inSleeve: THREE.Vector3
  inSleeveQ: THREE.Quaternion
  /** Fully slid out through the open edge, still in the sleeve's plane. */
  slidOut: THREE.Vector3
  /** Lifted clear of the sleeve and the plinth. */
  lifted: THREE.Vector3
  vinylBottomY: number
  /** The sleeve and inner paper, standing on the "now playing" stand. */
  stand: THREE.Group
}

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
  const gl = useThree((st) => st.gl)
  const deckGltf = useGLTF(TURNTABLE_URL)
  const recordGltf = useGLTF(RECORD_URL)
  const n = useMemo(() => byName(deckGltf.scene), [deckGltf.scene])
  const r = useMemo(() => byName(recordGltf.scene), [recordGltf.scene])
  const arm = useRef<ArmGeometry | null>(null)
  const contactLift = useRef(0.05)
  const leadInYaw = useRef(0)
  const s = useRef({ omega: 0, yaw: 0, lift: 0, lid: 0, start: 0, speedKnob: 0, cue: 0, flip: 0, handBlend: 0, onPlatter: 0 })
  const dragging = useRef(false)
  const flight = useRef({
    album: null as string | null,
    t: 1,
    duration: 1.2,
    watch: true,
    from: new THREE.Vector3(),
    fromQ: new THREE.Quaternion(),
  })

  // Poses for the vinyl, captured once from the Blender layout
  const poses = useMemo(() => {
    // Idempotent: StrictMode runs memos twice and the vinyl can only have one holder
    const cached = recordGltf.scene.userData.poses
    if (cached) return cached as Poses
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

    // The sleeve (and its inner paper) stands upright on the "now playing" stand
    const stand = new THREE.Group()
    stand.position.copy(STAND_SLEEVE.position)
    stand.rotation.copy(STAND_SLEEVE.rotation)
    recordGltf.scene.add(stand)
    const sleeveCentre = sleeve.position.clone()
    for (const part of [sleeve, r.Inner_Sleeve]) {
      part.position.sub(sleeveCentre)
      stand.add(part)
    }
    stand.updateMatrixWorld(true)

    const inSleeve = stand.position.clone()
    const inSleeveQ = stand.quaternion.clone()
    // Out through the open edge (+X along the groove, towards the deck) until it
    // clears the sleeve, then up over the plinth
    const slidOut = inSleeve.clone().add(standDirection(SLIDE_DISTANCE, 0, 0))
    const lifted = slidOut.clone().add(new THREE.Vector3(0.05, 0.2, 0.09))
    holder.position.copy(inSleeve)
    holder.quaternion.copy(inSleeveQ)
    holder.userData.phase = 'in'
    const result: Poses = { holder, onPlatterLocal, inSleeve, inSleeveQ, slidOut, lifted, vinylBottomY, stand }
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
    upgrade(root, 'PS500_Plinth', { clearcoat: 0.6, clearcoatRoughness: 0.22 })
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
      m.roughness = 0.12
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
    // Placeholder maps, so the shaders the picked album needs are compiled
    // now, at load, and not in the middle of the sleeve's flight
    // (same colour spaces as the real ones, or three.js builds new programs)
    const blank = (colorSpace: THREE.ColorSpace, v = 200) => {
      const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1)
      t.colorSpace = colorSpace
      t.flipY = false
      t.needsUpdate = true
      return t
    }
    const srgb = blank(THREE.SRGBColorSpace)
    const linearBlank = blank(THREE.NoColorSpace)
    const vinylBlank = blank(THREE.SRGBColorSpace, 9) // plain black vinyl until its faces are drawn
    for (const name of ['Sleeve_Front', 'Sleeve_Back']) {
      for (const m of materialsNamed(recordGltf.scene, name)) if (!m.map) finishSleeve(m, srgb)
    }
    for (const name of ['Vinyl_SideA', 'Vinyl_SideB']) {
      for (const m of materialsNamed(recordGltf.scene, name)) {
        const phys = m as unknown as THREE.MeshPhysicalMaterial
        // The glTF may already carry a map: check each slot on its own
        phys.map ??= vinylBlank
        phys.roughnessMap ??= linearBlank
        phys.color.set('#ffffff')
        phys.roughness = 1
        phys.needsUpdate = true
      }
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
    finishSleeve(front, coverTexture(album.coverUrl))
    const backTex = backCoverTexture(album, sides)
    finishSleeve(back, backTex)
    return () => backTex.dispose()
  }, [album, sides, recordGltf.scene])

  useEffect(() => {
    if (!album) return
    let cancelled = false
    const disposables: THREE.Texture[] = []
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
    ;(async () => {
      // The record is hidden in its sleeve while the sleeve flies to the stand:
      // draw its faces once it has landed, so the flight stays smooth
      // (the flight itself starts on the next frame, in the render loop)
      await frame()
      await frame()
      while (!cancelled && flight.current.t < 1) await frame()
      // ...and after the camera has glided over to the deck, unless the
      // record is being taken out already
      const settle = performance.now() + 1800
      while (!cancelled && performance.now() < settle && poses.holder.userData.phase === 'in') await frame()
      const tex: (Awaited<ReturnType<typeof createSideTextures>> | null)[] = []
      for (const side of [sides[record * 2], sides[record * 2 + 1]]) {
        tex.push(side ? await createSideTextures(side, album.coverUrl, album.name, album.artist) : null)
        await frame()
      }
      if (cancelled) return
      // Upload one texture per frame rather than four in a single frame
      for (const t of tex) {
        if (!t) continue
        disposables.push(t.map, t.roughnessMap)
        for (const texture of [t.map, t.roughnessMap]) {
          gl.initTexture(texture)
          await frame()
          if (cancelled) return
        }
      }
      // Looked up here so we get the physical materials created at setup
      const [a] = materialsNamed(recordGltf.scene, 'Vinyl_SideA')
      const [b] = materialsNamed(recordGltf.scene, 'Vinyl_SideB')
      ;[a, b].forEach((mat, i) => {
        const t = tex[i]
        if (!t) return
        const phys = mat as unknown as THREE.MeshPhysicalMaterial
        phys.map = t.map
        phys.roughnessMap = t.roughnessMap
      })
    })()
    return () => {
      cancelled = true
      disposables.forEach((t) => t.dispose())
    }
  }, [album, sides, record, recordGltf.scene, gl])

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
    const stand = poses.stand
    // With no album the set is shrunk away rather than hidden, so its shaders
    // are compiled up front (hidden objects are skipped by the renderer)
    const present = st.album ? 1 : 1e-5
    holder.scale.setScalar(present)
    stand.scale.setScalar(present)

    // A newly picked sleeve is carried from where it was taken to the stand
    const fl = flight.current
    if (st.album?.id !== fl.album) {
      fl.album = st.album?.id ?? null
      const from = st.pickedFrom
      if (st.album && from) {
        fl.from.fromArray(from.pos)
        fl.fromQ.fromArray(from.quat)
        const dist = fl.from.distanceTo(poses.inSleeve)
        fl.duration = THREE.MathUtils.clamp(0.7 + dist * 0.35, 1, 1.8)
        fl.watch = from.watch
        fl.t = 0
        if (!from.watch) st.followFocus('deck')
      } else fl.t = 1
    }
    if (fl.t < 1) {
      fl.t = Math.min(1, fl.t + dt / fl.duration)
      const e = THREE.MathUtils.smootherstep(fl.t, 0, 1)
      // Up out of the crate / off the shelf, over and down onto the stand
      const lift = 0.14 + fl.from.distanceTo(poses.inSleeve) * 0.12
      tmp.pos.lerpVectors(fl.from, poses.inSleeve, 0.5).y += lift
      const a = fl.from.clone().lerp(tmp.pos, e)
      const b = tmp.pos.clone().lerp(poses.inSleeve, e)
      stand.position.copy(a.lerp(b, e))
      stand.quaternion.slerpQuaternions(fl.fromQ, poses.inSleeveQ, THREE.MathUtils.smootherstep(fl.t, 0.05, 0.85))
      if (fl.t >= 1) {
        stand.position.copy(poses.inSleeve)
        stand.quaternion.copy(poses.inSleeveQ)
        deckAudio().sleeveSlide(0.16, true) // settles into the groove of the stand
        if (fl.watch) st.followFocus('deck')
      }
    }
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
      tmp.q.copy(poses.inSleeveQ)
    }
    tmp.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), v.flip)
    tmp.q.multiply(tmp.q2)

    // The record goes in and out of the sleeve physically: it slides along the
    // groove at hand speed (with sound), and only then is lifted or put away.
    const ud = holder.userData as { phase: SleevePhase; slide: number; seated?: boolean }
    const wantSleeve = st.vinyl === 'sleeve'
    const approach = (target: THREE.Vector3, q: THREE.Quaternion, rate: number) => {
      holder.position.lerp(target, 1 - Math.exp(-rate * dt))
      holder.quaternion.slerp(q, 1 - Math.exp(-rate * dt))
      return holder.position.distanceTo(target) < 0.006
    }
    const placeOnSlide = () => {
      const e = ud.slide * ud.slide * (3 - 2 * ud.slide)
      holder.position.lerpVectors(poses.inSleeve, poses.slidOut, e)
      holder.quaternion.copy(poses.inSleeveQ)
    }
    switch (ud.phase) {
      case 'in':
        holder.position.copy(stand.position)
        holder.quaternion.copy(stand.quaternion)
        if (!wantSleeve && fl.t >= 1) {
          ud.phase = 'sliding-out'
          ud.slide = 0
          deckAudio().sleeveSlide(SLIDE_OUT_S)
        }
        break
      case 'sliding-out':
        ud.slide = Math.min(1, ud.slide + dt / SLIDE_OUT_S)
        placeOnSlide()
        if (wantSleeve) {
          ud.phase = 'sliding-in'
          deckAudio().sleeveSlide(SLIDE_IN_S * ud.slide, true)
        } else if (ud.slide >= 1) ud.phase = 'lifting'
        break
      case 'lifting':
        if (approach(poses.lifted, poses.inSleeveQ, 7)) {
          ud.phase = 'free'
          // The camera follows the record to the deck once it is out
          if (st.focus !== 'deck') st.followFocus('deck')
        }
        break
      case 'free':
        if (wantSleeve) {
          ud.phase = 'returning'
          break
        }
        {
          const rate = st.vinyl === 'platter' && ud.seated ? 1000 : 5
          holder.position.lerp(tmp.pos, 1 - Math.exp(-rate * dt))
          holder.quaternion.slerp(tmp.q, 1 - Math.exp(-rate * dt))
          ud.seated = st.vinyl === 'platter' && holder.position.distanceTo(tmp.pos) < 0.0005
        }
        break
      case 'returning':
        // Up and over, lined up with the open edge
        if (!wantSleeve) ud.phase = 'free'
        else if (approach(poses.lifted, poses.inSleeveQ, 6)) ud.phase = 'aligning'
        break
      case 'aligning':
        if (!wantSleeve) ud.phase = 'free'
        else if (approach(poses.slidOut, poses.inSleeveQ, 8)) {
          ud.phase = 'sliding-in'
          ud.slide = 1
          deckAudio().sleeveSlide(SLIDE_IN_S, true)
        }
        break
      case 'sliding-in':
        ud.slide = Math.max(0, ud.slide - dt / SLIDE_IN_S)
        placeOnSlide()
        if (!wantSleeve) {
          ud.phase = 'sliding-out'
          deckAudio().sleeveSlide(SLIDE_OUT_S * (1 - ud.slide))
        } else if (ud.slide <= 0) ud.phase = 'in'
        break
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

  // A newly picked album starts with its record in the sleeve
  useEffect(() => {
    poses.holder.userData.phase = 'in'
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
