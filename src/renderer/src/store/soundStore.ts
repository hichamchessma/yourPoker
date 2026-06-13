import { create } from 'zustand'

// Global sound settings (mute + volume), persisted locally. The actual audio is
// synthesized procedurally in lib/sound.ts (no audio files needed).
const LS_MUTED = 'yourpoker_sound_muted'
const LS_VOLUME = 'yourpoker_sound_volume'

function initialVolume(): number {
  const v = Number(localStorage.getItem(LS_VOLUME))
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6
}

interface SoundState {
  muted: boolean
  volume: number
  toggleMute: () => void
  setVolume: (v: number) => void
}

export const useSoundStore = create<SoundState>((set, get) => ({
  muted: localStorage.getItem(LS_MUTED) === '1',
  volume: initialVolume(),
  toggleMute: () => {
    const muted = !get().muted
    localStorage.setItem(LS_MUTED, muted ? '1' : '0')
    set({ muted })
  },
  setVolume: (v: number) => {
    const volume = Math.max(0, Math.min(1, v))
    localStorage.setItem(LS_VOLUME, String(volume))
    set({ volume })
  },
}))
