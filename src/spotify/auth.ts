// Spotify Authorization Code flow with PKCE. Only the public Client ID is
// bundled; tokens live in localStorage of the user's own browser.

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
]

const STORAGE_KEY = 'vinyl.spotify.token'
const VERIFIER_KEY = 'vinyl.spotify.verifier'

interface StoredToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export const redirectUri = () =>
  `${window.location.origin}${import.meta.env.BASE_URL}callback`

export const isCallback = () =>
  window.location.pathname.replace(/\/$/, '').endsWith('/callback')

function requireClientId(): string {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  return CLIENT_ID
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(64)))
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredToken) : null
  } catch {
    return null
  }
}

function saveToken(res: TokenResponse, previousRefresh?: string): StoredToken {
  const token: StoredToken = {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? previousRefresh ?? '',
    // Refresh a minute early to avoid racing the expiry.
    expiresAt: Date.now() + (res.expires_in - 60) * 1000,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(token))
  return token
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: requireClientId(), ...body }),
  })
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`)
  return res.json()
}

export async function login(): Promise<void> {
  const verifier = randomVerifier()
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: requireClientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    scope: SCOPES.join(' '),
  })
  window.location.assign(`${AUTHORIZE_URL}?${params}`)
}

/** Exchanges the ?code on the callback URL and returns to the app root. */
export async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  const code = params.get('code')
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  window.history.replaceState(null, '', import.meta.env.BASE_URL)

  if (error) throw new Error(`Spotify login cancelled: ${error}`)
  if (!code || !verifier) throw new Error('Invalid Spotify callback')

  saveToken(
    await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  )
}

let refreshing: Promise<StoredToken> | null = null

/** Returns a valid access token, refreshing it if needed; null if logged out. */
export async function getAccessToken(): Promise<string | null> {
  const token = readToken()
  if (!token) return null
  if (Date.now() < token.expiresAt) return token.accessToken

  refreshing ??= requestToken({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
  })
    .then((res) => saveToken(res, token.refreshToken))
    .finally(() => {
      refreshing = null
    })

  try {
    return (await refreshing).accessToken
  } catch {
    logout()
    return null
  }
}

export const isLoggedIn = () => readToken() !== null

export function logout(): void {
  localStorage.removeItem(STORAGE_KEY)
}
