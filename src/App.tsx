import { useEffect, useState } from 'react'
import { handleCallback, isCallback, isLoggedIn, login, logout } from './spotify/auth'
import { getAlbum, getSavedAlbums, play, type Album } from './spotify/api'
import { useSpotifyPlayer } from './spotify/player'
import { Room } from './scene/Room'
import { Crate } from './ui/Crate'

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => !isCallback() && isLoggedIn())
  const [error, setError] = useState<string | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const [current, setCurrent] = useState<Album | null>(null)
  const { player, deviceId, snapshot, error: playerError } = useSpotifyPlayer(loggedIn)

  useEffect(() => {
    if (!isCallback()) return
    handleCallback()
      .then(() => setLoggedIn(true))
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    getSavedAlbums()
      .then(setAlbums)
      .catch((e: Error) => setError(e.message))
  }, [loggedIn])

  async function pick(album: Album) {
    if (!deviceId) return setError('El reproductor aún se está conectando…')
    setError(null)
    // Browsers block audio until a user gesture unlocks it.
    await player.current?.activateElement()
    try {
      const full = await getAlbum(album.id)
      setCurrent(full)
      await play(deviceId, full.uri, full.tracks[0].uri)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const playing = !!snapshot && !snapshot.paused
  const track = current?.tracks.find((t) => t.uri === snapshot?.trackUri)

  if (!loggedIn) {
    return (
      <main className="gate">
        <h1>Vinyl Room</h1>
        <p>Un tocadiscos, una habitación tranquila y tu colección de Spotify.</p>
        <button onClick={() => login().catch((e: Error) => setError(e.message))}>
          Entrar con Spotify
        </button>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  return (
    <div className="app">
      <Room coverUrl={current?.coverUrl ?? null} spinning={playing} />
      <Crate albums={albums} onPick={pick} />

      <footer className="deck-bar">
        <span className={`status ${deviceId ? 'status--on' : ''}`}>
          {deviceId ? 'Conectado' : 'Conectando…'}
        </span>
        {current && (
          <span className="now">
            <strong>{track?.name ?? current.name}</strong> · {current.artist}
          </span>
        )}
        {current && (
          <button onClick={() => player.current?.togglePlay()}>
            {playing ? 'Pausa' : 'Reanudar'}
          </button>
        )}
        <button className="ghost" onClick={() => (logout(), setLoggedIn(false))}>
          Salir
        </button>
      </footer>

      {(error || playerError) && <p className="toast">{error ?? playerError}</p>}
    </div>
  )
}
