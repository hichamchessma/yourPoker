// Tiny localStorage log of session perf SCORES (numbers only — a few bytes each) so
// the report can show a trend vs your average. The hands themselves live in the
// history store; this never duplicates them.
import type { SessionKind } from './historyStore'

export interface PerfEntry { date: string; score: number; grade: string; decisions: number }

const KEY = (k: SessionKind) => `yourpoker.perf.${k}`
const MAX = 60   // keep the last 60 sessions per format — well under any storage worry

export function loadPerfs(kind: SessionKind): PerfEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(kind)) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

export function savePerf(kind: SessionKind, entry: PerfEntry): PerfEntry[] {
  const list = [...loadPerfs(kind), entry].slice(-MAX)
  try { localStorage.setItem(KEY(kind), JSON.stringify(list)) } catch { /* quota — ignore */ }
  return list
}
