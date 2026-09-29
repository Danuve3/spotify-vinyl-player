import type { Album, Track } from '../spotify/api'

// Splits an album into LP sides and maps groove radius <-> playback position.
// Radii are in metres, measured on a 12" record.

export const MAX_SIDE_MS = 25 * 60 * 1000
export const R_LEAD_IN = 0.146 // first modulated groove
export const R_MIN_PROGRAM = 0.060 // innermost groove a full side may reach
export const R_LEAD_OUT = 0.054 // locked run-out groove
export const R_LABEL = 0.05
const GAP_WIDTH = 0.0016 // smooth band between tracks

// Constant groove pitch so a full 25 min side spans lead-in -> min program radius.
const REVS_PER_MS = 33.333 / 60000
const PITCH = (R_LEAD_IN - R_MIN_PROGRAM - 12 * GAP_WIDTH) / (MAX_SIDE_MS * REVS_PER_MS)

export interface Band {
  track: Track
  /** Outer radius where the track begins. */
  rStart: number
  /** Inner radius where it ends. */
  rEnd: number
}

export interface Side {
  /** "A", "B", "C"… */
  name: string
  record: number
  tracks: Track[]
  durationMs: number
  bands: Band[]
}

/** Contiguous split minimising the longest side (linear partition, tiny n). */
function partition(tracks: Track[], parts: number): Track[][] {
  const n = tracks.length
  const prefix = [0]
  for (const t of tracks) prefix.push(prefix[prefix.length - 1] + t.durationMs)
  const cost = (i: number, j: number) => prefix[j] - prefix[i]

  // best[k][j]: minimal max-side duration splitting the first j tracks into k sides
  const best = Array.from({ length: parts + 1 }, () => new Array<number>(n + 1).fill(Infinity))
  const cut = Array.from({ length: parts + 1 }, () => new Array<number>(n + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= parts; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= j; i++) {
        const v = Math.max(best[k - 1][i], cost(i, j))
        if (v < best[k][j]) {
          best[k][j] = v
          cut[k][j] = i
        }
      }
    }
  }
  const groups: Track[][] = []
  for (let k = parts, j = n; k > 0; k--) {
    const i = cut[k][j]
    groups.unshift(tracks.slice(i, j))
    j = i
  }
  return groups
}

function layoutBands(tracks: Track[]): Band[] {
  // Sides with many short tracks share the same total gap budget so they never
  // run into the label.
  const gap = Math.min(GAP_WIDTH, (12 * GAP_WIDTH) / Math.max(1, tracks.length - 1))
  let r = R_LEAD_IN
  return tracks.map((track, i) => {
    if (i > 0) r -= gap
    const rStart = r
    r -= track.durationMs * REVS_PER_MS * PITCH
    return { track, rStart, rEnd: r }
  })
}

export function splitIntoSides(album: Album): Side[] {
  const total = album.tracks.reduce((s, t) => s + t.durationMs, 0)
  let count = Math.max(2, Math.ceil(total / MAX_SIDE_MS))
  if (count % 2) count++
  // Very short albums (or singles) may leave a side empty; drop empty groups.
  count = Math.min(count, Math.max(2, album.tracks.length))
  if (count % 2 && album.tracks.length > 1) count--

  return partition(album.tracks, count)
    .filter((g) => g.length > 0)
    .map((tracks, i) => ({
      name: String.fromCharCode(65 + i),
      record: Math.floor(i / 2),
      tracks,
      durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
      bands: layoutBands(tracks),
    }))
}

export type NeedleSpot =
  | { kind: 'lead-in' }
  | { kind: 'track'; track: Track; positionMs: number }
  | { kind: 'gap'; next: Track }
  | { kind: 'run-out' }

/** What the stylus is playing at groove radius r. */
export function spotAt(side: Side, r: number): NeedleSpot {
  if (r > R_LEAD_IN) return { kind: 'lead-in' }
  for (const band of side.bands) {
    if (r > band.rStart) return { kind: 'gap', next: band.track }
    if (r >= band.rEnd) {
      const frac = (band.rStart - r) / (band.rStart - band.rEnd)
      return { kind: 'track', track: band.track, positionMs: frac * band.track.durationMs }
    }
  }
  return { kind: 'run-out' }
}

/** Groove radius for a playback position, used to move the arm while playing. */
export function radiusAt(side: Side, trackUri: string, positionMs: number): number | null {
  const band = side.bands.find((b) => b.track.uri === trackUri)
  if (!band) return null
  const frac = Math.min(1, Math.max(0, positionMs / band.track.durationMs))
  return band.rStart - frac * (band.rStart - band.rEnd)
}

export const lastRadius = (side: Side) => side.bands[side.bands.length - 1]?.rEnd ?? R_LEAD_IN
