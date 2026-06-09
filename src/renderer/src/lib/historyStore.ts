// ─────────────────────────────────────────────────────────────────────────────
// Saved session history (localStorage). A completed tournament or cash session is
// stored with the hands that were played — but ONLY the "highlight" hands: the
// ones where the hero VOLUNTARILY put money in (call / bet / raise / all-in). Free
// folds and blind-only fold-arounds are dropped so the history stays meaningful.
// ─────────────────────────────────────────────────────────────────────────────
import type { HandHistoryRecord } from '../pages/GamePage'

export type SessionKind = 'tournament' | 'cash'

export interface SavedSession {
  id: number
  kind: SessionKind
  date: string            // ISO
  title: string           // e.g. "MTT $20 · 180 joueurs" / "Cash 6-max 1/2"
  subtitle: string        // e.g. "Éliminé 47e · +$320" / "+63 BB en 41 mains"
  resultBB: number        // net hero result in BB (for color)
  hands: HandHistoryRecord[]
}

const KEY: Record<SessionKind, string> = {
  tournament: 'yourpoker_history_tournaments',
  cash: 'yourpoker_history_cash',
}
const MAX_SESSIONS = 40

// A hand is a "highlight" if the hero voluntarily put chips in (not a free fold /
// blind-only fold-around / pure check-down with no money committed).
export function isHighlightHand(rec: HandHistoryRecord): boolean {
  const hero = rec.players.find(p => p.isHero)
  if (!hero) return false
  return rec.actions.some(a => a.seatIdx === hero.idx &&
    (a.actionType === 'CALL' || a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))
}

export function loadSessions(kind: SessionKind): SavedSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY[kind]) || '[]') as SavedSession[]
    // Revive Date objects inside the hand records (JSON stored them as strings).
    return raw.map(s => ({ ...s, hands: s.hands.map(h => ({ ...h, date: new Date(h.date) })) }))
  } catch { return [] }
}

export function saveSession(kind: SessionKind, meta: Omit<SavedSession, 'id' | 'kind' | 'date' | 'hands'>, hands: HandHistoryRecord[]): SavedSession | null {
  const highlights = hands.filter(isHighlightHand)
  if (highlights.length === 0) return null // nothing worth keeping
  const session: SavedSession = { id: Date.now(), kind, date: new Date().toISOString(), hands: highlights, ...meta }
  let list: SavedSession[]
  try { list = JSON.parse(localStorage.getItem(KEY[kind]) || '[]') } catch { list = [] }
  list.unshift(session)
  if (list.length > MAX_SESSIONS) list = list.slice(0, MAX_SESSIONS)
  try { localStorage.setItem(KEY[kind], JSON.stringify(list)) } catch { /* quota — ignore */ }
  return session
}

export function deleteSession(kind: SessionKind, id: number): void {
  let list: SavedSession[]
  try { list = JSON.parse(localStorage.getItem(KEY[kind]) || '[]') } catch { list = [] }
  localStorage.setItem(KEY[kind], JSON.stringify(list.filter(s => s.id !== id)))
}
