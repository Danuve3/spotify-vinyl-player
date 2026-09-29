import { useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

// A pair of Bang & Olufsen BeoLab 18 (natural aluminium, oak lamellas) at
// either end of the glass wall, toed in towards the room. Proportions from the
// published spec: 20 x 132.4 x 20 cm on the floor stand, 19 wooden lamellas.
// Lit in real time; a soft painted shadow grounds them on the baked floor.

const BASE_H = 0.022
const CONE_H = 0.3
const BODY_H = 0.94
const BODY_W = 0.13 // aluminium core behind the lamellas
const BODY_D = 0.11
const LAMELLAS = 19
const FAN = 1.4 // rad either side of the front the lamellas wrap round to
const LISTEN = new THREE.Vector2(-0.7, 1.6) // where they point (x, z)

// In the corners either side of the glass wall (x 2.2, z -0.3 .. 3.4)
const PLACES: [number, number][] = [
  [1.95, 0.0],
  [1.95, 3.1],
]

function oakTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 1024
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c49c6c'
  ctx.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 26; i++) {
    const x0 = Math.random() * c.width
    ctx.strokeStyle = `rgba(${110 + Math.random() * 40}, ${72 + Math.random() * 25}, 38, ${0.15 + Math.random() * 0.3})`
    ctx.lineWidth = 0.4 + Math.random()
    ctx.beginPath()
    for (let y = 0; y <= c.height; y += 32) ctx.lineTo(x0 + Math.sin(y / 140 + i) * 1.5, y)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function softShadow() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.45)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function useSpeakerParts() {
  return useMemo(() => {
    const alu = new THREE.MeshStandardMaterial({ color: '#c8cbcf', metalness: 1, roughness: 0.36 })
    const aluDark = new THREE.MeshStandardMaterial({ color: '#5d6065', metalness: 0.9, roughness: 0.45 })
    const oak = new THREE.MeshStandardMaterial({ map: oakTexture(), roughness: 0.62 })
    const black = new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.55, metalness: 0.2 })
    const shadow = new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, opacity: 0.75, depthWrite: false })

    // Lamellas fan round the front of the column on an ellipse
    const slat = new THREE.BoxGeometry(0.0058, BODY_H, 0.021)
    const lamellas = new THREE.InstancedMesh(slat, oak, LAMELLAS)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < LAMELLAS; i++) {
      const phi = -FAN + (2 * FAN * i) / (LAMELLAS - 1)
      q.setFromAxisAngle(up, phi)
      m.compose(new THREE.Vector3(0.068 * Math.sin(phi), 0, 0.058 * Math.cos(phi) + 0.004), q, new THREE.Vector3(1, 1, 1))
      lamellas.setMatrixAt(i, m)
    }
    lamellas.castShadow = true
    return { alu, aluDark, black, shadow, lamellas }
  }, [])
}

function BeoLab18({ position, yaw, parts }: { position: [number, number]; yaw: number; parts: ReturnType<typeof useSpeakerParts> }) {
  const lamellas = useMemo(() => parts.lamellas.clone(), [parts])
  const bodyY = BASE_H + CONE_H + BODY_H / 2
  const top = BASE_H + CONE_H + BODY_H

  return (
    <group position={[position[0], 0, position[1]]} rotation-y={yaw}>
      <mesh position={[0, 0.0015, 0]} rotation-x={-Math.PI / 2} material={parts.shadow}>
        <planeGeometry args={[0.46, 0.46]} />
      </mesh>
      {/* Square floor plate */}
      <RoundedBox args={[0.2, BASE_H, 0.2]} radius={0.004} smoothness={3} position={[0, BASE_H / 2, 0]} material={parts.black} castShadow />
      {/* Pointed aluminium cone the column balances on */}
      <mesh position={[0, BASE_H + CONE_H / 2, 0]} material={parts.alu} castShadow>
        <cylinderGeometry args={[0.027, 0.004, CONE_H, 48]} />
      </mesh>
      {/* Column: aluminium core wrapped in oak lamellas */}
      <RoundedBox args={[BODY_W, BODY_H, BODY_D]} radius={0.02} smoothness={4} position={[0, bodyY, -0.004]} material={parts.aluDark} castShadow />
      <primitive object={lamellas} position={[0, bodyY, 0]} />
      <mesh position={[0, BASE_H + CONE_H + 0.004, -0.004]} material={parts.alu}>
        <boxGeometry args={[BODY_W + 0.012, 0.008, BODY_D + 0.018]} />
      </mesh>
      <mesh position={[0, top - 0.004, -0.004]} material={parts.alu}>
        <boxGeometry args={[BODY_W + 0.012, 0.008, BODY_D + 0.018]} />
      </mesh>
      {/* Acoustic lens: neck, reflector cone and cap */}
      <mesh position={[0, top + 0.012, 0]} material={parts.alu}>
        <cylinderGeometry args={[0.02, 0.024, 0.024, 40]} />
      </mesh>
      <mesh position={[0, top + 0.034, 0]} material={parts.alu}>
        <cylinderGeometry args={[0.043, 0.006, 0.022, 48]} />
      </mesh>
      <mesh position={[0, top + 0.047, 0]} material={parts.alu} castShadow>
        <cylinderGeometry args={[0.047, 0.047, 0.005, 48]} />
      </mesh>
    </group>
  )
}

export function Speakers() {
  const parts = useSpeakerParts()
  return (
    <>
      {PLACES.map(([x, z]) => (
        <BeoLab18 key={z} position={[x, z]} yaw={Math.atan2(LISTEN.x - x, LISTEN.y - z)} parts={parts} />
      ))}
    </>
  )
}
