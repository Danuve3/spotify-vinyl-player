// Rain heard from inside: a recorded 60 s seamless loop (cut from a longer
// field recording, see sources/), faded in and out with the weather.

const RAIN_URL = `${import.meta.env.BASE_URL}audio/rain.mp3`
const LEVEL = 0.6

class RainAudio {
  private ctx = new AudioContext()
  private out = this.ctx.createGain()
  private loading: Promise<void> | null = null

  constructor() {
    this.out.gain.value = 0
    this.out.connect(this.ctx.destination)
  }

  /** Fetched on first use, so it costs nothing while it does not rain. */
  private load() {
    this.loading ??= (async () => {
      try {
        const res = await fetch(RAIN_URL)
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer())
        const src = this.ctx.createBufferSource()
        src.buffer = buffer
        src.loop = true
        // Skip the MP3 encoder padding at both ends so the loop has no gap
        src.loopStart = 0.05
        src.loopEnd = buffer.duration - 0.05
        src.connect(this.out)
        src.start(0, 0.05 + Math.random() * (buffer.duration - 0.2))
      } catch {
        // Silent rain then; the visuals still play
      }
    })()
    return this.loading
  }

  /** Fade the rain in or out; resumes the context (needs a user gesture once). */
  set(on: boolean) {
    void this.ctx.resume()
    if (on) void this.load()
    this.out.gain.setTargetAtTime(on ? LEVEL : 0, this.ctx.currentTime, on ? 1.5 : 0.8)
  }

  get running() {
    return this.ctx.state === 'running'
  }
}

let instance: RainAudio | null = null
export const rainAudio = () => (instance ??= new RainAudio())
