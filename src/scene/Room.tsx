import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Turntable } from './Turntable'

interface Props {
  coverUrl: string | null
  spinning: boolean
}

export function Room({ coverUrl, spinning }: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.42, 0.55], fov: 38, near: 0.01, far: 20 }}
    >
      <color attach="background" args={['#120d0a']} />
      <fog attach="fog" args={['#120d0a', 1.2, 4]} />

      {/* Warm lamp key light + faint cool fill from the "window" */}
      <ambientLight intensity={0.08} color="#ffd9b0" />
      <spotLight
        position={[0.6, 1.2, 0.3]}
        angle={0.5}
        penumbra={0.8}
        intensity={6}
        color="#ffc98a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      />
      <pointLight position={[-1, 0.6, -0.8]} intensity={0.6} color="#7f9cff" />

      {/* Sideboard top */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[1.6, 0.04, 0.5]} />
        <meshStandardMaterial color="#4a2b17" roughness={0.55} />
      </mesh>

      <Suspense fallback={null}>
        <Turntable coverUrl={coverUrl} spinning={spinning} />
      </Suspense>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.6} scale={1.2} blur={2.5} far={0.3} />

      <OrbitControls
        target={[0, 0.08, 0]}
        enablePan={false}
        minDistance={0.3}
        maxDistance={1.2}
        maxPolarAngle={Math.PI / 2.2}
      />

      <EffectComposer>
        <Bloom intensity={0.25} luminanceThreshold={0.8} mipmapBlur />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  )
}
