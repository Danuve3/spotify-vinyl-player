import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { dayLevel } from './daytime'

// At night a glass wall is half a mirror: the lit room shows faintly on it,
// laid over the city. By day the bright outside drowns it out. A low-resolution planar reflection, blended additively
// (reflected light adds to what comes through the glass).

const GLASS = { x: 2.228, y0: 0.035, y1: 2.54, z0: -0.3, z1: 3.4 }
const STRENGTH = 0.09

const shader = {
  name: 'GlassReflection',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uStrength: { value: STRENGTH },
    uDay: dayLevel,
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vView;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vView = normalize(cameraPosition - world.xyz);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uDay;
    varying vec4 vUv;
    varying vec3 vView;
    void main() {
      vec3 refl = texture2DProj(tDiffuse, vUv).rgb;
      // Fresnel: glass reflects more at grazing angles
      float cosT = abs(vView.x);
      float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
      gl_FragColor = vec4(refl * (uStrength + fresnel * 0.3) * (1.0 - uDay * 0.9), 1.0);
      #include <colorspace_fragment>
    }
  `,
}

export function GlassReflection() {
  const reflector = useMemo(() => {
    const w = GLASS.z1 - GLASS.z0
    const h = GLASS.y1 - GLASS.y0
    const r = new Reflector(new THREE.PlaneGeometry(w, h), {
      textureWidth: 768,
      textureHeight: Math.round((768 * h) / w),
      clipBias: 0.003,
      shader,
      multisample: 0,
    })
    // Facing into the room (-X), on the inside face of the glass
    r.rotation.y = -Math.PI / 2
    r.position.set(GLASS.x, (GLASS.y0 + GLASS.y1) / 2, (GLASS.z0 + GLASS.z1) / 2)
    const mat = r.material as THREE.ShaderMaterial
    mat.uniforms.uDay = dayLevel // Reflector clones the uniforms: share the live one
    mat.transparent = true
    mat.depthWrite = false
    mat.blending = THREE.AdditiveBlending
    r.renderOrder = 5
    return r
  }, [])

  useEffect(() => () => reflector.dispose(), [reflector])
  // Not worth rendering the room twice once it is full day
  useFrame(() => {
    reflector.visible = dayLevel.value < 0.98
  })

  return <primitive object={reflector} />
}
