// Procedural city seen from a high-rise apartment. Everything is in metres in
// "city space": origin at the viewer's eye, +X out of the glass wall, street
// level EYE metres below.

export const EYE = 150
export const GRID_ANGLE = 0.32 // street grid is not square to the window
export const BLOCK = 118
export const STREET = 24
export const PITCH = BLOCK + STREET
export const R_MIN = 190
export const R_MAX = 5600
const HALF_FOV = 1.3 // only build what can be seen through the glass

// Downtown clusters: where the towers are
const CENTERS = [
  { x: 1650, z: -420, r: 650, peak: 430 },
  { x: 3300, z: 1150, r: 700, peak: 300 },
  { x: 900, z: 1300, r: 380, peak: 170 },
]

// A river winding across the view
export const riverZ = (x: number) => 520 + 260 * Math.sin(x / 820) + 90 * Math.sin(x / 310 + 1.3)
export const RIVER_HALF = 95

export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const toCity = (gx: number, gz: number): [number, number] => {
  const c = Math.cos(GRID_ANGLE)
  const s = Math.sin(GRID_ANGLE)
  return [gx * c - gz * s, gx * s + gz * c]
}

export const visible = (x: number, z: number, rMin = R_MIN, rMax = R_MAX) => {
  const d = Math.hypot(x, z)
  return d > rMin && d < rMax && x > 0 && Math.abs(Math.atan2(z, x)) < HALF_FOV
}

export const inRiver = (x: number, z: number, margin = 0) => Math.abs(z - riverZ(x)) < RIVER_HALF + margin

export interface Box {
  x: number
  z: number
  w: number
  d: number
  h: number
  base: number // metres above street level
  rot: number
  seed: number
  style: number // 0 residential, 1 office glass, 2 dark finned tower
  top: number // height of the whole building (for crowns)
}

export interface Beacon {
  x: number
  y: number
  z: number
  phase: number
}

export function buildLayout() {
  const rand = mulberry32(1969)
  const boxes: Box[] = []
  const beacons: Beacon[] = []
  const n = Math.ceil(R_MAX / PITCH) + 2

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const [bx, bz] = toCity(i * PITCH, j * PITCH)
      if (!visible(bx, bz) || inRiver(bx, bz, BLOCK * 0.55)) continue
      const dist = Math.hypot(bx, bz)
      // Parks: the odd empty block
      if (rand() < 0.04) continue

      let tower = 0
      for (const c of CENTERS) {
        const f = Math.exp(-((Math.hypot(bx - c.x, bz - c.z) / c.r) ** 2))
        tower = Math.max(tower, c.peak * f)
      }
      // Far away, one building per block keeps the instance count sane
      const split = dist > 2600 || tower > 140 ? 1 : rand() < 0.5 ? 4 : 2
      const lots: [number, number, number, number][] = []
      const half = BLOCK / 2
      if (split === 1) lots.push([0, 0, BLOCK, BLOCK])
      else if (split === 2) {
        const alongX = rand() < 0.5
        for (const s of [-1, 1]) lots.push(alongX ? [(s * half) / 2, 0, half, BLOCK] : [0, (s * half) / 2, BLOCK, half])
      } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) lots.push([(sx * half) / 2, (sz * half) / 2, half, half])

      for (const [ox, oz, lw, ld] of lots) {
        const w = lw - 6 - rand() * 14
        const d = ld - 6 - rand() * 14
        let h = 14 + rand() * 30 + tower * (0.3 + 0.7 * Math.pow(rand(), 0.6))
        if (rand() < 0.012) h += 120 + rand() * 120 // lone towers outside downtown
        const [cx, cz] = toCity(i * PITCH + ox, j * PITCH + oz)
        const seed = rand()
        const style = h > 110 ? (rand() < 0.55 ? 1 : 2) : rand() < 0.8 ? 0 : 1
        const rot = GRID_ANGLE
        const sink = 6 // bury the base so the ground never shows a gap
        const top = h
        boxes.push({ x: cx, z: cz, w, d, h: h + sink, base: -sink, rot, seed, style, top })

        // Setbacks: a slimmer volume on top of tall towers
        let roof = h
        if (h > 90 && rand() < 0.6) {
          const k = 0.55 + rand() * 0.25
          const h2 = h * (0.12 + rand() * 0.22)
          boxes.push({ x: cx, z: cz, w: w * k, d: d * k, h: h2, base: h, rot, seed, style, top: h + h2 })
          roof = h + h2
          boxes[boxes.length - 2].top = roof
          if (h > 220 && rand() < 0.5) {
            const h3 = 18 + rand() * 45 // spire
            boxes.push({ x: cx, z: cz, w: 2.2, d: 2.2, h: h3, base: roof, rot, seed, style: 3, top: roof + h3 })
            roof += h3
          }
        }
        // Aviation warning lights on anything tall
        if (roof > 120) beacons.push({ x: cx, y: roof + 1.5 - EYE, z: cz, phase: rand() })
      }
    }
  }
  return { boxes, beacons }
}

// Street centre lines (grid space), used by the traffic and street lamps
export function streetLines(radius: number) {
  const lines: { axis: 0 | 1; at: number }[] = []
  const n = Math.ceil(radius / PITCH) + 1
  for (let k = -n; k <= n; k++) {
    lines.push({ axis: 0, at: (k + 0.5) * PITCH })
    lines.push({ axis: 1, at: (k + 0.5) * PITCH })
  }
  return lines
}
