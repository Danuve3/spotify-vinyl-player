import { useEffect, useRef, useState } from 'react'
import { getAccessToken } from './auth'
import { transferPlayback } from './api'

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

export interface PlayerSnapshot {
  paused: boolean
  positionMs: number
  durationMs: number
  trackUri: string | null
  /** performance.now() when positionMs was reported, to extrapolate progress. */
  at: number
}

let sdkReady: Promise<void> | null = null

function loadSdk(): Promise<void> {
  sdkReady ??= new Promise((resolve) => {
    if (window.Spotify) return resolve()
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    document.body.appendChild(script)
  })
  return sdkReady
}

/** Registers this browser tab as a Spotify Connect device. */
export function useSpotifyPlayer(enabled: boolean) {
  const playerRef = useRef<Spotify.Player | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    loadSdk().then(() => {
      if (cancelled) return
      const player = new window.Spotify.Player({
        name: 'Vinyl Room',
        volume: 0.8,
        getOAuthToken: (cb) => {
          getAccessToken().then((token) => token && cb(token))
        },
      })
      playerRef.current = player

      player.addListener('ready', ({ device_id }) => {
        setDeviceId(device_id)
        transferPlayback(device_id).catch(() => {})
      })
      player.addListener('not_ready', () => setDeviceId(null))
      player.addListener('player_state_changed', (state) => {
        if (!state) return setSnapshot(null)
        setSnapshot({
          paused: state.paused,
          positionMs: state.position,
          durationMs: state.duration,
          trackUri: state.track_window.current_track?.uri ?? null,
          at: performance.now(),
        })
      })
      player.addListener('initialization_error', ({ message }) => setError(message))
      player.addListener('authentication_error', ({ message }) => setError(message))
      player.addListener('account_error', () =>
        setError('Se necesita una cuenta Spotify Premium'),
      )
      player.addListener('playback_error', ({ message }) => setError(message))

      player.connect()
    })

    return () => {
      cancelled = true
      playerRef.current?.disconnect()
      playerRef.current = null
      setDeviceId(null)
    }
  }, [enabled])

  return { player: playerRef, deviceId, snapshot, error }
}
