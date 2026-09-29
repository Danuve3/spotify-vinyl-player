import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDeck, type Focus } from '../deck/store'

// Seated viewer: fixed viewpoints per focus, eased transitions, and a
// limited free look that follows the pointer.

interface Pose {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

// three.js coordinates (Blender X, Z, -Y)
const POSES: Record<Focus, Pose> = {
  room: { pos: new THREE.Vector3(0.3, 1.22, 1.9), target: new THREE.Vector3(0.05, 0.98, 0), fov: 54 },
  deck: { pos: new THREE.Vector3(0.36, 1.1, 0.46), target: new THREE.Vector3(0.3, 0.7, 0.0), fov: 42 },
  crate: { pos: new THREE.Vector3(-0.55, 1.08, 0.62), target: new THREE.Vector3(-0.78, 0.8, 0.02), fov: 42 },
  // Standing by the glass wall, looking out over the skyline
  window: { pos: new THREE.Vector3(1.25, 1.52, 1.6), target: new THREE.Vector3(2.6, 1.4, 1.35), fov: 58 },
  // In front of the armchair, with the lamp behind it
  chair: { pos: new THREE.Vector3(0.35, 1.3, 2.45), target: new THREE.Vector3(-1.1, 0.6, 1.45), fov: 55 },
}

// Wheel zoom: some views ease continuously from their close pose to a wider
// one that shows more of the room
const WIDE: Partial<Record<Focus, Pose>> = {
  // Back from the glass: skyline, sideboard with the deck and the room
  window: { pos: new THREE.Vector3(-0.75, 1.5, 3.1), target: new THREE.Vector3(1.3, 1.0, 0.6), fov: 64 },
  // From the glass corner: armchair, lamp and sideboard
  chair: { pos: new THREE.Vector3(1.6, 1.45, 3.1), target: new THREE.Vector3(-0.9, 0.75, 0.9), fov: 62 },
}
const ZOOM_PER_PIXEL = 0.0015

const LOOK_YAW = 0.35 // radians of free look either side
const LOOK_PITCH = 0.18

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const pointer = useThree((s) => s.pointer)
  const state = useMemo(() => ({ pos: POSES.room.pos.clone(), target: POSES.room.target.clone(), fov: 50, yaw: 0, pitch: 0 }), [])
  // Zoom-out amount per view (0 close, 1 wide), kept while switching views
  const zoom = useMemo<Partial<Record<Focus, number>>>(() => ({}), [])
  const blend = useMemo<Pose>(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }), [])

  // Wheel outside the crate toggles between the room and the deck
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const { focus, setFocus } = useDeck.getState()
      if (focus === 'crate') return
      if (WIDE[focus]) {
        const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
        zoom[focus] = THREE.MathUtils.clamp((zoom[focus] ?? 0) + px * ZOOM_PER_PIXEL, 0, 1)
        return
      }
      setFocus(e.deltaY < 0 ? 'deck' : 'room')
    }
    const onKey = (e: KeyboardEvent) => {
      const { setFocus, flipVinyl } = useDeck.getState()
      if (e.key === '1') setFocus('room')
      if (e.key === '2') setFocus('deck')
      if (e.key === '3') setFocus('crate')
      if (e.key === '4') setFocus('window')
      if (e.key === '5') setFocus('chair')
      if (e.key.toLowerCase() === 'f') flipVinyl()
      if (e.key === 'Escape') setFocus('room')
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [zoom])

  const dir = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])

  useFrame((_, dt) => {
    const focus = useDeck.getState().focus
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
    state.yaw = THREE.MathUtils.damp(state.yaw, -edge(pointer.x) * LOOK_YAW, 2, dt)
    state.pitch = THREE.MathUtils.damp(state.pitch, edge(pointer.y) * LOOK_PITCH, 2, dt)

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
