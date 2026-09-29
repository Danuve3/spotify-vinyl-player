import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'

// Three canvases hung above the sideboard on the back wall, in slim black
// float frames. Lit in real time by the lamp (the wall itself is baked), with
// a soft painted shadow behind each one.

const ART_URL = `${import.meta.env.BASE_URL}art/`
const WALL_Z = -0.3 // back wall, three.js coordinates
const CENTRE_Y = 1.6
const HEIGHT = 0.66
const GAP = 0.13
const DEPTH = 0.03 // canvas stretcher
const FRAME = 0.016 // frame moulding width
const SHADOW_GAP = 0.008 // float gap between canvas and frame

const ART = [
  { file: 'cobain.webp', aspect: 425 / 600, height: HEIGHT },
  { file: 'winehouse.webp', aspect: 966 / 725, height: HEIGHT },
  { file: 'bowie.webp', aspect: 736 / 981, height: HEIGHT },
]

function shadowTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.filter = 'blur(10px)'
  ctx.fillStyle = '#000'
  ctx.fillRect(24, 24, size - 48, size - 48)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function Painting({ map, width, height, x }: { map: THREE.Texture; width: number; height: number; x: number }) {
  const shared = useMemo(
    () => ({
      frame: new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.45, metalness: 0.25 }),
      edge: new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.9 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.55, depthWrite: false }),
    }),
    [],
  )
  const canvas = useMemo(() => {
    const front = new THREE.MeshStandardMaterial({ map, roughness: 0.78 })
    // Box faces: +x, -x, +y, -y, +z (front), -z
    return [shared.edge, shared.edge, shared.edge, shared.edge, front, shared.edge]
  }, [map, shared])

  const outerW = width + 2 * (SHADOW_GAP + FRAME)
  const outerH = height + 2 * (SHADOW_GAP + FRAME)
  const fd = DEPTH + 0.012 // frame stands a little proud of the canvas
  const bars: [number, number, number, number][] = [
    [0, (outerH - FRAME) / 2, outerW, FRAME],
    [0, -(outerH - FRAME) / 2, outerW, FRAME],
    [-(outerW - FRAME) / 2, 0, FRAME, outerH - 2 * FRAME],
    [(outerW - FRAME) / 2, 0, FRAME, outerH - 2 * FRAME],
  ]

  return (
    <group position={[x, CENTRE_Y, WALL_Z]}>
      <mesh position={[0.01, -0.025, 0.002]} material={shared.shadow}>
        <planeGeometry args={[outerW * 1.35, outerH * 1.3]} />
      </mesh>
      <mesh position={[0, 0, DEPTH / 2 + 0.004]} material={canvas} castShadow>
        <boxGeometry args={[width, height, DEPTH]} />
      </mesh>
      {bars.map(([bx, by, bw, bh], i) => (
        <mesh key={i} position={[bx, by, fd / 2 + 0.002]} material={shared.frame} castShadow>
          <boxGeometry args={[bw, bh, fd]} />
        </mesh>
      ))}
    </group>
  )
}

export function Paintings() {
  const maps = useTexture(ART.map((a) => ART_URL + a.file))
  const gl = useThree((s) => s.gl)
  useMemo(() => {
    for (const m of maps) {
      m.colorSpace = THREE.SRGBColorSpace
      m.anisotropy = gl.capabilities.getMaxAnisotropy()
    }
  }, [maps, gl])

  // Lay them out centred over the sideboard
  const widths = ART.map((a) => a.height * a.aspect)
  const total = widths.reduce((s, w) => s + w, 0) + GAP * (ART.length - 1)
  let x = -total / 2
  return (
    <>
      {ART.map((a, i) => {
        const cx = x + widths[i] / 2
        x += widths[i] + GAP
        return <Painting key={a.file} map={maps[i]} width={widths[i]} height={a.height} x={cx} />
      })}
    </>
  )
}
