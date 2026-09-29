// Procedural turntable sounds layered over Spotify (whose DRM audio we cannot
// process). Everything is synthesised, so there are no audio assets to load.

const RPM = 33.333
const REV_S = 60 / RPM

function noiseBuffer(ctx: AudioContext, seconds: number, fill: (i: number, rate: number) => number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = fill(i, ctx.sampleRate)
  return buf
}

export class DeckAudio {
  private ctx: AudioContext
  private master: GainNode
  private surface: GainNode // groove noise + crackle, only while the stylus is down
  private motor: GainNode
  private runOutTimer: number | null = null
  private crackle: AudioBuffer
  private hiss: AudioBuffer

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)

    // Sparse crackle: random impulses with varied size and a soft tail, looped
    // over one revolution-ish length so it does not sound mechanical.
    this.crackle = noiseBuffer(this.ctx, 7.3, (i, rate) => {
      const t = i / rate
      const pop = Math.random() < 0.00018 ? (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7) : 0
      const tick = Math.random() < 0.0012 ? (Math.random() * 2 - 1) * 0.12 : 0
      // Faint once-per-revolution scratch
      const scratch = Math.abs((t % REV_S) - 0.9) < 0.004 ? (Math.random() * 2 - 1) * 0.25 : 0
      return pop + tick + scratch
    })
    this.hiss = noiseBuffer(this.ctx, 4, () => Math.random() * 2 - 1)

    this.surface = this.ctx.createGain()
    this.surface.gain.value = 0
    this.surface.connect(this.master)
    this.loop(this.crackle, this.surface, 0.55, { type: 'highpass', freq: 900 })
    this.loop(this.hiss, this.surface, 0.018, { type: 'bandpass', freq: 5000, q: 0.4 })
    // Low groove rumble modulated at the rotation rate
    const rumble = this.loop(this.hiss, this.surface, 0.05, { type: 'lowpass', freq: 90 })
    const wow = this.ctx.createOscillator()
    wow.frequency.value = 1 / REV_S
    const wowDepth = this.ctx.createGain()
    wowDepth.gain.value = 0.02
    wow.connect(wowDepth).connect(rumble.gain)
    wow.start()

    // Motor: a quiet 50 Hz hum with harmonic, fades with platter speed
    this.motor = this.ctx.createGain()
    this.motor.gain.value = 0
    this.motor.connect(this.master)
    for (const [f, g] of [[50, 0.012], [100, 0.006]] as const) {
      const osc = this.ctx.createOscillator()
      osc.frequency.value = f
      const gain = this.ctx.createGain()
      gain.gain.value = g
      osc.connect(gain).connect(this.motor)
      osc.start()
    }
  }

  private loop(buffer: AudioBuffer, out: AudioNode, level: number, filter: { type: BiquadFilterType; freq: number; q?: number }) {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = filter.type
    f.frequency.value = filter.freq
    if (filter.q) f.Q.value = filter.q
    const gain = this.ctx.createGain()
    gain.gain.value = level
    src.connect(f).connect(gain).connect(out)
    src.start(0, Math.random() * buffer.duration)
    return gain
  }

  /** Must be called from a user gesture before anything is audible. */
  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  setMotor(on: boolean) {
    this.motor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.6 : 1.2)
  }

  /** Stylus in the groove: surface noise on/off. */
  setStylusDown(down: boolean) {
    this.surface.gain.setTargetAtTime(down ? 1 : 0, this.ctx.currentTime, down ? 0.01 : 0.03)
  }

  private thump(freq: number, level: number, decay: number, noise = 0) {
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + decay)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + decay + 0.05)
    if (noise) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.hiss
      const ng = this.ctx.createGain()
      ng.gain.setValueAtTime(noise, t)
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
      src.connect(ng).connect(this.master)
      src.start(t, Math.random())
      src.stop(t + 0.06)
    }
  }

  needleDrop() {
    this.thump(70, 0.35, 0.18, 0.25)
  }

  needleLift() {
    this.thump(120, 0.08, 0.06, 0.05)
  }

  /** Mechanical click for levers, knobs and the lid. */
  click(weight = 1) {
    this.thump(1800 / weight, 0.06 * weight, 0.03, 0.12 * weight)
  }

  /**
   * Vinyl sliding against the paper inner sleeve and the card: a papery
   * friction whose loudness follows the speed of the (eased) slide.
   */
  sleeveSlide(duration: number, into = false) {
    this.resume()
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.hiss
    const band = this.ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 0.6
    band.frequency.setValueAtTime(1700, t)
    band.frequency.linearRampToValueAtTime(3000, t + duration * 0.5)
    band.frequency.linearRampToValueAtTime(1900, t + duration)
    const high = this.ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 500
    // Speed of a smoothstep slide is 6s(1-s): loud mid-way, quiet at the ends
    const curve = new Float32Array(48)
    for (let i = 0; i < curve.length; i++) {
      const s = i / (curve.length - 1)
      const speed = 6 * s * (1 - s) / 1.5
      curve[i] = 0.07 * Math.pow(speed, 0.8) * (0.85 + Math.random() * 0.3)
    }
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.setValueCurveAtTime(curve, t + 0.01, duration)
    src.connect(band).connect(high).connect(g).connect(this.master)
    src.start(t, Math.random() * 2)
    src.stop(t + duration + 0.1)
    // The record settles against the bottom of the sleeve, or leaves its edge
    window.setTimeout(() => (into ? this.thump(140, 0.05, 0.08, 0.05) : this.thump(900, 0.015, 0.03, 0.03)), duration * 1000)
  }

  /** Pull-chain lamp switch: a crisp ratchet click, and a softer one on the way back. */
  pullSwitch(release = false) {
    this.resume()
    if (release) this.thump(2200, 0.012, 0.015, 0.03)
    else {
      this.thump(3200, 0.05, 0.012, 0.16)
      window.setTimeout(() => this.thump(700, 0.03, 0.03, 0.02), 14)
    }
  }

  recordOnPlatter() {
    this.thump(55, 0.2, 0.25, 0.08)
  }

  /** Locked run-out groove: a soft thump every revolution. */
  setRunOut(active: boolean) {
    if (active && this.runOutTimer === null) {
      this.runOutTimer = window.setInterval(() => this.thump(60, 0.18, 0.12, 0.2), REV_S * 1000)
    } else if (!active && this.runOutTimer !== null) {
      clearInterval(this.runOutTimer)
      this.runOutTimer = null
    }
  }
}

let instance: DeckAudio | null = null
export const deckAudio = () => (instance ??= new DeckAudio())
