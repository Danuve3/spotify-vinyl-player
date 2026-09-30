import { Suspense, useEffect, useMemo, useRef, type ComponentType } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { PHOTO_R, UNIT, view } from './view'
import { dirVertex, photoFragment, skyFragment } from './shaders'
import { LANDSCAPES, LANDSCAPE_ORDER, useLandscape, type Landscape as Def, type LandscapeId } from './landscapes'
import { ManhattanLights } from './Manhattan'
import { CountrysideLife } from './Countryside'
import { Ocean } from './Ocean'
import { Skyways } from './Future'
import { Wasteland } from './Wasteland'
import { MoonSky } from './Moon'

// The view out of the glass wall: the chosen landscape's photograph wrapped on
// a band around the viewer, under a procedural sky, with its animated layer on
// top. Everything is in metres around the eye and shrunk to fit the far plane;
// it follows the camera, which at these distances matches real parallax.

const SKY_R = 7000

function apply(def: Def, night: THREE.Texture, day: THREE.Texture) {
  view.uPhoto.value = night
  view.uPhotoSize.value.set(def.photo.width, def.photo.height)
  view.uHalfSpan.value = def.photo.halfSpan
  view.uElevation.value.set(def.photo.elBottom, def.photo.elTop)
  view.uExposure.value = def.exposure
  view.uMirror.value = def.mirrorBelow ? 1 : 0
  const d = def.day
  view.uPhotoDay.value = day
  view.uPhotoSizeDay.value.set(d.photo.width, d.photo.height)
  view.uHalfSpanDay.value = d.photo.halfSpan
  view.uElevationDay.value.set(d.photo.elBottom, d.photo.elTop)
  view.uExposureDay.value = d.exposure
  view.uMirrorDay.value = (d.mirrorBelow ?? def.mirrorBelow) ? 1 : 0
  view.uMoonOn.value = def.moon ? 1 : 0
  if (def.moon) view.uMoon.value.copy(def.moon)
  view.uStars.value = def.stars
  view.uTwinkle.value = def.twinkle
  view.uMilky.value = def.milky
  view.uSmoke.value = def.smoke
  view.uFlash.value = 0
  view.uCity.value = def.city
  for (const f of view.uFires.value) f.set(0, 0, 0, 0)
  blend(def, view.uDay.value)
}

/** The sky and weather between night and day. */
function blend(def: Def, t: number) {
  const d = def.day
  view.uHaze.value.lerpVectors(def.haze, d.haze, t)
  view.uZenith.value.lerpVectors(def.zenith, d.zenith, t)
  view.uGlow.value.lerpVectors(def.glow, d.glow ?? def.glow, t)
  view.uClouds.value = THREE.MathUtils.lerp(def.clouds, d.clouds ?? def.clouds, t)
  view.uWind.value = THREE.MathUtils.lerp(def.wind, d.wind ?? def.wind, t)
}

const LAYERS: Record<LandscapeId, ComponentType> = {
  manhattan: ManhattanLights,
  countryside: CountrysideLife,
  sea: Ocean,
  future: Skyways,
  wasteland: Wasteland,
  moon: MoonSky,
}

export function Landscape() {
  const id = useLandscape((s) => s.id)
  // The other photos download in the background, so switching is quick
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 4000))
    idle(() =>
      LANDSCAPE_ORDER.forEach((l) => {
        if (l === id) return
        useTexture.preload(LANDSCAPES[l].photo.url)
        useTexture.preload(LANDSCAPES[l].day.photo.url)
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Suspense fallback={null}>
      <View key={id} def={LANDSCAPES[id]} />
    </Suspense>
  )
}

function View({ def }: { def: Def }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const group = useRef<THREE.Group>(null)
  const [photo, dayPhoto] = useTexture([def.photo.url, def.day.photo.url])
  const buffer = useMemo(() => new THREE.Vector2(), [])

  const objects = useMemo(() => {
    for (const t of [photo, dayPhoto]) {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = gl.capabilities.getMaxAnisotropy()
    }
    apply(def, photo, dayPhoto)
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 48, 24),
      new THREE.ShaderMaterial({ uniforms: view, vertexShader: dirVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
    )
    sky.renderOrder = -10
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(PHOTO_R, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: view,
        vertexShader: dirVertex,
        fragmentShader: photoFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    )
    band.renderOrder = -9
    return [sky, band]
  }, [def, photo, dayPhoto, gl])

  useEffect(
    () => () => {
      for (const o of objects) {
        o.geometry.dispose()
        o.material.dispose()
      }
    },
    [objects],
  )

  useFrame((state) => {
    group.current?.position.copy(camera.position)
    view.uTime.value = state.clock.elapsedTime
    blend(def, view.uDay.value)
    const h = state.gl.getDrawingBufferSize(buffer).y
    view.uProj.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  })

  const Layer = LAYERS[def.id]
  return (
    <group ref={group} scale={UNIT}>
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
      <Layer />
    </group>
  )
}
