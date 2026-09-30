import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { useDeck } from './deck/store'
import { useQuality } from './scene/quality'
import { useLandscape } from './scene/landscape/landscapes'
import { useDaytime } from './scene/daytime'
import { useLamp } from './scene/lamp'
import { preloadGrooves } from './vinyl/textures'

if (import.meta.env.DEV) Object.assign(window, { __deck: useDeck, __quality: useQuality, __landscape: useLandscape, __day: useDaytime, __lamp: useLamp })

preloadGrooves()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
