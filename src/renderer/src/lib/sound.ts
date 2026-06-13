// ─────────────────────────────────────────────────────────────────────────────
// Procedural sound engine (Web Audio API). No audio files — every effect is
// synthesized on the fly, so it's tiny, offline, and license-free. Respects the
// global mute/volume from soundStore. The AudioContext is created lazily on the
// first call (browsers require a user gesture before audio can start).
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
      master.connect(ctx.destination)
    } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  master!.gain.value = useSoundStore.getState().volume
  return ctx
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.5)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuf = buf
  return buf
}

function env(c: AudioContext, t0: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  return g
}

// A pitched blip (oscillator) with optional glide.
function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType = 'sine', peak = 0.3, glideTo?: number) {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur)
  const g = env(c, t0, peak, Math.min(0.01, dur * 0.2), dur)
  o.connect(g); g.connect(master!)
  o.start(t0); o.stop(t0 + dur + 0.03)
}

// A filtered noise hit (whoosh / clink texture).
function noiseHit(c: AudioContext, t0: number, dur: number, filter: BiquadFilterType, freq: number, peak = 0.3, q = 1, glideTo?: number) {
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = filter
  f.frequency.setValueAtTime(freq, t0)
  if (glideTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, glideTo), t0 + dur)
  f.Q.value = q
  const g = env(c, t0, peak, 0.003, dur)
  s.connect(f); f.connect(g); g.connect(master!)
  s.start(t0); s.stop(t0 + dur + 0.03)
}

// A single chip "clink": metallic ping + a touch of noise.
function chipClink(c: AudioContext, t0: number, peak = 0.22) {
  tone(c, t0, 2400 + Math.random() * 400, 0.06, 'triangle', peak)
  tone(c, t0, 3600 + Math.random() * 500, 0.04, 'sine', peak * 0.5)
  noiseHit(c, t0, 0.04, 'highpass', 5000, peak * 0.4)
}

function chipStack(c: AudioContext, t0: number, n: number, peak = 0.2) {
  for (let i = 0; i < n; i++) chipClink(c, t0 + i * (0.035 + Math.random() * 0.02), peak)
}

const SYNTH: Record<SoundName, (c: AudioContext, t0: number) => void> = {
  // card flicked across the felt
  deal: (c, t0) => noiseHit(c, t0, 0.13, 'bandpass', 1600, 0.28, 0.8, 700),
  // card snapped face-up
  flip: (c, t0) => { noiseHit(c, t0, 0.07, 'bandpass', 2200, 0.3, 1.2); tone(c, t0, 520, 0.05, 'triangle', 0.12) },
  // two soft knocks on the table
  check: (c, t0) => { tone(c, t0, 170, 0.045, 'triangle', 0.45); tone(c, t0 + 0.1, 150, 0.05, 'triangle', 0.4) },
  // a single chip put in
  call: (c, t0) => chipClink(c, t0, 0.26),
  // a small stack pushed forward
  bet: (c, t0) => chipStack(c, t0, 3, 0.22),
  // a bigger stack
  raise: (c, t0) => chipStack(c, t0, 4, 0.24),
  // muffled card slide away
  fold: (c, t0) => noiseHit(c, t0, 0.2, 'lowpass', 900, 0.16, 0.7, 400),
  // dramatic: rising whoosh + low impact + chip avalanche
  allin: (c, t0) => {
    noiseHit(c, t0, 0.35, 'bandpass', 300, 0.3, 0.9, 3000)
    tone(c, t0 + 0.18, 120, 0.5, 'sine', 0.5, 55)
    chipStack(c, t0 + 0.22, 6, 0.22)
  },
  // chips raked into the pot
  chips: (c, t0) => chipStack(c, t0, 5, 0.2),
  // ascending win arpeggio
  win: (c, t0) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, t0 + i * 0.09, f, 0.28, 'triangle', 0.3)) },
  // soft descending tone
  lose: (c, t0) => { tone(c, t0, 360, 0.3, 'sine', 0.28, 200); tone(c, t0 + 0.12, 240, 0.4, 'sine', 0.22, 130) },
  // tiny UI tick
  click: (c, t0) => tone(c, t0, 1300, 0.025, 'square', 0.12),
  // your turn — gentle two-tone
  turn: (c, t0) => { tone(c, t0, 880, 0.1, 'sine', 0.22); tone(c, t0 + 0.12, 1175, 0.12, 'sine', 0.2) },
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
