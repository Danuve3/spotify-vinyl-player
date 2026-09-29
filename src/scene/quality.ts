import { create } from 'zustand'

// Automatic quality ladder. PerformanceMonitor steps down when the frame rate
// drops and back up when there is headroom. Level 0 is the lightest.

interface Level {
  maxDpr: number
  shadows: boolean
  post: boolean
  ao: boolean
  msaa: number
}

const LEVELS: Level[] = [
  { maxDpr: 0.75, shadows: false, post: false, ao: false, msaa: 0 },
  { maxDpr: 1, shadows: false, post: true, ao: false, msaa: 0 },
  { maxDpr: 1, shadows: true, post: true, ao: false, msaa: 2 },
  { maxDpr: 1.5, shadows: true, post: true, ao: true, msaa: 4 },
  { maxDpr: 2, shadows: true, post: true, ao: true, msaa: 4 },
]

interface QualityState extends Level {
  level: number
  decline: () => void
  incline: () => void
}

export const useQuality = create<QualityState>((set, get) => ({
  // Start in the middle; the monitor settles within a few seconds
  level: 2,
  ...LEVELS[2],
  decline: () => {
    const level = Math.max(0, get().level - 1)
    set({ level, ...LEVELS[level] })
  },
  incline: () => {
    const level = Math.min(LEVELS.length - 1, get().level + 1)
    set({ level, ...LEVELS[level] })
  },
}))
