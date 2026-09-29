import { useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Album } from '../spotify/api'
import { useDeck } from '../deck/store'
import { coverTexture, finishSleeve } from '../vinyl/sleeveTextures'

// Records standing in the teak crate. Scroll flips through them; the record
// under the pointer rises a little; clicking takes it to the deck.

const RECORD_URL = `${import.meta.env.BASE_URL}models/record.glb`
const ROOM_URL = `${import.meta.env.BASE_URL}models/room.glb`
const MAX_RECORDS = 36
const SPACING = 0.0085

interface Props {
  albums: Album[]
}

export function Crate({ albums }: Props) {
  const record = useGLTF(RECORD_URL)
  const room = useGLTF(ROOM_URL)
  const focus = useDeck((s) => s.focus)
  const current = useDeck((s) => s.album)
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const group = useRef<THREE.Group>(null)

  // Slot origin (front of the crate, on its floor), set in Blender
  const origin = useMemo(() => {
    const slots = room.scene.getObjectByName('Crate_Slots')!
    return slots.getWorldPosition(new THREE.Vector3())
  }, [room.scene])

  const shown = albums.filter((a) => a.id !== current?.id).slice(0, MAX_RECORDS)

  // One sleeve per album: clones share geometry, only the front artwork differs.
  // The sleeve is multi-material, so glTF gives us a group of meshes.
  const sleeves = useMemo(() => {
    const template = record.scene.getObjectByName('Sleeve')!
    return shown.map((album) => {
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
      clone.rotation.set(0, 0, 0)
      clone.visible = true // the deck hides the template while no album is picked
      return { album, object: clone }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((a) => a.id).join(), record.scene])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    g.children.forEach((child, i) => {
      // Records before the cursor lean forward, the rest lean back against them
      const lean = i < cursor ? 0.55 : -0.12
      const lift = i === hover ? 0.05 : 0
      child.rotation.x = THREE.MathUtils.damp(child.rotation.x, Math.PI / 2 - lean, 8, dt)
      child.position.y = THREE.MathUtils.damp(child.position.y, origin.y + 0.157 + lift, 10, dt)
    })
  })

  const onWheel = (e: ThreeEvent<WheelEvent>) => {
    if (focus !== 'crate') return
    e.stopPropagation()
    setCursor((c) => THREE.MathUtils.clamp(c + Math.sign(e.deltaY), 0, Math.max(0, shown.length - 1)))
  }

  const pick = (e: ThreeEvent<MouseEvent>, album: Album) => {
    e.stopPropagation()
    const deck = useDeck.getState()
    if (deck.focus !== 'crate') return deck.setFocus('crate')
    deck.pickAlbum(album)
  }

  return (
    <group ref={group} onWheel={onWheel}>
      {sleeves.map(({ album, object }, i) => (
        <primitive
          key={album.id}
          object={object}
          position={[origin.x, origin.y + 0.157, origin.z - i * SPACING]}
          rotation={[Math.PI / 2, 0, 0]}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation()
            setHover(i)
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            setHover((h) => (h === i ? null : h))
            document.body.style.cursor = ''
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => pick(e, album)}
        />
      ))}
    </group>
  )
}
