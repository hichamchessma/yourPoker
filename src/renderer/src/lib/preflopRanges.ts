// ─────────────────────────────────────────────────────────────────────────────
// Preflop range model — built-in, "standard"-style ranges keyed by position and
// situation (RFI / vs open / vs 3-bet). It's a transparent percentage model: the
// 169 starting hands are scored for playability, then the top X% (weighted by
// combos) form each range. Approximation of common 6-max charts, not a solver.
// ─────────────────────────────────────────────────────────────────────────────

import { rfiRange, isoRange, vsOpenChart, squeezeChart, vs3betChart, vs4betChart, pushBucket, pushFoldRange } from './preflopCharts'

export type RangeAction = 'raise' | '3bet' | '4bet' | 'call' | 'fold'
export type Scenario = 'rfi' | 'iso' | 'vsopen' | 'squeeze' | 'vs3bet' | 'vs4bet'

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
  // Ace/King-high offsuit hands are opened for HIGH-CARD DOMINANCE (they crush a
  // wide blind-defending range), not for straight potential — so the gap between
  // their cards matters far less. A flat 2.6/gap penalty buried Kxo/Axo (e.g. K5o
  // ranked ~60%, behind 64s/J7o) and made a normal SB-steal open read as "trop
  // large". Use a gentler gap slope for dominance hands.
  const gapPen = hi >= 13 ? 1.4 : 2.6
  s -= gap * gapPen
  if (gap === 0) s += 7          // connectors (straight potential)
  else if (gap === 1) s += 4     // one-gappers
  else if (gap === 2) s += 2     // two-gappers
  if (hi === 14) s += 8          // ace (nut potential)
  else if (hi === 13) s += 5     // king (dominance)
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

// Keep only the strongest `keepFrac` of a hand set (by playability) — used to trim
// a chart's flat band when facing a bigger raise / lower SPR.
function trimWeakest(set: Set<string>, keepFrac: number): Set<string> {
  if (keepFrac >= 1) return set
  const ordered = RANKED.filter(h => set.has(h.key)).map(h => h.key) // strongest first
  return new Set(ordered.slice(0, Math.max(0, Math.round(ordered.length * keepFrac))))
}

// ── Situation → range size (in % of all hands) ──────────────────────────────
// RFI open width as a function of how many players still act behind the hero
// (blinds included). Fewer players behind → open wider. This auto-adapts to ANY
// table size: heads-up, short-handed, 6-max or full-ring all fall out of it.
// NOTE the dip at 1 (SB) vs 2 (BTN): the SB is the only "1 behind" spot and it
// plays the whole hand OUT OF POSITION, so even though it steals wide it should
// be a touch TIGHTER than the in-position button (raise-only). That OOP penalty
// is why this isn't strictly monotonic in players-behind — position matters too.
const OPEN_BY_BEHIND: Record<number, number> = {
  0: 60, // BB option (everyone folded to BB) — wide "playable" set
  1: 49, // blind battle: SB folded-to (1 behind + dead money) but OOP → steal, ≤ BTN
  2: 52, // button: 2 blinds behind AND in position the whole hand → widest opener
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
  UTG: 15, 'UTG+1': 16, MP: 18, 'MP+1': 19, HJ: 22, CO: 28, BTN: 52, SB: 49, BB: 60, 'BTN/SB': 49,
}
export interface RangeOpts {
  effBB?: number        // effective stack in big blinds
  raiseToBB?: number    // size of the open we're facing (in BB)
  multiway?: boolean    // other players already in the pot
  vsOpenerPos?: string  // position of the player who opened into us (vs-open only)
  reRaiseRatio?: number // vs-3bet: 3-bet size ÷ the open size (3 ≈ standard)
  threeBettorIP?: boolean // vs-3bet: the 3-bettor acts AFTER us postflop (cold 3-bet) → flat tighter
  icmTighten?: number   // tournament ICM: <1 shrinks the gambling ranges near the bubble / pay jumps
}

// Action map for every hand in the grid, for a given scenario + hero position.
// `playersBehind` (players still to act after the hero) adapts RFI width to the
// table size; `opts` tunes for stack depth, raise size and multiway.
export function buildRangeMap(scenario: Scenario, position: string, playersBehind?: number, opts: RangeOpts = {}): Map<string, RangeAction> {
  const map = new Map<string, RangeAction>()
  // Short-stack overlay: shallow effective stacks → SHOVE-or-fold (no postflop).
  // Applies to opening / iso / facing-an-open / squeeze; the 'raise' cell means
  // ALL-IN here. Facing an actual jam is handled separately (buildJamCallMap).
  const icm = opts.icmTighten ?? 1
  const pb = opts.effBB !== undefined ? pushBucket(opts.effBB) : null
  if (pb && (scenario === 'rfi' || scenario === 'iso' || scenario === 'vsopen' || scenario === 'squeeze')) {
    const shove = trimWeakest(pushFoldRange(opts.effBB!, playersBehind, position), icm) // ICM: shove tighter near the bubble
    for (const h of RANKED) map.set(h.key, shove.has(h.key) ? 'raise' : 'fold')
    return map
  }
  if (scenario === 'rfi') {
    // Reference RFI chart lookup (real ranges), not a heuristic top-% cut.
    const raise = rfiRange(playersBehind, position)
    for (const h of RANKED) map.set(h.key, raise.has(h.key) ? 'raise' : 'fold')
  } else if (scenario === 'iso') {
    // Limpers in front → iso-raise a value range (raise or fold, no light bluffs).
    const raise = isoRange(playersBehind, position)
    for (const h of RANKED) map.set(h.key, raise.has(h.key) ? 'raise' : 'fold')
  } else if (scenario === 'vsopen' || scenario === 'squeeze') {
    // vs-open: polarized 3-bet + flat band (sizing trims bluffs & flats vs a big
    // open). squeeze: open + caller(s) → polarized & multiway, tiny flat.
    const chart = scenario === 'squeeze' ? squeezeChart(position) : vsOpenChart(position, opts.vsOpenerPos)
    const openBB = opts.raiseToBB ?? 2.5
    const bluffFrac = (scenario === 'squeeze' ? 1 : openBB <= 2.8 ? 1 : openBB <= 4 ? 0.6 : openBB <= 5.5 ? 0.3 : 0) * icm
    const callKeep = (scenario === 'squeeze' ? 1 : openBB <= 2.8 ? 1 : openBB <= 4 ? 0.85 : openBB <= 5.5 ? 0.7 : 0.5) * icm
    const bluffs = new Set(chart.bluff.slice(0, Math.round(chart.bluff.length * bluffFrac)))
    const call = trimWeakest(chart.call, callKeep)
    for (const h of RANKED) {
      const a: RangeAction = chart.value.has(h.key) || bluffs.has(h.key) ? '3bet'
        : call.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  } else if (scenario === 'vs4bet') {
    // Facing a 4-bet (after our 3-bet): jam the nuts, flat the next tier IP, fold.
    const chart = vs4betChart(position)
    for (const h of RANKED) {
      const a: RangeAction = chart.value.has(h.key) ? '4bet' : chart.call.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  } else {
    // Reference vs-3bet chart (4-bets + bluffs + flat band). The flat band shrinks
    // with the 3-bet RATIO (small 2× = great price → keep all; big 3.5×+ → trim),
    // with how much is committed (absolute size / SPR), stack depth, and whether
    // the 3-bettor is IN POSITION (cold 3-bet → we're OOP → flat tighter).
    const chart = vs3betChart(position)
    const ratio = opts.reRaiseRatio ?? 3
    const ratioFactor = ratio <= 2.2 ? 1.0 : ratio <= 2.6 ? 0.92 : ratio <= 3.2 ? 0.85 : ratio <= 4 ? 0.7 : 0.55
    const threebetBB = opts.raiseToBB ?? ratio * 2.5
    const commitFactor = threebetBB >= 25 ? 0.7 : threebetBB >= 15 ? 0.85 : 1
    const depthFactor = opts.effBB === undefined ? 1 : opts.effBB < 25 ? 0.5 : 1
    const ipFactor = opts.threeBettorIP ? 0.7 : 1
    const callKeep = Math.max(0.2, ratioFactor * commitFactor * depthFactor * ipFactor * icm * (opts.multiway ? 0.7 : 1))
    const call = trimWeakest(chart.call, callKeep)
    for (const h of RANKED) {
      const a: RangeAction = chart.value.has(h.key) || chart.bluff.includes(h.key) ? '4bet'
        : call.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  }
  return map
}

// Facing one or more ALL-IN jams pre-flop you can only CALL or FOLD — there is no
// flat-behind and no re-raise. The call-off range is a tight premium block: looser
// when short (you're getting a price) and MUCH tighter for each extra all-in (more
// ranges to beat, and you can't realise position). Replaces the misleading vs-3bet
// "flat band" (you'd never flat 55/KQs vs two 100bb jams).
// Call-off PRIORITY order (≈ equity vs a jamming range, strongest first). Unlike
// the open-playability score, AK/AQ rank ABOVE medium pairs here (a topByPct on
// comboScore would keep JJ but drop AKs, which is wrong vs a jam).
const JAM_PRIORITY = [
  'AA','KK','QQ','AKs','AKo','JJ','AQs','TT','AQo','AJs','KQs','99','AJo','ATs','KJs','KQo','88',
  'KTs','QJs','A9s','77','ATo','JTs','KJo','A8s','QTs','A5s','66','A7s','K9s','A4s','A6s','QJo',
  'A3s','KTo','A2s','55','T9s','JTo','Q9s','J9s','QTo','K8s','44','98s','A9o','K7s','33','T8s','22',
  '87s','A8o','Q8s','K9o','97s','J8s','76s','T7s','65s','A7o','Q9o','86s','54s','K6s','75s',
]
function combosOfKey(k: string): number { return k.length === 2 ? 6 : (k[2] === 's' ? 4 : 12) }
export function buildJamCallMap(effBB: number, numAllIn: number, icmTighten = 1): Map<string, RangeAction> {
  let pct = effBB <= 10 ? 42 : effBB <= 18 ? 22 : effBB <= 30 ? 13 : effBB <= 50 ? 8 : effBB <= 80 ? 5 : 3.2
  pct *= Math.pow(0.52, Math.max(0, numAllIn - 1))   // each extra jam ~halves the call-off
  pct *= icmTighten                                  // ICM: calling-off tighter near the bubble / pay jumps
  pct = Math.max(1.2, Math.min(95, pct))             // never below the very top (AA/KK/QQ)
  const target = (pct / 100) * TOTAL_COMBOS
  const call = new Set<string>()
  let acc = 0
  for (const k of JAM_PRIORITY) { if (acc >= target) break; call.add(k); acc += combosOfKey(k) }
  // Very wide (short-stack) call-offs: top up by playability for the long tail.
  if (acc < target) for (const h of RANKED) { if (acc >= target) break; if (!call.has(h.key)) { call.add(h.key); acc += h.combos } }
  const map = new Map<string, RangeAction>()
  for (const h of RANKED) map.set(h.key, call.has(h.key) ? 'call' : 'fold')
  return map
}

// Cumulative % of all combos at which a hand enters the open ranking (0..100).
// Lets callers tell a "borderline a touch too loose" open from a real punt.
export function handOpenRank(key: string): number {
  let acc = 0
  for (const h of RANKED) { acc += h.combos; if (h.key === key) return (acc / TOTAL_COMBOS) * 100 }
  return 100
}
// The RFI open width (%) used for a given position / players-behind — mirrors the
// logic inside buildRangeMap so a critique can measure how far off an open was.
export function openPctFor(position: string, playersBehind?: number): number {
  return playersBehind !== undefined ? openPctByBehind(playersBehind) : (OPEN_PCT[position] ?? 18)
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
  iso: 'Iso-raise (des limpers devant)',
  vsopen: 'Face à une relance',
  squeeze: 'Squeeze (relance + suiveur)',
  vs3bet: 'Face à un 3-bet',
  vs4bet: 'Face à un 4-bet',
}
