import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { common, dirVertex } from './shaders'
import { view } from './view'

// Now and then a shooting star: a thin streak that brightens and fades along
// a short arc, in front of the photo's sky. Drawn on a shell just inside it.

const fragment = /* glsl */ `
  ${common}
  uniform float uEvery; // seconds between meteors, on average
  varying vec3 vDir;

  // Direction on the sky from azimuth / elevation
  vec3 sky(float az, float el) { return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      // Two interleaved schedules so they are not evenly spaced
      float period = uEvery * (k == 0 ? 1.0 : 1.63);
      float slot = floor(uTime / period + float(k) * 0.37);
      float t = fract(uTime / period + float(k) * 0.37) * period; // seconds into this slot
      float r1 = hash(vec3(slot, float(k), 1.0)), r2 = hash(vec3(slot, float(k), 2.0));
      float r3 = hash(vec3(slot, float(k), 3.0)), r4 = hash(vec3(slot, float(k), 4.0));
      float dur = 0.5 + r3 * 0.7;
      if (t > dur || r4 < 0.35) continue; // some slots stay empty
      vec3 a = sky((r1 - 0.5) * 2.2, 0.25 + r2 * 0.7);
      vec3 b = sky((r1 - 0.5) * 2.2 + (r3 - 0.5) * 0.5, 0.25 + r2 * 0.7 - 0.12 - r4 * 0.1);
      float p = t / dur;
      vec3 head = normalize(mix(a, b, p));
      vec3 tail = normalize(mix(a, b, max(p - 0.25, 0.0)));
      // Distance from this pixel to the head-tail segment, in radians
      vec3 ab = head - tail;
      float s = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      float dist = length(d - (tail + ab * s));
      float bright = sin(p * 3.14159) * (0.3 + 0.7 * s);
      col += vec3(0.85, 0.9, 1.0) * bright * exp(-pow(dist / 0.0012, 2.0)) * 2.5;
    }
    col *= (1.0 - uRain) * (1.0 - uDay);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Meteors({ every = 14 }: { every?: number }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(6000, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { ...view, uEvery: { value: every } },
        vertexShader: dirVertex,
        fragmentShader: fragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    m.renderOrder = -8
    return m
  }, [every])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )
  return <primitive object={mesh} />
}
