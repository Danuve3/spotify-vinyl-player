import type { Album, Track } from '../spotify/api'

// Dev-only fake albums so the room can be explored without a Spotify login
// (open http://127.0.0.1:5173/?preview). Never bundled into production paths
// because App only imports it behind import.meta.env.DEV.

const PALETTES = [
  ['#c8553d', '#f2d0a4', '#2d3047'],
  ['#1b998b', '#f4e04d', '#1f1f1f'],
  ['#e0a458', '#419d78', '#2d3142'],
  ['#8e5572', '#f2e3bc', '#443850'],
  ['#3d5a80', '#ee6c4d', '#e0fbfc'],
  ['#9e2a2b', '#e09f3e', '#fff3b0'],
]

function cover(i: number, title: string): string {
  const [a, b, c] = PALETTES[i % PALETTES.length]
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = a
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = b
  ctx.beginPath()
  ctx.arc(180 + (i % 3) * 60, 220, 150, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = c
  ctx.fillRect(0, 400, 512, 112)
  ctx.fillStyle = b
  ctx.font = '600 44px Georgia, serif'
  ctx.fillText(title, 28, 470)
  return canvas.toDataURL('image/jpeg', 0.9)
}

function tracks(albumId: string, count: number, seed: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${albumId}-t${i}`,
    uri: `spotify:track:${albumId}${i}`,
    name: `Canción ${i + 1}`,
    durationMs: (150 + ((seed * 37 + i * 53) % 180)) * 1000,
    trackNumber: i + 1,
    discNumber: 1,
  }))
}

export function demoAlbums(): Album[] {
  const titles = ['Noche Clara', 'Teca', 'Sala 69', 'Ámbar', 'Surcos', 'Tocadiscos', 'Lento', 'Brisa']
  return titles.map((name, i) => {
    const id = `demo${i}`
    return {
      id,
      uri: `spotify:album:${id}`,
      name,
      artist: 'Demo Ensemble',
      year: String(1965 + i),
      coverUrl: cover(i, name),
      tracks: tracks(id, 6 + (i % 7), i + 1),
    }
  })
}

export const isDemo = (album: Album) => album.id.startsWith('demo')
