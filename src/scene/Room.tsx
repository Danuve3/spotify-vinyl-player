import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AdaptiveDpr, Environment, Lightformer, PerformanceMonitor, useGLTF, useProgress } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { Album } from '../spotify/api'
import { Deck } from './Deck'
import { Crate } from './Crate'
import { CameraRig } from './CameraRig'
import { useQuality } from './quality'
import './specularAA'
import { Landscape } from './landscape/Landscape'
import { Paintings } from './Paintings'
import { SleeveStand } from './SleeveStand'
import { Speakers } from './Speakers'
import { GlassReflection } from './GlassReflection'
import { Rain } from './Rain'
import { LampCord } from './LampCord'
import { Shelf } from './Shelf'
import { lampLevel, useLamp } from './lamp'
import { dayLevel, useDaytime } from './daytime'

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
// Daylight is baked from a much brighter window than the night; this brings
// it to a comfortable level indoors (the camera "adapts")
const DAY_EXPOSURE = 0.24
// Scale of the daylight bakes (blender/bake_day.py), until room.glb is
// exported again with them as extras
const DAY_SCALES: Record<string, number> = { 'arch.png': 9.9469, 'furn.png': 9.4355 }

// Baked surfaces carry three lightmaps: lamp on and lamp off at night (moon
// and city only), and daylight with the lamp off. The shader fades between
// night and day and adds the lamp's own share (on minus off) on top, so the
// lamp can be switched on by day too.
function blendLightmaps(
  mat: THREE.MeshBasicMaterial,
  off: THREE.Texture,
  offIntensity: number,
  day: THREE.Texture | null,
  dayIntensity: number,
) {
  mat.customProgramCacheKey = () => (day ? 'lamp-day-blend' : 'lamp-blend')
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.lightMapOff = { value: off }
    shader.uniforms.lightMapOffIntensity = { value: offIntensity }
    shader.uniforms.lightMapDay = { value: day ?? off }
    shader.uniforms.lightMapDayIntensity = { value: day ? dayIntensity : offIntensity }
    shader.uniforms.uLamp = lampLevel
    shader.uniforms.uDay = dayLevel
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform sampler2D lightMapOff;\nuniform float lightMapOffIntensity;\nuniform sampler2D lightMapDay;\nuniform float lightMapDayIntensity;\nuniform float uLamp;\nuniform float uDay;\nvoid main() {',
      )
      .replace(
        'reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;',
        `vec3 lampOff = texture2D( lightMapOff, vLightMapUv ).rgb * lightMapOffIntensity;
        vec3 lampOn = lightMapTexel.rgb * lightMapIntensity;
        vec3 daylight = texture2D( lightMapDay, vLightMapUv ).rgb * lightMapDayIntensity;
        vec3 lamp = max( lampOn - lampOff, vec3( 0.0 ) );
        reflectedLight.indirectDiffuse += ( mix( lampOff, daylight, uDay ) + lamp * uLamp ) * RECIPROCAL_PI;`,
      )
  }
}

function StaticRoom() {
  const { scene } = useGLTF(ROOM_URL)
  const gl = useThree((s) => s.gl)
  const glowing = useRef<{ mat: THREE.MeshStandardMaterial; base: number }[]>([])

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const lightmaps = new Map<string, THREE.Texture>()
    const loadLightmap = (file: string) => {
      let lm = lightmaps.get(file)
      if (!lm) {
        lm = loader.load(`${LIGHTMAP_URL}${file}`)
        lm.channel = 1
        lm.flipY = false
        lm.colorSpace = THREE.SRGBColorSpace
        lm.anisotropy = gl.capabilities.getMaxAnisotropy()
        lightmaps.set(file, lm)
      }
      return lm
    }
    glowing.current = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.receiveShadow = true
      // Multi-material objects become a group of meshes: the extras live on the parent
      let holder: THREE.Object3D | null = mesh
      while (holder && holder.userData.lightmap === undefined) holder = holder.parent
      const baked = holder?.userData.lightmap as string | undefined
      const bakedScale = Number(holder?.userData.lightmap_scale ?? 1)
      const offScale = holder?.userData.lightmap_off_scale as number | undefined
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
        const lm = loadLightmap(baked.replace(/\.png$/, '.webp'))
        const tint = TINTS[std.name]
        if (tint) {
          basic.color.setRGB(...tint.rgb, THREE.LinearSRGBColorSpace)
          if (tint.flat) basic.map = null
        }
        basic.lightMap = lm
        basic.lightMapIntensity = bakedScale * Math.PI
        if (offScale !== undefined) {
          const dayScale = (holder?.userData.lightmap_day_scale as number | undefined) ?? DAY_SCALES[baked]
          blendLightmaps(
            basic,
            loadLightmap(baked.replace(/\.png$/, '_off.webp')),
            offScale * Math.PI,
            dayScale !== undefined ? loadLightmap(baked.replace(/\.png$/, '_day.webp')) : null,
            (dayScale ?? 0) * DAY_EXPOSURE * Math.PI,
          )
        }
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
        if (std.emissive && std.emissiveIntensity > 0 && std.emissive.getHex() !== 0) {
          std.toneMapped = false
          // The lamp's shade and bulb follow the pull switch
          if (/lamp|bulb/i.test(std.name)) glowing.current.push({ mat: std, base: std.emissiveIntensity })
        }
      }
    })
  }, [scene, gl])

  useFrame(() => {
    for (const g of glowing.current) g.mat.emissiveIntensity = g.base * lampLevel.value
  })

  return <primitive object={scene} />
}

const WINDOW_NIGHT = new THREE.Color('#8fb0ff')
const WINDOW_DAY = new THREE.Color('#fff4e6')

function Lights({ shadows }: { shadows: boolean }) {
  const lampOn = useLamp((s) => s.on)
  const day = useDaytime((s) => s.day)
  const bulb = useRef<THREE.PointLight>(null)
  const windowLight = useRef<THREE.DirectionalLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  useFrame((_, dt) => {
    // A filament glows up (and dies down) in a few tens of milliseconds
    lampLevel.value = THREE.MathUtils.damp(lampLevel.value, lampOn ? 1 : 0, lampOn ? 22 : 30, Math.min(dt, 0.05))
    if (bulb.current) bulb.current.intensity = 6 * lampLevel.value
    // Day and night fade over a couple of seconds
    dayLevel.value = THREE.MathUtils.damp(dayLevel.value, day ? 1 : 0, 2.2, Math.min(dt, 0.05))
    const d = dayLevel.value
    if (windowLight.current) {
      windowLight.current.intensity = THREE.MathUtils.lerp(0.3, 1.4, d)
      windowLight.current.color.lerpColors(WINDOW_NIGHT, WINDOW_DAY, d)
    }
    if (ambient.current) ambient.current.intensity = THREE.MathUtils.lerp(0.04, 0.35, d)
  })
  return (
    <>
      {/* Lamp bulb (2700 K) — matches the baked light for dynamic objects */}
      <pointLight
        ref={bulb}
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
      {/* Moonlight and city glow (or daylight) through the glass wall */}
      <directionalLight ref={windowLight} position={[3.5, 1.8, 1.2]} intensity={0.3} color="#8fb0ff" />
      <ambientLight ref={ambient} intensity={0.04} color="#ffd6a8" />
      {/* Reflections for the metal and vinyl: warm lamp blob + the window */}
      {/* Re-rendered once whenever the lamp is switched or day turns to night */}
      <Environment key={`${lampOn ? 'lamp-on' : 'lamp-off'}-${day ? 'day' : 'night'}`} resolution={128} frames={1}>
        <color attach="background" args={[day ? '#3a342e' : '#0a0706']} />
        {lampOn && <Lightformer form="circle" intensity={4} color="#ffb070" position={[-1.6, 1.5, 0]} scale={0.6} />}
        <Lightformer
          form="rect"
          intensity={day ? 6 : 0.9}
          color={day ? '#e8eeff' : '#8f8cb8'}
          position={[2.3, 1.3, 1.55]}
          rotation-y={-Math.PI / 2}
          scale={[3.7, 2.6, 1]}
        />
        <Lightformer form="rect" intensity={day ? 0.8 : 0.15} color="#ffe2c0" position={[0, 2.6, 0.5]} rotation-x={Math.PI / 2} scale={[3, 3, 1]} />
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
        <Suspense fallback={null}>
          <StaticRoom />
          <Paintings />
          <SleeveStand />
          <Speakers />
          <Landscape />
          <Rain />
          <LampCord />
          {quality.post && <GlassReflection />}
          <Deck />
          <Crate albums={albums} />
          <Shelf albums={albums} />
        </Suspense>
        {quality.post && (
          <EffectComposer multisampling={quality.msaa}>
            {quality.ao ? <N8AO aoRadius={0.3} intensity={1.5} distanceFalloff={0.5} halfRes /> : <></>}
            <Bloom intensity={0.45} luminanceThreshold={1.0} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette offset={0.3} darkness={0.7} />
          </EffectComposer>
        )}
      </Canvas>
      <Loader />
    </>
  )
}

useGLTF.preload(ROOM_URL)
