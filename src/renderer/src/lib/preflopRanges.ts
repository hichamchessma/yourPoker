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

// Polarized 3-bet bluffs (vs an open), BEST first (blockers + playability): suited
// wheel aces, then suited gappers / connectors. Ordered so we can keep a fraction
// of them depending on the open size (big opens kill 3-bet bluffing).
const THREEBET_BLUFF_ORDER = ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s', 'A2s', 'J9s', 'T8s', '97s', '86s', '75s', '64s']
// 4-bet bluffs (vs a 3-bet) — tight: just the ace-blocker suited wheel hands.
const FOURBET_BLUFFS = new Set(['A5s', 'A4s', 'A3s'])

export interface RangeOpts {
  effBB?: number        // effective stack in big blinds
  raiseToBB?: number    // size of the open we're facing (in BB)
  multiway?: boolean    // other players already in the pot
  vsOpenerPos?: string  // position of the player who opened into us (vs-open only)
  reRaiseRatio?: number // vs-3bet: 3-bet size ÷ the open size (3 ≈ standard)
}

// How much to widen/tighten our defense based on WHO opened. A late, wide opener
// (BTN/SB steal) is beaten by a much wider continuing range than a tight UTG
// open. Anchored so a ~CO-width open (≈25%) ⇒ factor 1.0 (≈ current behaviour),
// then scales with the opener's RFI width. Undefined opener ⇒ 1.0 (no change),
// which keeps every un-wired caller identical to before.
function defenseFactor(o: RangeOpts): number {
  if (!o.vsOpenerPos) return 1
  const openerWidth = openPctFor(o.vsOpenerPos)
  return Math.max(0.6, Math.min(1.8, openerWidth / 25))
}

// Adjust a call width for stack depth, the raise size faced, and multiway.
function adjustCall(base: number, o: RangeOpts): number {
  let c = base
  if (o.raiseToBB !== undefined) {
    // The open SIZE drives the price you're getting. A bigger raise → defend
    // tighter; a SMALL open / min-raise → defend MUCH wider (you risk little to
    // win the dead money), especially closing the action from the BB. Previously
    // the model only tightened vs big raises and never widened vs small ones, so
    // a BB facing a 2bb min-raise "defended" the same 31% as vs a 3x — way too
    // tight for the price.
    if (o.raiseToBB > 2.5) c *= Math.max(0.5, 1 - (o.raiseToBB - 2.5) * 0.08)
    else if (o.raiseToBB < 2.5) c *= 1 + (2.5 - o.raiseToBB) * 0.7  // 2bb open → ×1.35
  }
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
    // The OPEN SIZE drives how much we 3-bet-bluff: vs a small/standard open we
    // bluff a full polarized set; vs a big open there's no fold equity and it's
    // too costly, so the bluffs drop off (only value 3-bets remain vs a huge one).
    const openBB = opts.raiseToBB ?? 2.5
    const bluffFrac = openBB <= 2.8 ? 1 : openBB <= 4 ? 0.6 : openBB <= 5.5 ? 0.3 : 0
    const bluffs = new Set(THREEBET_BLUFF_ORDER.slice(0, Math.round(THREEBET_BLUFF_ORDER.length * bluffFrac)))
    // Flat band scales with the opener's width and the open size (adjustCall).
    const cont = topByPct(adjustCall(def.call, opts) * defenseFactor(opts) + 3) // +3% ≈ covers the value combos
    for (const h of RANKED) {
      const a: RangeAction = value.has(h.key) || bluffs.has(h.key) ? '3bet'
        : cont.has(h.key) ? 'call' : 'fold'
      map.set(h.key, a)
    }
  } else {
    // vs a 3-bet: explicit polarized value 4-bets (QQ+/AK) + ace-blocker bluffs,
    // then a CALL band of strong-but-not-nut hands, fold the rest. The continue
    // width scales with the 3-bet RATIO (a small 2× 3-bet gives a great price →
    // continue wider; a big 3.5×+ → tighter) and with stack depth.
    const def = VS_3BET_DEF[position] ?? { value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'], call: 8 }
    const value = new Set(def.value)
    const ratio = opts.reRaiseRatio ?? 3
    const ratioFactor = ratio <= 2.2 ? 1.45 : ratio <= 2.6 ? 1.2 : ratio <= 3.2 ? 1.0 : ratio <= 4 ? 0.75 : 0.55
    const depthFactor = opts.effBB === undefined ? 1 : opts.effBB < 25 ? 0.55 : opts.effBB > 80 ? 1.1 : 1
    // Absolute 3-bet size vs stack: a big 3-bet (e.g. 30bb) = low SPR / lots
    // committed → flat a much tighter, nuttier range than a small 10bb 3-bet of
    // the SAME ratio (high SPR, can set-mine / play speculative).
    const threebetBB = opts.raiseToBB ?? ratio * 2.5
    const commitFactor = threebetBB >= 25 ? 0.7 : threebetBB >= 15 ? 0.85 : 1
    const multiwayFactor = opts.multiway ? 0.8 : 1
    const cont = topByPct(def.call * ratioFactor * depthFactor * commitFactor * multiwayFactor + 3)
    for (const h of RANKED) {
      const a: RangeAction = value.has(h.key) || FOURBET_BLUFFS.has(h.key) ? '4bet'
        : cont.has(h.key) ? 'call' : 'fold'
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
export function buildJamCallMap(effBB: number, numAllIn: number): Map<string, RangeAction> {
  let pct = effBB <= 10 ? 42 : effBB <= 18 ? 22 : effBB <= 30 ? 13 : effBB <= 50 ? 8 : effBB <= 80 ? 5 : 3.2
  pct *= Math.pow(0.52, Math.max(0, numAllIn - 1))   // each extra jam ~halves the call-off
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
  vsopen: 'Face à une relance',
  vs3bet: 'Face à un 3-bet',
}
