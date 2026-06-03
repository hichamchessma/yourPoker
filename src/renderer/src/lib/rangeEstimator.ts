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
function madeStrength(hole: Card[], board: Card[]): number {
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
function hasStrongDraw(hole: Card[], board: Card[]): boolean {
  if (board.length >= 5 || board.length < 3) return false
  const all = [...hole, ...board]
  const bs: Record<string, number> = {}; all.forEach(c => (bs[c.suit] = (bs[c.suit] ?? 0) + 1))
  if (Object.values(bs).some(n => n === 4)) return true
  const vals = new Set(all.map(c => RV[c.rank])); if (vals.has(14)) vals.add(1)
  for (let lo = 1; lo <= 10; lo++) { let c = 0; for (let k = lo; k < lo + 5; k++) if (vals.has(k)) c++; if (c === 4 && (!vals.has(lo) || !vals.has(lo + 4))) return true }
  return false
}
function preflopStrength(c1: Card, c2: Card): number {
  const r1 = RV[c1.rank] ?? 2, r2 = RV[c2.rank] ?? 2
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2)
  const pair = r1 === r2, suited = c1.suit === c2.suit, gap = hi - lo
  if (pair) return hi >= 14 ? 10 : hi >= 12 ? 9 : hi >= 10 ? 8 : hi >= 8 ? 7 : 6
  if (hi === 14) { if (lo >= 13) return suited ? 10 : 9; if (lo >= 11) return suited ? 8 : 7; if (lo >= 9) return suited ? 7 : 6; return suited ? 6 : 5 }
  if (hi >= 13 && lo >= 11) return suited ? 8 : 7
  if (hi >= 12 && lo >= 10) return suited ? 7 : 6
  if (gap <= 1 && lo >= 9) return suited ? 7 : 6
  if (gap <= 1 && lo >= 7) return suited ? 6 : 5
  if (suited && gap <= 1 && lo >= 5) return 5
  if (suited && gap <= 2 && lo >= 5) return 4
  if (hi >= 10 && gap <= 2) return 4
  return Math.max(1, 2.5 - gap * 0.3 + (suited ? 0.5 : 0))
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

// ── Probability of each action category for a given hand strength ────────────
function actionProbs(preflop: boolean, strength: number, draw: boolean, toCall: number, potOdds: number, posBonus: number, tier: number, p: PolicyParams, facingRaise: boolean): Record<ActCat, number> {
  if (preflop) {
    // `strength` here is the raw preflop chart value (1..10).
    const openTh = 8.5 - posBonus * 4.5
    const threeBetTh = openTh + 2.5
    const callTh = openTh - 1.2
    if (toCall <= 0) return strength >= openTh ? { fold: 0, check: 0, call: 0, aggr: 1 } : { fold: 0, check: 1, call: 0, aggr: 0 }
    if (!facingRaise) {
      if (strength >= openTh) return { fold: 0, check: 0, call: 0, aggr: 1 }
      const call = tier === 1 && strength >= callTh ? 0.5 : 0
      return { fold: 1 - call, check: 0, call, aggr: 0 }
    }
    if (strength >= threeBetTh) return { fold: 0, check: 0, call: 0, aggr: 1 }
    if (strength >= callTh) return { fold: 0, check: 0, call: 1, aggr: 0 }
    const lightAggr = tier >= 2 && strength >= openTh - 2 ? (tier === 3 ? 0.10 : 0.06) : 0
    return { fold: 1 - lightAggr, check: 0, call: 0, aggr: lightAggr }
  }
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
  facingRaise: boolean // preflop: a raise happened before this player acted
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
    const probs = actionProbs(ctx.preflop, strength, draw, ctx.toCall, ctx.potOdds, ctx.posBonus, ctx.tier, p, ctx.facingRaise)
    out[h.key] = w * probs[observed]
  }
  return out
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
    effect = ctx.numCallers >= 2
      ? `range polarisée + resserrée (squeeze multiway → value-lourd, peu de bluffs)`
      : `range polarisée (value + bluffs)`
  } else if (observed === 'call') {
    effect = `range condensée / cappée (médiane — rarement le nuts)`
  } else if (observed === 'check') {
    effect = `range cappée (les grosses mains auraient souvent misé)`
  } else {
    effect = `hors du coup`
  }
  return { move, effect }
}
