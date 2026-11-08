// Optional ambient sound, synthesized with WebAudio (no audio files, no network). Off by default.
// Keyboard clicks follow how many employees are really working; everything else is cosmetic.
// Silent while the app is in the background or unfocused, so it never plays behind other work.

export interface SoundPrefs {
  enabled: boolean
  ambience: number
  effects: number
}

const KEY = 'autopia:sound'
const DEFAULTS: SoundPrefs = { enabled: false, ambience: 0.5, effects: 0.6 }

class OfficeSound {
  private ctx: AudioContext | null = null
  private amb: GainNode | null = null
  private fx: GainNode | null = null
  private tone: AudioBufferSourceNode | null = null
  private noise: AudioBuffer | null = null
  private typists = 0
  private typing: number | null = null
  prefs: SoundPrefs = load()
  private lastStep = 0

  constructor() {
    const sync = () => this.syncFocus()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('blur', sync)
    window.addEventListener('focus', sync)
  }

  /** Pause everything while the window is hidden or another app has focus; pick up again on return. */
  private syncFocus(): void {
    if (!this.ctx || !this.prefs.enabled) return
    if (document.hidden || !document.hasFocus()) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  apply(prefs: SoundPrefs): void {
    this.prefs = prefs
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // storage unavailable: preferences last for this session only
    }
    if (!prefs.enabled) {
      this.stop()
      return
    }
    this.start()
    const t = this.ctx!.currentTime
    this.amb!.gain.setTargetAtTime(prefs.ambience * 0.5, t, 0.3)
    this.fx!.gain.setTargetAtTime(prefs.effects, t, 0.1)
  }

  private start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.amb = this.ctx.createGain()
      this.fx = this.ctx.createGain()
      this.amb.gain.value = 0
      this.fx.gain.value = 0
      this.amb.connect(this.ctx.destination)
      this.fx.connect(this.ctx.destination)
      // two seconds of brown noise, reused for room tone and every noisy effect
      const len = this.ctx.sampleRate * 2
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        d[i] = last * 3.5
      }
    }
    if (!document.hidden) void this.ctx.resume()
    if (!this.tone) {
      // room tone: HVAC-like low rumble
      const src = this.ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 380
      const g = this.ctx.createGain()
      g.gain.value = 0.18
      src.connect(lp).connect(g).connect(this.amb!)
      src.start()
      this.tone = src
    }
    this.typing ??= window.setInterval(() => this.typeTick(), 110)
  }

  private stop(): void {
    this.tone?.stop()
    this.tone = null
    if (this.typing) clearInterval(this.typing)
    this.typing = null
    void this.ctx?.suspend()
  }

  setTypists(n: number): void {
    this.typists = n
  }

  private typeTick(): void {
    // each working employee types in bursts; clicks are tiny filtered noise ticks
    for (let i = 0; i < this.typists; i++) if (Math.random() < 0.28) this.burst({ freq: 2600 + Math.random() * 1400, q: 3, dur: 0.018, gain: 0.05, bus: 'amb' })
  }

  private burst(o: { freq: number; q: number; dur: number; gain: number; bus: 'amb' | 'fx'; sweepTo?: number }): void {
    if (!this.ctx || !this.prefs.enabled || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(o.freq, t)
    if (o.sweepTo) bp.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur)
    bp.Q.value = o.q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain, t + Math.min(0.01, o.dur / 4))
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    src.loop = o.dur > 1.5
    src.connect(bp).connect(g).connect(o.bus === 'amb' ? this.amb! : this.fx!)
    src.start(t, Math.random())
    src.stop(t + o.dur + 0.05)
  }

  brew(): void {
    this.burst({ freq: 900, q: 1.2, dur: 2.4, gain: 0.25, bus: 'fx', sweepTo: 2400 })
  }

  /** A soft footfall; `near` (0..1) is how close to the view centre it is. Rate-limited across everyone. */
  step(near: number): void {
    const now = performance.now()
    if (near <= 0 || now - this.lastStep < 140) return
    this.lastStep = now
    this.burst({ freq: 160 + Math.random() * 60, q: 1.4, dur: 0.07, gain: 0.05 * near, bus: 'fx' })
  }

  printer(): void {
    // paper feed: a few soft mechanical passes
    for (let i = 0; i < 4; i++) setTimeout(() => this.burst({ freq: 1300, q: 2, dur: 0.22, gain: 0.07, bus: 'fx', sweepTo: 900 }), i * 260)
  }

  /** A small switch or button press (lights, TV remote, appliance door). */
  click(): void {
    this.burst({ freq: 3200, q: 4, dur: 0.025, gain: 0.12, bus: 'fx' })
  }

  /** Microwave: a low hum while it runs, then the bell. */
  hum(seconds: number): void {
    this.burst({ freq: 120, q: 6, dur: seconds, gain: 0.05, bus: 'fx' })
  }

  ding(): void {
    this.tone1(1975, 0.6, 0.1)
  }

  private tone1(freq: number, dur: number, gain: number): void {
    if (!this.ctx || !this.prefs.enabled || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.fx!)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  door(): void {
    this.burst({ freq: 500, q: 0.8, dur: 0.35, gain: 0.12, bus: 'fx', sweepTo: 220 })
  }

  pong(): void {
    this.tone1(1700, 0.05, 0.12)
  }
}

function load(): SoundPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), enabled: false }
  } catch {
    return { ...DEFAULTS }
  }
}

export const officeSound = new OfficeSound()
