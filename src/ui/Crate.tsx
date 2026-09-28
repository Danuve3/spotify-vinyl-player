import { useState } from 'react'
import { searchAlbums, type Album } from '../spotify/api'

// Provisional 2D record crate; phase 2 replaces it with the 3D shelf.

interface Props {
  albums: Album[]
  onPick: (album: Album) => void
}

export function Crate({ albums, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Album[] | null>(null)
  const [searching, setSearching] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return setResults(null)
    setSearching(true)
    try {
      setResults(await searchAlbums(query.trim()))
    } finally {
      setSearching(false)
    }
  }

  const shown = results ?? albums

  return (
    <aside className="crate">
      <form onSubmit={search} className="crate__search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar un disco…"
          aria-label="Buscar álbum"
        />
        {results && (
          <button type="button" onClick={() => (setQuery(''), setResults(null))}>
            Mis discos
          </button>
        )}
      </form>
      <p className="crate__heading">
        {searching ? 'Buscando…' : results ? 'Resultados' : 'Tu colección'}
      </p>
      <ul className="crate__grid">
        {shown.map((album) => (
          <li key={album.id}>
            <button className="sleeve" onClick={() => onPick(album)} title={album.name}>
              <img src={album.coverUrl} alt="" loading="lazy" />
              <span className="sleeve__name">{album.name}</span>
              <span className="sleeve__artist">{album.artist}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
