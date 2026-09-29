// Smooths Cycles bake noise in the lightmaps without bleeding across UV
// islands. Mask-normalised Gaussian blur in float (blur(rgb*mask) / blur(mask)),
// only applied where most of the kernel lies inside the island; island borders
// keep the raw bake instead of being amplified by a tiny weight.
// Reads the PNGs written by the Blender bake, writes WebP and removes the PNG.
// Without a PNG the lightmap is skipped: re-filtering the WebP compounds the blur.
// Usage: node blender/denoise_lightmaps.mjs [sigma]
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import sharp from 'sharp'

const sigma = Number(process.argv[2] ?? 1.5)
const dir = new URL('../public/models/lightmaps/', import.meta.url).pathname
// Fraction of the kernel that must be inside the island to use the blurred value
const MIN_WEIGHT = 0.6

function kernel(s) {
  const r = Math.ceil(s * 3)
  const k = new Float32Array(r * 2 + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * s * s))
  return k.map((v) => v / sum)
}

// Separable Gaussian over a single float channel (clamped edges)
function blur(src, width, height, k) {
  const r = (k.length - 1) / 2
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += src[row + Math.min(width - 1, Math.max(0, x + i))] * k[i + r]
      tmp[row + x] = acc
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x] * k[i + r]
      out[y * width + x] = acc
    }
  }
  return out
}

const k = kernel(sigma)

for (const name of ['arch', 'furn']) {
  const png = `${dir}${name}.png`
  const file = `${dir}${name}.webp`
  if (!existsSync(png)) {
    console.log('skipped', name, '- no fresh bake PNG')
    continue
  }
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const n = width * height

  let lit = 0
  const mask = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    mask[i] = data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2] > 0 ? 1 : 0
    lit += mask[i]
  }
  if (lit < n * 0.01) {
    console.warn('skipped', name, '- bake is (almost) black, rebake it first')
    continue
  }
  const weight = blur(mask, width, height, k)

  const out = Buffer.from(data)
  for (let c = 0; c < 3; c++) {
    const channel = new Float32Array(n)
    for (let i = 0; i < n; i++) channel[i] = data[i * 3 + c] * mask[i]
    const blurred = blur(channel, width, height, k)
    for (let i = 0; i < n; i++) {
      if (mask[i] && weight[i] >= MIN_WEIGHT) out[i * 3 + c] = Math.min(255, Math.round(blurred[i] / weight[i]))
    }
  }

  const tmp = `${dir}${name}.tmp.webp`
  await sharp(out, { raw: { width, height, channels: 3 } }).webp({ quality: 92 }).toFile(tmp)
  await sharp(tmp).toFile(file)
  await unlink(tmp)
  await unlink(png)
  console.log('denoised', name, `${width}x${height}`, 'sigma', sigma)
}
