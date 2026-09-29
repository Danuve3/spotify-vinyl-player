import * as THREE from 'three'

// Linear brushed-aluminium detail generated on the fly (the Blender version
// is procedural and does not survive glTF export).

let cache: { roughness: THREE.DataTexture; normal: THREE.DataTexture } | null = null

export function brushedLinearMaps(size = 512) {
  if (cache) return cache
  // 1D streak profile along V, constant along U -> long streaks
  const streak = new Float32Array(size)
  for (let y = 0; y < size; y++) streak[y] = Math.random()
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < size - 1; y++) streak[y] = (streak[y - 1] + streak[y] * 2 + streak[y + 1]) / 4
  }
  const rough = new Uint8Array(size * size * 4)
  const normal = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    const slope = (streak[(y + 1) % size] - streak[(y - 1 + size) % size]) * 4
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const jitter = (Math.random() - 0.5) * 0.04
      const r = 0.24 + (streak[y] - 0.5) * 0.16 + jitter
      rough[i] = rough[i + 2] = 0
      rough[i + 1] = Math.max(0, Math.min(255, r * 255))
      rough[i + 3] = 255
      normal[i] = 128
      normal[i + 1] = Math.max(0, Math.min(255, 128 + slope * 127))
      normal[i + 2] = 255
      normal[i + 3] = 255
    }
  }
  const make = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, size, size)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 6)
    t.needsUpdate = true
    return t
  }
  cache = { roughness: make(rough), normal: make(normal) }
  return cache
}
