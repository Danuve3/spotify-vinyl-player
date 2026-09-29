import * as THREE from 'three'
import { R_LABEL, R_LEAD_IN, R_LEAD_OUT, lastRadius, type Side } from './sides'

// Runtime textures for a 12" record. UVs are planar over the disc diameter,
// so pixel (x, y) maps to the radius from the texture centre.

const R_DISC = 0.1524
const SIZE = 2048
const PX_PER_M = SIZE / (2 * R_DISC)

const px = (r: number) => r * PX_PER_M

function canvas(size = SIZE) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!] as const
}

function ring(ctx: CanvasRenderingContext2D, rOuter: number, rInner: number, style: string) {
  const c = SIZE / 2
  ctx.beginPath()
  ctx.arc(c, c, px(rOuter), 0, Math.PI * 2)
  ctx.arc(c, c, px(rInner), 0, Math.PI * 2, true)
  ctx.fillStyle = style
  ctx.fill()
}

/** Fine concentric grooves: one 1px circle per pixel of radius with random tone. */
function grooves(ctx: CanvasRenderingContext2D, rOuter: number, rInner: number, base: number, spread: number) {
  const c = SIZE / 2
  ctx.lineWidth = 1
  for (let p = px(rOuter); p > px(rInner); p -= 1) {
    const v = Math.round(base + (Math.random() - 0.5) * spread)
    ctx.strokeStyle = `rgb(${v},${v},${v})`
    ctx.beginPath()
    ctx.arc(c, c, p, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function drawLabel(ctx: CanvasRenderingContext2D, cover: HTMLImageElement | null, side: Side, title: string, artist: string) {
  const c = SIZE / 2
  const r = px(R_LABEL)
  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.clip()
  if (cover) ctx.drawImage(cover, c - r, c - r, r * 2, r * 2)
  else {
    ctx.fillStyle = '#c8b28a'
    ctx.fillRect(c - r, c - r, r * 2, r * 2)
  }
  // Printed-paper feel: darken towards the rim so the text reads
  const shade = ctx.createRadialGradient(c, c, r * 0.35, c, c, r)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = shade
  ctx.fillRect(c - r, c - r, r * 2, r * 2)

  ctx.fillStyle = '#f4ead8'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${r * 0.16}px Fraunces, Georgia, serif`
  ctx.fillText(side.name, c + r * 0.62, c)
  ctx.font = `500 ${r * 0.075}px "DM Mono", monospace`
  ctx.fillText('33⅓', c - r * 0.62, c)
  ctx.font = `600 ${r * 0.1}px Fraunces, Georgia, serif`
  ctx.fillText(title.slice(0, 28), c, c + r * 0.62)
  ctx.font = `500 ${r * 0.07}px "DM Mono", monospace`
  ctx.fillText(artist.slice(0, 34), c, c + r * 0.76)
  ctx.restore()

  // Spindle hole
  ctx.beginPath()
  ctx.arc(c, c, px(0.0036), 0, Math.PI * 2)
  ctx.fillStyle = '#000'
  ctx.fill()
}

export interface SideTextures {
  map: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
}

export async function createSideTextures(
  side: Side,
  coverUrl: string,
  title: string,
  artist: string,
): Promise<SideTextures> {
  const cover = await loadImage(coverUrl).catch(() => null)
  const [colorC, color] = canvas()
  const [roughC, rough] = canvas()
  const end = lastRadius(side)

  // Colour: near-black vinyl; grooved areas a touch lighter than smooth ones
  color.fillStyle = '#070707'
  color.fillRect(0, 0, SIZE, SIZE)
  ring(color, R_DISC, R_LEAD_IN, '#0b0b0b')
  grooves(color, R_LEAD_IN, end, 14, 6)
  for (let i = 1; i < side.bands.length; i++) {
    ring(color, side.bands[i - 1].rEnd, side.bands[i].rStart, '#050505')
  }
  ring(color, end, R_LEAD_OUT, '#060606')
  ring(color, R_LEAD_OUT + 0.0004, R_LEAD_OUT, '#151515') // locked groove
  ring(color, R_LEAD_OUT, R_LABEL, '#080808')
  drawLabel(color, cover, side, title, artist)

  // Roughness (green channel as three.js reads it): gaps are glossy mirrors
  rough.fillStyle = 'rgb(0,90,0)'
  rough.fillRect(0, 0, SIZE, SIZE)
  ring(rough, R_LEAD_IN, end, 'rgb(0,110,0)')
  for (let i = 1; i < side.bands.length; i++) {
    ring(rough, side.bands[i - 1].rEnd, side.bands[i].rStart, 'rgb(0,35,0)')
  }
  ring(rough, end, R_LABEL, 'rgb(0,45,0)')
  ring(rough, R_LABEL, 0, 'rgb(0,170,0)')

  // glTF UVs expect unflipped textures
  const map = new THREE.CanvasTexture(colorC)
  map.flipY = false
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const roughnessMap = new THREE.CanvasTexture(roughC)
  roughnessMap.flipY = false
  roughnessMap.anisotropy = 8
  return { map, roughnessMap }
}

let anisotropyCache: THREE.DataTexture | null = null

/**
 * Circular anisotropy (RG = tangent direction, B = strength) that produces the
 * characteristic light "fan" of grooves. Shared by every record and the platter.
 */
export function circularAnisotropyMap(size = 512, rMinFrac = R_LABEL / R_DISC): THREE.DataTexture {
  if (anisotropyCache && size === 512) return anisotropyCache
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c
      const dy = y - c
      const len = Math.hypot(dx, dy) || 1
      const i = (y * size + x) * 4
      data[i] = ((-dy / len) * 0.5 + 0.5) * 255
      data[i + 1] = ((dx / len) * 0.5 + 0.5) * 255
      data[i + 2] = len / c > rMinFrac && len / c <= 1 ? 255 : 0
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size)
  tex.needsUpdate = true
  if (size === 512) anisotropyCache = tex
  return tex
}
