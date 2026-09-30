import { useEffect, useRef } from 'react'
import { deckAudio } from '../audio/deckAudio'
import type { PlaybackSource } from './source'
import { currentSide, useDeck } from './store'
import { R_LEAD_IN, R_LEAD_OUT, radiusAt, spotAt } from '../vinyl/sides'

// Bridges the physical deck and the music source (Spotify or the demo records):
// - stylus lands at radius r  -> play the track/position engraved there
// - while playing             -> move the stylus inward with the music
// - gaps / lead-in            -> silence while the stylus crosses them
// - end of the side           -> locked run-out groove, then auto-return

const GAP_SPEED = 0.0016 / 2.2 // m/s: a track gap takes ~2 s to cross
const RUN_OUT_BEFORE_RETURN_MS = 4 * 1800

type Mode =
  | { kind: 'idle' }
  | { kind: 'gliding' } // lead-in or gap: stylus advances without music
  | { kind: 'starting'; trackUri: string; since: number } // waiting for Spotify to report the track
  | { kind: 'playing'; trackUri: string }
  | { kind: 'run-out'; since: number }

export function usePlayback(source: PlaybackSource) {
  const mode = useRef<Mode>({ kind: 'idle' })
  const snap = useRef(source.snapshot)
  snap.current = source.snapshot
  const src = useRef(source)
  src.current = source

  // Old 78s already crackle and hiss on their own: no surface noise of ours on top
  useEffect(() => deckAudio().setSurfaceNoise(!source.ownSurfaceNoise), [source.ownSurfaceNoise])

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const pause = () => {
      const s = snap.current
      if (s && !s.paused) src.current.pause()
    }

    const startTrack = (trackUri: string, positionMs: number) => {
      const { album } = useDeck.getState()
      if (!album || !src.current.ready) return
      mode.current = { kind: 'starting', trackUri, since: performance.now() }
      src.current.play(album.uri, trackUri, positionMs).catch((e: Error) => {
        useDeck.getState().say(e.message)
        mode.current = { kind: 'idle' }
      })
    }

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const deck = useDeck.getState()
      const side = currentSide(deck)
      const audio = deckAudio()
      const grooveLive = deck.contact && deck.vinyl === 'platter' && !!side
      const spinning = grooveLive && deck.motorOn && deck.atSpeed

      audio.setStylusDown(spinning)
      audio.setMotor(deck.motorOn)

      if (!spinning || !side) {
        // Stylus up, platter stopped or no record: silence and forget the mode
        if (mode.current.kind !== 'idle') {
          pause()
          audio.setRunOut(false)
          mode.current = { kind: 'idle' }
        }
        raf = requestAnimationFrame(tick)
        return
      }

      const r = deck.stylusRadius ?? R_LEAD_IN
      const m = mode.current

      if (m.kind === 'idle' || m.kind === 'gliding') {
        const spot = spotAt(side, r)
        if (spot.kind === 'track') startTrack(spot.track.uri, spot.positionMs)
        else if (spot.kind === 'run-out') {
          mode.current = { kind: 'run-out', since: now }
          audio.setRunOut(true)
          deck.setStylusRadius(R_LEAD_OUT)
        } else {
          mode.current = { kind: 'gliding' }
          pause()
          deck.setStylusRadius(r - GAP_SPEED * dt)
        }
      } else if (m.kind === 'starting') {
        const s = snap.current
        if (s && !s.paused && s.trackUri === m.trackUri) mode.current = { kind: 'playing', trackUri: m.trackUri }
        else if (now - m.since > 15000) mode.current = { kind: 'idle' } // retry (streams can be slow to start)
      } else if (m.kind === 'playing') {
        const s = snap.current
        if (!s) return void (raf = requestAnimationFrame(tick))
        const position = s.paused ? s.positionMs : s.positionMs + (now - s.at)
        const band = side.bands.find((b) => b.track.uri === m.trackUri)
        const duration = (s.trackUri === m.trackUri && s.durationMs) || band?.track.durationMs || 0
        // The track is over when it nears its end, or when Spotify has already
        // moved on (another track, or the paused-at-0 state it reports between tracks)
        const ended = s.trackUri !== m.trackUri || position >= duration - 300 || (s.paused && position === 0)

        if (!band) {
          // Not on this side any more: stop at the run-out
          pause()
          mode.current = { kind: 'run-out', since: now }
          audio.setRunOut(true)
          deck.setStylusRadius(R_LEAD_OUT)
        } else if (ended) {
          // Like a real record: the stylus crosses the silent gap into the next
          // track (or on to the run-out after the last one), see 'gliding'
          pause()
          mode.current = { kind: 'gliding' }
          deck.setStylusRadius(band.rEnd - 1e-5)
        } else {
          const target = radiusAt(side, m.trackUri, position)
          if (target !== null) deck.setStylusRadius(target)
        }
      } else if (m.kind === 'run-out') {
        // PS 500 auto-stop: after a few turns in the locked groove the arm returns
        if (now - m.since > RUN_OUT_BEFORE_RETURN_MS && deck.arm === 'down') {
          audio.setRunOut(false)
          mode.current = { kind: 'idle' }
          useDeck.setState({ arm: 'auto-return', motorOn: false })
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // A manual lift or stop clears any pending run-out loop immediately
  useEffect(
    () =>
      useDeck.subscribe((s, prev) => {
        if (prev.contact && !s.contact) {
          deckAudio().needleLift()
          deckAudio().setRunOut(false)
        }
        if (!prev.contact && s.contact) deckAudio().needleDrop()
      }),
    [],
  )
}
