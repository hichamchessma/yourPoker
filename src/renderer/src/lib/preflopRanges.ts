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
  // Reward suitedness & connectedness more, and the dominance of offsuit high-card
  // hands less, so late-position ranges open suited connectors/gappers (54s, 75s,
  // 85s…) — which solvers favour — instead of offsuit junk (Q7o, J7o, T7o).
  let s = hi * 3 + lo * 2.5
  if (suited) s += 14
  const gap = hi - lo - 1
  s -= gap * 2.6
  if (gap === 0) s += 7          // connectors (straight potential)
  else if (gap === 1) s += 4     // one-gappers
  else if (gap === 2) s += 2     // two-gappers
  if (hi === 14) s += 8          // ace (nut potential)
  else if (hi === 13) s += 3     // king
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
// vs-open: polarized 3-bet VALUE (explicit, NOT a linear top-% which would 3-bet
// medium pairs as value) + bluffs (THREEBET_BLUFFS) + a position-scaled FLAT band.
const VS_OPEN_DEF: Record<string, { value: string[]; call: number }> = {
  UTG:    { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],               call: 7 },
  'UTG+1':{ value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],               call: 7 },
  MP:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],               call: 8 },
  'MP+1': { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],               call: 8 },
  HJ:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],        call: 9 },
  CO:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],        call: 14 },
  BTN:    { value: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs'],  call: 19 },
  SB:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],        call: 5 },  // polarized OOP, small flat
  BB:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],        call: 26 }, // closes, defends wide
  'BTN/SB':{ value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],       call: 16 },
}
// vs-3bet defense by position. The 4-bet VALUE part is an EXPLICIT polarized set
// (QQ+/AK), NOT a linear "top-%": the playability score ranks every pair above AK,
// so a top-% cut would wrongly 4-bet 88-JJ. `call` is the continue width (in % of
// hands) — the strong-but-not-nut hands we flat. Blinds/late positions defend wider.
const VS_3BET_DEF: Record<string, { value: string[]; call: number }> = {
  UTG:    { value: ['AA', 'KK', 'QQ', 'AKs'],                call: 5 },
  'UTG+1':{ value: ['AA', 'KK', 'QQ', 'AKs'],                call: 5 },
  MP:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 6 },
  'MP+1': { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 6 },
  HJ:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 8 },
  CO:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 11 },
  BTN:    { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs'],  call: 15 },
  SB:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 8 },
  BB:     { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],         call: 18 },
  'BTN/SB':{ value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],        call: 12 },
}

// Polarized bluffs. 3-bet bluffs (vs an open) — suited wheel aces + suited gappers.
const THREEBET_BLUFFS = new Set(['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s', '86s', '75s', '64s'])
// 4-bet bluffs (vs a 3-bet) — tight: just the ace-blocker suited wheel hands.
const FOURBET_BLUFFS = new Set(['A5s', 'A4s', 'A3s'])

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
    // Polarized 3-bet (explicit value + blocker/suited bluffs), then a flat band.
    const def = VS_OPEN_DEF[position] ?? { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'], call: 10 }
    const value = new Set(def.value)
    const cont = topByPct(adjustCall(def.call, opts) + 3) // +3% ≈ covers the value combos
    for (const h of RANKED) {
      const a: RangeAction = value.has(h.key) || THREEBET_BLUFFS.has(h.key) ? '3bet'
        : cont.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  } else {
    // vs a 3-bet: explicit polarized value 4-bets (QQ+/AK) + ace-blocker bluffs,
    // then a position-scaled CALL band of strong-but-not-nut hands, fold the rest.
    const def = VS_3BET_DEF[position] ?? { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'], call: 8 }
    const value = new Set(def.value)
    const cont = topByPct(adjustCall(def.call, opts) + 3) // +3% ≈ covers the value combos so the band starts at the calls
    for (const h of RANKED) {
      const a: RangeAction = value.has(h.key) || FOURBET_BLUFFS.has(h.key) ? '4bet'
        : cont.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
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
