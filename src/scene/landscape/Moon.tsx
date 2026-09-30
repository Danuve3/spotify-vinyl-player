import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { common } from './shaders'
import { view } from './view'

// On the Moon: the Earth hangs in the black sky, turning slowly, lit from the
// side by the same sun as the hills (NASA Blue Marble, public domain); stars
// do not twinkle without air, and now and then a spacecraft glides over.

const EARTH_URL = `${import.meta.env.BASE_URL}landscapes/earth.webp`
const deg = THREE.MathUtils.degToRad
const DIST = 5000 // m
const RADIUS = DIST * Math.tan(deg(0.95)) // the Earth is ~1.9 degrees across from the Moon
const EARTH_AZ = deg(-22)
const EARTH_EL = deg(14)
// The sun, low and to the right, as in the photograph
const SUN = new THREE.Vector3(Math.cos(deg(8)) * Math.cos(deg(105)), Math.sin(deg(8)), Math.cos(deg(8)) * Math.sin(deg(105))).normalize()
// In the lunar night the sun is behind us: the Earth is full (and lights the ground)
const SUN_NIGHT = new THREE.Vector3(Math.cos(EARTH_EL) * Math.cos(EARTH_AZ), Math.sin(EARTH_EL), Math.cos(EARTH_EL) * Math.sin(EARTH_AZ)).negate()

const earthVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vLocal;
  varying vec3 vView;
  void main() {
    vLocal = normalize(position);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const earthFragment = /* glsl */ `
  ${common}
  uniform sampler2D uEarth;
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vLocal;
  varying vec3 vView;
  void main() {
    // Longitude turns with time (a day every ~20 minutes); clouds drift a little faster
    float lon = atan(vLocal.z, vLocal.x);
    float lat = asin(clamp(vLocal.y, -1.0, 1.0));
    float spin = uTime * 6.2832 / 1200.0;
    vec2 uv = vec2(fract((lon + spin) / 6.2832 + 0.5), 0.5 + lat / 3.14159);
    vec2 cuv = vec2(fract((lon + spin * 1.06) / 6.2832 + 0.5), uv.y);
    vec3 ground = texture(uEarth, uv).rgb;
    float cloud = texture(uEarth, cuv).a;
    vec3 n = normalize(vNormal);
    float lit = dot(n, uSun);
    float day = smoothstep(-0.08, 0.12, lit);
    // Oceans (dark, blue) catch the sun
    float ocean = smoothstep(0.12, 0.04, ground.r) * smoothstep(0.02, 0.08, ground.b);
    vec3 h = normalize(uSun + vView);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * ocean * 0.6;
    vec3 col = ground * 1.3 * max(lit, 0.0) + spec;
    col = mix(col, vec3(1.0) * max(lit, 0.0) * 1.15, cloud * 0.9);
    // Thin blue atmosphere, strongest at the rim on the day side
    float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
    col += vec3(0.25, 0.45, 1.0) * rim * (0.2 + day) * 0.9;
    col *= day * 0.95 + 0.02;
    gl_FragColor = vec4(col * 1.6, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// A spacecraft crossing: a steady point with a brief glint
const craftVertex = /* glsl */ `
  ${common}
  varying float vGlint;
  void main() {
    float period = 150.0;
    float t = mod(uTime + 40.0, period) / period;
    vec3 a = normalize(vec3(0.9, 0.35, -0.9)), b = normalize(vec3(0.7, 0.55, 1.0));
    vec3 dir = normalize(mix(a, b, t));
    vGlint = 0.8 + 3.0 * exp(-pow((t - 0.55) * 40.0, 2.0));
    vGlint *= smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.9, t);
    vec4 mv = modelViewMatrix * vec4(dir * 5500.0, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = 2.2 + vGlint;
  }
`

const craftFragment = /* glsl */ `
  varying float vGlint;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.92) * vGlint * exp(-dot(q, q) * 14.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function MoonSky() {
  const earthMap = useTexture(EARTH_URL)
  const { earth, craft } = useMemo(() => {
    earthMap.colorSpace = THREE.SRGBColorSpace
    earthMap.wrapS = THREE.RepeatWrapping
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { ...view, uEarth: { value: earthMap }, uSun: { value: SUN.clone() } },
        vertexShader: earthVertex,
        fragmentShader: earthFragment,
      }),
    )
    earth.position.set(Math.cos(EARTH_EL) * Math.cos(EARTH_AZ), Math.sin(EARTH_EL), Math.cos(EARTH_EL) * Math.sin(EARTH_AZ)).multiplyScalar(DIST)
    earth.rotation.z = deg(-18) // axial tilt as seen from here
    earth.renderOrder = -9.5
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const craft = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: view, vertexShader: craftVertex, fragmentShader: craftFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    craft.frustumCulled = false
    craft.renderOrder = -9.5
    return { earth, craft }
  }, [earthMap])
  useEffect(
    () => () => {
      for (const o of [earth, craft]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [earth, craft],
  )
  useFrame(() => {
    const sun = (earth.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3
    sun.lerpVectors(SUN_NIGHT, SUN, view.uDay.value).normalize()
  })
  return (
    <>
      <primitive object={earth} />
      <primitive object={craft} />
    </>
  )
}
