import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'

// Placeholder turntable until the Blender model lands (phase 2).
// Units are metres, roughly matching a real mid-century deck.

const RPM_33 = (33.333 / 60) * Math.PI * 2

interface Props {
  coverUrl: string | null
  spinning: boolean
}

function Label({ coverUrl }: { coverUrl: string }) {
  const texture = useTexture(coverUrl)
  texture.colorSpace = THREE.SRGBColorSpace
  return (
    <mesh position={[0, 0.0012, 0]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[0.05, 64]} />
      <meshStandardMaterial map={texture} roughness={0.6} />
    </mesh>
  )
}

export function Turntable({ coverUrl, spinning }: Props) {
  const platter = useRef<THREE.Group>(null)
  const speed = useRef(0)

  useFrame((_, dt) => {
    // Ease in/out like a real belt-driven platter instead of snapping.
    const target = spinning ? RPM_33 : 0
    speed.current = THREE.MathUtils.damp(speed.current, target, 1.5, dt)
    if (platter.current) platter.current.rotation.y -= speed.current * dt
  })

  return (
    <group>
      {/* Plinth */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.08, 0.36]} />
        <meshStandardMaterial color="#6b3f22" roughness={0.45} />
      </mesh>
      {/* Top plate */}
      <mesh position={[0, 0.0815, 0]} receiveShadow>
        <boxGeometry args={[0.44, 0.003, 0.34]} />
        <meshStandardMaterial color="#c9c5bc" metalness={0.6} roughness={0.35} />
      </mesh>

      <group ref={platter} position={[-0.04, 0.083, 0]}>
        <mesh position={[0, 0.008, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.016, 96]} />
          <meshStandardMaterial color="#9a9a9a" metalness={0.9} roughness={0.25} />
        </mesh>
        {coverUrl && (
          <group position={[0, 0.0165, 0]}>
            <mesh rotation-x={-Math.PI / 2} castShadow>
              <ringGeometry args={[0.0036, 0.1515, 128]} />
              <meshPhysicalMaterial
                color="#0c0c0c"
                roughness={0.28}
                clearcoat={1}
                clearcoatRoughness={0.2}
              />
            </mesh>
            <Label coverUrl={coverUrl} />
          </group>
        )}
        {/* Spindle */}
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.0036, 0.0036, 0.03, 16]} />
          <meshStandardMaterial color="#ddd" metalness={1} roughness={0.2} />
        </mesh>
      </group>

      {/* Tonearm: pivot, arm, headshell */}
      <group position={[0.17, 0.083, -0.12]} rotation-y={spinning ? 0.42 : 0}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.018, 0.022, 0.04, 32]} />
          <meshStandardMaterial color="#b8b8b8" metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[-0.02, 0.045, 0.11]} rotation-x={Math.PI / 2} rotation-z={0.18}>
          <cylinderGeometry args={[0.004, 0.004, 0.23, 16]} />
          <meshStandardMaterial color="#d0d0d0" metalness={1} roughness={0.2} />
        </mesh>
        <mesh position={[-0.045, 0.043, 0.225]}>
          <boxGeometry args={[0.018, 0.01, 0.035]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}
