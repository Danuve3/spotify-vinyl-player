import { useEffect, useState } from 'react'

/**
 * True after `ms` without pointer, key, wheel or touch input. Never idles
 * while a field has focus (typing a search) or a button is held (dragging).
 */
export function useIdle(ms = 4000): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer = 0
    let held = false
    const arm = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const el = document.activeElement as HTMLElement | null
        const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (held || typing) arm()
        else setIdle(true)
      }, ms)
    }
    const wake = () => {
      setIdle(false)
      arm()
    }
    const down = () => {
      held = true
      wake()
    }
    const up = () => {
      held = false
      wake()
    }
    const events = ['pointermove', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, wake, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    arm()
    return () => {
      clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, wake)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [ms])

  return idle
}
