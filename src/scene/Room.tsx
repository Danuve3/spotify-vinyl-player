import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor, useGLTF, useProgress } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { Album } from '../spotify/api'
import { Deck } from './Deck'
import { Crate } from './Crate'
import { CameraRig } from './CameraRig'
import { useQuality } from './quality'
import { City } from './city/City'
import { Paintings } from './Paintings'

// The living room: static geometry uses light baked in Blender (unlit
// materials + lightmaps), while the deck and records are lit in real time
// by the lamp and moonlight so they react as they move.

const ROOM_URL = `${import.meta.env.BASE_URL}models/room.glb`

// Colour tweaks made with shader nodes in Blender that glTF cannot carry.
// Values are linear RGB, as in Blender. `flat` drops the texture entirely.
const TINTS: Record<string, { rgb: [number, number, number]; flat?: boolean }> = {
  plastered_wall_04: { rgb: [0.62, 0.5, 0.4], flat: true }, // warm painted plaster
  wool_boucle: { rgb: [0.75, 0.32, 0.18] }, // rust rug
  oak_veneer_02: { rgb: [0.78, 0.48, 0.28] }, // oiled teak crate
}
const LIGHTMAP_URL = `${import.meta.env.BASE_URL}models/lightmaps/`

function StaticRoom() {
  const { scene } = useGLTF(ROOM_URL)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const lightmaps = new Map<string, THREE.Texture>()
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.receiveShadow = true
      // Multi-material objects become a group of meshes: the extras live on the parent
      let holder: THREE.Object3D | null = mesh
      while (holder && holder.userData.lightmap === undefined) holder = holder.parent
      const baked = holder?.userData.lightmap as string | undefined
      const bakedScale = Number(holder?.userData.lightmap_scale ?? 1)
      const swap = (m: THREE.Material) => {
        const std = m as THREE.MeshStandardMaterial
        if (!baked) return m
        // Baked surfaces: albedo x irradiance, no runtime lighting cost
        const basic = new THREE.MeshBasicMaterial({
          name: std.name,
          map: std.map,
          color: std.map ? new THREE.Color('#ffffff') : std.color,
          transparent: std.transparent,
          side: std.side,
        })
        let lm = lightmaps.get(baked)
        if (!lm) {
          lm = loader.load(`${LIGHTMAP_URL}${baked.replace(/\.png$/, '.webp')}`)
          lm.channel = 1
          lm.flipY = false
          lm.colorSpace = THREE.SRGBColorSpace
          lm.anisotropy = gl.capabilities.getMaxAnisotropy()
          lightmaps.set(baked, lm)
        }
        const tint = TINTS[std.name]
        if (tint) {
          basic.color.setRGB(...tint.rgb, THREE.LinearSRGBColorSpace)
          if (tint.flat) basic.map = null
        }
        basic.lightMap = lm
        basic.lightMapIntensity = bakedScale * Math.PI
        return basic
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
      // Bake-only light source in older exports; the city replaces it
      if (mesh.name === 'Night_Backdrop') mesh.visible = false
      if (mesh.name === 'Window_Glass') {
        // Floor-to-ceiling glazing: a faint tint plus reflections of the room
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: '#0c1116',
          transparent: true,
          opacity: 0.16,
          roughness: 0.03,
          envMapIntensity: 2.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      }
      // Emissive surfaces (lamp shade, bulb, night sky) glow for the bloom pass
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        if (std.emissive && std.emissiveIntensity > 0 && std.emissive.getHex() !== 0) std.toneMapped = false
      }
    })
  }, [scene, gl])

  return <primitive object={scene} />
}

function Lights({ shadows }: { shadows: boolean }) {
  return (
    <>
      {/* Lamp bulb (2700 K) — matches the baked light for dynamic objects */}
      <pointLight
        position={[-1.62, 1.45, 0.05]}
        intensity={6}
        distance={6}
        decay={2}
        color="#ffae5c"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-radius={6}
      />
      {/* Moonlight and city glow through the glass wall */}
      <directionalLight position={[3.5, 1.8, 1.2]} intensity={0.3} color="#8fb0ff" />
      <ambientLight intensity={0.04} color="#ffd6a8" />
      {/* Reflections for the metal and vinyl: warm lamp blob + cool window */}
      <Environment resolution={128} frames={1}>
        <color attach="background" args={['#0a0706']} />
        <Lightformer form="circle" intensity={4} color="#ffb070" position={[-1.6, 1.5, 0]} scale={0.6} />
        <Lightformer form="rect" intensity={0.9} color="#8f8cb8" position={[2.3, 1.3, 1.55]} rotation-y={-Math.PI / 2} scale={[3.7, 2.6, 1]} />
        <Lightformer form="rect" intensity={0.15} color="#ffe2c0" position={[0, 2.6, 0.5]} rotation-x={Math.PI / 2} scale={[3, 3, 1]} />
      </Environment>
    </>
  )
}

// Dev-only handle for automated checks (scene graph, camera, renderer info)
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __r3f: unknown }).__r3f = state
  }, [state])
  return null
}

function Loader() {
  const { progress, active } = useProgress()
  if (!active) return null
  return (
    <div className="loader">
      <span>Preparando la habitación… {Math.round(progress)}%</span>
    </div>
  )
}

interface Props {
  albums: Album[]
}

export function Room({ albums }: Props) {
  const quality = useQuality()
  const dpr = useMemo<[number, number]>(() => [1, quality.maxDpr], [quality.maxDpr])

  return (
    <>
      <Canvas
        shadows={quality.shadows ? 'soft' : false}
        dpr={dpr}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.1 }}
        camera={{ position: [0.25, 1.12, 1.05], fov: 50, near: 0.02, far: 200 }}
      >
        <color attach="background" args={['#050403']} />
        <PerformanceMonitor onDecline={quality.decline} onIncline={quality.incline} flipflops={4} />
        <AdaptiveDpr pixelated={false} />
        <CameraRig />
        <DevHandle />
        <Lights shadows={quality.shadows} />
        <City />
        <Suspense fallback={null}>
          <StaticRoom />
          <Paintings />
          <Deck />
          <Crate albums={albums} />
        </Suspense>
        {quality.post && (
          <EffectComposer multisampling={quality.msaa}>
            {quality.ao ? <N8AO aoRadius={0.3} intensity={1.5} distanceFalloff={0.5} halfRes /> : <></>}
            <Bloom intensity={0.45} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />
            <Vignette offset={0.3} darkness={0.7} />
          </EffectComposer>
        )}
      </Canvas>
      <Loader />
    </>
  )
}

useGLTF.preload(ROOM_URL)
