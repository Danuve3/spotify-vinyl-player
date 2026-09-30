import * as THREE from 'three'
import { rainAmount } from '../weather'
import { dayLevel } from '../daytime'

// Uniforms shared by the sky, the photo, the animated layers and the rain on
// the glass (which refracts the photo), updated in place when the landscape
// changes. Everything outside is in metres around the eye, scaled by UNIT.

export const UNIT = 1 / 40
export const PHOTO_R = 6500
export type ViewUniforms = ReturnType<typeof makeUniforms>

function makeUniforms() {
  return {
    uTime: { value: 0 },
    uRain: rainAmount,
    uProj: { value: 800 },
    uUnit: { value: UNIT },
    uPhotoR: { value: PHOTO_R * 0.97 },
    uPhoto: { value: null as THREE.Texture | null },
    uPhotoSize: { value: new THREE.Vector2(1, 1) },
    uHalfSpan: { value: 1 },
    uElevation: { value: new THREE.Vector2(-0.5, 0.5) },
    uExposure: { value: 1 },
    // The daytime photo, faded in by uDay
    uPhotoDay: { value: null as THREE.Texture | null },
    uPhotoSizeDay: { value: new THREE.Vector2(1, 1) },
    uHalfSpanDay: { value: 1 },
    uElevationDay: { value: new THREE.Vector2(-0.5, 0.5) },
    uExposureDay: { value: 1 },
    uMirrorDay: { value: 1 },
    uDay: dayLevel,
    uHaze: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Vector3() },
    uMoon: { value: new THREE.Vector3(1, 0, 0) },
    uMoonOn: { value: 0 },
    uStars: { value: 1 },
    uTwinkle: { value: 1 },
    uMilky: { value: 0 },
    uClouds: { value: 0 },
    uSmoke: { value: 0 },
    uGlow: { value: new THREE.Vector3() },
    uFlash: { value: 0 },
    uCity: { value: 0 },
    uWind: { value: 0 },
    uMirror: { value: 1 },
    uFires: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uLamps: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
    uLampColor: { value: new THREE.Vector3(1, 0.62, 0.3) },
    uWater: { value: new THREE.Vector4(0, 0, 0, 1) },
    uShimmer: { value: 0 },
    uLava: { value: 0 },
    uFog: { value: 0 },
    uFogColor: { value: new THREE.Vector3(0.5, 0.52, 0.55) },
    uAurora: { value: 0 },
    uMoon2: { value: new THREE.Vector3(0, 0, 0) },
  }
}

export const view = makeUniforms()
