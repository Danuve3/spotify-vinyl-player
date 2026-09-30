import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { create } from 'zustand'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Album } from '../spotify/api'
import { useDeck } from '../deck/store'
import { coverTexture, finishSleeve, thickenSleeve } from '../vinyl/sleeveTextures'
import { deckAudio } from '../audio/deckAudio'
import { STAND_SLEEVE } from './SleeveStand'

// Records standing in the teak crate, browsed like in a record shop: the
// wheel, a drag or the arrow keys stand the current record up and move on to
// the next one, reclined behind it; the current record rises to show its cover. Clicking it (or Enter) takes it to
// the deck; clicking another record brings that one to the front.

const RECORD_URL = `${import.meta.env.BASE_URL}models/record.glb`
const ROOM_URL = `${import.meta.env.BASE_URL}models/room.glb`
const MAX_RECORDS = 24
const SPACING = 0.0085
const FRONT_LIFT = 0.12 // m: the record at the front rises to show its cover
const FLIP_LEAN = 0.5 // rad: records behind the current one recline up to this much...
// ...as far as the rear lip lets the last one lean (measured from the slot origin)
const BACK_DEPTH = 0.28 // m to the inside of the back wall
const LIP_HEIGHT = 0.228 // m above the crate floor
const HALF = 0.157 // half the sleeve's height: records tip on their bottom edge
const DRAG_STEP_PX = 36 // drag this far to flip one record
const HOVER_LIFT = 0.15 // m more with the pointer on it, to see (almost) all the cover
/** The record leaving the stand flies back this long (the deck waits for it). */
export const RETURN_FLIGHT_S = 1

/** The record at the front of the crate, for the caption. */
export const useCrateFront = create<{ album: Album | null }>(() => ({ album: null }))

const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement

interface Props {
  albums: Album[]
}

export function Crate({ albums }: Props) {
  const record = useGLTF(RECORD_URL)
  const room = useGLTF(ROOM_URL)
  const focus = useDeck((s) => s.focus)
  const current = useDeck((s) => s.album)
  const [cursor, setCursor] = useState(0)
  const group = useRef<THREE.Group>(null)
  const drag = useRef<{ y: number; moved: boolean } | null>(null)
  const hovered = useRef<number | null>(null)

  // Slot origin (front of the crate, on its floor), set in Blender
  const origin = useMemo(() => {
    const slots = room.scene.getObjectByName('Crate_Slots')!
    return slots.getWorldPosition(new THREE.Vector3())
  }, [room.scene])

  const shown = albums.filter((a) => a.id !== current?.id).slice(0, MAX_RECORDS)
  const front = Math.min(cursor, Math.max(0, shown.length - 1))
  const browsing = focus === 'crate' || focus === 'both'
  // The reclined pack leans in parallel until the last record rests on the rear lip
  const packLean = THREE.MathUtils.clamp(
    Math.atan((BACK_DEPTH - (shown.length - 1) * SPACING - 0.006) / LIP_HEIGHT),
    0,
    FLIP_LEAN,
  )
  const flip = (step: number) => setCursor((c) => THREE.MathUtils.clamp(c + step, 0, Math.max(0, shown.length - 1)))

  // One sleeve per album: clones share geometry, only the front artwork differs.
  // The sleeve is multi-material, so glTF gives us a group of meshes. Built
  // once per album and kept, so picking a record does not rebuild the crate.
  const cache = useMemo(() => new Map<string, THREE.Object3D>(), [])
  const sleeves = useMemo(() => {
    const template = record.scene.getObjectByName('Sleeve')!
    return shown.map((album) => {
      const cached = cache.get(album.id)
      if (cached) return { album, object: cached }
      const clone = template.clone(true)
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = mesh.receiveShadow = true
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.name === 'Sleeve_Front') {
          const front = mat.clone()
          finishSleeve(front, coverTexture(album.coverUrl))
          mesh.material = front
        }
      })
      clone.position.set(0, 0, 0)
      thickenSleeve(clone)
      clone.rotation.set(0, 0, 0)
      clone.visible = true // the deck hides the template while no album is picked
      cache.set(album.id, clone)
      return { album, object: clone }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((a) => a.id).join(), record.scene, cache])

  // A record leaving the stand (another one picked, or put back) flies from
  // the stand back into its slot, like the pick flight in reverse
  const returning = useRef(new Map<string, { t: number; duration: number; waited: number }>())
  const lastOnStand = useRef<string | null>(current?.id ?? null)
  const flight = useMemo(
    () => ({
      from: STAND_SLEEVE.position.clone(),
      fromQ: new THREE.Quaternion().setFromEuler(STAND_SLEEVE.rotation),
      to: new THREE.Vector3(),
      toQ: new THREE.Quaternion(),
      mid: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      e: new THREE.Euler(),
    }),
    [],
  )

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const onStand = useDeck.getState().album?.id ?? null
    if (onStand !== lastOnStand.current) {
      const left = lastOnStand.current
      lastOnStand.current = onStand
      if (left) {
        returning.current.set(left, { t: 0, duration: RETURN_FLIGHT_S, waited: 0 })
      }
    }
    g.children.forEach((child, i) => {
      // Records still to see recline back over the rear lip (in parallel, so
      // they never cross), those already seen stand upright in front, and the
      // current one rises out of the crate. (tilt > 0: top edge away from the viewer)
      const lean = i > front ? packLean : 0
      const lift = i === front && browsing ? FRONT_LIFT + (hovered.current === i ? HOVER_LIFT : 0) : 0
      const fl = returning.current.get(sleeves[i]?.album.id ?? '')
      if (fl) {
        // Up off the stand, over and down into the slot at its resting pose
        fl.t = Math.min(1, fl.t + dt / fl.duration)
        const tilt = lean
        flight.to.set(origin.x, origin.y + HALF * Math.cos(tilt) + lift, origin.z - i * SPACING - HALF * Math.sin(tilt))
        flight.toQ.setFromEuler(flight.e.set(Math.PI / 2 - lean, 0, 0))
        const e = THREE.MathUtils.smootherstep(fl.t, 0, 1)
        flight.mid.lerpVectors(flight.from, flight.to, 0.5).y += 0.14 + flight.from.distanceTo(flight.to) * 0.12
        flight.a.lerpVectors(flight.from, flight.mid, e)
        flight.b.lerpVectors(flight.mid, flight.to, e)
        child.position.lerpVectors(flight.a, flight.b, e)
        child.quaternion.slerpQuaternions(flight.fromQ, flight.toQ, THREE.MathUtils.smootherstep(fl.t, 0.05, 0.85))
        if (fl.t >= 1) {
          returning.current.delete(sleeves[i].album.id)
          deckAudio().sleeveSlide(0.16, true) // drops into its place
        }
        return
      }
      child.rotation.x = THREE.MathUtils.damp(child.rotation.x, Math.PI / 2 - lean, 8, dt)
      const tilt = Math.PI / 2 - child.rotation.x
      child.position.y = THREE.MathUtils.damp(child.position.y, origin.y + HALF * Math.cos(tilt) + lift, 10, dt)
      child.position.z = origin.z - i * SPACING - HALF * Math.sin(tilt)
    })
    // Records that do not go back into the crate (beyond the ones it shows)
    for (const [id, fl] of returning.current) {
      if (fl.t === 0 && ++fl.waited > 30) returning.current.delete(id)
    }
  })

  // Caption with the record at the front, while browsing
  const frontAlbum = browsing ? (shown[front] ?? null) : null
  useEffect(() => useCrateFront.setState({ album: frontAlbum }), [frontAlbum])

  const onWheel = (e: ThreeEvent<WheelEvent>) => {
    if (!browsing) return
    e.stopPropagation()
    flip(Math.sign(e.deltaY))
  }

  // Drag up/down or sideways over the crate: one record per step
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!browsing) return
    drag.current = { y: e.clientX + e.clientY, moved: false }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const steps = Math.trunc((e.clientX + e.clientY - d.y) / DRAG_STEP_PX)
      if (steps === 0) return
      d.y += steps * DRAG_STEP_PX
      d.moved = true
      flip(steps)
    }
    const up = () => setTimeout(() => (drag.current = null)) // after the click it may cause
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length])

  // Arrow keys flip, Enter takes the front record
  const frontRef = useRef<{ album: Album; object: THREE.Object3D } | null>(null)
  useEffect(() => {
    if (!browsing) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') flip(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') flip(-1)
      else if (e.key === 'Enter' && frontRef.current) take(frontRef.current.album, frontRef.current.object)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, shown.length])

  const pick = (e: ThreeEvent<MouseEvent>, i: number, album: Album, object: THREE.Object3D) => {
    e.stopPropagation()
    if (drag.current?.moved) return
    const deck = useDeck.getState()
    // First click brings the crate into view (where it is already in view, it just picks)
    if (deck.focus !== 'crate' && deck.focus !== 'both' && deck.focus !== 'free') return deck.followFocus('crate')
    // A record further in comes to the front first
    if (browsing && i !== front) return setCursor(i)
    take(album, object)
  }

  const take = (album: Album, object: THREE.Object3D) => {
    const deck = useDeck.getState()
    // The deck lifts this very sleeve out of the crate and onto the stand
    const pos = object.getWorldPosition(new THREE.Vector3())
    const quat = object.getWorldQuaternion(new THREE.Quaternion())
    deck.pickAlbum(album, { pos: pos.toArray(), quat: quat.toArray() as [number, number, number, number], watch: true })
  }

  return (
    <group ref={group} onWheel={onWheel} onPointerDown={onDown}>
      {sleeves.map(({ album, object }, i) => {
        if (i === front) frontRef.current = { album, object }
        return (
        <primitive
          key={album.id}
          object={object}
          position={[origin.x, origin.y + HALF, origin.z - i * SPACING]}
          rotation={[Math.PI / 2, 0, 0]}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation()
            hovered.current = i
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            if (hovered.current === i) hovered.current = null
            document.body.style.cursor = ''
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => pick(e, i, album, object)}
        />
        )
      })}
    </group>
  )
}
