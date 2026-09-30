import { useEffect, useState } from 'react'
import { handleCallback, isCallback, isLoggedIn, login, logout } from './spotify/auth'
import { getSavedAlbums, type Album } from './spotify/api'
import { useSpotifyPlayer } from './spotify/player'
import { usePlayback } from './deck/usePlayback'
import { currentSide, useDeck } from './deck/store'
import { spotAt } from './vinyl/sides'
import { deckAudio } from './audio/deckAudio'
import { Room } from './scene/Room'
import { Search } from './ui/Search'
import { useWeather } from './scene/weather'
import { LANDSCAPES, LANDSCAPE_ORDER, useLandscape, type LandscapeId } from './scene/landscape/landscapes'
import { useIdle } from './ui/useIdle'
import { useCrateFront } from './scene/Crate'

function useHint(): string {
  const deck = useDeck()
  if (!deck.album && (deck.focus === 'crate' || deck.focus === 'both'))
    return 'Rueda, arrastra o ←/→ para hojear · Clic en la portada (o Intro) para elegirla'
  if (!deck.album) return 'Elige un disco de la caja'
  if (deck.vinyl === 'sleeve') return 'Haz clic en la funda para sacar el vinilo'
  if (deck.vinyl === 'hand') return 'Clic en el vinilo: ponerlo en el plato · Arrástralo (o F): darle la vuelta · Clic en la funda: guardarlo'
  if (!deck.lidOpen) return 'Tapa cerrada'
  if (deck.arm === 'rest' && !deck.motorOn) return 'Pulsa start, o sube la palanca y lleva el brazo a mano'
  if (deck.arm === 'lifted') return 'Arrastra el brazo hasta el surco y baja la palanca'
  return ''
}

/** Title and artist of the record at the front of the crate. */
function CrateCaption() {
  const album = useCrateFront((s) => s.album)
  if (!album) return null
  return (
    <p className="crate-caption" key={album.id}>
      <strong>{album.name}</strong>
      <span>{album.artist}</span>
    </p>
  )
}

function NowPlaying() {
  const deck = useDeck()
  const side = currentSide(deck)
  if (!deck.album || !side || !deck.contact || deck.stylusRadius === null) return null
  const spot = spotAt(side, deck.stylusRadius)
  const label =
    spot.kind === 'track'
      ? spot.track.name
      : spot.kind === 'run-out'
        ? 'Fin de la cara'
        : spot.kind === 'gap'
          ? `→ ${spot.next.name}`
          : 'Entrada'
  return (
    <span className="now">
      <em>Cara {side.name}</em> <strong>{label}</strong> · {deck.album.artist}
    </span>
  )
}

// Dev-only: explore the room without logging in (?preview)
const PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => PREVIEW || (!isCallback() && isLoggedIn()))
  const [error, setError] = useState<string | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const { player, deviceId, snapshot, error: playerError } = useSpotifyPlayer(loggedIn && !PREVIEW)
  usePlayback(player, deviceId, snapshot)

  const hint = useHint()
  const message = useDeck((s) => s.message)
  const vinyl = useDeck((s) => s.vinyl)
  const sides = useDeck((s) => s.sides)
  const album = useDeck((s) => s.album)
  const focus = useDeck((s) => s.focus)
  const rain = useWeather((s) => s.rain)
  const landscape = useLandscape((s) => s.id)
  // With no input for a while the controls fade away, leaving just the room
  const idle = useIdle(4000)

  useEffect(() => {
    if (!isCallback()) return
    handleCallback()
      .then(() => setLoggedIn(true))
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    if (PREVIEW) {
      void import('./dev/demo').then((m) => setAlbums(m.demoAlbums()))
      return
    }
    getSavedAlbums()
      .then(setAlbums)
      .catch((e: Error) => setError(e.message))
  }, [loggedIn])

  // Messages from the deck fade after a moment
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useDeck.getState().say(null), 3500)
    return () => clearTimeout(t)
  }, [message])

  // Browsers only allow audio after a gesture: unlock Spotify and Web Audio on the first click
  useEffect(() => {
    const unlock = () => {
      deckAudio().resume()
      void player.current?.activateElement()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [player, deviceId])

  if (!loggedIn) {
    return (
      <main className="gate">
        <div className="gate-deck" aria-hidden="true">
          <div className="gate-record">
            <div className="gate-label">
              <span className="gate-label-title">Vinyl Room</span>
              <span className="gate-label-side">A · 33⅓</span>
            </div>
          </div>
          <svg className="gate-arm" viewBox="0 0 120 220">
            <circle cx="96" cy="22" r="13" className="gate-arm-base" />
            <circle cx="96" cy="22" r="4" className="gate-arm-pivot" />
            <path d="M96 22 L92 150 Q91 168 78 182" className="gate-arm-tube" />
            <rect x="64" y="176" width="22" height="12" rx="2" transform="rotate(-38 75 182)" className="gate-arm-head" />
          </svg>
        </div>
        <h1>Vinyl Room</h1>
        <p>Un tocadiscos, una habitación tranquila y tu colección de Spotify.</p>
        <button onClick={() => login().catch((e: Error) => setError(e.message))}>Entrar con Spotify</button>
        {error && <p className="error">{error}</p>}
        <small className="gate-note">Necesita Spotify Premium · acceso por invitación</small>
      </main>
    )
  }

  const fullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()

  return (
    <div className={`app ${idle ? 'app--idle' : ''}`}>
      <Room albums={albums} />

      <header className="hud-top">
        <Search onAdd={(a) => setAlbums((list) => [a, ...list.filter((x) => x.id !== a.id)])} />
        <nav className="views">
          <button className="ghost" onClick={() => useDeck.getState().setFocus('crate')}>Discos</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('deck')}>Tocadiscos</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('both')}>Discos&nbsp;+&nbsp;Tocadiscos</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('room')}>Sala</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('window')}>Ventana</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('chair')}>Sillón</button>
          <button className="ghost" onClick={() => useDeck.getState().setFocus('shelf')}>Estantería</button>
          <button
            className={`ghost toggle ${focus === 'free' ? 'toggle--on' : ''}`}
            onClick={() => useDeck.getState().setFocus('free')}
            title="Cámara libre: muévete por la habitación"
          >
            Libre
          </button>
          <label className="view-pick" title="Lo que se ve por la ventana">
            <span className="sr-only">Paisaje</span>
            <select value={landscape} onChange={(e) => useLandscape.getState().set(e.target.value as LandscapeId)}>
              {LANDSCAPE_ORDER.map((id) => (
                <option key={id} value={id}>
                  {LANDSCAPES[id].label}
                </option>
              ))}
            </select>
          </label>
          {LANDSCAPES[landscape].rain && (
            <button
              className={`ghost toggle ${rain ? 'toggle--on' : ''}`}
              onClick={useWeather.getState().toggleRain}
              aria-pressed={rain}
              title={rain ? 'Quitar la lluvia' : 'Que llueva'}
            >
              Lluvia
            </button>
          )}
          <button className="ghost" onClick={fullscreen} title="Pantalla completa">⛶</button>
        </nav>
      </header>

      {focus === 'free' && (
        <p className="free-hint">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> moverte · arrastra para mirar · <kbd>Q</kbd>
          <kbd>E</kbd> altura · <kbd>Mayús</kbd> rápido · <kbd>Esc</kbd> salir
        </p>
      )}

      <footer className="deck-bar">
        <span className={`status ${deviceId ? 'status--on' : ''}`}>{deviceId ? 'Conectado' : 'Conectando…'}</span>
        <NowPlaying />
        {!album || vinyl !== 'hand' ? null : (
          <>
            <button onClick={() => useDeck.getState().flipVinyl()}>Dar la vuelta</button>
            {sides.length > 2 && <button onClick={() => useDeck.getState().swapRecord()}>Otro disco</button>}
          </>
        )}
        {album && vinyl === 'sleeve' && (
          <button className="ghost" onClick={() => useDeck.getState().returnAlbum()}>
            Devolver a la caja
          </button>
        )}
        <button className="ghost" onClick={() => (logout(), setLoggedIn(false))}>Salir</button>
      </footer>

      <CrateCaption />
      {hint && <p className="hint">{hint}</p>}
      {(message || error || playerError) && <p className="toast">{message ?? error ?? playerError}</p>}
    </div>
  )
}
