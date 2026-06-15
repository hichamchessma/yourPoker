// ─────────────────────────────────────────────────────────────────────────────
// Live opponent RANGE ESTIMATION engine.
//   • Each player starts with the full set of hands (weighted by combos).
//   • Every action multiplies each hand's weight by P(action | hand), computed
//     from the SAME parametric policy the bots use (their tier + mood) and the
//     hand's strength on the current board → an honest, AI-derived range.
//   • Output: a 13×13 frequency heatmap + a one-line "what changed" summary
//     (polarised / capped / tightened / widened) with multiway context.
// Heuristic but coherent with the bot brains — not a solver.
// ─────────────────────────────────────────────────────────────────────────────

import i18n from '../i18n'
const tt = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const RV: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 }

export interface Card { rank: string; suit: string }
export type ActCat = 'fold' | 'check' | 'call' | 'aggr'
export type RangeWeights = Record<string, number> // handKey -> weight (0..combos)

// ── Hand catalog (169 types) ────────────────────────────────────────────────
interface HandType { key: string; combos: number; rep: [Card, Card] }
const HANDS: HandType[] = (() => {
  const out: HandType[] = []
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (i === j) {
        out.push({ key: RANKS[i] + RANKS[i], combos: 6, rep: [{ rank: RANKS[i], suit: '♠' }, { rank: RANKS[i], suit: '♥' }] })
      } else if (i < j) {
        out.push({ key: RANKS[i] + RANKS[j] + 's', combos: 4, rep: [{ rank: RANKS[i], suit: '♠' }, { rank: RANKS[j], suit: '♠' }] })
      } else {
        out.push({ key: RANKS[j] + RANKS[i] + 'o', combos: 12, rep: [{ rank: RANKS[j], suit: '♠' }, { rank: RANKS[i], suit: '♥' }] })
      }
    }
  }
  // de-dupe (offsuit keys generated twice above)
  const seen = new Set<string>()
  return out.filter(h => (seen.has(h.key) ? false : (seen.add(h.key), true)))
})()
export const HAND_KEYS = HANDS.map(h => h.key)

// ── Poker evaluation (group-size tiebreak, wheel handling) ───────────────────
function evalFive(cards: Card[]): number {
  const rv = cards.map(c => RV[c.rank] ?? 2)
  const sv = cards.map(c => c.suit)
  const isF = sv.every(s => s === sv[0])
  const u = [...new Set(rv)].sort((a, b) => b - a)
  const wheel = u.length === 5 && u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2
  const isS = (u.length === 5 && u[0] - u[4] === 4) || wheel
  const cnt: Record<number, number> = {}; rv.forEach(r => (cnt[r] = (cnt[r] ?? 0) + 1))
  const cv = Object.values(cnt).sort((a, b) => b - a)
  let rank = 0
  if (isF && isS) rank = 8; else if (cv[0] === 4) rank = 7; else if (cv[0] === 3 && cv[1] === 2) rank = 6
  else if (isF) rank = 5; else if (isS) rank = 4; else if (cv[0] === 3) rank = 3
  else if (cv[0] === 2 && cv[1] === 2) rank = 2; else if (cv[0] === 2) rank = 1
  if (isS) return rank * 15 ** 5 + (wheel ? 5 : u[0])
  const tb: number[] = []
  Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a).forEach(r => { for (let k = 0; k < cnt[r]; k++) tb.push(r) })
  return rank * 15 ** 5 + (tb[0] ?? 0) * 15 ** 4 + (tb[1] ?? 0) * 15 ** 3 + (tb[2] ?? 0) * 15 ** 2 + (tb[3] ?? 0) * 15 + (tb[4] ?? 0)
}
function best7(cards: Card[]): number {
  if (cards.length <= 5) { const p = [...cards]; while (p.length < 5) p.push({ rank: '2', suit: '♠' }); return evalFive(p) }
  let best = 0
  const n = cards.length
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const s = evalFive([cards[a], cards[b], cards[c], cards[d], cards[e]]); if (s > best) best = s
    }
  return best
}
const CAT_STRENGTH = [0.08, 0.42, 0.68, 0.80, 0.86, 0.91, 0.96, 0.99, 1.0]
export function madeStrength(hole: Card[], board: Card[]): number {
  const cat = Math.floor(best7([...hole, ...board]) / 15 ** 5)
  if (cat !== 1) return CAT_STRENGTH[cat] ?? 0.08
  const bR = board.map(c => RV[c.rank]).sort((a, b) => b - a)
  const hR = hole.map(c => RV[c.rank])
  const pocket = hole[0].rank === hole[1].rank
  if (pocket && hR[0] > (bR[0] ?? 0)) return 0.62
  if (hR.includes(bR[0] ?? -1)) return 0.55
  if (bR[1] !== undefined && hR.includes(bR[1])) return 0.42
  return 0.32
}
export function hasStrongDraw(hole: Card[], board: Card[]): boolean {
  if (board.length >= 5 || board.length < 3) return false
  const all = [...hole, ...board]
  const bs: Record<string, number> = {}; all.forEach(c => (bs[c.suit] = (bs[c.suit] ?? 0) + 1))
  if (Object.values(bs).some(n => n === 4)) return true
  const vals = new Set(all.map(c => RV[c.rank])); if (vals.has(14)) vals.add(1)
  for (let lo = 1; lo <= 10; lo++) { let c = 0; for (let k = lo; k < lo + 5; k++) if (vals.has(k)) c++; if (c === 4 && (!vals.has(lo) || !vals.has(lo + 4))) return true }
  return false
}
// Chen formula — a fine-grained, widely-used preflop hand ranking (~ -1 … 20).
// Far more resolution than a coarse chart, so position-based thresholds map to
// realistic range widths. MUST stay identical to the copy in GamePage.tsx.
export function preflopStrength(c1: Card, c2: Card): number {
  const r1 = RV[c1.rank] ?? 2, r2 = RV[c2.rank] ?? 2
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2)
  const val = (r: number) => r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2
  if (r1 === r2) return Math.max(5, val(hi) * 2)            // pair
  let s = val(hi)
  if (c1.suit === c2.suit) s += 2                            // suited bonus
  const gap = hi - lo - 1                                    // cards between
  if (gap === 1) s -= 1; else if (gap === 2) s -= 2; else if (gap === 3) s -= 4; else if (gap >= 4) s -= 5
  if (hi - lo <= 2 && hi < 12) s += 1                        // straight bonus (both below Q)
  return s                                                   // unrounded → finer thresholds
}

// ── Bot policy params (mirror of the in-game bot tiers) ──────────────────────
export interface PolicyParams { betValue: number; betFreqStrong: number; semiBluff: number; bluff: number; raiseValue: number; callEdge: number; spew: number }
const TIER: Record<number, PolicyParams> = {
  1: { betValue: 0.62, betFreqStrong: 0.70, semiBluff: 0.15, bluff: 0.05, raiseValue: 0.82, callEdge: -0.06, spew: 0.10 },
  2: { betValue: 0.55, betFreqStrong: 0.86, semiBluff: 0.55, bluff: 0.08, raiseValue: 0.78, callEdge: 0.07, spew: 0 },
  3: { betValue: 0.52, betFreqStrong: 0.92, semiBluff: 0.66, bluff: 0.13, raiseValue: 0.74, callEdge: 0.04, spew: 0 },
}
export function policyFor(tier: number, human: boolean, mood = 0): PolicyParams {
  const base = { ...(TIER[Math.max(1, Math.min(3, tier))] ?? TIER[2]) }
  if (!human) return base
  const p = { ...TIER[2] }
  const tilt = Math.max(0, -mood), conf = Math.max(0, mood)
  p.betValue -= conf * 0.04
  p.bluff += tilt * 0.24 + conf * 0.05
  p.semiBluff += tilt * 0.15
  p.callEdge -= tilt * 0.13
  p.raiseValue -= tilt * 0.08
  p.spew = tilt * 0.30
  return p
}

// ── Pre-flop policy BY RAISE LEVEL — SHARED by the bots (decideBotAction) and the
//    range estimator, so a player's shown range always matches how the bots play.
//    priorRaises = number of raises already made this street before the player acts:
//      0 = unopened (RFI / limped) · 1 = vs an open · 2 = vs a 3-bet · ≥3 = vs a 4-bet+.
//    `psv` is the raw 1..10 hand-chart value (preflopStrength).
export function preflopProbs(psv: number, posBonus: number, priorRaises: number, tier: number, toCall: number): Record<ActCat, number> {
  // Chen-scale thresholds. openTh maps to realistic widths:
  //   UTG≈6.7 (~17%) · HJ≈5.9 (~24%) · CO≈5.3 (~27%) · BTN≈4.7 (~42%).
  const openTh = 10.0 - posBonus * 5.3
  const RAISE: Record<ActCat, number> = { fold: 0, check: 0, call: 0, aggr: 1 }

  // Unopened pot — open our position range, otherwise check (BB) / fold.
  if (priorRaises <= 0) {
    if (toCall <= 0) return psv >= openTh ? RAISE : { fold: 0, check: 1, call: 0, aggr: 0 }
    if (psv >= openTh) return RAISE              // raise-first-in over limpers / blinds
    const call = tier === 1 && psv >= openTh - 1.5 ? 0.5 : 0   // only the fish limp along
    return { fold: 1 - call, check: 0, call, aggr: 0 }
  }

  // vs a single OPEN → 3-bet (value QQ+/AK/strong broadways + a few bluffs) / FLAT / fold.
  if (priorRaises === 1) {
    const value3bet = 10                         // ~ QQ+, JJ, TT, AK, AQs, AJs, KQs
    const flatLo = openTh - 0.5
    if (psv >= value3bet) return RAISE
    if (psv >= flatLo) {
      const bluff = tier >= 2 && psv < flatLo + 1.5 ? (tier === 3 ? 0.12 : 0.07) : 0  // polarised light 3-bets
      return { fold: 0, check: 0, call: 1 - bluff, aggr: bluff }
    }
    return { fold: 1, check: 0, call: 0, aggr: 0 }
  }

  // vs a 3-BET → 4-bet ONLY premiums (QQ+), FLAT the value core (JJ-TT, AK, AQs,
  // suited broadways, suited connectors…), fold the junk. This makes a "call vs
  // 3-bet" range correctly capped & condensed (~9%) instead of a 27%-wide soup.
  if (priorRaises === 2) {
    const value4bet = 14                         // AA, KK, QQ
    const flatLo = 8                             // down to 88, AKo, ATs, KTs, suited broadways…
    if (psv >= value4bet) return RAISE
    if (psv >= flatLo) {
      const bluff = tier === 3 && psv < flatLo + 1 ? 0.10 : 0
      return { fold: 0, check: 0, call: 1 - bluff, aggr: bluff }
    }
    return { fold: 1, check: 0, call: 0, aggr: 0 }
  }

  // vs a 4-BET+ → jam the nuts, call the next tier, fold the rest.
  if (psv >= 15) return RAISE                     // AA, KK
  if (psv >= 12) return { fold: 0, check: 0, call: 1, aggr: 0 }  // QQ, JJ, AKs
  return { fold: 1, check: 0, call: 0, aggr: 0 }
}

// ── Probability of each action category for a given hand strength ────────────
function actionProbs(preflop: boolean, strength: number, draw: boolean, toCall: number, potOdds: number, posBonus: number, tier: number, p: PolicyParams, priorRaises: number): Record<ActCat, number> {
  if (preflop) return preflopProbs(strength, posBonus, priorRaises, tier, toCall)
  if (toCall <= 0) {
    const aggr = strength >= p.betValue ? p.betFreqStrong : draw ? p.semiBluff : p.bluff
    return { fold: 0, check: 1 - aggr, call: 0, aggr }
  }
  if (strength >= p.raiseValue) return { fold: 0, check: 0, call: 0, aggr: 1 }
  let aggr = draw ? p.semiBluff * 0.7 : 0
  let call = (strength >= potOdds + p.callEdge) ? 1 : (draw && strength + 0.18 >= potOdds) ? 1 : p.spew
  const bluffR = tier >= 2 ? p.bluff * 0.6 : 0
  aggr = Math.min(1, aggr + bluffR * (1 - call))
  call = Math.min(1 - aggr, call)
  void posBonus
  return { fold: Math.max(0, 1 - aggr - call), check: 0, call, aggr }
}

export interface ActionCtx {
  preflop: boolean
  board: Card[]
  toCall: number       // amount this player faced
  potOdds: number
  posBonus: number
  tier: number
  human: boolean
  mood: number
  priorRaises: number  // preflop: # of raises made before this player acted (0/1/2/≥3)
}

const RANK_BLOCK = (board: Card[]) => {
  const m: Record<string, number> = {}
  board.forEach(c => { m[c.rank + c.suit] = 1 })
  return m
}

// Multiply a player's range by the likelihood of the observed action category.
export function applyAction(range: RangeWeights, observed: ActCat, ctx: ActionCtx): RangeWeights {
  const p = policyFor(ctx.tier, ctx.human, ctx.mood)
  const out: RangeWeights = {}
  for (const h of HANDS) {
    const w = range[h.key] ?? 0
    if (w <= 0) { out[h.key] = 0; continue }
    const [a, b] = h.rep
    // Pre-flop: raw chart value (1..10); post-flop: made-hand strength (0..1).
    const strength = ctx.preflop ? preflopStrength(a, b) : madeStrength([a, b], ctx.board)
    const draw = ctx.preflop ? false : hasStrongDraw([a, b], ctx.board)
    const probs = actionProbs(ctx.preflop, strength, draw, ctx.toCall, ctx.potOdds, ctx.posBonus, ctx.tier, p, ctx.priorRaises)
    out[h.key] = w * probs[observed]
  }
  return out
}

// Number of starting combos for a 169-grid key (pair=6, suited=4, offsuit=12).
export function handCombos(key: string): number {
  return key.length === 2 ? 6 : key.endsWith('s') ? 4 : 12
}

const SUITS = ['♠', '♥', '♦', '♣']
// EXACT available combos of a 169 key given a set of DEAD cards (board + the hero's
// known hole cards). A hand the dead cards block has fewer combos — e.g. AKs is only
// 3 combos if the hero holds the A♠, AA is 3 combos if one ace is dead, etc.
export function comboCount(key: string, dead: Card[] = []): number {
  const ds = new Set(dead.map(c => c.rank + c.suit))
  if (key.length === 2) {                         // pair
    const r = key[0]
    const avail = SUITS.filter(s => !ds.has(r + s)).length
    return (avail * (avail - 1)) / 2              // C(avail, 2)
  }
  const r1 = key[0], r2 = key[1]
  if (key.endsWith('s')) {                         // suited: same suit, both live
    return SUITS.filter(s => !ds.has(r1 + s) && !ds.has(r2 + s)).length
  }
  let n = 0                                        // offsuit: different suits, both live
  for (const a of SUITS) for (const b of SUITS) if (a !== b && !ds.has(r1 + a) && !ds.has(r2 + b)) n++
  return n
}

// Explain, for ONE hand, why a single observed action kept it (prob→1), cut it
// (prob→0) or only trimmed it (mid) — using the SAME policy the range engine
// applies. Returns the multiplier P(action|hand) plus a human-readable reason, so
// the UI can replay a clicked cell's fate action-by-action.
export function explainHandStep(handKey: string, observed: ActCat, ctx: ActionCtx): { prob: number; reason: string } {
  const h = HANDS.find(x => x.key === handKey)
  if (!h) return { prob: 1, reason: '' }
  const [a, b] = h.rep
  const pol = policyFor(ctx.tier, ctx.human, ctx.mood)
  const strength = ctx.preflop ? preflopStrength(a, b) : madeStrength([a, b], ctx.board)
  const draw = ctx.preflop ? false : hasStrongDraw([a, b], ctx.board)
  const probs = actionProbs(ctx.preflop, strength, draw, ctx.toCall, ctx.potOdds, ctx.posBonus, ctx.tier, pol, ctx.priorRaises)
  const prob = probs[observed]
  const pc = (x: number) => `${Math.round(x * 100)}%`
  let reason = ''

  if (ctx.preflop) {
    const openTh = 10.0 - ctx.posBonus * 5.3
    const sv = strength.toFixed(1)
    const th = openTh.toFixed(1)
    if (ctx.priorRaises <= 0) {
      if (observed === 'aggr') reason = prob > 0 ? tt('rng.openAggrKeep', { sv, th }) : tt('rng.openAggrCut', { sv, th })
      else if (observed === 'check') reason = prob > 0 ? tt('rng.openCheckKeep', { sv, th }) : tt('rng.openCheckCut', { sv, th })
      else reason = prob > 0 ? tt('rng.openLimpKeep') : tt('rng.openLimpCut')
    } else if (ctx.priorRaises === 1) {
      if (observed === 'aggr') reason = strength >= 10 ? tt('rng.p1AggrPremium', { sv })
        : prob > 0 ? tt('rng.p1AggrBluff') : tt('rng.p1AggrCut')
      else if (observed === 'call') reason = prob > 0 ? tt('rng.p1CallKeep')
        : strength >= 10 ? tt('rng.p1CallPremiumCut') : tt('rng.p1CallWeakCut')
    } else if (ctx.priorRaises === 2) {
      if (observed === 'aggr') reason = strength >= 14 ? tt('rng.p2AggrMonster') : prob > 0 ? tt('rng.p2AggrBluff') : tt('rng.p2AggrCut')
      else if (observed === 'call') reason = prob > 0 ? tt('rng.p2CallKeep')
        : strength >= 14 ? tt('rng.p2CallPremiumCut') : tt('rng.p2CallWeakCut')
    } else {
      if (observed === 'aggr') reason = strength >= 15 ? tt('rng.p3AggrNuts') : tt('rng.p3AggrCut')
      else if (observed === 'call') reason = strength >= 12 && strength < 15 ? tt('rng.p3CallKeep') : tt('rng.p3CallCut')
    }
  } else {
    const sPct = pc(strength)
    if (ctx.toCall <= 0) {
      const aggrP = strength >= pol.betValue ? pol.betFreqStrong : draw ? pol.semiBluff : pol.bluff
      if (observed === 'check') {
        reason = strength >= pol.betValue
          ? tt('rng.pfCheckStrong', { s: sPct, bet: pc(pol.betFreqStrong), keep: pc(1 - aggrP) })
          : draw ? tt('rng.pfCheckDraw', { semi: pc(pol.semiBluff), keep: pc(1 - aggrP) })
          : tt('rng.pfCheckWeak', { s: sPct, keep: pc(1 - aggrP) })
      } else {
        reason = strength >= pol.betValue
          ? tt('rng.pfBetStrong', { s: sPct, bet: pc(pol.betFreqStrong) })
          : draw ? tt('rng.pfBetDraw', { semi: pc(pol.semiBluff) })
          : tt('rng.pfBetWeak', { bluff: pc(pol.bluff) })
      }
    } else {
      if (strength >= pol.raiseValue) {
        reason = observed === 'aggr'
          ? tt('rng.pfRaiseStrongKeep', { s: sPct })
          : tt('rng.pfRaiseStrongCut', { act: observed === 'call' ? 'CALL' : 'CHECK' })
      } else {
        const callsByOdds = strength >= ctx.potOdds + pol.callEdge
        if (observed === 'call') reason = prob > 0
          ? (callsByOdds ? tt('rng.pfCallOdds', { s: sPct, odds: pc(ctx.potOdds) })
            : draw ? tt('rng.pfCallDraw') : tt('rng.pfCallLight'))
          : tt('rng.pfCallCut', { s: sPct, odds: pc(ctx.potOdds) })
        else reason = prob > 0 ? tt('rng.pfRaiseBluffKeep') : tt('rng.pfRaiseBluffCut')
      }
    }
  }
  return { prob, reason }
}

// Initial range: every hand weighted by its number of combos, minus board blockers.
export function initRange(board: Card[] = []): RangeWeights {
  const used = RANK_BLOCK(board)
  const r: RangeWeights = {}
  for (const h of HANDS) {
    // crude blocker discount: drop combos that use a board card of the rep ranks
    let combos = h.combos
    const usesA = Object.keys(used).some(k => k[0] === h.rep[0].rank)
    const usesB = Object.keys(used).some(k => k[0] === h.rep[1].rank)
    if (usesA) combos *= 0.6
    if (usesB) combos *= 0.6
    r[h.key] = combos
  }
  return r
}

// ── Display helpers ──────────────────────────────────────────────────────────
export interface RangeView {
  cells: Record<string, number>  // handKey -> intensity 0..1 (relative)
  totalCombos: number            // estimated combos still in range
  pctOfHands: number             // % of all starting hands (1326)
}
export function rangeView(range: RangeWeights): RangeView {
  const cells: Record<string, number> = {}
  let max = 0, total = 0
  for (const h of HANDS) { const w = range[h.key] ?? 0; total += w; if (w > max) max = w }
  for (const h of HANDS) cells[h.key] = max > 0 ? (range[h.key] ?? 0) / max : 0
  return { cells, totalCombos: total, pctOfHands: total > 0 ? Math.min(100, (total / 1326) * 100) : 0 }
}

// One-line "what just happened" for the header above the grid.
export function actionSummary(observed: ActCat, ctx: { preflop: boolean; numCallers: number; was3betPlus: boolean }): { move: string; effect: string } {
  const move = observed === 'aggr' ? (ctx.was3betPlus ? 'RE-RAISE / 3-bet+' : ctx.preflop ? 'OPEN / RAISE' : 'BET / RAISE')
    : observed === 'call' ? 'CALL' : observed === 'check' ? 'CHECK' : 'FOLD'
  let effect: string
  if (observed === 'aggr') {
    effect = ctx.numCallers >= 2 ? tt('rng.effPolarTight') : tt('rng.effPolar')
  } else if (observed === 'call') {
    effect = tt('rng.effCondensed')
  } else if (observed === 'check') {
    effect = tt('rng.effCapped')
  } else {
    effect = tt('rng.effOut')
  }
  return { move, effect }
}
