// Rain heard from inside a high-rise: a warm, gently swelling wash (the glass
// takes the harsh highs off), soft tonal drops tapping the pane, and now and
// then a heavier drip from the window frame. Synthesised, like the deck
// sounds, so there are no audio files.

const LEVEL = 0.3

class RainAudio {
  private ctx = new AudioContext()
  private out = this.ctx.createGain()
  private drops = this.ctx.createGain()
  private timer: number | null = null
  private nextDrop = 0
  private nextDrip = 0

  constructor() {
    const { ctx, out } = this
    out.gain.value = 0
    out.connect(ctx.destination)
    this.drops.gain.value = 1
    this.drops.connect(out)

    // Wash: long stereo pink + brown noise, low-passed like sound through glass
    const len = ctx.sampleRate * 14
    const wash = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = wash.getChannelData(ch)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856
        b4 = 0.55 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.016898
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
        brown = (brown + 0.02 * w) / 1.02
        d[i] = pink * 0.7 + brown * 2.4
      }
      // Crossfade the ends so the loop point is seamless
      const fade = ctx.sampleRate * 0.5
      for (let i = 0; i < fade; i++) {
        const k = i / fade
        d[i] = d[i] * k + d[len - fade + i] * (1 - k)
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = wash
    src.loop = true
    src.loopStart = 0
    src.loopEnd = wash.duration - 0.5
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 1100
    low.Q.value = 0.5
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 90
    const washGain = ctx.createGain()
    washGain.gain.value = 0.85
    src.connect(high).connect(low).connect(washGain).connect(out)
    src.start(0, Math.random() * 10)

    // Slow, irregular swells: two LFOs at unrelated rates on the wash level
    for (const [rate, depth] of [[0.07, 0.18], [0.023, 0.12]] as const) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const g = ctx.createGain()
      g.gain.value = depth
      lfo.connect(g).connect(washGain.gain)
      lfo.start(ctx.currentTime + Math.random() * 5)
    }
    // ... which also opens the filter a little when it swells
    const bright = ctx.createOscillator()
    bright.frequency.value = 0.07
    const bg = ctx.createGain()
    bg.gain.value = 220
    bright.connect(bg).connect(low.frequency)
    bright.start()
  }

  /** A soft tonal tap of a drop on the glass. */
  private drop(t: number, heavy = false) {
    const { ctx } = this
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const f = heavy ? 520 + Math.random() * 380 : 1500 + Math.random() * 2300
    osc.frequency.setValueAtTime(f, t)
    // Water drops glide up slightly as the bubble closes
    osc.frequency.exponentialRampToValueAtTime(f * (heavy ? 1.6 : 1.25), t + (heavy ? 0.07 : 0.03))
    const g = ctx.createGain()
    const level = heavy ? 0.05 : 0.008 + Math.random() * 0.02
    const decay = heavy ? 0.12 : 0.025 + Math.random() * 0.03
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.6 - 0.8
    // Heard through the glass: round off the top
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    osc.connect(g).connect(lp).connect(pan).connect(this.drops)
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }

  /** Schedules drops a little ahead of time while the rain is on. */
  private schedule = () => {
    const now = this.ctx.currentTime
    const horizon = now + 0.25
    if (this.nextDrop < now) this.nextDrop = now
    while (this.nextDrop < horizon) {
      this.drop(this.nextDrop)
      this.nextDrop += -Math.log(1 - Math.random()) / 7 // ~7 taps a second, random spacing
    }
    if (this.nextDrip < now) this.nextDrip = now + 2 + Math.random() * 5
    if (this.nextDrip < horizon) {
      this.drop(this.nextDrip, true)
      this.nextDrip += 2.5 + Math.random() * 6
    }
  }

  /** Fade the rain in or out; resumes the context (needs a user gesture once). */
  set(on: boolean) {
    void this.ctx.resume()
    this.out.gain.setTargetAtTime(on ? LEVEL : 0, this.ctx.currentTime, on ? 1.5 : 0.8)
    if (on && this.timer === null) this.timer = window.setInterval(this.schedule, 100)
    if (!on && this.timer !== null) {
      const timer = this.timer
      this.timer = null
      window.setTimeout(() => clearInterval(timer), 3000) // let the fade finish
    }
  }

  get running() {
    return this.ctx.state === 'running'
  }
}

let instance: RainAudio | null = null
export const rainAudio = () => (instance ??= new RainAudio())
