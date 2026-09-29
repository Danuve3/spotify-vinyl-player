import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDeck, type Focus } from '../deck/store'
import { useLamp } from './lamp'

// Seated viewer: fixed viewpoints per focus, eased transitions, and a
// limited free look that follows the pointer. Plus a free camera to walk
// anywhere in the room (WASD / arrows, Q/E height, drag to look, wheel).

interface Pose {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}
type SeatedFocus = Exclude<Focus, 'free'>

// three.js coordinates (Blender X, Z, -Y)
const POSES: Record<SeatedFocus, Pose> = {
  room: { pos: new THREE.Vector3(0.3, 1.26, 1.95), target: new THREE.Vector3(0.05, 1.06, 0), fov: 56 },
  deck: { pos: new THREE.Vector3(0.36, 1.1, 0.46), target: new THREE.Vector3(0.3, 0.7, 0.0), fov: 42 },
  crate: { pos: new THREE.Vector3(-0.55, 1.08, 0.62), target: new THREE.Vector3(-0.78, 0.8, 0.02), fov: 42 },
  // Standing by the glass wall, looking out over the skyline
  window: { pos: new THREE.Vector3(1.25, 1.52, 1.6), target: new THREE.Vector3(2.6, 1.4, 1.35), fov: 58 },
  // In front of the armchair, with the lamp behind it
  chair: { pos: new THREE.Vector3(0.35, 1.3, 2.45), target: new THREE.Vector3(-1.1, 0.6, 1.45), fov: 55 },
}

// Wheel zoom: some views ease continuously from their close pose to a wider
// one that shows more of the room
const WIDE: Partial<Record<SeatedFocus, Pose>> = {
  // Back from the glass: skyline, sideboard with the deck and the room
  window: { pos: new THREE.Vector3(-0.75, 1.5, 3.1), target: new THREE.Vector3(1.3, 1.0, 0.6), fov: 64 },
  // From the glass corner: armchair, lamp and sideboard
  chair: { pos: new THREE.Vector3(1.6, 1.45, 3.1), target: new THREE.Vector3(-0.9, 0.75, 0.9), fov: 62 },
}
const ZOOM_PER_PIXEL = 0.0015

const LOOK_YAW = 0.35 // radians of free look either side
const LOOK_PITCH = 0.18

// Free camera
const FREE_FOV = 60
const WALK = 1.1 // m/s
const RUN = 2.4
const CLIMB = 0.7
const LOOK_PER_PIXEL = 0.0035
const WHEEL_PER_PIXEL = 0.0012
// Inside the walls, ceiling, floor and glass (with a little clearance)
const BOUNDS = new THREE.Box3(new THREE.Vector3(-2.05, 0.25, -0.15), new THREE.Vector3(2.05, 2.42, 3.25))
const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1],
  KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyE: [0, 1, 0], KeyQ: [0, -1, 0],
}

const typing = (e: Event) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const pointer = useThree((s) => s.pointer)
  const canvas = useThree((s) => s.gl.domElement)
  const state = useMemo(() => ({ pos: POSES.room.pos.clone(), target: POSES.room.target.clone(), fov: 50, yaw: 0, pitch: 0 }), [])
  // Zoom-out amount per view (0 close, 1 wide), kept while switching views
  const zoom = useMemo<Partial<Record<SeatedFocus, number>>>(() => ({}), [])
  const blend = useMemo<Pose>(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }), [])
  const free = useMemo(
    () => ({ pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set<string>(), dragging: false, lastX: 0, lastY: 0, prevFocus: 'room' as Focus }),
    [],
  )

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const { focus, setFocus } = useDeck.getState()
      const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
      if (focus === 'free') {
        // Walk along the view direction
        const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(free.pitch, free.yaw, 0, 'YXZ'))
        free.pos.addScaledVector(fwd, -px * WHEEL_PER_PIXEL).clamp(BOUNDS.min, BOUNDS.max)
        return
      }
      if (focus === 'crate') return
      if (WIDE[focus]) {
        zoom[focus] = THREE.MathUtils.clamp((zoom[focus] ?? 0) + px * ZOOM_PER_PIXEL, 0, 1)
        return
      }
      // Wheel outside the crate toggles between the room and the deck
      setFocus(e.deltaY < 0 ? 'deck' : 'room')
    }
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      const { setFocus, flipVinyl, focus } = useDeck.getState()
      if (focus === 'free' && (MOVE_KEYS[e.code] || e.code.startsWith('Shift'))) {
        free.keys.add(e.code)
        e.preventDefault()
        return
      }
      if (e.key === '1') setFocus('room')
      if (e.key === '2') setFocus('deck')
      if (e.key === '3') setFocus('crate')
      if (e.key === '4') setFocus('window')
      if (e.key === '5') setFocus('chair')
      if (e.key === '6') setFocus('free')
      if (e.key.toLowerCase() === 'f') flipVinyl()
      if (e.key === 'Escape') setFocus('room')
    }
    const onKeyUp = (e: KeyboardEvent) => free.keys.delete(e.code)
    const onBlur = () => free.keys.clear()
    // Drag to look (free camera only); the lamp cord keeps its own drag
    const onDown = (e: PointerEvent) => {
      if (useDeck.getState().focus !== 'free' || (e.button !== 0 && e.button !== 2)) return
      free.dragging = true
      free.lastX = e.clientX
      free.lastY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (!free.dragging) return
      const dx = e.clientX - free.lastX
      const dy = e.clientY - free.lastY
      free.lastX = e.clientX
      free.lastY = e.clientY
      if (useLamp.getState().dragging) return
      free.yaw -= dx * LOOK_PER_PIXEL
      free.pitch = THREE.MathUtils.clamp(free.pitch - dy * LOOK_PER_PIXEL, -1.35, 1.35)
    }
    const onUp = () => (free.dragging = false)
    const noMenu = (e: Event) => useDeck.getState().focus === 'free' && e.preventDefault()

    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('contextmenu', noMenu)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('contextmenu', noMenu)
    }
  }, [zoom, free, canvas])

  const dir = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const move = useMemo(() => new THREE.Vector3(), [])
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const focus = useDeck.getState().focus

    if (focus === 'free') {
      if (free.prevFocus !== 'free') {
        // Start from wherever the camera is, facing the same way
        free.pos.copy(camera.position).clamp(BOUNDS.min, BOUNDS.max)
        euler.setFromQuaternion(camera.quaternion, 'YXZ')
        free.yaw = euler.y
        free.pitch = euler.x
        free.keys.clear()
      }
      free.prevFocus = focus
      // Walk on the horizontal plane relative to where we look
      move.set(0, 0, 0)
      for (const code of free.keys) {
        if (!MOVE_KEYS[code]) continue
        const [x, y, z] = MOVE_KEYS[code]
        move.x += x
        move.y += y
        move.z += z
      }
      if (move.lengthSq() > 0) {
        const speed = free.keys.has('ShiftLeft') || free.keys.has('ShiftRight') ? RUN : WALK
        const sin = Math.sin(free.yaw)
        const cos = Math.cos(free.yaw)
        const h = Math.hypot(move.x, move.z) || 1
        free.pos.x += ((move.x * cos - move.z * sin) / h) * speed * dt
        free.pos.z += ((-move.x * sin - move.z * cos) / h) * speed * dt
        free.pos.y += move.y * CLIMB * dt
        free.pos.clamp(BOUNDS.min, BOUNDS.max)
      }
      // Ease towards the target pose so movement feels like a head, not a cursor
      camera.position.lerp(free.pos, 1 - Math.exp(-12 * dt))
      euler.set(free.pitch, free.yaw, 0, 'YXZ')
      q.setFromEuler(euler)
      camera.quaternion.slerp(q, 1 - Math.exp(-18 * dt))
      state.fov += (FREE_FOV - state.fov) * (1 - Math.exp(-4 * dt))
      if (Math.abs(camera.fov - state.fov) > 0.01) {
        camera.fov = state.fov
        camera.updateProjectionMatrix()
      }
      return
    }

    if (free.prevFocus === 'free') {
      // Leaving the free camera: glide back to the seated view from here
      state.pos.copy(camera.position)
      state.target.copy(camera.position).add(camera.getWorldDirection(dir))
      state.yaw = 0
      state.pitch = 0
    }
    free.prevFocus = focus

    let pose = POSES[focus]
    const wide = WIDE[focus]
    if (wide) {
      const t = THREE.MathUtils.smootherstep(zoom[focus] ?? 0, 0, 1)
      blend.pos.lerpVectors(pose.pos, wide.pos, t)
      blend.target.lerpVectors(pose.target, wide.target, t)
      blend.fov = THREE.MathUtils.lerp(pose.fov, wide.fov, t)
      pose = blend
    }
    const k = 1 - Math.exp(-2.8 * dt)
    state.pos.lerp(pose.pos, k)
    state.target.lerp(pose.target, k)
    state.fov += (pose.fov - state.fov) * k

    // Free look: pointer at the screen edge turns the head, gently
    const edge = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.35) / 0.65
    // Holding the lamp cord near the screen edge must not turn the head
    if (!useLamp.getState().dragging) {
      state.yaw = THREE.MathUtils.damp(state.yaw, -edge(pointer.x) * LOOK_YAW, 2, dt)
      state.pitch = THREE.MathUtils.damp(state.pitch, edge(pointer.y) * LOOK_PITCH, 2, dt)
    }

    camera.position.copy(state.pos)
    camera.lookAt(state.target)
    q.setFromAxisAngle(dir.set(0, 1, 0), state.yaw)
    camera.quaternion.premultiply(q)
    camera.rotateX(state.pitch)
    if (Math.abs(camera.fov - state.fov) > 0.01) {
      camera.fov = state.fov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
