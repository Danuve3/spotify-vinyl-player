import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerSnapshot } from '../spotify/player'
import type { PlaybackSource } from '../deck/source'

// The demo records play from the Internet Archive through a plain <audio>
// element: no account needed. Reports its state like the Spotify SDK does, so
// the deck drives both the same way.

export function useDemoPlayer(enabled: boolean): PlaybackSource {
  const audio = useMemo(() => {
    const a = new Audio()
    a.preload = 'auto'
    a.crossOrigin = 'anonymous'
    return a
  }, [])
  // The track as the deck names it (the element may normalise its src)
  const current = useRef<string | null>(null)
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const report = () =>
      setSnapshot({
        paused: audio.paused,
        positionMs: audio.currentTime * 1000,
        durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0,
        trackUri: current.current,
        at: performance.now(),
      })
    const failed = () => setError('No se pudo cargar el disco (Internet Archive)')
    const events = ['playing', 'pause', 'seeked', 'timeupdate', 'ended'] as const
    for (const e of events) audio.addEventListener(e, report)
    audio.addEventListener('error', failed)
    return () => {
      for (const e of events) audio.removeEventListener(e, report)
      audio.removeEventListener('error', failed)
      audio.pause()
    }
  }, [enabled, audio])

  return useMemo(
    () => ({
      ready: enabled,
      snapshot,
      error,
      ownSurfaceNoise: true,
      play: async (_album: string, trackUri: string, positionMs: number) => {
        setError(null)
        if (current.current !== trackUri) {
          current.current = trackUri
          audio.src = trackUri
        }
        const seek = () => {
          audio.currentTime = Math.max(0, positionMs / 1000)
        }
        if (audio.readyState >= 1) seek()
        else audio.addEventListener('loadedmetadata', seek, { once: true })
        await audio.play()
      },
      pause: () => audio.pause(),
      unlock: () => {
        // A silent play/pause inside the gesture lets later plays start by themselves
        if (!current.current) return
        void audio.play().then(() => audio.pause()).catch(() => {})
      },
    }),
    [enabled, snapshot, error, audio],
  )
}
