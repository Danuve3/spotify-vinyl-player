import * as THREE from 'three'
import type { Landscape, Photo } from './landscapes'

// The themed views. Each is one photograph (blender/landscapes_themes.py):
// the day image is the photo, the night one the same photo graded to night
// with its sky cut out, so both show exactly the same place. Cyberpunk is the
// exception: a daytime and a blue-hour photo from the same summit.

const deg = THREE.MathUtils.degToRad
const v = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b)
const url = (file: string) => `${import.meta.env.BASE_URL}landscapes/${file}`
const dir = (azDeg: number, elDeg: number) =>
  v(Math.cos(deg(elDeg)) * Math.cos(deg(azDeg)), Math.sin(deg(elDeg)), Math.cos(deg(elDeg)) * Math.sin(deg(azDeg)))

function photos(name: string, halfSpan: number, el: [number, number], day: [number, number], night: [number, number]): { day: Photo; night: Photo } {
  const common = { halfSpan: deg(halfSpan), elBottom: deg(el[0]), elTop: deg(el[1]) }
  return {
    day: { url: url(`${name}-day.webp`), width: day[0], height: day[1], ...common },
    night: { url: url(`${name}-night.webp`), width: night[0], height: night[1], ...common },
  }
}

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

// A row of floodlights (negative strength: pool of light, no visible bulb)
const flood = (us: number[], vTop: number, radius: number, strength: number): [number, number, number, number][] =>
  us.map((u) => [u, vTop, radius, -strength])
const bulbs = (us: number[], vTop: number, radius: number, strength: number): [number, number, number, number][] =>
  us.map((u) => [u, vTop, radius, strength])

const west = photos('west', 80, [-15.41, 23.11], [4096, 986], [3072, 740])
const medieval = photos('medieval', 62, [-20.43, 22.13], [4096, 1406], [3072, 1054])
const arctic = photos('arctic', 60, [-9.97, 23.84], [4096, 1154], [3072, 866])
const volcanic = photos('volcanic', 65, [-21.4, 28.36], [4096, 1568], [3072, 1176])
const fantasy = photos('fantasy', 80, [-28.37, 13.97], [4096, 1084], [3072, 813])
const forest = photos('forest', 75, [-35, 62], [3413, 2207], [3072, 1986])
const antiquity = photos('antiquity', 75, [-30, 60], [3413, 2048], [3072, 1843])
const steampunk = photos('steampunk', 75, [-32, 50], [3413, 1866], [3072, 1680])
const gothic = photos('gothic', 65, [-13.22, 18.26], [4096, 992], [3072, 744])

export type ThemeId = 'west' | 'medieval' | 'arctic' | 'volcanic' | 'fantasy' | 'forest' | 'antiquity' | 'cyberpunk' | 'steampunk' | 'gothic'

export const THEMES: Record<ThemeId, Omit<Landscape, 'id'> & { id: ThemeId }> = {
  west: {
    ...base,
    id: 'west',
    label: 'Viejo Oeste',
    // Monument Valley from the Lookout Point
    photo: west.night,
    haze: v(0.02, 0.022, 0.034),
    zenith: v(0.003, 0.004, 0.011),
    moon: dir(25, 32),
    stars: 1.6,
    milky: 0.6,
    wind: 0.3,
    shimmer: 1,
    lamps: [
      [0.57, 0.72, 0.008, 1.3], // a campfire in the valley
      [0.23, 0.63, 0.005, 0.5], // a distant ranch
    ],
    lampColor: v(1, 0.5, 0.2),
    day: { photo: west.day, exposure: 1, haze: v(0.2, 0.264, 0.475), zenith: v(0.12, 0.17, 0.38) },
  },
  medieval: {
    ...base,
    id: 'medieval',
    label: 'Medieval',
    // La Cité de Carcassonne, floodlit amber at night as it really is
    photo: medieval.night,
    haze: v(0.018, 0.02, 0.032),
    zenith: v(0.003, 0.004, 0.011),
    moon: dir(-15, 24),
    stars: 0.9,
    wind: 0.3,
    lamps: [
      // Low along the walls, so the light does not spill on the hills behind
      ...flood([0.12, 0.19, 0.26, 0.33, 0.4, 0.47, 0.53, 0.59, 0.65, 0.71, 0.77, 0.81], 0.73, 0.028, 0.6),
      ...flood([0.18, 0.27, 0.49, 0.56, 0.67, 0.79], 0.63, 0.012, 0.5),
      ...bulbs([0.3, 0.44, 0.62, 0.74], 0.66, 0.003, 0.7),
    ],
    lampColor: v(1, 0.62, 0.3),
    fires: [
      [0.3, 0.62, 0.012, -0.5],
      [0.72, 0.6, 0.01, -0.4],
    ],
    day: { photo: medieval.day, exposure: 1, haze: v(0.52, 0.63, 0.72), zenith: v(0.35, 0.46, 0.63) },
  },
  arctic: {
    ...base,
    id: 'arctic',
    label: 'Ártico',
    // Svalbard: mountains across the fjord; northern lights at night
    photo: arctic.night,
    haze: v(0.01, 0.015, 0.03),
    zenith: v(0.002, 0.004, 0.01),
    moon: dir(-40, 12),
    stars: 1.3,
    aurora: 1,
    water: [0.705, 1.0],
    fog: 0.12,
    fogNight: v(0.012, 0.015, 0.025),
    fogDay: v(0.6, 0.65, 0.73),
    day: { photo: arctic.day, exposure: 1, haze: v(0.35, 0.41, 0.62), zenith: v(0.25, 0.3, 0.5) },
  },
  volcanic: {
    ...base,
    id: 'volcanic',
    label: 'Volcánico',
    // Holuhraun, Iceland, 2014: lava fountains along a fissure
    photo: volcanic.night,
    haze: v(0.06, 0.025, 0.012),
    zenith: v(0.006, 0.005, 0.006),
    stars: 0.4,
    smoke: 0.55,
    glow: v(0.16, 0.05, 0.012),
    lava: 0.7,
    shimmer: 0.7,
    fires: [
      [0.286, 0.33, 0.08, 1.2],
      [0.186, 0.42, 0.05, 0.7],
    ],
    rain: false,
    day: { photo: volcanic.day, exposure: 1, haze: v(0.49, 0.52, 0.55), zenith: v(0.42, 0.45, 0.5), glow: v(0.3, 0.28, 0.26) },
  },
  fantasy: {
    ...base,
    id: 'fantasy',
    label: 'Fantasía épica',
    // The Old Man of Storr, Skye; two moons and dragons over the sound
    photo: fantasy.night,
    haze: v(0.012, 0.016, 0.032),
    zenith: v(0.003, 0.004, 0.012),
    moon: dir(-25, 22),
    moon2: dir(20, 30),
    stars: 1.5,
    milky: 0.7,
    aurora: 0.35,
    wind: 0.8,
    water: [0.36, 0.5, 0.18, 0.85],
    lamps: bulbs([0.43, 0.46, 0.49, 0.51], 0.475, 0.004, 0.5),
    day: { photo: fantasy.day, exposure: 1, haze: v(0.68, 0.76, 0.87), zenith: v(0.4, 0.52, 0.72) },
  },
  forest: {
    ...base,
    id: 'forest',
    label: 'Bosque misterioso',
    // Misty pines; will-o'-the-wisps drift between the trunks at night
    photo: forest.night,
    haze: v(0.01, 0.013, 0.02),
    zenith: v(0.006, 0.008, 0.013),
    stars: 0,
    wind: 0.3,
    fog: 0.55,
    fogNight: v(0.012, 0.016, 0.024),
    fogDay: v(0.78, 0.8, 0.84),
    day: { photo: forest.day, exposure: 1, haze: v(0.86, 0.88, 0.97), zenith: v(0.8, 0.83, 0.92) },
  },
  antiquity: {
    ...base,
    id: 'antiquity',
    label: 'Antigüedad clásica',
    // The Colosseum from the Via Sacra; its arcades floodlit at night
    photo: antiquity.night,
    haze: v(0.02, 0.022, 0.035),
    zenith: v(0.004, 0.005, 0.012),
    moon: dir(-30, 35),
    stars: 0.5,
    shimmer: 0.3,
    lamps: [
      ...flood([0.52, 0.6, 0.68, 0.76, 0.84, 0.92], 0.61, 0.03, 0.75),
      ...flood([0.55, 0.64, 0.72, 0.8, 0.88, 0.96], 0.47, 0.028, 0.65),
      ...flood([0.6, 0.7, 0.8, 0.9], 0.33, 0.026, 0.55),
    ],
    lampColor: v(1, 0.7, 0.42),
    day: { photo: antiquity.day, exposure: 1, haze: v(0.15, 0.28, 0.67), zenith: v(0.1, 0.2, 0.55) },
  },
  cyberpunk: {
    ...base,
    id: 'cyberpunk',
    label: 'Cyberpunk',
    // Kowloon from Lion Rock, at blue hour and by day, under neon holograms
    photo: { url: url('cyberpunk-night.webp'), width: 3072, height: 664, halfSpan: deg(90), elBottom: deg(-31.54), elTop: deg(7.4) },
    haze: v(0.06, 0.035, 0.08),
    zenith: v(0.012, 0.01, 0.025),
    stars: 0.2,
    clouds: 0.6,
    city: 1,
    fog: 0.12,
    fogNight: v(0.06, 0.02, 0.07),
    fogDay: v(0.7, 0.7, 0.72),
    day: {
      photo: { url: url('cyberpunk-day.webp'), width: 4096, height: 984, halfSpan: deg(80), elBottom: deg(-26.91), elTop: deg(11.53) },
      exposure: 1,
      haze: v(0.7, 0.72, 0.75),
      zenith: v(0.45, 0.5, 0.6),
    },
  },
  steampunk: {
    ...base,
    id: 'steampunk',
    label: 'Steampunk',
    // Hamburg's Speicherstadt: brick warehouses, a canal, airships overhead
    photo: steampunk.night,
    haze: v(0.03, 0.025, 0.02),
    zenith: v(0.004, 0.004, 0.008),
    moon: dir(20, 38),
    stars: 0.4,
    water: [0.62, 0.93, 0.43, 0.57],
    fog: 0.1,
    fogNight: v(0.03, 0.028, 0.025),
    fogDay: v(0.7, 0.68, 0.62),
    lamps: [
      ...bulbs([0.08, 0.2, 0.32], 0.62, 0.006, 1.0),
      ...bulbs([0.64, 0.76, 0.88], 0.6, 0.006, 1.0),
      ...flood([0.15, 0.3, 0.7, 0.85], 0.4, 0.03, 0.3),
    ],
    lampColor: v(1, 0.8, 0.45),
    fires: [
      [0.13, 0.14, 0.015, -0.6],
      [0.3, 0.27, 0.012, -0.5],
      [0.73, 0.12, 0.015, -0.6],
      [0.9, 0.2, 0.012, -0.5],
    ],
    day: { photo: steampunk.day, exposure: 1, haze: v(0.75, 0.82, 0.92), zenith: v(0.45, 0.6, 0.85) },
  },
  gothic: {
    ...base,
    id: 'gothic',
    label: 'Gótico',
    // Prague Castle and St Vitus over the Vltava; mist, bats and a full moon
    photo: gothic.night,
    haze: v(0.02, 0.02, 0.035),
    zenith: v(0.003, 0.004, 0.01),
    moon: dir(6.5, 14),
    stars: 0.7,
    water: [0.6, 1.0, 0.0, 0.93],
    fog: 0.25,
    fogNight: v(0.02, 0.022, 0.03),
    fogDay: v(0.72, 0.76, 0.82),
    lamps: [
      [0.49, 0.33, 0.02, -1.0],
      [0.495, 0.3, 0.012, -0.8],
      ...flood([0.44, 0.47, 0.53, 0.57, 0.62], 0.39, 0.02, 0.6),
      [0.17, 0.47, 0.02, -0.5],
      [0.46, 0.5, 0.025, -0.5],
      ...bulbs([0.61, 0.65, 0.69, 0.73, 0.77, 0.81, 0.85, 0.89], 0.51, 0.004, 0.9),
      ...bulbs([0.61, 0.65, 0.69, 0.73, 0.77, 0.81, 0.85], 0.69, 0.008, 0.35), // their reflections
    ],
    lampColor: v(1, 0.66, 0.34),
    day: { photo: gothic.day, exposure: 1, haze: v(0.3, 0.5, 0.9), zenith: v(0.2, 0.36, 0.75) },
  },
}

export const THEME_ORDER: ThemeId[] = ['west', 'medieval', 'arctic', 'volcanic', 'fantasy', 'forest', 'antiquity', 'cyberpunk', 'steampunk', 'gothic']
