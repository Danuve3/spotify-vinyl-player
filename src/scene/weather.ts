import { create } from 'zustand'

// Weather outside the glass wall. `rain` is the switch; `rainAmount` is the
// eased 0..1 level that shaders and audio follow, so rain fades in and out.

const KEY = 'vinyl-room:rain'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface WeatherState {
  rain: boolean
  toggleRain: () => void
}

export const useWeather = create<WeatherState>((set, get) => ({
  rain: stored(),
  toggleRain: () => {
    const rain = !get().rain
    try {
      localStorage.setItem(KEY, rain ? '1' : '0')
    } catch {
      // private mode: the choice just isn't remembered
    }
    set({ rain })
  },
}))

/** Shared shader uniform, eased towards the switch by <Rain />. */
export const rainAmount = { value: stored() ? 1 : 0 }
