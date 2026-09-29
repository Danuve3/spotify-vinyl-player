import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

// At night a glass wall is half a mirror: the lit room shows faintly on it,
// laid over the city. A low-resolution planar reflection, blended additively
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
    varying vec4 vUv;
    varying vec3 vView;
    void main() {
      vec3 refl = texture2DProj(tDiffuse, vUv).rgb;
      // Fresnel: glass reflects more at grazing angles
      float cosT = abs(vView.x);
      float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
      gl_FragColor = vec4(refl * (uStrength + fresnel * 0.3), 1.0);
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
    mat.transparent = true
    mat.depthWrite = false
    mat.blending = THREE.AdditiveBlending
    r.renderOrder = 5
    return r
  }, [])

  useEffect(() => () => reflector.dispose(), [reflector])

  return <primitive object={reflector} />
}
