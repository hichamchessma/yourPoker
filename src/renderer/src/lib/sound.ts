// ─────────────────────────────────────────────────────────────────────────────
// Procedural sound engine (Web Audio API). No audio files — every effect is
// synthesized on the fly, so it's tiny, offline, and license-free. Respects the
// global mute/volume from soundStore. The AudioContext is created lazily on the
// first call (browsers require a user gesture before audio can start).
//
// Realism comes from layering: an impact TRANSIENT (filtered noise) + resonant
// PARTIALS (the body/ring of the object) + a master compressor that glues it and
// adds punch. Chips ring with detuned clay-like partials; cards are felt slides.
// ─────────────────────────────────────────────────────────────────────────────
import { useSoundStore } from '../store/soundStore'

export type SoundName =
  | 'deal' | 'flip' | 'check' | 'call' | 'bet' | 'raise' | 'fold'
  | 'allin' | 'chips' | 'win' | 'lose' | 'click' | 'turn'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try {
      ctx = new AC()
      master = ctx.createGain()
      // Master glue: a compressor for punch + a gentle high-shelf cut to take the
      // harsh edge off the synthesized transients (warmer, more "pro").
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 4
      comp.attack.value = 0.003; comp.release.value = 0.18
      const shelf = ctx.createBiquadFilter()
      shelf.type = 'highshelf'; shelf.frequency.value = 6500; shelf.gain.value = -6
      master.connect(comp); comp.connect(shelf); shelf.connect(ctx.destination)
    } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  master!.gain.value = useSoundStore.getState().volume
  return ctx
}

// Browsers start the AudioContext SUSPENDED and only allow resuming it from inside a
// real user gesture. Our sounds fire from timers (dealing, bot actions) — NOT a gesture —
// so without this the context never resumes and nothing plays. Unlock on the first
// interaction (creating + resuming the context while we're inside the gesture).
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = ensure()
    if (c && c.state === 'suspended') c.resume().catch(() => {})
  }
  ;(['pointerdown', 'touchstart', 'keydown', 'click'] as const).forEach(ev =>
    window.addEventListener(ev, unlock, { passive: true })
  )
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.6)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuf = buf
  return buf
}

// Percussive envelope: instant attack → exponential decay (natural for impacts).
function hit(c: AudioContext, t0: number, peak: number, decay: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(Math.max(0.0002, peak), t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  return g
}

// A resonant partial (the "ring"/body of an object) with slight pitch jitter.
function partial(c: AudioContext, t0: number, freq: number, decay: number, peak: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator()
  o.type = type
  o.frequency.value = freq * (1 + (Math.random() * 2 - 1) * 0.02)
  const g = hit(c, t0, peak, decay)
  o.connect(g); g.connect(master!)
  o.start(t0); o.stop(t0 + decay + 0.02)
}

// A pitched tone with optional glide (for risers / melodic stings).
function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType = 'sine', peak = 0.3, glideTo?: number) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.02, dur * 0.25))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g); g.connect(master!)
  o.start(t0); o.stop(t0 + dur + 0.03)
}

// A filtered noise burst (transient / slide / whoosh). Optional filter glide.
function noise(c: AudioContext, t0: number, decay: number, filter: BiquadFilterType, freq: number, peak: number, q = 1, glideTo?: number) {
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  s.playbackRate.value = 0.8 + Math.random() * 0.4
  const f = c.createBiquadFilter()
  f.type = filter
  f.frequency.setValueAtTime(freq, t0)
  if (glideTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, glideTo), t0 + decay)
  f.Q.value = q
  const g = hit(c, t0, peak, decay)
  s.connect(f); f.connect(g); g.connect(master!)
  s.start(t0); s.stop(t0 + decay + 0.03)
}

// ── Composite "objects" ─────────────────────────────────────────────────────

// A single clay poker chip click: sharp noise transient + detuned resonant ring + low body.
function chip(c: AudioContext, t0: number, g = 1) {
  noise(c, t0, 0.014, 'bandpass', 2700, 0.42 * g, 1.6)        // impact transient
  partial(c, t0, 1850, 0.055, 0.16 * g, 'triangle')           // ring
  partial(c, t0, 2550, 0.045, 0.11 * g, 'sine')
  partial(c, t0, 3500, 0.03, 0.06 * g, 'sine')
  partial(c, t0, 215, 0.05, 0.13 * g, 'sine')                 // low body thunk
}

// A stack of chips pushed/dropped: several clicks with timing jitter + a settle rattle.
function stack(c: AudioContext, t0: number, n: number, g = 1) {
  let t = t0
  for (let i = 0; i < n; i++) {
    chip(c, t, g * (0.8 + Math.random() * 0.45))
    t += 0.026 + Math.random() * 0.032
  }
  noise(c, t, 0.06, 'bandpass', 2300, 0.07 * g, 1.2)          // settle
}

// A soft knuckle/card thud on the felt (muffled).
function thud(c: AudioContext, t0: number, g = 1) {
  noise(c, t0, 0.05, 'lowpass', 240, 0.38 * g, 0.8)
  partial(c, t0, 120, 0.07, 0.2 * g, 'sine')
}

const SYNTH: Record<SoundName, (c: AudioContext, t0: number) => void> = {
  // card flicked across the felt: a tiny edge tick + a noise slide sweeping down
  deal: (c, t0) => {
    noise(c, t0, 0.01, 'highpass', 4200, 0.16, 0.8)
    noise(c, t0, 0.11, 'bandpass', 2100, 0.15, 0.7, 760)
  },
  // card snapped face-up: a crisp snap + a little body
  flip: (c, t0) => {
    noise(c, t0, 0.05, 'bandpass', 2600, 0.28, 1.6, 1400)
    partial(c, t0, 540, 0.05, 0.1, 'triangle')
  },
  // two soft knocks on the table
  check: (c, t0) => { thud(c, t0); thud(c, t0 + 0.11, 0.9) },
  // a single chip dropped in
  call: (c, t0) => chip(c, t0, 1.15),
  // a small stack pushed forward
  bet: (c, t0) => stack(c, t0, 3, 1),
  // a bigger stack
  raise: (c, t0) => stack(c, t0, 5, 1.05),
  // cards mucked: a soft felt slide + flutter
  fold: (c, t0) => {
    noise(c, t0, 0.17, 'lowpass', 1100, 0.13, 0.6, 520)
    noise(c, t0 + 0.05, 0.1, 'lowpass', 850, 0.07, 0.6)
  },
  // dramatic: a rising whoosh + low impact boom + chip avalanche
  allin: (c, t0) => {
    noise(c, t0, 0.4, 'bandpass', 380, 0.16, 1.3, 4200)        // riser
    tone(c, t0, 180, 0.42, 'sawtooth', 0.1, 680)               // pitch riser
    partial(c, t0 + 0.4, 68, 0.6, 0.5, 'sine')                 // impact boom
    noise(c, t0 + 0.4, 0.12, 'lowpass', 480, 0.26, 0.7)        // impact crack
    stack(c, t0 + 0.46, 7, 1.1)                                // avalanche
  },
  // chips raked into the pot
  chips: (c, t0) => stack(c, t0, 6, 1),
  // ascending win arpeggio (warm: fundamental + octave shimmer)
  win: (c, t0) => {
    ;[523, 659, 784, 1046].forEach((f, i) => {
      const t = t0 + i * 0.085
      partial(c, t, f, 0.38, 0.16, 'triangle')
      partial(c, t, f * 2, 0.3, 0.04, 'sine')
    })
  },
  // soft descending "aww"
  lose: (c, t0) => { tone(c, t0, 340, 0.32, 'sine', 0.22, 190); tone(c, t0 + 0.13, 220, 0.42, 'sine', 0.17, 120) },
  // tiny UI tick
  click: (c, t0) => tone(c, t0, 1300, 0.025, 'square', 0.1),
  // your turn — gentle two-tone chime
  turn: (c, t0) => { partial(c, t0, 880, 0.14, 0.18, 'sine'); partial(c, t0 + 0.12, 1175, 0.18, 0.16, 'sine') },
}

export function playSound(name: SoundName): void {
  if (useSoundStore.getState().muted) return
  const c = ensure()
  if (!c || !master) return
  try { SYNTH[name](c, c.currentTime + 0.005) } catch { /* ignore audio glitches */ }
}

// Deal several cards with a natural stagger.
export function playDeal(count: number, gap = 0.11): void {
  if (useSoundStore.getState().muted) return
  const c = ensure()
  if (!c || !master) return
  const t0 = c.currentTime + 0.005
  for (let i = 0; i < count; i++) {
    try { SYNTH.deal(c, t0 + i * gap) } catch { /* ignore */ }
  }
}
