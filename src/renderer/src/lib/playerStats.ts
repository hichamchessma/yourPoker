// ─────────────────────────────────────────────────────────────────────────────
// Real player stats, derived from the local session history (no invented numbers).
// Used by the Lobby dashboard and the Profile page. When the player has no history
// yet, everything is zero and the UI shows an empty state.
// ─────────────────────────────────────────────────────────────────────────────
import { loadSessions, type SavedSession } from './historyStore'

export interface PlayerStats {
  totalSessions: number
  tourPlayed: number
  cashPlayed: number
  totalHands: number      // highlight hands recorded across all sessions
  cashNetBB: number       // net result across cash sessions (BB)
  tourNet: number         // net result across tournaments ($)
  tourItmPct: number      // % of tournaments finished in the money (resultBB > 0)
  bestCashBB: number      // best single cash session (BB)
  bestTour: number        // best single tournament ($)
  recent: SavedSession[]  // most recent sessions across both kinds (newest first)
  hasData: boolean
}

export function computePlayerStats(recentLimit = 5): PlayerStats {
  const tour = loadSessions('tournament')
  const cash = loadSessions('cash')

  const totalHands =
    tour.reduce((s, x) => s + x.hands.length, 0) +
    cash.reduce((s, x) => s + x.hands.length, 0)

  const cashNetBB = cash.reduce((s, x) => s + x.resultBB, 0)
  const tourNet = tour.reduce((s, x) => s + x.resultBB, 0)
  const itm = tour.filter(x => x.resultBB > 0).length
  const tourItmPct = tour.length ? Math.round((itm / tour.length) * 100) : 0
  const bestCashBB = cash.reduce((m, x) => Math.max(m, x.resultBB), 0)
  const bestTour = tour.reduce((m, x) => Math.max(m, x.resultBB), 0)

  const recent = [...tour, ...cash]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, recentLimit)

  return {
    totalSessions: tour.length + cash.length,
    tourPlayed: tour.length,
    cashPlayed: cash.length,
    totalHands,
    cashNetBB,
    tourNet,
    tourItmPct,
    bestCashBB,
    bestTour,
    recent,
    hasData: tour.length + cash.length > 0,
  }
}
