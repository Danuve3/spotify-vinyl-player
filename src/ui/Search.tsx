import { useState } from 'react'
import { searchAlbums, type Album } from '../spotify/api'
import { useDeck } from '../deck/store'

// Find any album on Spotify and drop it at the front of the crate.

export function Search({ onAdd }: { onAdd: (album: Album) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Album[]>([])
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return setResults([])
    setBusy(true)
    try {
      setResults(await searchAlbums(query.trim()))
    } catch (err) {
      useDeck.getState().say((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search">
      <form onSubmit={submit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={busy ? 'Buscando…' : 'Buscar un disco para la caja…'}
          aria-label="Buscar álbum"
        />
      </form>
      {results.length > 0 && (
        <ul className="search__results">
          {results.map((a) => (
            <li key={a.id}>
              <button
                className="search__item"
                onClick={() => {
                  onAdd(a)
                  setResults([])
                  setQuery('')
                  useDeck.getState().followFocus('crate')
                }}
              >
                <img src={a.coverUrl} alt="" />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.artist}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
