import { create } from 'zustand'

// In-memory "resume" store for live cash / tournament sessions. When the player
// leaves a table (sidebar nav or Quit) the table state is already checkpointed
// here at every hand boundary, so they can pick it back up where they left off.
// Memory-only by design — it does NOT survive a full page reload.

export type LiveFormat = 'cash' | 'tournament'

export interface ResumableSession {
  /** GameConfig-shaped object passed back to /game to re-enter the table. */
  cfg: Record<string, unknown>
  /** Clean start-of-hand seats (stacks, positions, eliminations…). */
  seats: unknown[]
  dealerIdx: number
  prevHandNum: number
  /** Tournament clock snapshot (levelIdx, secondsLeft, playersLeft, place…). */
  tour?: { ref: Record<string, unknown> }
  /** Short human label for the resume dialog, e.g. "Niv 4 · 152 BB · 88e". */
  label: string
  savedAt: number
}

interface LiveSessionState {
  cash: ResumableSession | null
  tournament: ResumableSession | null
  /** Set while a cash/tournament table is mounted & playing — drives the leave guard. */
  activeFormat: LiveFormat | null
  saveResumable: (fmt: LiveFormat, s: ResumableSession) => void
  clearResumable: (fmt: LiveFormat) => void
  setActive: (fmt: LiveFormat | null) => void
}

export const useLiveSession = create<LiveSessionState>((set) => ({
  cash: null,
  tournament: null,
  activeFormat: null,
  saveResumable: (fmt, s) => set(fmt === 'cash' ? { cash: s } : { tournament: s }),
  clearResumable: (fmt) => set(fmt === 'cash' ? { cash: null } : { tournament: null }),
  setActive: (fmt) => set({ activeFormat: fmt }),
}))
