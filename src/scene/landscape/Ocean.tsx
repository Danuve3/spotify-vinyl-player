import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { common, dirVertex } from './shaders'
import { view } from './view'
import { Meteors } from './Meteors'

// The sea under the moon, seen from a clifftop house: a rendered ocean whose
// swell reflects the photo's sky (so the moon lays its own glitter path on
// it), fading into haze at the horizon, with a few ships' lights far out.

const EYE_HEIGHT = 22 // m above the water
const RADIUS = 30000 // m: beyond this the photo's own horizon takes over
// Where the moon is in the sky photo
const MOON_EL = THREE.MathUtils.degToRad(17)
const MOON_AZ = THREE.MathUtils.degToRad(8)
const MOON = new THREE.Vector3(Math.cos(MOON_EL) * Math.cos(MOON_AZ), Math.sin(MOON_EL), Math.cos(MOON_EL) * Math.sin(MOON_AZ))


const oceanFragment = /* glsl */ `
  ${common}
  uniform sampler2D uPhoto;
  uniform float uHalfSpan;
  uniform vec2 uElevation;
  uniform vec3 uZenith;
  uniform vec3 uMoonDir;
  varying vec3 vDir;

  // The sky in a direction: the photo where it covers it, the dome above
  vec3 skyColour(vec3 r) {
    float az = atan(r.z, r.x);
    float el = asin(clamp(r.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + az / (2.0 * uHalfSpan), (max(el, 0.004) - uElevation.x) / (uElevation.y - uElevation.x));
    vec3 dome = mix(uHaze, uZenith, smoothstep(0.2, 0.9, r.y));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y > 1.0) return dome;
    vec3 photo = texture(uPhoto, uv, 1.5).rgb;
    float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x) * (1.0 - smoothstep(0.9, 1.0, uv.y));
    return mix(dome, photo, edge);
  }

  // Swell: a few long directional waves plus finer chop, as slopes (dh/dx, dh/dz)
  vec2 slope(vec2 p, float dist) {
    vec2 g = vec2(0.0);
    const int N = 7;
    for (int i = 0; i < N; i++) {
      float fi = float(i);
      float ang = 0.35 + fi * 1.9 + sin(fi * 3.1) * 0.4;
      vec2 dir = vec2(cos(ang), sin(ang));
      float len = 60.0 / pow(1.75, fi);                // wavelength, m
      float k = 6.2832 / len;
      float speed = sqrt(9.81 / k);                    // deep-water waves
      float amp = len * 0.012;
      // Detail far away shrinks below a pixel: fade it out instead of aliasing
      float fade = 1.0 - smoothstep(len * 8.0, len * 30.0, dist);
      float ph = dot(dir, p) * k - uTime * speed * k + fi * 1.7;
      g += dir * cos(ph) * amp * k * fade;
    }
    // Ripples from noise, near the shore of view
    float near = 1.0 - smoothstep(20.0, 400.0, dist);
    vec2 q = p * 0.9 + vec2(uTime * 0.4, uTime * 0.25);
    float e = 0.05;
    float n0 = fbm(q), nx = fbm(q + vec2(e, 0.0)), nz = fbm(q + vec2(0.0, e));
    g += vec2(nx - n0, nz - n0) / e * 0.05 * near;
    return g;
  }

  void main() {
    // The sea is drawn on a far shell (so the room always stays in front of
    // it): each pixel finds where its ray meets the water
    vec3 v = normalize(vDir);
    if (v.y > -0.0004) discard;
    float dist = ${EYE_HEIGHT.toFixed(1)} / -v.y;
    vec3 pos = v * dist;
    dist = length(pos.xz);
    vec2 s = slope(pos.xz + vec2(3000.0, 1000.0), dist);
    vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
    vec3 r = reflect(v, n);
    r.y = abs(r.y);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, -v), 0.0), 5.0);

    vec3 reflected = skyColour(r);
    // Moon glints on the facets turned just right
    float glint = pow(max(dot(r, uMoonDir), 0.0), 900.0) * 6.0 + pow(max(dot(r, uMoonDir), 0.0), 90.0) * 0.08;
    reflected += vec3(1.0, 0.97, 0.9) * glint * (1.0 - uRain * 0.9);
    // Deep water: almost black, a hint of green-blue where waves face us
    vec3 deep = vec3(0.0015, 0.004, 0.006) * (0.6 + 0.8 * max(n.x, 0.0));
    vec3 col = mix(deep, reflected, fresnel);

    // Haze towards the horizon, like the photo's
    float haze = smoothstep(800.0, 6500.0, dist);
    col = mix(col, uHaze * 1.1, haze * 0.85);
    // Rain dimples the surface and greys it
    col = mix(col, uHaze * 0.6, uRain * 0.25);
    // Soft rim where the rendered sea meets the photo's horizon
    float a = 1.0 - smoothstep(0.55, 1.0, dist / ${RADIUS.toFixed(1)});
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Ships far out: a white masthead light and a red or green sidelight, drifting
const shipsVertex = /* glsl */ `
  ${common}
  uniform float uProj;
  uniform float uUnit;
  attribute vec4 aShip; // az, distance, speed (rad/s), colour kind
  varying vec3 vColor;
  void main() {
    float az = aShip.x + uTime * aShip.z;
    vec3 p = vec3(cos(az), 0.0, sin(az)) * aShip.y;
    p.y = -${EYE_HEIGHT.toFixed(1)} + position.y;
    p += vec3(-sin(az), 0.0, cos(az)) * position.x;
    float blink = aShip.w > 2.5 ? step(0.85, fract(uTime * 0.5 + aShip.x * 7.0)) : 1.0;
    vColor = (aShip.w < 0.5 ? vec3(1.0, 0.92, 0.75) : aShip.w < 1.5 ? vec3(1.0, 0.1, 0.05) : aShip.w < 2.5 ? vec3(0.1, 1.0, 0.3) : vec3(1.0, 0.95, 0.9)) * 2.0 * blink * (1.0 - uRain * 0.8);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = blink < 0.5 ? 0.0 : clamp(3.0 * uUnit * uProj / -mv.z, 1.2, 4.0);
  }
`

const shipsFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    gl_FragColor = vec4(vColor * exp(-dot(q, q) * 14.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function makeShips() {
  const ship: number[] = []
  const pos: number[] = []
  const add = (az: number, dist: number, speed: number, height: number, side: number, kind: number) => {
    ship.push(az, dist, speed, kind)
    pos.push(side, height, 0)
  }
  // A few vessels between 2 and 6 km out, very slowly crossing
  const vessels = [
    [-0.55, 2600, 1],
    [0.3, 4200, -1],
    [0.85, 5600, 1],
    [-0.15, 6100, -1],
  ]
  vessels.forEach(([az, dist, dir], i) => {
    const speed = (dir * (2.5 + i)) / dist // ~3-6 m/s
    add(az, dist, speed, 14, 0, 0) // masthead
    add(az, dist, speed, 7, dir * 6, dir > 0 ? 2 : 1) // sidelight facing us
    add(az, dist, speed, 7, -dir * 40, 0) // stern light
    if (i === 2) add(az, dist, speed, 30, 0, 3) // a tall one with a flashing light
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aShip', new THREE.Float32BufferAttribute(ship, 4))
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({ uniforms: view, vertexShader: shipsVertex, fragmentShader: shipsFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  points.frustumCulled = false
  points.renderOrder = -6
  return points
}

export function Ocean() {
  const { sea, ships } = useMemo(() => {
    // Lower half of a shell just inside the photo band
    const geo = new THREE.SphereGeometry(6300, 128, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
    const sea = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { ...view, uMoonDir: { value: MOON } },
        vertexShader: dirVertex,
        fragmentShader: oceanFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    )
    sea.renderOrder = -7
    return { sea, ships: makeShips() }
  }, [])
  useEffect(
    () => () => {
      for (const o of [sea, ships]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [sea, ships],
  )
  return (
    <>
      <primitive object={sea} />
      <primitive object={ships} />
      <Meteors every={18} />
    </>
  )
}
