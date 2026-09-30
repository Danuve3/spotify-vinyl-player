import { create } from 'zustand'

// Day or night outside. `dayLevel` is the eased 0..1 uniform that the room's
// lightmaps, the lights and the landscape follow, so the change is a fade.

const KEY = 'vinyl-room:day'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface DaytimeState {
  day: boolean
  toggle: () => void
}

export const useDaytime = create<DaytimeState>((set, get) => ({
  day: stored(),
  toggle: () => {
    const day = !get().day
    try {
      localStorage.setItem(KEY, day ? '1' : '0')
    } catch {
      // private mode: the choice just isn't remembered
    }
    set({ day })
  },
}))

export const dayLevel = { value: stored() ? 1 : 0 }
