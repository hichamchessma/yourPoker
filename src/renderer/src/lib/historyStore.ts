// ─────────────────────────────────────────────────────────────────────────────
// Saved session history. A completed tournament or cash session is stored with
// the hands that were played — but ONLY the "highlight" hands: the ones where the
// hero VOLUNTARILY put money in (call / bet / raise / all-in). Free folds and
// blind-only fold-arounds are dropped so the history stays meaningful.
//
// OFFLINE-FIRST, CLOUD-BACKED: localStorage remains the source of truth (instant
// reads, works offline, works logged-out), and Supabase is a mirror so the ACCOUNT
// is portable. Losing your whole progression by switching phone makes a monthly
// subscription impossible to defend — hence the backup.
//
// Every cloud call is fire-and-forget and silently no-ops when Supabase isn't
// configured or nobody is signed in: the app must behave identically offline.
// ─────────────────────────────────────────────────────────────────────────────
import type { HandHistoryRecord } from './handTypes'
import { supabase, isSupabaseConfigured } from './supabase'

export type SessionKind = 'tournament' | 'cash'

export interface SavedSession {
  id: number
  kind: SessionKind
  date: string            // ISO
  title: string           // e.g. "MTT $20 · 180 joueurs" / "Cash 6-max 1/2"
  subtitle: string        // e.g. "Éliminé 47e · +$320" / "+63 BB en 41 mains"
  resultBB: number        // net hero result in BB (for color)
  currency?: string       // cash: the table's currency symbol ($/€/DH) so replays format right
  hands: HandHistoryRecord[]
}

const KEY: Record<SessionKind, string> = {
  tournament: 'yourpoker_history_tournaments',
  cash: 'yourpoker_history_cash',
}
const MAX_SESSIONS = 40
/** Pulled back from the cloud, per kind — more than anyone scrolls through. */
const CLOUD_MAX_SESSIONS = 30
/** Hands mirrored per session. Replays are the heavy part AND the cheap part to lose,
 *  so one player's history can never eat the database quota. */
const CLOUD_MAX_HANDS = 20

/** Fired on `window` once a cloud pull has merged new sessions in, so an already
 *  mounted page can refresh instead of showing a stale list until the next nav. */
export const HISTORY_SYNCED_EVENT = 'yourpoker:history-synced'

// A hand is a "highlight" if the hero voluntarily put chips in (not a free fold /
// blind-only fold-around / pure check-down with no money committed).
export function isHighlightHand(rec: HandHistoryRecord): boolean {
  const hero = rec.players.find(p => p.isHero)
  if (!hero) return false
  return rec.actions.some(a => a.seatIdx === hero.idx &&
    (a.actionType === 'CALL' || a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))
}

// ── Local store (raw = exactly what sits in localStorage: dates are ISO strings) ──
function readRaw(kind: SessionKind): SavedSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY[kind]) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}
function writeRaw(kind: SessionKind, list: SavedSession[]): void {
  try { localStorage.setItem(KEY[kind], JSON.stringify(list.slice(0, MAX_SESSIONS))) } catch { /* quota — ignore */ }
}

export function loadSessions(kind: SessionKind): SavedSession[] {
  // Revive Date objects inside the hand records (JSON stored them as strings).
  return readRaw(kind).map(s => ({ ...s, hands: (s.hands ?? []).map(h => ({ ...h, date: new Date(h.date) })) }))
}

export function saveSession(
  kind: SessionKind,
  meta: Omit<SavedSession, 'id' | 'kind' | 'date' | 'hands'>,
  hands: HandHistoryRecord[],
): SavedSession | null {
  const highlights = hands.filter(isHighlightHand)
  if (highlights.length === 0) return null // nothing worth keeping
  const session: SavedSession = { id: Date.now(), kind, date: new Date().toISOString(), hands: highlights, ...meta }
  writeRaw(kind, [session, ...readRaw(kind)])
  void pushSession(kind, session)
  return session
}

export function deleteSession(kind: SessionKind, id: number): void {
  writeRaw(kind, readRaw(kind).filter(s => s.id !== id))
  void deleteRemoteSession(id)
}

// ── Cloud mirror ────────────────────────────────────────────────────────────
async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try { const { data } = await supabase.auth.getUser(); return data?.user?.id ?? null } catch { return null }
}

async function pushSession(kind: SessionKind, s: SavedSession): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  try {
    await supabase.from('sessions').upsert({
      id: s.id, user_id: uid, kind, played_at: s.date,
      title: s.title, subtitle: s.subtitle, result_bb: s.resultBB,
      currency: s.currency ?? null,
      hands: s.hands.slice(-CLOUD_MAX_HANDS),
    }, { onConflict: 'user_id,id' })
  } catch { /* offline / RLS — the local copy is already safe */ }
}

async function deleteRemoteSession(id: number): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  try { await supabase.from('sessions').delete().eq('user_id', uid).eq('id', id) } catch { /* ignore */ }
}

/**
 * Merge the account's cloud history into the local store (union by id, newest
 * first). Called after sign-in; safe to call repeatedly. Emits HISTORY_SYNCED_EVENT
 * when something actually changed.
 */
export async function pullSessionsFromCloud(): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  let changed = false
  for (const kind of ['tournament', 'cash'] as SessionKind[]) {
    try {
      const { data, error } = await supabase.from('sessions')
        .select('id,played_at,title,subtitle,result_bb,currency,hands')
        .eq('user_id', uid).eq('kind', kind)
        .order('played_at', { ascending: false })
        .limit(CLOUD_MAX_SESSIONS)
      if (error || !data) continue
      const local = readRaw(kind)
      const known = new Set(local.map(s => s.id))
      const incoming: SavedSession[] = data
        .filter(r => !known.has(Number(r.id)))
        .map(r => ({
          id: Number(r.id), kind, date: r.played_at as string,
          title: (r.title as string) ?? '', subtitle: (r.subtitle as string) ?? '',
          resultBB: Number(r.result_bb) || 0,
          currency: (r.currency as string | null) ?? undefined,
          hands: (r.hands as HandHistoryRecord[]) ?? [],
        }))
      if (incoming.length === 0) continue
      const merged = [...local, ...incoming].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      writeRaw(kind, merged)
      changed = true
    } catch { /* offline — keep the local store as-is */ }
  }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_SYNCED_EVENT))
}
