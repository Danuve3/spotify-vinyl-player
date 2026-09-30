import { Drift, Flyers, Holograms, Sparks, Tumbleweeds, type Flock, type Fountain, type Hologram, type Roller } from './effects'
import { Meteors } from './Meteors'
import { Skyways } from './Future'
import type { ThemeId } from './themeDefs'
import type { ComponentType } from 'react'

// What moves in each themed view. Positions are (u, v from the top) in its photo.

const westRollers: Roller[] = [
  { v: 0.9, size: 4.5, period: 34, phase: 0, dir: 1 },
  { v: 0.8, size: 2.6, period: 52, phase: 0.45, dir: 1 },
  { v: 0.73, size: 1.5, period: 75, phase: 0.2, dir: -1 },
]
const westFlocks: Flock[] = [{ kind: 'bird', count: 2, from: [0.42, 0.22], orbit: [0.07, 0.05], period: 40, size: 0.9, when: 'day' }]

function West() {
  return (
    <>
      <Tumbleweeds rollers={westRollers} />
      <Flyers flocks={westFlocks} />
      <Drift count={120} colour={[0.55, 0.4, 0.28]} speed={0.1} size={0.04} wind={2} wander={2} low={-3} high={4} when="day" />
      <Meteors every={12} />
    </>
  )
}

const medievalFlocks: Flock[] = [
  { kind: 'bird', count: 9, from: [-0.05, 0.32], to: [1.05, 0.2], period: 55, size: 0.7, spread: [0.03, 0.03], when: 'day' },
  { kind: 'bat', count: 6, from: [0.5, 0.38], orbit: [0.16, 0.1], period: 22, size: 0.55, when: 'night' },
]

function Medieval() {
  return <Flyers flocks={medievalFlocks} />
}

const gulls: Flock[] = [
  { kind: 'gull', count: 3, from: [1.05, 0.55], to: [-0.05, 0.4], period: 45, size: 1.1, spread: [0.04, 0.03], when: 'day' },
  { kind: 'gull', count: 2, from: [0.3, 0.45], orbit: [0.1, 0.05], period: 30, size: 0.9, when: 'day' },
]

function Arctic() {
  return (
    <>
      <Flyers flocks={gulls} />
      <Drift count={500} colour={[0.85, 0.88, 0.95]} speed={-0.7} size={0.035} wind={0.6} wander={1.2} />
      <Meteors every={20} />
    </>
  )
}

const lavaFountains: Fountain[] = [
  { u: 0.29, v: 0.47, width: 0.13, height: 1.6, count: 280 },
  { u: 0.16, v: 0.47, width: 0.04, height: 0.8, count: 70 },
]

function Volcanic() {
  return (
    <>
      <Sparks fountains={lavaFountains} />
      <Drift count={350} colour={[0.08, 0.075, 0.075]} speed={-0.35} size={0.035} wind={0.8} wander={1.5} />
      <Drift count={70} colour={[3, 1.1, 0.25]} speed={0.9} size={0.03} glow wind={0.6} wander={1} low={-4} high={12} />
    </>
  )
}

const dragons: Flock[] = [
  { kind: 'dragon', count: 1, from: [0.55, 0.22], orbit: [0.12, 0.04], period: 70, size: 7 },
  { kind: 'dragon', count: 1, from: [1.1, 0.26], to: [-0.1, 0.12], period: 95, size: 11 },
  { kind: 'bird', count: 5, from: [-0.05, 0.4], to: [1.05, 0.34], period: 50, size: 0.6, spread: [0.03, 0.02], when: 'day' },
]

function Fantasy() {
  return (
    <>
      <Flyers flocks={dragons} />
      <Meteors every={10} />
    </>
  )
}

const forestFlocks: Flock[] = [{ kind: 'bird', count: 3, from: [-0.05, 0.3], to: [1.05, 0.25], period: 35, size: 0.7, spread: [0.03, 0.02], when: 'day' }]

function Forest() {
  return (
    <>
      <Flyers flocks={forestFlocks} occlude={false} />
      {/* Will-o'-the-wisps: cold lights that drift and pulse among the trunks */}
      <Drift count={45} colour={[0.35, 1.3, 1.0]} speed={0.05} size={0.12} glow pulse wander={2.5} low={-1.5} high={1.5} when="night" />
      <Drift count={120} colour={[0.75, 1.1, 0.3]} speed={0.02} size={0.05} glow pulse wander={1} low={-1.5} high={0.5} when="night" />
    </>
  )
}

const antiquityFlocks: Flock[] = [
  { kind: 'bird', count: 14, from: [0.3, 0.25], orbit: [0.16, 0.08], period: 14, size: 0.45, when: 'day' },
  { kind: 'bat', count: 5, from: [0.7, 0.2], orbit: [0.1, 0.06], period: 16, size: 0.4, when: 'night' },
]

function Antiquity() {
  return <Flyers flocks={antiquityFlocks} />
}

const signs: Hologram[] = [
  { u: 0.3, v: 0.3, w: 4, h: 6, hue: 0.85 },
  { u: 0.45, v: 0.36, w: 3, h: 4.5, hue: 0.5 },
  { u: 0.62, v: 0.26, w: 6, h: 3.5, hue: 0.92 },
  { u: 0.76, v: 0.4, w: 3, h: 4, hue: 0.55 },
  { u: 0.18, v: 0.45, w: 2, h: 3, hue: 0.78 },
  { u: 0.55, v: 0.5, w: 2.5, h: 1.8, hue: 0.12 },
]

function Cyberpunk() {
  return (
    <>
      <Holograms signs={signs} />
      <Skyways />
    </>
  )
}

const airships: Flock[] = [
  // Mostly seen in the gap of sky over the canal, and above the rooftops
  { kind: 'airship', count: 1, from: [0.5, 0.33], orbit: [0.04, 0.01], period: 240, size: 5 },
  { kind: 'airship', count: 1, from: [0.47, 0.42], orbit: [0.025, 0.006], period: 180, size: 2.2 },
  { kind: 'airship', count: 1, from: [-0.1, 0.1], to: [1.1, 0.06], period: 200, size: 9 },
  { kind: 'bird', count: 5, from: [1.05, 0.35], to: [-0.05, 0.3], period: 30, size: 0.5, spread: [0.03, 0.02], when: 'day' },
]

function Steampunk() {
  return <Flyers flocks={airships} />
}

const gothicFlocks: Flock[] = [
  { kind: 'bat', count: 12, from: [0.5, 0.18], orbit: [0.13, 0.08], period: 18, size: 0.6, when: 'night' },
  { kind: 'bird', count: 6, from: [-0.05, 0.25], to: [1.05, 0.15], period: 45, size: 0.55, spread: [0.03, 0.02], when: 'day' },
]

function Gothic() {
  return <Flyers flocks={gothicFlocks} />
}

export const THEME_LAYERS: Record<ThemeId, ComponentType> = {
  west: West,
  medieval: Medieval,
  arctic: Arctic,
  volcanic: Volcanic,
  fantasy: Fantasy,
  forest: Forest,
  antiquity: Antiquity,
  cyberpunk: Cyberpunk,
  steampunk: Steampunk,
  gothic: Gothic,
}
