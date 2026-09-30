import * as THREE from 'three'
import { create } from 'zustand'

// The views out of the glass wall. Each is a real photograph (a band of a
// panorama, azimuth and elevation linear in the image: see
// blender/landscapes.py) under a procedural sky, plus its own animated layer.

export type LandscapeId = 'manhattan' | 'countryside' | 'sea' | 'future' | 'wasteland' | 'moon'

export interface Photo {
  url: string
  width: number
  height: number
  /** Azimuth half-width the photo covers, centred straight out of the glass. */
  halfSpan: number
  /** Elevation of its bottom and top edges (rad). */
  elBottom: number
  elTop: number
}

/** The same place by day: its own photo, and what changes in the sky. */
export interface DayLook {
  photo: Photo
  exposure: number
  haze: THREE.Vector3
  zenith: THREE.Vector3
  clouds?: number
  glow?: THREE.Vector3
  wind?: number
  mirrorBelow?: boolean
}

export interface Landscape {
  id: LandscapeId
  label: string
  /** The night photo; `day` has the daytime one. */
  photo: Photo
  /** Photo brightness. */
  exposure: number
  /** Sky low down and overhead (linear); also where the photo fades out. */
  haze: THREE.Vector3
  zenith: THREE.Vector3
  moon?: THREE.Vector3 // a procedural moon, when the photo has none
  stars: number
  twinkle: number
  milky: number
  clouds: number
  smoke: number
  glow: THREE.Vector3
  /** Lit windows and shimmering lights in the photo. */
  city: number
  wind: number
  /** What shows below the photo: its foreground mirrored, or a dark fill. */
  mirrorBelow: boolean
  /** Rain makes sense here (not on the Moon). */
  rain: boolean
  day: DayLook
}

const deg = THREE.MathUtils.degToRad
const v = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b)
const url = (file: string) => `${import.meta.env.BASE_URL}landscapes/${file}`

// Manhattan's panorama spans ~130 degrees; its horizon sits 31.5% down from the
// top, a touch below eye level (we are high up)
const MANHATTAN_SPAN = deg(65)
const MANHATTAN_V = 2 * MANHATTAN_SPAN * (1980 / 4096)
const MANHATTAN_BOTTOM = -0.02 - (1 - 0.315) * MANHATTAN_V

const MOON_PHOTO: Photo = { url: url('moon.webp'), width: 4096, height: 1375, halfSpan: deg(65), elBottom: deg(-24), elTop: deg(19.63) }

const base = {
  exposure: 1,
  stars: 1,
  twinkle: 1,
  milky: 0,
  clouds: 0,
  smoke: 0,
  glow: v(0, 0, 0),
  city: 0,
  wind: 0,
  mirrorBelow: true,
  rain: true,
}

export const LANDSCAPES: Record<LandscapeId, Landscape> = {
  manhattan: {
    ...base,
    id: 'manhattan',
    label: 'Manhattan',
    photo: {
      url: url('manhattan.webp'),
      width: 4096,
      height: 1980,
      halfSpan: MANHATTAN_SPAN,
      elBottom: MANHATTAN_BOTTOM,
      elTop: MANHATTAN_BOTTOM + MANHATTAN_V,
    },
    haze: v(0.029, 0.018, 0.013), // the photo's sky
    zenith: v(0.004, 0.005, 0.012),
    moon: v(0.78, 0.5, -0.4).normalize(),
    clouds: 1,
    city: 1,
    day: {
      // Top of the Rock looking south, January 2026
      photo: { url: url('manhattan-day.webp'), width: 4096, height: 1638, halfSpan: deg(55), elBottom: deg(-21.8), elTop: deg(22.2) },
      exposure: 1,
      haze: v(0.62, 0.66, 0.74),
      zenith: v(0.16, 0.28, 0.58),
      clouds: 0.8,
    },
  },
  countryside: {
    ...base,
    id: 'countryside',
    label: 'Campo',
    // Clarens, South Africa, by moonlight (Poly Haven)
    photo: { url: url('countryside.webp'), width: 4096, height: 2649, halfSpan: deg(75), elBottom: deg(-35), elTop: deg(62) },
    haze: v(0.0115, 0.0168, 0.0297),
    zenith: v(0.0115, 0.0168, 0.0297),
    stars: 0.6,
    wind: 1,
    city: 1, // the village lights twinkle, now and then one goes out
    day: {
      // The same hills at midday, facing the village
      photo: { url: url('countryside-day.webp'), width: 4096, height: 2649, halfSpan: deg(75), elBottom: deg(-35), elTop: deg(62) },
      exposure: 1,
      haze: v(0.6, 0.665, 0.79),
      zenith: v(0.6, 0.665, 0.79),
    },
  },
  sea: {
    ...base,
    id: 'sea',
    label: 'Mar',
    // Clear night sky with the moon low (Poly Haven); the sea is rendered
    photo: { url: url('sea-sky.webp'), width: 3413, height: 1684, halfSpan: deg(75), elBottom: deg(-4), elTop: deg(70) },
    haze: v(0.02, 0.024, 0.032),
    zenith: v(0.009, 0.0114, 0.0161),
    stars: 0.6,
    day: {
      // Late afternoon, scattered clouds, the sun low over the water
      photo: { url: url('sea-sky-day.webp'), width: 3414, height: 1684, halfSpan: deg(75), elBottom: deg(-4), elTop: deg(70) },
      exposure: 1,
      haze: v(0.45, 0.5, 0.6),
      zenith: v(0.134, 0.197, 0.311),
    },
  },
  future: {
    ...base,
    id: 'future',
    label: 'Futurista',
    // Chongqing from Eling Park at night
    photo: { url: url('future.webp'), width: 4096, height: 1338, halfSpan: deg(65), elBottom: deg(-23.5), elTop: deg(19) },
    haze: v(0.038, 0.022, 0.056),
    zenith: v(0.006, 0.004, 0.012),
    stars: 0.3,
    city: 1,
    mirrorBelow: false, // the photo ends in a dark hedge
    day: {
      // From the tower in the same park, on a hazy day
      photo: { url: url('future-day.webp'), width: 4096, height: 1235, halfSpan: deg(65), elBottom: deg(-22.6), elTop: deg(16.4) },
      exposure: 1,
      haze: v(0.8, 0.79, 0.8),
      zenith: v(0.5, 0.52, 0.58),
      mirrorBelow: true,
    },
  },
  wasteland: {
    ...base,
    id: 'wasteland',
    label: 'Postapocalíptico',
    // Pripyat, graded to a smoky dusk; the sky is procedural smoke
    photo: { url: url('wasteland.webp'), width: 2500, height: 867, halfSpan: deg(75), elBottom: deg(-40), elTop: deg(12) },
    haze: v(0.11, 0.035, 0.012),
    zenith: v(0.012, 0.008, 0.008),
    stars: 0,
    smoke: 1,
    glow: v(0.16, 0.05, 0.015),
    day: {
      // Bleached under a yellow, toxic haze; still smoking
      photo: { url: url('wasteland-day.webp'), width: 2500, height: 867, halfSpan: deg(75), elBottom: deg(-40), elTop: deg(12) },
      exposure: 1,
      haze: v(0.42, 0.37, 0.25),
      zenith: v(0.2, 0.18, 0.14),
      glow: v(0.35, 0.3, 0.18),
    },
  },
  moon: {
    ...base,
    id: 'moon',
    label: 'Luna',
    // Apollo 17 at Taurus-Littrow (NASA), under a black sky. The photo is
    // lunar day; at night the same ground is lit only by the full Earth
    photo: MOON_PHOTO,
    exposure: 0.07,
    haze: v(0, 0, 0),
    zenith: v(0, 0, 0),
    stars: 3,
    twinkle: 0,
    milky: 1,
    rain: false,
    day: { photo: MOON_PHOTO, exposure: 1, haze: v(0, 0, 0), zenith: v(0, 0, 0) },
  },
}

export const LANDSCAPE_ORDER: LandscapeId[] = ['manhattan', 'countryside', 'sea', 'future', 'wasteland', 'moon']

const KEY = 'vinyl-room:landscape'

function stored(): LandscapeId {
  try {
    const id = localStorage.getItem(KEY) as LandscapeId | null
    return id && id in LANDSCAPES ? id : 'manhattan'
  } catch {
    return 'manhattan'
  }
}

export const useLandscape = create<{ id: LandscapeId; set: (id: LandscapeId) => void }>((set) => ({
  id: stored(),
  set: (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // private mode: the choice just isn't remembered
    }
    set({ id })
  },
}))
