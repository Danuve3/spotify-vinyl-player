import * as THREE from 'three'
import { create } from 'zustand'

// The views out of the glass wall. Each is a real photograph (a band of a
// panorama, azimuth and elevation linear in the image: see
// blender/landscapes.py) under a procedural sky, plus its own animated layer.

export type LandscapeId = 'manhattan' | 'countryside' | 'sea' | 'future' | 'wasteland' | 'moon'

export interface Landscape {
  id: LandscapeId
  label: string
  photo: {
    url: string
    width: number
    height: number
    /** Azimuth half-width the photo covers, centred straight out of the glass. */
    halfSpan: number
    /** Elevation of its bottom and top edges (rad). */
    elBottom: number
    elTop: number
  }
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
}

const deg = THREE.MathUtils.degToRad
const v = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b)
const url = (file: string) => `${import.meta.env.BASE_URL}landscapes/${file}`

// Manhattan's panorama spans ~130 degrees; its horizon sits 31.5% down from the
// top, a touch below eye level (we are high up)
const MANHATTAN_SPAN = deg(65)
const MANHATTAN_V = 2 * MANHATTAN_SPAN * (1980 / 4096)
const MANHATTAN_BOTTOM = -0.02 - (1 - 0.315) * MANHATTAN_V

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
  },
  moon: {
    ...base,
    id: 'moon',
    label: 'Luna',
    // Apollo 17 at Taurus-Littrow (NASA), under a black sky
    photo: { url: url('moon.webp'), width: 4096, height: 1375, halfSpan: deg(65), elBottom: deg(-24), elTop: deg(19.63) },
    haze: v(0, 0, 0),
    zenith: v(0, 0, 0),
    stars: 3,
    twinkle: 0,
    milky: 1,
    rain: false,
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
