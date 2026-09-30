import type { PlayerSnapshot } from '../spotify/player'

/**
 * Where the music comes from: Spotify (Web Playback SDK) or the demo records
 * (plain audio streamed from the Internet Archive). The deck only needs these.
 */
export interface PlaybackSource {
  /** Ready to play (Spotify: the device is registered). */
  ready: boolean
  /** Last reported state, with `at` to extrapolate the position. */
  snapshot: PlayerSnapshot | null
  error: string | null
  play: (albumUri: string, trackUri: string, positionMs: number) => Promise<void>
  pause: () => void
  /** Called on the first user gesture: browsers only allow audio after one. */
  unlock: () => void
  /** The recordings carry their own surface noise: the deck adds none. */
  ownSurfaceNoise: boolean
}
