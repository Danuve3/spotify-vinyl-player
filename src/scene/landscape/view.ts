import * as THREE from 'three'
import { rainAmount } from '../weather'

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
  }
}

export const view = makeUniforms()
