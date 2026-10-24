// ─────────────────────────────────────────────────────────────────────────────
// Log of session perf SCORES (numbers only — a few bytes each) so the report can
// show a trend vs your average. The hands themselves live in historyStore; this
// never duplicates them.
//
// This IS the progression record that justifies a subscription, and it's tiny, so
// unlike the hand replays it is mirrored to the cloud IN FULL: a player must be
// able to see six months of improvement after switching phone.
// ─────────────────────────────────────────────────────────────────────────────
import type { SessionKind } from './historyStore'
import { supabase, isSupabaseConfigured } from './supabase'

export interface PerfEntry { date: string; score: number; grade: string; decisions: number }

const KEY = (k: SessionKind) => `yourpoker.perf.${k}`
const MAX = 60   // keep the last 60 sessions per format — well under any storage worry

/** Fired on `window` once a cloud pull merged new scores in. */
export const PERF_SYNCED_EVENT = 'yourpoker:perf-synced'

export function loadPerfs(kind: SessionKind): PerfEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(kind)) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function write(kind: SessionKind, list: PerfEntry[]): void {
  try { localStorage.setItem(KEY(kind), JSON.stringify(list.slice(-MAX))) } catch { /* quota — ignore */ }
}

export function savePerf(kind: SessionKind, entry: PerfEntry): PerfEntry[] {
  const list = [...loadPerfs(kind), entry].slice(-MAX)
  write(kind, list)
  void pushPerf(kind, entry)
  return list
}

// ── Cloud mirror ────────────────────────────────────────────────────────────
async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try { const { data } = await supabase.auth.getUser(); return data?.user?.id ?? null } catch { return null }
}

async function pushPerf(kind: SessionKind, e: PerfEntry): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  try {
    // (user_id, kind, scored_at) is the primary key → replaying a push is harmless.
    await supabase.from('perf_scores').upsert({
      user_id: uid, kind, scored_at: e.date,
      score: e.score, grade: e.grade, decisions: e.decisions,
    }, { onConflict: 'user_id,kind,scored_at' })
  } catch { /* offline — the local copy is already safe */ }
}

/** Merge the account's cloud scores into the local log (union by timestamp). */
export async function pullPerfsFromCloud(): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  let changed = false
  for (const kind of ['tournament', 'cash'] as SessionKind[]) {
    try {
      const { data, error } = await supabase.from('perf_scores')
        .select('scored_at,score,grade,decisions')
        .eq('user_id', uid).eq('kind', kind)
        .order('scored_at', { ascending: true })
        .limit(MAX)
      if (error || !data) continue
      const local = loadPerfs(kind)
      const known = new Set(local.map(p => p.date))
      const incoming = data
        .filter(r => !known.has(r.scored_at as string))
        .map((r): PerfEntry => ({
          date: r.scored_at as string, score: Number(r.score) || 0,
          grade: (r.grade as string) ?? '—', decisions: Number(r.decisions) || 0,
        }))
      if (incoming.length === 0) continue
      write(kind, [...local, ...incoming].sort((a, b) => a.date.localeCompare(b.date)))
      changed = true
    } catch { /* offline — keep the local log as-is */ }
  }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(PERF_SYNCED_EVENT))
}
