import { useMemo } from 'react'
import * as THREE from 'three'

// "Now playing" stand to the left of the deck: an oak block with a groove
// that holds the current album's sleeve upright, leaning back a little. The
// sleeve itself belongs to the record set in Deck; it is placed with STAND_SLEEVE.

const CABINET_TOP = 0.68
// Far enough left that a record can slide right out before reaching the deck
const BASE = { x: -0.35, z: -0.05, w: 0.3, h: 0.024, d: 0.075 }
const GROOVE_Z = BASE.z + 0.01
const GROOVE_DEPTH = 0.01
const SLEEVE_HALF = 0.157
export const STAND_LEAN = 0.17 // rad, top of the sleeve leans towards the wall
export const STAND_YAW = 0.28 // rad, turned on the cabinet to face into the room

const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), STAND_YAW)
/** A direction in the stand's own frame (x along the groove) to world space. */
export const standDirection = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(yaw)

// Sleeve centre and rotation (three.js coordinates): the flat Blender sleeve,
// stood up about X so its front faces the room and its open edge points +X,
// towards the deck; then the whole stand is turned by STAND_YAW
export const STAND_SLEEVE = {
  position: new THREE.Vector3(BASE.x, CABINET_TOP, BASE.z).add(
    standDirection(
      0,
      BASE.h - GROOVE_DEPTH + SLEEVE_HALF * Math.cos(STAND_LEAN),
      GROOVE_Z - BASE.z - SLEEVE_HALF * Math.sin(STAND_LEAN),
    ),
  ),
  rotation: new THREE.Euler(Math.PI / 2 - STAND_LEAN, STAND_YAW, 0, 'YXZ'),
}

function oakTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#b48a58'
  ctx.fillRect(0, 0, c.width, c.height)
  // Long grain lines with a little waviness
  for (let i = 0; i < 70; i++) {
    const y0 = Math.random() * c.height
    ctx.strokeStyle = `rgba(${90 + Math.random() * 40}, ${58 + Math.random() * 25}, 30, ${0.12 + Math.random() * 0.25})`
    ctx.lineWidth = 0.5 + Math.random() * 1.2
    ctx.beginPath()
    for (let x = 0; x <= c.width; x += 16) ctx.lineTo(x, y0 + Math.sin(x / 90 + i) * 2)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function plaqueTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c29a55'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#3a2a14'
  ctx.font = '600 34px "DM Mono", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.letterSpacing = '10px'
  ctx.fillText('NOW PLAYING', c.width / 2, c.height / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function softShadow() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.filter = 'blur(9px)'
  ctx.fillStyle = '#000'
  ctx.fillRect(22, 40, 84, 48)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function SleeveStand() {
  const mats = useMemo(
    () => ({
      oak: new THREE.MeshStandardMaterial({ map: oakTexture(), roughness: 0.55 }),
      groove: new THREE.MeshStandardMaterial({ color: '#1b120a', roughness: 0.9 }),
      plaque: new THREE.MeshStandardMaterial({ map: plaqueTexture(), metalness: 0.85, roughness: 0.32 }),
      shadow: new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, opacity: 0.6, depthWrite: false }),
    }),
    [],
  )

  return (
    <group position={[BASE.x, CABINET_TOP, BASE.z]} rotation-y={STAND_YAW}>
      <mesh position={[0, 0.0012, 0]} rotation-x={-Math.PI / 2} material={mats.shadow}>
        <planeGeometry args={[BASE.w * 1.5, BASE.d * 2.6]} />
      </mesh>
      <mesh position={[0, BASE.h / 2, 0]} material={mats.oak} castShadow receiveShadow>
        <boxGeometry args={[BASE.w, BASE.h, BASE.d]} />
      </mesh>
      {/* Groove the sleeve sits in */}
      <mesh position={[0, BASE.h + 0.0002, GROOVE_Z - BASE.z]} material={mats.groove}>
        <boxGeometry args={[BASE.w - 0.012, 0.0006, 0.0065]} />
      </mesh>
      {/* Brass plaque on the front face */}
      <mesh position={[0, BASE.h / 2, BASE.d / 2 + 0.0008]} material={mats.plaque}>
        <boxGeometry args={[0.13, 0.013, 0.0012]} />
      </mesh>
    </group>
  )
}
