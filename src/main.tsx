import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { useDeck } from './deck/store'
import { useQuality } from './scene/quality'

if (import.meta.env.DEV) Object.assign(window, { __deck: useDeck, __quality: useQuality })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
