import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────────────────────
// "Resume" store for live cash / tournament sessions. The table is checkpointed
// here at every hand boundary, so the player can pick it back up where they left.
//
// PERSISTED to localStorage: on mobile the OS kills a backgrounded tab constantly,
// and this used to be memory-only — a 40-minute tournament simply vanished on a
// reload. A few kB of JSON per format is a rounding error next to losing a session.
//
// `activeFormat` is deliberately NOT persisted: it means "a table is mounted and
// playing RIGHT NOW" and drives the leave-confirmation guard. Restoring it after a
// reload would pop "you have a hand in progress" on an empty app.
// ─────────────────────────────────────────────────────────────────────────────

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

const LS_KEY = 'yourpoker_live_sessions'
// A table older than a week isn't a session you meant to resume — offering it is
// more confusing than helpful (stale stacks, forgotten context).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface Stored { cash: ResumableSession | null; tournament: ResumableSession | null }
const EMPTY: Stored = { cash: null, tournament: null }

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null') as Partial<Stored> | null
    if (!raw) return EMPTY
    const fresh = (s: ResumableSession | null | undefined): ResumableSession | null =>
      s && typeof s.savedAt === 'number' && Date.now() - s.savedAt < MAX_AGE_MS ? s : null
    return { cash: fresh(raw.cash), tournament: fresh(raw.tournament) }
  } catch { return EMPTY }
}
function writeStored(s: Stored): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* quota / private mode — ignore */ }
}

interface LiveSessionState extends Stored {
  /** Set while a cash/tournament table is mounted & playing — drives the leave guard. */
  activeFormat: LiveFormat | null
  saveResumable: (fmt: LiveFormat, s: ResumableSession) => void
  clearResumable: (fmt: LiveFormat) => void
  setActive: (fmt: LiveFormat | null) => void
}

export const useLiveSession = create<LiveSessionState>((set, get) => ({
  ...readStored(),
  activeFormat: null,
  saveResumable: (fmt, s) => {
    const next: Stored = fmt === 'cash'
      ? { cash: s, tournament: get().tournament }
      : { cash: get().cash, tournament: s }
    set(next); writeStored(next)
  },
  clearResumable: (fmt) => {
    const next: Stored = fmt === 'cash'
      ? { cash: null, tournament: get().tournament }
      : { cash: get().cash, tournament: null }
    set(next); writeStored(next)
  },
  setActive: (fmt) => set({ activeFormat: fmt }),
}))
