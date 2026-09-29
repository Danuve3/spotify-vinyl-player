import { getAccessToken } from './auth'

const API = 'https://api.spotify.com/v1'

export interface Track {
  id: string
  uri: string
  name: string
  durationMs: number
  trackNumber: number
  discNumber: number
}

export interface Album {
  id: string
  uri: string
  name: string
  artist: string
  year: string
  coverUrl: string
  tracks: Track[]
}

export class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new SpotifyError(401, 'Not logged in')

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new SpotifyError(res.status, body?.error?.message ?? res.statusText)
  }
  return res.status === 204 || res.headers.get('content-length') === '0'
    ? (undefined as T)
    : res.json().catch(() => undefined as T)
}

function toTrack(t: any): Track {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    durationMs: t.duration_ms,
    trackNumber: t.track_number,
    discNumber: t.disc_number,
  }
}

function toAlbum(a: any): Album {
  return {
    id: a.id,
    uri: a.uri,
    name: a.name,
    artist: a.artists.map((x: any) => x.name).join(', '),
    year: (a.release_date ?? '').slice(0, 4),
    // Spotify lists images largest first; the 640px one is the real cover.
    coverUrl: a.images?.[0]?.url ?? '',
    tracks: (a.tracks?.items ?? []).map(toTrack),
  }
}

/** The most recently saved albums, fetched 50 at a time (the API maximum). */
export async function getSavedAlbums(total = 150): Promise<Album[]> {
  const albums: Album[] = []
  let next: string | null = `/me/albums?limit=50`
  while (next && albums.length < total) {
    const page: any = await request<any>(next.replace(API, ''))
    albums.push(...page.items.map((item: any) => toAlbum(item.album)))
    next = page.next
  }
  return albums.slice(0, total)
}

export async function searchAlbums(query: string): Promise<Album[]> {
  const q = encodeURIComponent(query)
  // Development-mode apps may ask for at most 10 results per type (Feb 2026)
  const res = await request<any>(`/search?type=album&limit=10&q=${q}`)
  return res.albums.items.map(toAlbum)
}

/** Full album with every track (album endpoints page tracks after 50). */
export async function getAlbum(id: string): Promise<Album> {
  const album = toAlbum(await request<any>(`/albums/${id}`))
  const first = await request<any>(`/albums/${id}/tracks?limit=50`)
  album.tracks = first.items.map(toTrack)
  let next: string | null = first.next
  while (next) {
    const page: any = await request<any>(next.replace(API, ''))
    album.tracks.push(...page.items.map(toTrack))
    next = page.next
  }
  return album
}

export async function play(
  deviceId: string,
  albumUri: string,
  trackUri: string,
  positionMs = 0,
): Promise<void> {
  await request(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({
      context_uri: albumUri,
      offset: { uri: trackUri },
      position_ms: Math.max(0, Math.round(positionMs)),
    }),
  })
}

export async function transferPlayback(deviceId: string): Promise<void> {
  await request('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  })
}
