import type { Album } from '../spotify/api'
import data from './great78.json'

// Demo records: 78 rpm sides from 1906-1925 (public domain in the US), from
// the Great 78 Project at the Internet Archive, gathered into four LPs by
// scripts/great78.py. The audio streams from archive.org.

export const DEMO_PREFIX = 'g78-'

export function demoAlbums(): Album[] {
  return data.map((a) => ({
    id: a.id,
    uri: `great78:${a.id}`,
    name: a.name,
    artist: a.artist,
    year: a.year,
    coverUrl: `${import.meta.env.BASE_URL}${a.cover}`,
    tracks: a.sides.map((s, i) => ({
      id: s.identifier,
      uri: s.url,
      name: s.name,
      durationMs: s.durationMs,
      trackNumber: i + 1,
      discNumber: 1,
    })),
  }))
}

export const isDemoAlbum = (id: string) => id.startsWith(DEMO_PREFIX)
