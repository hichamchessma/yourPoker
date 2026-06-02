// ─────────────────────────────────────────────────────────────────────────────
// Preflop range model — built-in, "standard"-style ranges keyed by position and
// situation (RFI / vs open / vs 3-bet). It's a transparent percentage model: the
// 169 starting hands are scored for playability, then the top X% (weighted by
// combos) form each range. Approximation of common 6-max charts, not a solver.
// ─────────────────────────────────────────────────────────────────────────────

export type RangeAction = 'raise' | '3bet' | '4bet' | 'call' | 'fold'
export type Scenario = 'rfi' | 'vsopen' | 'vs3bet'

export const GRID_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const RVAL: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 }
const TOTAL_COMBOS = 1326

interface Hand { key: string; combos: number; score: number }

// Playability score (higher = better). Pairs ranked on top of their value band,
// suited / connected hands get bonuses, large gaps a penalty, aces a kicker bump.
function comboScore(hi: number, lo: number, suited: boolean, pair: boolean): number {
  if (pair) return 60 + hi * 4 // 22→68 … TT→100 … AA→116
  let s = hi * 4 + lo * 2
  if (suited) s += 10
  const gap = hi - lo - 1
  s -= gap * 2.2
  if (hi === 14) s += 6
  return s
}

// All 169 hand types, sorted from strongest to weakest.
const RANKED: Hand[] = (() => {
  const hands: Hand[] = []
  for (let i = 0; i < 13; i++) {
    const ri = RVAL[GRID_RANKS[i]]
    hands.push({ key: GRID_RANKS[i] + GRID_RANKS[i], combos: 6, score: comboScore(ri, ri, false, true) })
    for (let j = i + 1; j < 13; j++) {
      const rj = RVAL[GRID_RANKS[j]]
      hands.push({ key: GRID_RANKS[i] + GRID_RANKS[j] + 's', combos: 4, score: comboScore(ri, rj, true, false) })
      hands.push({ key: GRID_RANKS[i] + GRID_RANKS[j] + 'o', combos: 12, score: comboScore(ri, rj, false, false) })
    }
  }
  return hands.sort((a, b) => b.score - a.score)
})()

// The set of hand keys forming the top `pct`% of all combos.
function topByPct(pct: number): Set<string> {
  const target = (Math.max(0, Math.min(100, pct)) / 100) * TOTAL_COMBOS
  const set = new Set<string>()
  let acc = 0
  for (const h of RANKED) {
    if (acc >= target) break
    set.add(h.key)
    acc += h.combos
  }
  return set
}

// ── Situation → range size (in % of all hands) ──────────────────────────────
// RFI open width as a function of how many players still act behind the hero
// (blinds included). Fewer players behind → open wider. This auto-adapts to ANY
// table size: heads-up, short-handed, 6-max or full-ring all fall out of it.
const OPEN_BY_BEHIND: Record<number, number> = {
  0: 60, // BB option (everyone folded to BB) — wide "playable" set
  1: 45, // last to open before the BB (SB / HU button)
  2: 47, // button with the two blinds behind
  3: 31, // cutoff
  4: 24,
  5: 20,
  6: 16,
  7: 13,
  8: 11,
  9: 9,  // full-ring UTG
}
function openPctByBehind(behind: number): number {
  if (behind <= 0) return OPEN_BY_BEHIND[0]
  return OPEN_BY_BEHIND[Math.min(behind, 9)] ?? 11
}
// Fallback open % by label (used if the caller can't supply playersBehind).
const OPEN_PCT: Record<string, number> = {
  UTG: 15, 'UTG+1': 16, MP: 18, 'MP+1': 19, HJ: 22, CO: 28, BTN: 46, SB: 45, BB: 60, 'BTN/SB': 47,
}
const VS_OPEN: Record<string, { tb: number; call: number }> = {
  UTG: { tb: 5, call: 7 }, 'UTG+1': { tb: 5, call: 7 }, MP: { tb: 6, call: 8 }, 'MP+1': { tb: 6, call: 8 },
  HJ: { tb: 7, call: 9 }, CO: { tb: 8, call: 14 }, BTN: { tb: 9, call: 19 },
  SB: { tb: 11, call: 6 }, BB: { tb: 9, call: 26 }, 'BTN/SB': { tb: 10, call: 16 },
}
const VS_3BET = { fb: 4, call: 5 }

// Polarized 3-bet bluffs: suited wheel aces (blockers) + suited gappers/connectors.
const THREEBET_BLUFFS = new Set(['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s', '86s', '75s', '64s'])

export interface RangeOpts {
  effBB?: number       // effective stack in big blinds
  raiseToBB?: number   // size of the open we're facing (in BB)
  multiway?: boolean   // other players already in the pot
}

// Adjust a call width for stack depth, the raise size faced, and multiway.
function adjustCall(base: number, o: RangeOpts): number {
  let c = base
  if (o.raiseToBB && o.raiseToBB > 2.5) c *= Math.max(0.5, 1 - (o.raiseToBB - 2.5) * 0.08) // bigger raise → call less
  if (o.effBB !== undefined) { if (o.effBB < 25) c *= 0.6; else if (o.effBB > 80) c *= 1.15 } // short folds more, deep calls more
  if (o.multiway) c *= 0.8 // tighten multiway
  return Math.max(0, c)
}

// Action map for every hand in the grid, for a given scenario + hero position.
// `playersBehind` (players still to act after the hero) adapts RFI width to the
// table size; `opts` tunes for stack depth, raise size and multiway.
export function buildRangeMap(scenario: Scenario, position: string, playersBehind?: number, opts: RangeOpts = {}): Map<string, RangeAction> {
  const map = new Map<string, RangeAction>()
  if (scenario === 'rfi') {
    const pct = playersBehind !== undefined ? openPctByBehind(playersBehind) : (OPEN_PCT[position] ?? 18)
    const raise = topByPct(pct)
    for (const h of RANKED) map.set(h.key, raise.has(h.key) ? 'raise' : 'fold')
  } else if (scenario === 'vsopen') {
    const cfg = VS_OPEN[position] ?? { tb: 6, call: 10 }
    let tbPct = cfg.tb
    if (opts.effBB !== undefined && opts.effBB < 25) tbPct *= 1.1 // short → more 3-bet (shove)
    const callPct = adjustCall(cfg.call, opts)
    const tb = topByPct(tbPct)
    const cont = topByPct(tbPct + callPct)
    for (const h of RANKED) {
      const a: RangeAction = tb.has(h.key) || THREEBET_BLUFFS.has(h.key) ? '3bet' : cont.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  } else {
    const fb = topByPct(VS_3BET.fb)
    const cont = topByPct(VS_3BET.fb + adjustCall(VS_3BET.call, opts))
    for (const h of RANKED) map.set(h.key, fb.has(h.key) ? '4bet' : cont.has(h.key) ? 'call' : 'fold')
  }
  return map
}

// Canonical hand key (e.g. "AKs", "QQ", "T9o") from two cards.
export function handKeyFromCards(
  c1: { rank: string; suit: string },
  c2: { rank: string; suit: string }
): string {
  if (c1.rank === c2.rank) return c1.rank + c2.rank
  const hi = RVAL[c1.rank] >= RVAL[c2.rank] ? c1 : c2
  const lo = RVAL[c1.rank] >= RVAL[c2.rank] ? c2 : c1
  return hi.rank + lo.rank + (c1.suit === c2.suit ? 's' : 'o')
}

// The grid cell key for row i / col j (suited upper-right, offsuit lower-left).
export function cellKey(i: number, j: number): string {
  if (i === j) return GRID_RANKS[i] + GRID_RANKS[i]
  if (i < j) return GRID_RANKS[i] + GRID_RANKS[j] + 's'
  return GRID_RANKS[j] + GRID_RANKS[i] + 'o'
}

export const ACTION_LABEL: Record<RangeAction, string> = {
  raise: 'OPEN / RAISE', '3bet': '3-BET', '4bet': '4-BET', call: 'CALL', fold: 'FOLD',
}
export const SCENARIO_LABEL: Record<Scenario, string> = {
  rfi: 'Ouverture (personne n’a relancé)',
  vsopen: 'Face à une relance',
  vs3bet: 'Face à un 3-bet',
}
