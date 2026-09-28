import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repo>/; dev runs at the root so the
// registered redirect URI http://127.0.0.1:5173/callback works.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spotify-vinyl-player/' : '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
}))
