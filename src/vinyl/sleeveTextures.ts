import * as THREE from 'three'
import type { Album } from '../spotify/api'
import type { Side } from './sides'

// Sleeve artwork: front = album cover, back = a printed tracklist by side.

const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader().setCrossOrigin('anonymous')

export function coverTexture(url: string): THREE.Texture {
  let tex = cache.get(url)
  if (!tex) {
    tex = loader.load(url)
    // Applied to glTF materials, whose UVs expect unflipped textures
    tex.flipY = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    cache.set(url, tex)
  }
  return tex
}

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function backCoverTexture(album: Album, sides: Side[]): THREE.CanvasTexture {
  const size = 1024
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!

  // Aged card stock
  ctx.fillStyle = '#e9e0cc'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(90,70,40,${Math.random() * 0.05})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2)
  }

  const pad = 80
  ctx.fillStyle = '#1d1712'
  ctx.textBaseline = 'top'
  ctx.font = '600 44px Fraunces, Georgia, serif'
  ctx.fillText(album.name.slice(0, 36), pad, pad)
  ctx.font = '400 26px "DM Mono", monospace'
  ctx.fillStyle = '#5a4a38'
  ctx.fillText(`${album.artist}${album.year ? ' · ' + album.year : ''}`.slice(0, 56), pad, pad + 62)

  // Tracklist columns: one per side, wrapping into two columns
  const colW = (size - pad * 2) / 2
  const lineH = Math.min(30, (size - 320) / Math.max(12, album.tracks.length / 2 + sides.length * 2))
  let x = pad
  let y = pad + 140
  for (const side of sides) {
    const need = (side.tracks.length + 2) * lineH
    if (y + need > size - pad && x === pad) {
      x = pad + colW
      y = pad + 140
    }
    ctx.fillStyle = '#b8562a'
    ctx.font = `600 ${lineH * 0.95}px Fraunces, Georgia, serif`
    ctx.fillText(`Cara ${side.name}`, x, y)
    y += lineH * 1.3
    ctx.font = `400 ${lineH * 0.62}px "DM Mono", monospace`
    side.tracks.forEach((t, i) => {
      ctx.fillStyle = '#1d1712'
      ctx.fillText(`${side.name}${i + 1}  ${t.name}`.slice(0, 34), x, y)
      ctx.fillStyle = '#6d5d48'
      ctx.textAlign = 'right'
      ctx.fillText(fmt(t.durationMs), x + colW - 24, y)
      ctx.textAlign = 'left'
      y += lineH
    })
    y += lineH * 0.7
  }

  ctx.fillStyle = '#6d5d48'
  ctx.font = '400 20px "DM Mono", monospace'
  ctx.fillText('33⅓ RPM · STEREO', pad, size - pad - 20)

  const tex = new THREE.CanvasTexture(c)
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
