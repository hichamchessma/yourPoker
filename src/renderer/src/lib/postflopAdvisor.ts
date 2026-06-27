// ─────────────────────────────────────────────────────────────────────────────
// Postflop coaching engine (offline) — "boosted".
//   • RANGE-AWARE equity: opponents aren't random, their range is weighted by how
//     aggressively they've played (barrels → stronger, more polarized range).
//   • Hand-class logic: value-raise only strong made hands; one pair = bluffcatch
//     (call/fold, never raise into aggression); draws = call / semi-bluff.
//   • SPR / effective-stack aware (commit decisions), board-texture aware sizing.
// Heuristic, not a solver — but a much sharper "expert beside you".
// ─────────────────────────────────────────────────────────────────────────────

import i18n from '../i18n'
const tt = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string

export interface Card { rank: string; suit: string }
export type AdviceAction = 'BET' | 'CHECK' | 'CALL' | 'RAISE' | 'FOLD'

// ── Shared, localized hand vocabulary (used by the live coach AND the trainers) ──
type DrawCode = 'flush' | 'oesd' | 'gutshot'
export function handCatLabel(cat: number): string { return tt(`hand.cat${Math.max(0, Math.min(8, cat))}`) }
function drawLabel(c: DrawCode): string { return tt(c === 'flush' ? 'hand.drawFlush' : c === 'oesd' ? 'hand.drawOesd' : 'hand.drawGut') }
function drawDisplay(cs: DrawCode[]): string[] { return cs.map(drawLabel) }
function pairLabel(p: PairKind): string { return tt(p === 'overpair' ? 'hand.pairOverpair' : p === 'top' ? 'hand.pairTop' : p === 'second' ? 'hand.pairSecond' : 'hand.pairWeak') }
const RANK_KEY: Record<number, string> = { 14: 'hand.rankA', 13: 'hand.rankK', 12: 'hand.rankQ', 11: 'hand.rankJ', 10: 'hand.rankT', 9: 'hand.r9', 8: 'hand.r8', 7: 'hand.r7', 6: 'hand.r6', 5: 'hand.r5', 4: 'hand.r4', 3: 'hand.r3', 2: 'hand.r2' }
function rankLabel(v: number): string { const k = RANK_KEY[v]; return k ? tt(k) : String(v) }

export interface FacePlanRow {
  label: string      // "⅓ pot", "pot", "all-in"…
  reqEq: number      // equity needed to call that bet/raise
  equation: string   // the math: "B = ⅔·pot ($X) ; req = B/(pot+2B) = 2/7 ≈ 29%"
  action: string     // "CALL", "FOLD", "RE-RAISE / 4-BET (valeur)"…
  why: string        // short math rationale
  kind: 'call' | 'fold' | 'reraise'   // language-agnostic action primitive (for the Pro Plan)
}
// ── PRO PLAN — the multi-street "line" a strong player would announce (check-call ⅓,
//    bet-fold, barrel turn…). Synthesised from facePlan + the made-hand read so it is
//    CONSISTENT with what the coach would advise at each next node (not faked depth). ──
export interface ProPlan {
  line: string                                   // shorthand headline: "CHECK / FOLD", "BET ⅔ / FOLD"…
  branches: { cond: string; act: string; kind: 'call' | 'fold' | 'reraise' }[]  // condensed decision tree
  turn: string                                   // next-street intent (barrel / give up / pot control)
  term: string                                   // the key pro term used (for the glossary)
}
export interface OutCard { card: Card; cat: number; label: string; weak?: boolean }
export interface Advice {
  action: AdviceAction
  sizingText: string
  equity: number
  potOdds: number
  madeHand: string
  madeCat: number          // true made-hand category (0 high card … 8) — language-agnostic logic key
  draws: string[]
  strongDraw: boolean       // flush / open-ended (logic key, not a localized string)
  reasons: string[]
  confidence: 'haute' | 'moyenne' | 'basse'
  facePlan?: FacePlanRow[] // plan vs a bet/raise behind — when CHECK / BET / CALL
  proPlan?: ProPlan        // synthesised multi-street "line" (Pro tier)
  story?: string[]         // "in a pro's head" — flowing reasoning beats (the narrative tab)
  outs: OutCard[]          // specific cards (flop/turn) that improve the hero's hand
  betFrac?: number         // recommended bet/raise size as a fraction of the pot (for auto-play)
  jam?: boolean            // recommended size is all-in
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const SUITS = ['♠', '♥', '♦', '♣']

// ── Evaluation ───────────────────────────────────────────────────────────────
function eval5(c: Card[]): number {
  const rv = c.map(x => RV[x.rank])
  const sv = c.map(x => x.suit)
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
  // Tiebreak by group size first (pairs/trips), then rank — so a pair beats a higher kicker.
  const tb: number[] = []
  Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a).forEach(r => { for (let i = 0; i < cnt[r]; i++) tb.push(r) })
  return rank * 15 ** 5 + (tb[0] ?? 0) * 15 ** 4 + (tb[1] ?? 0) * 15 ** 3 + (tb[2] ?? 0) * 15 ** 2 + (tb[3] ?? 0) * 15 + (tb[4] ?? 0)
}
function best7(cards: Card[]): number {
  if (cards.length <= 5) return eval5(padTo5(cards))
  let best = 0
  const n = cards.length
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const s = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]])
      if (s > best) best = s
    }
  return best
}
function padTo5(cards: Card[]): Card[] {
  const out = [...cards]
  while (out.length < 5) out.push({ rank: '2', suit: '♠' })
  return out
}
function categoryOf(score: number): number { return Math.floor(score / 15 ** 5) } // 0..8
export function handCategory(cards: Card[]): string { return handCatLabel(categoryOf(best7(cards))) }

// Best made-hand category among FEWER than 5 cards (no padding → no phantom pairs).
// Used to tell whether a card improves the BOARD alone (everyone) vs the HERO only.
function rawCat(cards: Card[]): number {
  if (cards.length >= 5) return categoryOf(best7(cards))
  const cnt: Record<number, number> = {}; cards.forEach(c => (cnt[RV[c.rank]] = (cnt[RV[c.rank]] ?? 0) + 1))
  const cv = Object.values(cnt).sort((a, b) => b - a)
  if (cv[0] === 4) return 7
  if (cv[0] === 3 && (cv[1] ?? 0) >= 2) return 6
  if (cv[0] === 3) return 3
  if (cv[0] === 2 && (cv[1] ?? 0) === 2) return 2
  if (cv[0] === 2) return 1
  return 0
}

// The exact cards (still in the deck) that improve the HERO's hand on the next
// street — i.e. visual "outs". Only flop/turn (a card is still to come), and only
// improvements that USE a hole card (a board pair/straight that helps everyone is
// not a hero out). Returns each out tagged with the hand category it completes.
export function computeOuts(hole: Card[], board: Card[]): OutCard[] {
  if (board.length < 3 || board.length >= 5) return []
  if (!hole[0] || !hole[1]) return []
  const known = new Set([...hole, ...board].map(c => c.rank + c.suit))
  const curCat = categoryOf(best7([...hole, ...board]))
  const holeRanks = new Set(hole.map(h => h.rank))
  // Dominated flush draw? On a 4-flush where the hero does NOT hold the highest
  // off-board card of the suit, completing it can still lose to a higher flush
  // (e.g. you hold 9♣ on A♣J♣T♣ — a K♣/Q♣ beats you). Flag those flush outs "weak".
  let weakFlushSuit: string | null = null
  for (const s of SUITS) {
    const suited = [...hole, ...board].filter(c => c.suit === s)
    if (suited.length !== 4 || !hole.some(h => h.suit === s)) continue // a live draw hero is part of
    const onBoard = new Set(board.filter(c => c.suit === s).map(c => RV[c.rank]))
    const heroRanks = hole.filter(c => c.suit === s).map(c => RV[c.rank])
    let nutOff = -1
    for (let r = 14; r >= 2; r--) if (!onBoard.has(r)) { nutOff = r; break } // best card of the suit not on board
    if (!heroRanks.includes(nutOff)) weakFlushSuit = s
  }
  const res: OutCard[] = []
  for (const c of fullDeck()) {
    if (known.has(c.rank + c.suit)) continue
    const heroCat = categoryOf(best7([...hole, ...board, c]))
    if (heroCat <= curCat) continue                 // must raise the hero's category
    if (heroCat <= rawCat([...board, c])) continue  // the gain must be hero-specific
    // A RANK-based gain (pair/two pair/trips/full/quads) is only a real out if the
    // card pairs one of the HERO's hole cards. Pairing the BOARD instead (e.g. an A
    // landing on A-J-T while you hold 99 → "two pair") hands that pair to everyone —
    // it doesn't improve YOUR relative hand, so it's not an out. Straights/flushes
    // are sequence/suit gains that inherently use your hole cards → always kept.
    const isDrawGain = heroCat === 4 || heroCat === 5 || heroCat === 8 // straight / flush / straight flush
    if (!isDrawGain && !holeRanks.has(c.rank)) continue
    const weak = heroCat === 5 && c.suit === weakFlushSuit
    res.push({ card: c, cat: heroCat, label: handCatLabel(heroCat), weak })
  }
  // Strongest improvement first, then by rank then suit — stable, easy to count.
  const suitOrder: Record<string, number> = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 }
  res.sort((a, b) => b.cat - a.cat || RV[b.card.rank] - RV[a.card.rank] || suitOrder[a.card.suit] - suitOrder[b.card.suit])
  return res
}

// ── Range-aware Monte-Carlo equity ───────────────────────────────────────────
function fullDeck(): Card[] { return SUITS.flatMap(s => RANKS.map(r => ({ rank: r, suit: s }))) }

// Plain equity vs N uniformly random opponents (used preflop / aggression 0).
export function monteCarloEquity(hole: Card[], board: Card[], opponents: number, iters = 1500): number {
  return rangeEquity(hole, board, opponents, 0, iters)
}

// A quick strong-draw check (flush draw or open-ended) for range weighting.
function hasStrongDraw(hole: Card[], board: Card[]): boolean {
  if (board.length >= 5 || board.length < 3) return false
  const all = [...hole, ...board]
  const bySuit: Record<string, number> = {}
  all.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  // A flush DRAW needs the HERO to hold a card of that suit — 4 of a suit all on the
  // board is a board flush, not the hero's draw (e.g. black JJ on a 4-heart board).
  if (Object.entries(bySuit).some(([s, n]) => n === 4 && hole.some(h => h.suit === s))) return true
  const vals = new Set(all.map(c => RV[c.rank]))
  if (vals.has(14)) vals.add(1)
  for (let lo = 1; lo <= 10; lo++) {
    let count = 0
    for (let k = lo; k < lo + 5; k++) if (vals.has(k)) count++
    if (count === 4 && (!vals.has(lo) || !vals.has(lo + 4))) return true // open-ended (not gutshot)
  }
  return false
}

// P(a player bets/continues this hand | their cards) — the realistic shape of an
// aggressor's range. A bettor is mostly value (top pair+, sets) + draws (semi-bluff)
// + a SMALL fraction of pure bluffs — NOT ~half air. This is what makes a weak made
// hand (e.g. bottom pair) correctly low-equity against a bet, so the coach folds it.
// `donkLead`: the bettor is NOT the pre-flop aggressor and is LEADING into the field
// (a donk-lead / lead-and-barrel, often OOP into several players). That line is far
// more value-defined than a generic c-bet — a passive caller who then bets out is
// rarely doing it with air/draws — so we STRIP the bluffy tail (weak pairs, draws,
// air) and concentrate the range on real value (top pair+/overpair/two pair/sets).
// `facingRaise`: the hero BET and got RAISED (a bet-then-raise on this street). A
// raise is the STRONGEST line — it's polarized to two-pair+/sets (+ a few semi-bluff
// draws), almost never "just" a top pair — so we strip even the top-pair tail and
// concentrate hard on the nutted value. This is what stops the coach from stacking
// off a single top pair into a turn/river raise.
function betFrequency(oppHole: Card[], board: Card[], a: number, donkLead = false, facingRaise = false): number {
  const cat = categoryOf(best7([...oppHole, ...board]))
  if (cat >= 3) return 0.95                              // set / straight / flush / boat+ → value
  const bRanks = board.map(c => RV[c.rank]).sort((x, y) => y - x)
  const pocket = oppHole[0].rank === oppHole[1].rank
  // Pairs the hand makes USING a hole card (a pocket pair, or a hole card matching a
  // board card). A "two pair" that leans on the BOARD's pair has only ONE own pair —
  // it's really one pair for ranking and it does NOT multi-barrel (e.g. 99 on Q-7-7).
  // A genuine two pair (two own pairs) stays strong value.
  const ownPairs = new Set<number>()
  if (pocket) ownPairs.add(RV[oppHole[0].rank])
  oppHole.forEach(c => { if (board.some(b => b.rank === c.rank)) ownPairs.add(RV[c.rank]) })
  if (cat === 2 && ownPairs.size >= 2) return 0.90       // genuine two pair
  const pairRank = ownPairs.size ? Math.max(...ownPairs) : 0
  if (pairRank > 0) {                                     // one pair (or a board-leaning "two pair") → by pair strength
    const above = bRanks.filter(r => r > pairRank).length // board cards out-ranking the own pair
    // The more barrels (higher a), the more POLARIZED the range: medium/weak pairs give
    // up (they don't multi-barrel), only strong top pair / overpair keep value-betting
    // (and even they ease off vs heavy aggression). This is what makes a board-paired
    // "two pair" (really one pair) correctly low-equity against a triple barrel.
    if (pocket && pairRank > bRanks[0]) return Math.max(0.25, 0.80 * (1 - a * 0.28)) // overpair (still raises for value)
    if (above === 0) return Math.max(0.22, 0.78 * (1 - a * 0.32)) * (facingRaise ? 0.12 : 1)  // top pair — a RAISE is rarely just this
    // donkLead = a LEAD (not a raise) is still more value-heavy than a c-bet, but NOT
    // as nitty as we modelled — opponents (esp. bots) bluff-lead/barrel a fair bit, so
    // softer multipliers keep more bluffs in the lead range → marginal made hands call
    // more vs leads (a top pair into a barrel is a real bluff-catch, not an auto-fold).
    if (above === 1) return Math.max(0.08, 0.52 * (1 - a * 0.7)) * (facingRaise ? 0.06 : donkLead ? 0.52 : 1)  // 2nd pair / middle
    return Math.max(0.05, 0.36 * (1 - a * 0.85)) * (facingRaise ? 0.04 : donkLead ? 0.44 : 1)              // weak / bottom pair
  }
  if (hasStrongDraw(oppHole, board)) return 0.58 * (facingRaise ? 0.18 : donkLead ? 0.58 : 1)  // a turn/river raise is rarely a BARE draw
  return Math.max(0.05, 0.18 * (1 - a * 0.4)) * (facingRaise ? 0.03 : donkLead ? 0.42 : 1)    // air bluff
}

// Pre-flop pot type narrows the villain's range BEFORE the flop. A 3-bet/4-bet pot
// means a premium-heavy range, so marginal made hands (top pair) are far weaker than
// vs a single-raised/random range. Returns an importance weight for the opponent's
// starting hand given the pot type. (Soft weights, not a hard filter, keep the MC
// stable while still crushing top-pair equity in a 4-bet pot.)
export type VillainTier = 'raised' | '3bet' | '4bet'
function preflopWeight(a: Card, b: Card, tier: VillainTier): number {
  const hi = Math.max(RV[a.rank], RV[b.rank]), lo = Math.min(RV[a.rank], RV[b.rank])
  const pair = a.rank === b.rank, suited = a.suit === b.suit
  if (tier === '4bet') {                          // ≈ QQ+, AK (+ a few suited-ace bluffs)
    if (pair && lo >= 12) return 1                // QQ+
    if (hi === 14 && lo === 13) return 1          // AK
    if (pair && lo === 11) return 0.35            // JJ (mixed)
    if (hi === 14 && lo === 12) return 0.3        // AQ (mixed)
    if (hi === 14 && (lo === 5 || lo === 4) && suited) return 0.25 // A5s/A4s bluff
    return 0.02
  }
  if (tier === '3bet') {                          // ≈ 99+, AJ+, KQ, suited broadways
    if (pair && lo >= 9) return 1                 // 99+
    if (hi === 14 && lo >= 12) return 1           // AQ+, AK
    if (hi === 14 && lo === 11) return 0.85       // AJ
    if (hi === 13 && lo === 12) return 0.8        // KQ
    if (pair && lo >= 6) return 0.5               // 66-88
    if (hi === 14 && lo === 10 && suited) return 0.6 // ATs
    if (suited && hi >= 12 && lo >= 10) return 0.5   // KJs/QJs/KTs/QTs
    if (hi === 14 && suited) return 0.3           // Axs bluffs
    return 0.05
  }
  return 1
}

// Equity where each opponent hand is importance-weighted by how likely a player
// would actually be betting/continuing it (see betFrequency), scaled by `aggression`
// (0 = random range … ~0.85 = multi-barreled, very polarized to value), and by the
// pre-flop pot type (`tier`: a 3-bet/4-bet pot is premium-heavy).
export function rangeEquity(hole: Card[], board: Card[], opponents: number, aggression: number, iters = 1800, tier?: VillainTier, aggressors?: number, donkLead = false, facingRaise = false): number {
  if (opponents < 1) return 1
  const known = new Set([...hole, ...board].map(c => c.rank + c.suit))
  const deck = fullDeck().filter(c => !known.has(c.rank + c.suit))
  const needBoard = 5 - board.length
  const a = Math.max(0, Math.min(0.9, aggression))
  // MULTIWAY: only the players who actually BET/RAISED have a polarized-to-value
  // range. The others merely CALLED — their range is capped/drawing, barely stronger
  // than random — so applying the bettor's aggression to ALL opponents wildly
  // under-rates a strong hand (e.g. KK overpair folds the turn 5-way because the 3
  // cold-callers are wrongly treated as value-bettors). `aggressors` = how many
  // opponents drove the action; the rest get a mild "caller" weighting.
  const nAgg = aggressors === undefined ? opponents : Math.max(0, Math.min(opponents, aggressors))
  const callerA = a * 0.4 // a continuing (calling) range: slightly above random, NOT polarized to value

  const keepProb = (oppHole: Card[], aggr: number): number => {
    let w = 1
    if (aggr > 0 && board.length >= 3) {
      // Blend a uniform range with the bet-frequency-shaped (polarized-to-value) range.
      // The blend ramps to 100% by the time we've seen ~2 barrels, so a barreled range
      // is fully shaped (weak hands carry little weight) rather than half-uniform air.
      const blend = Math.min(1, aggr / 0.45)
      w *= (1 - blend) * 1 + blend * betFrequency(oppHole, board, aggr, donkLead, facingRaise)
    }
    if (tier === '3bet' || tier === '4bet') w *= preflopWeight(oppHole[0], oppHole[1], tier)
    return w
  }

  let winW = 0, totW = 0
  for (let it = 0; it < iters; it++) {
    const need = needBoard + opponents * 2
    const pool = deck.slice()
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const fullBoard = board.concat(pool.slice(0, needBoard))
    const heroScore = best7(hole.concat(fullBoard))
    let p = needBoard, w = 1, beaten = false, tie = 1
    for (let o = 0; o < opponents; o++) {
      const oh = [pool[p], pool[p + 1]]; p += 2
      w *= keepProb(oh, o < nAgg ? a : callerA) // first nAgg slots = aggressors, rest = callers
      const sc = best7(oh.concat(fullBoard))
      if (sc > heroScore) beaten = true
      else if (sc === heroScore) tie++
    }
    totW += w
    if (!beaten) winW += w * (1 / tie)
  }
  return totW > 0 ? winW / totW : 0
}

// ── Made-hand class on the current board ─────────────────────────────────────
type PairKind = 'overpair' | 'top' | 'second' | 'weak' | 'none'
function analyseMade(hole: Card[], board: Card[]): { cat: number; pair: PairKind; name: string } {
  const cat = categoryOf(best7([...hole, ...board]))
  let pair: PairKind = 'none'
  if (cat === 1 && board.length >= 3) {
    const bRanks = board.map(c => RV[c.rank]).sort((x, y) => y - x)
    const hRanks = hole.map(c => RV[c.rank])
    const pocket = hole[0].rank === hole[1].rank
    if (pocket && hRanks[0] > bRanks[0]) pair = 'overpair'
    else if (hRanks.includes(bRanks[0])) pair = 'top'
    else if (bRanks[1] !== undefined && hRanks.includes(bRanks[1])) pair = 'second'
    else pair = 'weak'
  }
  return { cat, pair, name: handCatLabel(cat) }
}

// ── Draw detection (returns STABLE codes; translate for display via drawDisplay) ─
function detectDraws(hole: Card[], board: Card[]): DrawCode[] {
  const draws: DrawCode[] = []
  if (board.length >= 5) return draws
  const all = [...hole, ...board]
  const bySuit: Record<string, number> = {}
  all.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  // Only a flush draw the HERO actually holds (a card of that suit) — 4 of a suit all
  // on the board is a board flush, not the hero's draw.
  if (Object.entries(bySuit).some(([s, n]) => n === 4 && hole.some(h => h.suit === s))) draws.push('flush')
  const vals = new Set(all.map(c => RV[c.rank]))
  if (vals.has(14)) vals.add(1)
  let oesd = false, gut = false
  for (let lo = 1; lo <= 10; lo++) {
    let count = 0
    for (let k = lo; k < lo + 5; k++) if (vals.has(k)) count++
    if (count === 4) { if (!vals.has(lo + 4) || !vals.has(lo)) oesd = true; else gut = true }
  }
  if (oesd) draws.push('oesd')
  else if (gut) draws.push('gutshot')
  return draws
}
function isStrongDraw(cs: DrawCode[]): boolean { return cs.some(d => d === 'flush' || d === 'oesd') }

// Wet/dangerous board: 3+ to a flush, or 3+ connected → ranges connect more.
function boardWetness(board: Card[]): number {
  if (board.length < 3) return 0
  let w = 0
  const bySuit: Record<string, number> = {}
  board.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  const maxSuit = Math.max(...Object.values(bySuit))
  if (maxSuit >= 3) w += 0.5; else if (maxSuit === 2) w += 0.2
  const vals = [...new Set(board.map(c => RV[c.rank]))].sort((a, b) => a - b)
  let conn = 0
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] <= 2) conn++
  if (conn >= 2) w += 0.4; else if (conn === 1) w += 0.15
  return Math.min(1, w)
}

// ── Board texture class (solver-informed) — drives c-bet sizing via the "wetness
//    parabola": dynamic two-tone boards take a BIG bet (charge the many draws), but
//    BOTH dry AND very-wet (monotone / straight-heavy) boards take a SMALL bet — a big
//    bet there only folds out trash and runs into too many strong hands. Sources:
//    GTO Wizard "Mechanics of C-Bet Sizing" / "Flop heuristics IP c-betting".
type TextureClass = 'dry' | 'dynamic' | 'connected' | 'monotone'
function textureClass(board: Card[]): TextureClass {
  if (board.length < 3) return 'dry'
  const bySuit: Record<string, number> = {}; board.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  const maxSuit = Math.max(...Object.values(bySuit))
  if (maxSuit >= 3) return 'monotone'                                   // 3+ to a flush → small (parabola)
  const vals = [...new Set(board.map(c => RV[c.rank]))].sort((a, b) => a - b)
  for (let lo = 2; lo <= 10; lo++) if (vals.filter(v => v >= lo && v < lo + 5).length >= 3) return 'connected' // straights live → size DOWN
  if (maxSuit === 2 && board.length < 5) return 'dynamic'              // two-tone = a flush DRAW to charge (only pre-river) → BIG
  return 'dry'                                                          // rainbow / no live draw → dry
}
// Recommended value c-bet / value-raise size as a fraction of the pot, by texture.
// Multiway leans a touch bigger (value-heavier, less fold equity needed).
function cbetFrac(board: Card[], opponents: number, forRaise: boolean, strongValue: boolean, loose = false): number {
  const cls = textureClass(board)
  // Ranges polarize toward the river → STRONG value bets grow by street on dry/dynamic
  // boards. A MEDIUM one-pair value hand does NOT get the polar bump (on the river it has
  // no protection value and only thin value — bloating just folds out worse / gets called
  // by better). Monotone/connected stay cautious for everyone.
  const polar = strongValue ? (board.length >= 5 ? 0.15 : board.length >= 4 ? 0.07 : 0) : 0
  let f = cls === 'dynamic' ? 0.75 + polar   // two-tone / gappy → charge draws big
    : cls === 'connected' ? 0.5         // straights in the defender's range → size down
    : cls === 'monotone' ? 0.4          // wetness parabola → small (fold only trash otherwise)
    : 0.55 + polar                      // dry/static → medium, more polar by street for value
  if (forRaise) f += 0.1
  if (Math.max(1, opponents) >= 2) f += 0.08
  // EXPLOIT vs a loose / calling-station opponent: they pay off, so size value UP (more
  // chips in when you're ahead). Only when it's genuinely a value hand.
  if (loose && strongValue) f += 0.18
  return Math.min(forRaise ? 1.15 : 1.0, f)
}

// ── Main advice ──────────────────────────────────────────────────────────────
export function getPostflopAdvice(input: {
  hole: Card[]; board: Card[]; pot: number; toCall: number
  heroStack: number; effStack?: number; opponents: number; inPosition: boolean
  aggression?: number; barrels?: number; bb?: number; villainTier?: VillainTier; aggressors?: number; cappedRange?: boolean; callPressure?: number; iters?: number; donkLead?: boolean; facingRaise?: boolean
  villainLoose?: boolean   // EXPLOIT: the relevant opponent is a loose-passive / calling-station type (tier-1 fish) → value bigger, bluff less
}): Advice {
  const { hole, board, pot, opponents, inPosition } = input
  // You can NEVER call more than your remaining stack. Facing a bet bigger than your
  // stack means you're all-in for LESS, so the true price — and therefore the pot odds —
  // is your stack, not the full bet. Without this cap the coach prices the full bet and
  // folds made hands that are getting massive odds to call off their last chips: e.g. AJ
  // top pair folding for 9k into a 74k pot because it "needed" to pay a 28k river bet. In
  // a tournament that's a catastrophic leak. When toCall ≤ stack (the normal case) the cap
  // is a no-op → zero regression on every standard spot.
  const toCall = input.heroStack > 0 ? Math.min(input.toCall, input.heroStack) : input.toCall
  const rawAggr0 = Math.max(0, Math.min(0.9, input.aggression ?? 0))
  // CALL PRESSURE: opponents who passively CALL several streets (especially multiway)
  // DON'T have air — a called-down range is value-heavy. The aggression model only
  // counts BETS, so without this a 1-pair hand (even an overpair) looks way ahead when
  // 2 players just called 3 barrels, and the coach keeps value-betting into a hand that
  // crushes it. Treat sustained calling like aggression for the equity (narrows range).
  const rawAggr = Math.max(rawAggr0, input.callPressure ?? 0)
  // A "delayed" bet — the villain CHECKED an earlier postflop street, then bet — is a
  // CAPPED range: the strongest hands (e.g. a flopped top pair / set) usually bet
  // earlier, so a checked-then-bet line is rarely the nuts and carries far more
  // bluffs / medium hands. Soften the value-polarization so the hero's bluff-catchers
  // correctly call more (it also eases the reverse-implied-odds cushion).
  // BUT only for a SINGLE delayed bet. Once the villain keeps BARRELLING (2+ streets) the
  // range re-polarises to value — the hands that delayed now fire, and a completing scare
  // card makes value credible — so the "capped" discount switches OFF instead of paying
  // down a double/triple barrel with an underpair (e.g. 77 vs check-flop, bet-turn, bet-A-river).
  const cappedActive = !!input.cappedRange && (input.barrels ?? 0) <= 1
  const aggression = cappedActive ? rawAggr * 0.5 : rawAggr
  const effStack = input.effStack ?? input.heroStack
  const barrels = input.barrels ?? 0
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  // A TINY bet (great pot odds, e.g. a 6%-pot "shove" of a short stack's last chips) is
  // NOT a value-defined line — it's a blocker / busted draw / desperate jam, full of
  // bluffs. So DON'T concentrate the villain's range to value (ignore donkLead/facingRaise)
  // when the price is tiny — that wrongly crushes your equity and folds a made hand that
  // is getting 10:1+. (The reverse-implied-odds margin is also dropped below.)
  const tinyBet = toCall > 0 && potOdds < 0.15

  const eq = rangeEquity(hole, board, Math.max(1, opponents), aggression, input.iters ?? 1800, input.villainTier, input.aggressors, input.donkLead && !tinyBet, input.facingRaise && !tinyBet)
  const { cat, pair, name } = analyseMade(hole, board)
  const drawCodes = detectDraws(hole, board)
  const draws = drawDisplay(drawCodes)
  const strongDraw = isStrongDraw(drawCodes)
  const wet = boardWetness(board)
  const spr = pot > 0 ? effStack / pot : 99
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const round = (v: number) => Math.max(1, Math.round(v))

  // Villain bet earlier streets but now it's checked to us → their range is CAPPED
  // (strong hands would usually keep betting). Key signal for turning air into a bluff.
  const villainGaveUp = toCall <= 0 && aggression > 0
  const reasons: string[] = []
  const eqSuffix = villainGaveUp ? tt('cadv.eqVsCapped')
    : aggression > 0 ? tt('cadv.eqVsRange', { q: barrels >= 2 ? tt('cadv.eqRangeStrong') : tt('cadv.eqRangeTight') })
    : tt('cadv.eqVsOpp', { count: opponents })
  reasons.push(tt('cadv.equityReal', { eq: pct(eq), suffix: eqSuffix }))
  if (toCall > 0) reasons.push(tt('cadv.potOdds', { odds: pct(potOdds), toCall }))
  if (cappedActive && toCall > 0) reasons.push(tt('cadv.capped'))
  if (input.donkLead && !input.facingRaise && toCall > 0) reasons.push(tt('cadv.donkLead'))
  if (input.facingRaise && toCall > 0) reasons.push(tt('cadv.facingRaise'))
  // "Playing the board" is strictly a RIVER concept (5 community cards) where your
  // hole cards add nothing. Pre-river you always hold at least high-card / a draw,
  // so we never mislabel it (and we avoid padding the board with fake cards).
  const playsBoard = board.length === 5 && best7([...hole, ...board]) <= best7(board)
  // A "pair" that comes only from the BOARD (hero's hole cards don't pair anything)
  // is NOT a real made hand — treat it as air + draw, not a bluffcatcher.
  const heroHasRealPair = hole[0].rank === hole[1].rank || hole.some(h => board.some(b => b.rank === h.rank))
  const boardOnlyPair = cat === 1 && !heroHasRealPair
  // Distinct ranks the hero pairs USING a hole card (a pocket pair, or a hole card
  // matching a board card). A "two pair" that leans on a BOARD pair (e.g. KQ on
  // Q-5-5: your QQ + the board's 55) has only ONE such rank — the 55 is shared by
  // everyone, so it adds no relative strength. It's really TOP/one pair, so we demote
  // it and play it as a bluff-catch / pot-control hand, not a strong value two-pair.
  const holePairRanks = new Set<number>()
  if (hole[0].rank === hole[1].rank) holePairRanks.add(RV[hole[0].rank])
  hole.forEach(h => { if (board.some(b => b.rank === h.rank)) holePairRanks.add(RV[h.rank]) })
  const boardLeanTwoPair = cat === 2 && holePairRanks.size <= 1
  // Trips / full house / quads the hero makes WITHOUT any hole-card pair (no pocket pair,
  // no card matching the board) sit ENTIRELY on the board — everyone shares them, only
  // the kicker plays. e.g. Q-T on A-2-K-K-K is NOT trips, it's a Queen kicker → don't
  // value-bet/jam it. (Straights/flushes are excluded: hole cards can form those.)
  const boardOnlyMade = (cat === 3 || cat === 6 || cat === 7) && !heroHasRealPair
  const effCat = boardOnlyPair || boardOnlyMade ? 0 : boardLeanTwoPair ? 1 : cat
  // Effective pair class for the demoted hand (analyseMade only classifies cat 1).
  let effPair: PairKind = pair
  if (boardLeanTwoPair) {
    const pr = [...holePairRanks][0] ?? 0
    const bSorted = board.map(c => RV[c.rank]).sort((a, b) => b - a)
    const pocket = hole[0].rank === hole[1].rank
    effPair = (pocket && pr > bSorted[0]) ? 'overpair' : pr >= bSorted[0] ? 'top' : pr >= (bSorted[1] ?? 0) ? 'second' : 'weak'
  }
  const boardPaired = (() => { const r: Record<number, number> = {}; board.forEach(c => (r[RV[c.rank]] = (r[RV[c.rank]] ?? 0) + 1)); return Object.values(r).some(n => n >= 2) })()
  // Low / dominated flush draw: hero's highest card in the 4-flush suit is small →
  // reverse implied odds (you can complete it and still lose to a higher flush).
  const flushSuit = (() => { const s: Record<string, number> = {}; [...hole, ...board].forEach(c => (s[c.suit] = (s[c.suit] ?? 0) + 1)); const e = Object.entries(s).find(([, n]) => n === 4); return e ? e[0] : null })()
  const flushHigh = flushSuit ? Math.max(0, ...hole.filter(c => c.suit === flushSuit).map(c => RV[c.rank])) : 0
  const lowFlushDraw = !!flushSuit && flushHigh < 12
  // A draw that is hero's ONLY equity (no real made hand). Reverse-implied if it's a
  // low flush or the board is paired (you hit but lose to a higher flush / full house).
  const drawIsOnlyEquity = strongDraw && effCat === 0 && !playsBoard
  const vulnerableDraw = drawIsOnlyEquity && (boardPaired || lowFlushDraw)
  // Equity margin required to CALL: negative for clean draws (implied odds let you
  // call slightly below the price), POSITIVE for vulnerable draws facing aggression
  // (reverse implied odds → you need MORE than the raw price to call profitably).
  // A one-pair that is easily dominated (2nd/weak pair, or top pair on a wet board)
  // needs a SAFETY CUSHION over the raw price: multiway + facing aggression = reverse
  // implied odds (you're often already beaten or drawing thin, and you can still be
  // raised behind when you don't close the action). Heads-up vs a small bet the cushion
  // stays tiny, so a genuine bluffcatch that beats the price still calls.
  const dominatedPair = effCat === 1 && (effPair === 'second' || effPair === 'weak' || (effPair === 'top' && (wet > 0.4 || !!input.facingRaise)))
  const onePairMargin = dominatedPair
    ? 0.03 + (Math.max(1, opponents) >= 2 ? 0.03 : 0) + (aggression >= 0.4 ? 0.02 : 0) + (input.facingRaise ? 0.08 : 0)
    : 0.01
  // AIR (no pair, no real draw — overcards / backdoors only) REALIZES poorly: it must
  // improve to win and can't barrel profitably, especially OOP / multiway. So it needs
  // a real cushion over the raw price, not the tiny one-pair margin — otherwise the
  // coach calls a c-bet with ace-high (e.g. A5 high on J-Q-7) that beats the price on
  // raw equity but is a clear fold once realization is accounted for.
  const airNoDraw = effCat === 0 && !playsBoard && !drawIsOnlyEquity && !strongDraw
  // A no-pair hand still draws via its OUTS. A real out-count (gutshot + overcards ≈ 8-10
  // outs) realizes like a draw and must NOT pay the full "pure air" reverse-implied cushion
  // — that folds a 10-out draw that's getting the price, a clear leak. Scale by the outs.
  const outsList = computeOuts(hole, board)
  const outsN = outsList.length
  const airMargin = outsN >= 8 ? -0.02                                                          // genuine draw (gutshot+overs / double gutshot)
    : outsN >= 6 ? 0.02 + (!inPosition ? 0.02 : 0) + (Math.max(1, opponents) >= 2 ? 0.02 : 0)   // overcards-ish: modest cushion
    : 0.05 + (!inPosition ? 0.05 : 0) + (Math.max(1, opponents) >= 2 ? 0.04 : 0)                // true air: full cushion
  const rawCallMargin = drawIsOnlyEquity
    ? (vulnerableDraw ? (aggression >= 0.5 ? 0.05 : 0.03) : (board.length <= 3 ? -0.05 : -0.01))
    : airNoDraw ? airMargin
    : onePairMargin
  // Facing a TINY bet (huge pot odds, often an all-in closing the action) there's no
  // reverse-implied-odds risk — call on the raw price. Don't stack a safety cushion on
  // top of a 10:1+ price: that's how you fold a made hand getting 17:1 (a catastrophe).
  const callMargin = tinyBet ? Math.min(rawCallMargin, 0.01) : rawCallMargin
  // Implied-odds buffer below direct pot odds: generous on the flop (two cards to
  // come), almost none on the turn (one card, little room to get paid).
  const impliedBuf = board.length <= 3 ? 0.05 : 0.01

  const drawsTxt = draws.length ? ' + ' + draws.join(' + ') : ''
  reasons.push((playsBoard || boardOnlyPair)
    ? tt('cadv.handBoard', { what: boardOnlyPair ? tt('cadv.playBoardPair') : tt('cadv.playBoard', { name }), draws: draws.length ? tt('cadv.onlyDraws', { draws: draws.join(' + ') }) : '' })
    : boardLeanTwoPair
    ? tt('cadv.handLeanTwoPair', { pair: pairLabel(effPair) })
    : tt('cadv.handMade', { name, pair: effPair !== 'none' ? tt('cadv.pairParen', { pair: pairLabel(effPair) }) : '', draws: drawsTxt }))
  reasons.push(inPosition ? tt('cadv.inPos') : tt('cadv.oop'))
  if (effCat === 0 && !playsBoard && !drawIsOnlyEquity && toCall > 0) reasons.push(tt('cadv.highCardValue'))
  if (pot > 0 && spr < 4) reasons.push(tt('cadv.spr', { spr: spr.toFixed(1), txt: spr <= 1.5 ? tt('cadv.sprCommitted') : tt('cadv.sprLow') }))

  // Multiway, called-down: a LONE overpair/one pair is often beaten when several
  // players have called multiple streets (their range is value-heavy two-pair+/sets).
  // Don't treat it as "strong value" → pot-control instead of barrelling/stacking off.
  const beatenMultiway = (input.callPressure ?? 0) >= 0.45 && Math.max(1, opponents) >= 2 && effCat <= 1 && eq < 0.52
  const isStrongValue = !playsBoard && (effCat >= 2 || effPair === 'overpair') && !beatenMultiway // two pair+, sets, overpair
  const isOnePair = !playsBoard && effCat === 1
  if (beatenMultiway) reasons.push(tt('cadv.beatenMultiway', { eq: pct(eq) }))
  // Texture-driven value sizing (wetness parabola) — replaces the old "wetter = bigger"
  // binary, which wrongly sized UP on monotone boards (those want SMALL).
  const vbFrac = cbetFrac(board, opponents, false, isStrongValue, !!input.villainLoose)
  const vrFrac = cbetFrac(board, opponents, true, isStrongValue, !!input.villainLoose)
  const fracLabel = (f: number) => f >= 0.7 ? '¾' : f >= 0.58 ? '⅔' : f >= 0.45 ? '½' : '⅓'
  const valueRaiseSize = round(pot * vrFrac)
  const valueBetSize = round(pot * vbFrac)
  // DANGER board for a RAISE: a STRAIGHT or FLUSH is possible that the hero does NOT
  // hold. Then a "strong" made hand (two pair / set) facing aggression is really a
  // BLUFF-CATCHER — raising only gets called by the straights/flushes/better that crush
  // it (it folds out the bluffs you beat). So DON'T value-raise it: call instead.
  const suitCntB: Record<string, number> = {}; board.forEach(c => (suitCntB[c.suit] = (suitCntB[c.suit] ?? 0) + 1))
  const flushPossibleB = Math.max(0, ...Object.values(suitCntB)) >= 3
  const bvalsB = [...new Set(board.map(c => RV[c.rank]))]
  let straightPossibleB = false
  for (let lo = 2; lo <= 10 && !straightPossibleB; lo++) if (bvalsB.filter(v => v >= lo && v < lo + 5).length >= 3) straightPossibleB = true
  // hero "has it" if they make a straight+ (effCat>=4) — then they CAN raise for value.
  const raiseGetsOnlyValue = (flushPossibleB || straightPossibleB) && effCat >= 2 && effCat < 4 && toCall > 0 && aggression >= 0.5
  // ── OVERBET (polarized value): a NUTTED hand (set+, effCat≥3) with a clear nut advantage
  // on a HIGH-card dry/dynamic board (villain holds inelastic top pairs that can't fold),
  // heads-up, with no completed straight/flush we don't hold. Polarize & bet BIG — bigger
  // by street as ranges polarize toward the river. Research (verified): disconnected
  // A/Broadway/low boards are overbet most (AK6r); overbets need nut advantage + an
  // inelastic range. Tightly gated so it only fires on genuine monsters.
  const maxBoardRank = board.length >= 3 ? Math.max(...board.map(c => RV[c.rank])) : 0
  // vs a loose/station opponent the overbet pays off more readily → relax the equity bar.
  const overbetSpot = toCall === 0 && effCat >= 3 && eq >= (input.villainLoose ? 0.74 : 0.80) && Math.max(1, opponents) === 1
    && maxBoardRank >= 12 && !flushPossibleB && !straightPossibleB
    && (textureClass(board) === 'dry' || textureClass(board) === 'dynamic')

  let action: AdviceAction
  let sizingText = ''
  let confidence: Advice['confidence'] = 'moyenne'
  let betFrac = 0 // recommended bet/raise size as a pot fraction (for auto-play)
  let jam = false // recommended size is all-in

  if (toCall > 0) {
    // ── Facing a bet/raise. Golden rule: NEVER fold when equity beats the pot
    // odds — only raise (strong value) or call/fold around the price. ──
    if (isStrongValue && eq >= 0.55 && !raiseGetsOnlyValue) {
      // Strong made hand with the edge → value raise.
      if (spr <= 1.5) { action = 'RAISE'; sizingText = tt('cadv.szRaiseAllinLowSpr'); jam = true }
      else { action = 'RAISE'; sizingText = tt('cadv.szValueRaise', { frac: fracLabel(vrFrac), amt: valueRaiseSize }); betFrac = vrFrac }
      reasons.push(tt('cadv.valueRaise'))
      confidence = eq >= 0.7 ? 'haute' : 'moyenne'
    } else if (eq >= potOdds + callMargin) {
      // Profitable continue, given the required margin (implied odds lower it for clean
      // draws, reverse implied odds raise it for vulnerable ones). Frame by hand type.
      action = 'CALL'
      if (raiseGetsOnlyValue) { sizingText = tt('cadv.szBluffCatch', { toCall }); reasons.push(tt('cadv.bluffCatchBoard', { tex: straightPossibleB ? tt('cadv.straightWord') : tt('cadv.flushWord'), name: name.toLowerCase(), tex2: straightPossibleB ? tt('cadv.straightsWord') : tt('cadv.flushesWord') })); confidence = 'moyenne' }
      else if (isStrongValue) { sizingText = tt('cadv.szCall', { toCall }); reasons.push(tt('cadv.strongValueCall')); confidence = 'moyenne' }
      else if (drawIsOnlyEquity) {
        sizingText = tt('cadv.szDrawCall', { toCall })
        reasons.push(callMargin < 0
          ? tt('cadv.drawCallImplied', { eq: pct(eq) })
          : tt('cadv.drawCallTight', { eq: pct(eq), req: pct(potOdds + callMargin) }))
        if (vulnerableDraw) reasons.push(tt('cadv.vulnDraw'))
        confidence = 'basse'
      }
      else if (isOnePair) { sizingText = tt('cadv.szBluffcatch', { toCall }); reasons.push(tt('cadv.bluffcatch', { eq: pct(eq), odds: pct(potOdds) })); confidence = eq >= potOdds + 0.12 ? 'moyenne' : 'basse' }
      else { sizingText = tt('cadv.szCall', { toCall }); reasons.push(tt('cadv.callProfit', { eq: pct(eq), odds: pct(potOdds) })); confidence = eq >= potOdds + 0.15 ? 'moyenne' : 'basse' }
    } else {
      action = 'FOLD'; sizingText = tt('cadv.szFold')
      if (vulnerableDraw) reasons.push(tt('cadv.foldVulnDraw', { eq: pct(eq), req: pct(potOdds + callMargin) }))
      else if (strongDraw) reasons.push(tt('cadv.foldDraw', { eq: pct(eq), odds: pct(potOdds), turn: board.length >= 4 ? tt('cadv.oneCardLeft') : '' }))
      else if (eq >= potOdds) reasons.push(tt('cadv.foldMarginal', { eq: pct(eq), odds: pct(potOdds), dom: effCat === 1 ? tt('cadv.domPair') : tt('cadv.domMarginal'), multi: Math.max(1, opponents) >= 2 ? tt('cadv.multiwaySuffix') : '', aggr: aggression > 0 ? tt('cadv.vsAggrSuffix') : '', oop: !inPosition ? tt('cadv.oopSuffix') : '', req: pct(potOdds + callMargin) }))
      else reasons.push(tt('cadv.foldNoOdds', { eq: pct(eq), odds: pct(potOdds) }))
      confidence = eq < potOdds - 0.08 ? 'haute' : 'moyenne'
    }
  } else {
    // ── No bet to call (checked to you / you open the action) ──
    // THIN VALUE vs a CAPPED range: when the pot has gone passive (villain checked an
    // earlier street → capped/weak range), a medium one-pair that's clearly ahead
    // (≈70%+ equity) should bet SMALL for value — worse pairs call, and checking back
    // just leaves money on the table. This is the classic "second pair good kicker bets
    // the river after it checks through" spot.
    const thinValueVsCapped = !!input.cappedRange && isOnePair && !isStrongValue && effPair !== 'top' && eq >= 0.70
    // PROTECTION / equity-denial bet: a VULNERABLE made pair (2nd/weak) that is still
    // the LIKELY BEST hand vs a capped range — above its fair share of the pot (1/(n+1))
    // — but can be outdrawn (under-pairs → sets, overcards → pairs). With cards still to
    // come, bet to DENY a free outdraw and take it down NOW (not for value). This is the
    // classic "bet to end the hand & protect", not "bet to get paid".
    const fairShare = 1 / (Math.max(1, opponents) + 1)
    const protectionBet = !!input.cappedRange && isOnePair && !isStrongValue && !thinValueVsCapped
      && (effPair === 'second' || effPair === 'weak') && board.length < 5
      && eq >= Math.max(0.42, fairShare + 0.06) && eq < 0.70
    // PROTECTION on a DRAW-heavy board (no capped read needed): a TOP pair / overpair
    // (incl. a board-leaning two pair demoted to top pair) that is the LIKELY BEST hand
    // must BET to charge the flush/straight DRAWS — checking gives a free card that
    // completes them. The coach only value-bet a top pair at ≥60%, so it CHECKED
    // strong-but-not-60% hands on wet boards and let the draw hit for free.
    const maxSuitB = Math.max(0, ...Object.values(suitCntB))
    const drawyBoard = board.length < 5 && (maxSuitB === 2 || straightPossibleB || wet >= 0.4)
    const protectVsDraw = toCall <= 0 && !isStrongValue && !thinValueVsCapped && !protectionBet
      && isOnePair && (effPair === 'top' || effPair === 'overpair')
      && drawyBoard && eq >= Math.max(0.48, fairShare + 0.1)
    // A COMPLETED flush sits on the board (4+ of a suit) and the hero has NO flush
    // (effCat < 5): a set / two pair / pair is BEHIND every made flush → betting for
    // "value" only gets called by flushes (which crush it) and folds out worse. Check
    // and pot-control instead (we still beat non-flushes and may redraw to a full house).
    const boardFlushNoHero = maxSuitB >= 4 && effCat < 5
    if (boardFlushNoHero && (isStrongValue || isOnePair)) {
      action = 'CHECK'; sizingText = tt('cadv.szCheckPotControl')
      reasons.push(tt('cadv.flushBoardPotControl', { n: maxSuitB, name: name.toLowerCase() }))
      confidence = 'moyenne'
    } else if (isStrongValue || (isOnePair && effPair === 'top' && eq >= 0.6) || thinValueVsCapped || protectionBet || protectVsDraw) {
      action = 'BET'
      if (protectionBet) {
        sizingText = tt('cadv.szProtectionHalf', { amt: round(pot * 0.5) }); betFrac = 0.5
        reasons.push(tt('cadv.protectionBet'))
      } else if (protectVsDraw) {
        sizingText = tt('cadv.szProtectionTwoThird', { amt: round(pot * 0.66) }); betFrac = 0.66
        reasons.push(tt('cadv.protectVsDraw'))
      } else if (thinValueVsCapped && eq < 0.8) {
        sizingText = tt('cadv.szThinValue', { amt: round(pot * 0.4) }); betFrac = 0.4
        reasons.push(tt('cadv.thinValue'))
      } else if (overbetSpot) {
        const obFrac = board.length >= 5 ? 1.5 : board.length >= 4 ? 1.35 : 1.25   // polarity grows by street
        sizingText = tt('cadv.szOverbet', { mult: String(obFrac), amt: round(pot * obFrac) }); betFrac = obFrac
        reasons.push(tt('cadv.overbet'))
      } else {
        sizingText = tt('cadv.szValueBet', { frac: fracLabel(vbFrac), amt: valueBetSize }); betFrac = vbFrac
        reasons.push(tt('cadv.valueBet'))
      }
      confidence = eq >= 0.72 ? 'haute' : 'moyenne'
    } else if (strongDraw) {
      action = 'BET'; sizingText = tt('cadv.szSemiBluff', { amt: round(pot * 0.5) }); betFrac = 0.5
      reasons.push(tt('cadv.semiBluff'))
      confidence = 'basse'
    } else if (isOnePair) {
      action = 'CHECK'; sizingText = tt('cadv.szCheckPotControl')
      reasons.push(tt('cadv.onePairCheck'))
      confidence = 'moyenne'
    } else {
      // Weak hand, ~no showdown value. If the villain showed weakness (barreled then
      // CHECKED to us) on a board where we can credibly rep value (flush/straight
      // texture), turn the air into a BLUFF — checking just surrenders the pot. This
      // is the give-up-vs-bluff decision, and it's clearest on the turn/river.
      const lateStreet = board.length >= 4
      const noSDV = cat === 0 && eq < 0.20            // basically nothing at showdown
      // Board where big bets credibly rep the nuts: a flush is possible (3+ of a
      // suit) OR a real straight texture (3+ board cards inside a 5-rank window).
      const suitCount: Record<string, number> = {}; board.forEach(c => (suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1))
      const flushPossible = Math.max(0, ...Object.values(suitCount)) >= 3
      const bvals = [...new Set(board.map(c => RV[c.rank]))]
      let straighty = false
      for (let lo = 2; lo <= 10 && !straighty; lo++) { if (bvals.filter(v => v >= lo && v < lo + 5).length >= 3) straighty = true }
      const repValue = flushPossible || straighty
      if (lateStreet && noSDV && villainGaveUp && repValue && inPosition) {
        action = 'BET'
        jam = spr <= 1.2; betFrac = 0.9
        sizingText = jam ? tt('cadv.szBluffAllin') : tt('cadv.szBluffPolarized', { amt: round(pot * 0.9) })
        reasons.push(tt('cadv.bluffNoSdv', { eq: pct(eq) }))
        reasons.push(tt('cadv.bluffRepNuts', { tex: wet >= 0.5 ? tt('cadv.texCompleted') : tt('cadv.texConnected') }))
        confidence = 'moyenne'
      } else {
        action = 'CHECK'; sizingText = tt('cadv.szCheck')
        reasons.push(noSDV ? tt('cadv.checkSpeculative') : tt('cadv.checkWeak'))
        confidence = 'moyenne'
      }
    }
  }

  // Plan ahead: if we check, what to do when an opponent bets behind us, for
  // each common sizing. Pot odds drive the call/fold; a strong hand check-raises.
  // Anticipation plan: if the opponent bets / raises behind us, what's the move
  // for each sizing? We expose the actual MATH (required equity = B/(pot+2B)) and
  // the full move set incl. RE-RAISE / 4-BET, not just call/fold. Shown whenever
  // we'd CHECK, BET or CALL (i.e. the action isn't already a fold/raise).
  let facePlan: FacePlanRow[] | undefined
  // A CHECK only faces a bet "behind" when we're OUT of position (someone acts after us).
  // IN position a check CLOSES the street — there's nothing to call here, so the "vs a
  // bet behind" plan must NOT be built (it read as a nonsensical check-call).
  if ((action === 'CHECK' && !inPosition) || action === 'BET' || action === 'CALL') {
    const potW = tt('cadv.potWord')
    const sizes: { label: string; fracTxt: string; reqTxt: string; frac?: number; allin?: boolean; pen: number }[] = [
      { label: `⅓ ${potW}`, fracTxt: `⅓·${potW}`, reqTxt: '1/5', frac: 1 / 3, pen: 0.00 },
      { label: `½ ${potW}`, fracTxt: `½·${potW}`, reqTxt: '1/4', frac: 1 / 2, pen: 0.02 },
      { label: `⅔ ${potW}`, fracTxt: `⅔·${potW}`, reqTxt: '2/7', frac: 2 / 3, pen: 0.03 },
      { label: potW, fracTxt: potW, reqTxt: '1/3', frac: 1, pen: 0.06 },
      { label: tt('cadv.allinWord'), fracTxt: tt('cadv.tapisWord'), reqTxt: '', allin: true, pen: 0.10 },
    ]
    facePlan = sizes.map(s => {
      const B = s.allin ? Math.max(effStack, pot) : pot * (s.frac as number)
      const reqEq = B / (pot + 2 * B)
      const effEq = Math.max(0, eq - s.pen)
      const small = !s.allin && (s.frac as number) <= 0.5
      const equation = s.allin
        ? `B = ${s.fracTxt} ($${round(B)}) ; req = B/(pot+2B) = ${round(B)}/(${round(pot)}+2·${round(B)}) ≈ ${pct(reqEq)}`
        : `B = ${s.fracTxt} ($${round(B)}) ; req = B/(pot+2B) = ${s.reqTxt} ≈ ${pct(reqEq)}`
      let act: string, why: string, kind: FacePlanRow['kind']
      if (isStrongValue) {
        if (s.allin || spr <= 1.5) { act = tt('cadv.fpCallAllinValue'); why = tt('cadv.fpWhyStrong', { eq: pct(eq) }); kind = 'call' }
        else { act = tt('cadv.fpReraiseValue'); why = tt('cadv.fpWhyDominate', { small: small ? tt('cadv.fpSmallReraise') : '' }); kind = 'reraise' }
      } else if (strongDraw && small) {
        act = tt('cadv.fpReraiseSemi'); why = tt('cadv.fpWhySemi'); kind = 'reraise'
      } else if (effEq >= reqEq) {
        act = isOnePair ? tt('cadv.fpCallBluffcatch') : tt('cadv.fpCall')
        why = tt('cadv.fpWhyCall', { eq: pct(eq), req: pct(reqEq) }); kind = 'call'
      } else if (strongDraw && effEq >= reqEq - impliedBuf) {
        act = tt('cadv.fpCallDraw'); why = tt('cadv.fpWhyDraw', { eq: pct(eq), req: pct(reqEq) }); kind = 'call'
      } else {
        act = tt('cadv.fpFold'); why = tt('cadv.fpWhyFold', { eq: pct(eq), req: pct(reqEq), big: s.allin || (s.frac as number) >= 1 ? tt('cadv.fpBigBet') : '' }); kind = 'fold'
      }
      return { label: s.label, reqEq, equation, action: act, why, kind }
    })
  }

  // EXPLOIT note vs a loose / calling-station opponent: value bigger, don't bother bluffing.
  if (input.villainLoose && (action === 'BET' || action === 'RAISE') && (isStrongValue || (isOnePair && eq >= 0.6))) reasons.push(tt('cadv.exploitStation'))

  // ── PRO PLAN: synthesise the announced "line" from facePlan + the made-hand read ──
  const proPlan = buildProPlan(action, facePlan, betFrac, jam, { isStrongValue, isOnePair, strongDraw, eq, inPosition })

  // Honest hand label: a "pair" that is ONLY the board's pair (your hole cards add
  // nothing) is really just your high card + the shared board pair — never call it
  // "Paire" as if it were yours. A two-pair leaning on a board pair is shown as top pair.
  const heroHi = rankLabel(Math.max(RV[hole[0].rank], RV[hole[1].rank]))
  const madeHand = boardOnlyPair ? tt('hand.madeBoardOnly', { hi: heroHi })
    : boardLeanTwoPair ? tt('hand.madeBoardLean', { pair: pairLabel(effPair) })
    : name
  // ── "In a pro's head" — weave the same facts into a flowing first-person monologue ──
  const story = buildPostflopStory({
    action, sizingText, eq, potOdds, toCall, madeHand, draws, strongDraw,
    isStrongValue, isOnePair, outsN,
    inPosition, opponents: Math.max(1, opponents), spr, aggression, capped: cappedActive, donkLead: !!input.donkLead, proPlan,
    villainLoose: !!input.villainLoose,
  })
  return { action, sizingText, equity: eq, potOdds, madeHand, madeCat: cat, draws, strongDraw, reasons, confidence, facePlan, proPlan, story, outs: outsList, betFrac, jam }
}

// PREFLOP "in a pro's head" — same idea, told from the preflop facts (position, what
// happened, the hand, the range decision, the anticipation). Built in RangeAssistant's
// preflop path and shown in the same narrative tab.
export function buildPreflopStory(f: {
  position: string; scenario: string; heroKey: string; chart: string
  eq: number; raiseToBB: number; vsJam: boolean; effBB: number; inPosition: boolean; reshove: boolean
  heroRaised?: boolean   // did the hero already open/raise this pre-flop? (else vs-3bet/4bet is a COLD spot)
}): string[] {
  const pos = f.position, key = f.heroKey
  const short = f.effBB <= 15
  const beats: string[] = []
  beats.push(
    f.vsJam ? tt('pstory.setJam', { pos, bb: Math.round(f.effBB) })
      : f.scenario === 'rfi' ? tt('pstory.setRfi', { pos })
      : f.scenario === 'iso' ? tt('pstory.setIso', { pos })
      : f.scenario === 'vsopen' ? tt('pstory.setVsopen', { pos, size: f.raiseToBB ? f.raiseToBB.toFixed(1) : '?' })
      : f.scenario === 'squeeze' ? tt('pstory.setSqueeze', { pos })
      : f.scenario === 'vs3bet' ? tt(f.heroRaised ? 'pstory.setVs3bet' : 'pstory.setVs3betCold', { pos })
      : tt(f.heroRaised ? 'pstory.setVs4bet' : 'pstory.setVs4betCold', { pos }),
  )
  beats.push(tt('pstory.hand', { key }))
  const aggr = f.chart === 'raise' || f.chart === '3bet' || f.chart === '4bet'
  let dec: string, goal: string, action: string
  if (f.vsJam && f.chart === 'call') { dec = tt('pstory.decCallJam', { key, eq: Math.round(f.eq * 100) }); goal = tt('pstory.goalCallJam'); action = tt('crit.recCallJam') }
  else if (f.reshove || (short && aggr && f.scenario !== 'rfi' && f.scenario !== 'iso')) { dec = tt('pstory.decJam', { key }); goal = tt('pstory.goalJam'); action = tt('crit.recReshove') }
  else if (f.chart === '4bet') { dec = tt('pstory.dec4bet', { key }); goal = tt('pstory.goal3bet'); action = '4-BET' }
  else if (f.chart === '3bet') { dec = f.eq < 0.5 ? tt('pstory.dec3betBluff', { key }) : tt('pstory.dec3betValue', { key }); goal = tt('pstory.goal3bet'); action = '3-BET' }
  else if (f.chart === 'raise') { dec = f.scenario === 'iso' ? tt('pstory.decIso', { key }) : tt('pstory.decOpen', { key }); goal = tt('pstory.goalOpen'); action = tt('crit.recOpen') }
  else if (f.chart === 'call') { dec = tt('pstory.decCall', { key, ip: f.inPosition ? tt('pstory.ipNote') : '' }); goal = tt('pstory.goalCall'); action = tt('crit.recCall') }
  else { dec = tt('pstory.decFold', { key }); goal = tt('pstory.goalFold'); action = tt('crit.foldWord') }
  beats.push(dec)
  if (f.chart === '3bet' && !short) beats.push(tt('pstory.antiVs4bet', { cont: f.eq >= 0.6 ? tt('pstory.contJam') : tt('pstory.contFold') }))
  beats.push(tt('pstory.concl', { action, key, goal }))
  return beats
}

// ── Coach STORY — the same data, told as a pro reasoning out loud (for the "Dans la
//    tête d'un pro" tab). Each beat is one sentence; the UI renders them as a flowing,
//    self-developing monologue that lands on the conclusion. Deterministic, offline. ──
function buildPostflopStory(f: {
  action: AdviceAction; sizingText: string; eq: number; potOdds: number; toCall: number
  madeHand: string; draws: string[]; strongDraw: boolean; isStrongValue: boolean; isOnePair: boolean
  outsN: number; inPosition: boolean; opponents: number; spr: number; aggression: number
  capped: boolean; donkLead: boolean; proPlan?: ProPlan; villainLoose?: boolean
}): string[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const beats: string[] = []
  const pos = f.inPosition ? tt('story.ip') : tt('story.oop')
  const read = f.capped ? tt('story.readCapped')
    : f.toCall <= 0 && f.aggression <= 0 ? tt('story.readChecked')
    : f.donkLead ? tt('story.readDonk')
    : f.aggression >= 0.55 ? tt('story.readStrong')
    : f.toCall > 0 ? tt('story.readBet') : tt('story.readQuiet')
  beats.push(tt('story.pSetup', { n: f.opponents + 1, pos, read }))
  const drawTxt = f.draws.length ? ' + ' + f.draws.join(' + ') : ''
  const outsTxt = f.strongDraw && f.outsN > 0 ? tt('story.outs', { n: f.outsN }) : ''  // outs matter for draws, not made hands
  const oddsTxt = f.toCall > 0 ? tt('story.vsOdds', { odds: pct(f.potOdds) }) : ''
  beats.push(tt('story.pHand', { hand: f.madeHand, draws: drawTxt, eq: Math.round(f.eq * 100), outs: outsTxt, odds: oddsTxt }))
  const semiBluff = f.action === 'BET' && f.strongDraw && f.eq < 0.55
  beats.push(
    semiBluff ? tt('story.lSemiBluff')
      : (f.action === 'BET' || f.action === 'RAISE') && f.isStrongValue ? tt('story.lValue')
      : f.action === 'CALL' && f.isOnePair ? tt('story.lBluffCatch', { eq: Math.round(f.eq * 100), odds: pct(f.potOdds) })
      : f.action === 'CALL' ? tt('story.lCall', { eq: Math.round(f.eq * 100), odds: pct(f.potOdds) })
      : f.action === 'CHECK' ? tt('story.lCheck')
      : f.action === 'FOLD' ? tt(f.eq >= f.potOdds ? 'story.lFoldRealize' : 'story.lFold', { eq: Math.round(f.eq * 100), odds: pct(f.potOdds) })
      : tt('story.lBetThin'),
  )
  if (f.villainLoose && f.isStrongValue && (f.action === 'BET' || f.action === 'RAISE')) beats.push(tt('story.exploitStation'))
  if (f.spr < 3.5 && (f.action === 'BET' || f.action === 'RAISE' || f.action === 'CALL')) beats.push(tt('story.pSpr', { spr: f.spr.toFixed(1) }))
  beats.push(tt('story.pDecision', { action: f.action, sizing: f.sizingText }))
  if (f.proPlan && (f.proPlan.branches.length || f.proPlan.turn)) {
    const br = f.proPlan.branches[0]
    beats.push(tt('story.pPlan', { cond: br ? `${br.cond} → ${br.act}` : f.proPlan.line, turn: f.proPlan.turn }))
  }
  const goal = f.action === 'FOLD' ? tt('story.goalFold')
    : f.action === 'CHECK' ? tt('story.goalCheck')
    : f.action === 'CALL' ? tt('story.goalCall')
    : semiBluff ? tt('story.goalSemiBluff')
    : tt('story.goalValue')
  beats.push(tt('story.pConclusion', { action: f.action, goal }))
  return beats
}

// Turn the per-size facePlan into a single announced LINE (check-call ⅓ · fold +,
// bet-fold, check-raise…) plus a next-street intent. Pure summarisation of data the
// coach already produced → the line never contradicts the node-by-node advice.
function buildProPlan(
  action: AdviceAction,
  facePlan: FacePlanRow[] | undefined,
  betFrac: number,
  jam: boolean,
  ctx: { isStrongValue: boolean; isOnePair: boolean; strongDraw: boolean; eq: number; inPosition: boolean },
): ProPlan | undefined {
  const { isStrongValue, isOnePair, strongDraw, eq, inPosition } = ctx
  // IN POSITION, a CHECK closes the street (you're last to act) → you take a free card
  // and see the turn. There is no bet to face here, so show a "check back" plan keyed on
  // the NEXT street, not a phantom check-call.
  if (action === 'CHECK' && inPosition) {
    const turn = isStrongValue ? tt('plan.turnTrapBet')
      : (isOnePair || eq >= 0.5) ? tt('plan.turnPotControl')
      : strongDraw ? tt('plan.turnFreeCardDraw')
      : tt('plan.turnGiveUp')
    return { line: tt('plan.checkBack'), branches: [], turn, term: 'check-back' }
  }
  if (!facePlan || facePlan.length === 0) return undefined
  if (action !== 'CHECK' && action !== 'BET' && action !== 'CALL' && action !== 'RAISE') return undefined
  // Compact recommended-size token for the headline (the full sizingText is a sentence).
  const sizingText = jam ? tt('cadv.tapisWord')
    : betFrac >= 0.95 ? tt('cadv.potWord')
    : betFrac >= 0.58 ? `⅔ ${tt('cadv.potWord')}`
    : betFrac >= 0.42 ? `½ ${tt('cadv.potWord')}`
    : `⅓ ${tt('cadv.potWord')}`
  const callable = facePlan.filter(r => r.kind === 'call' || r.kind === 'reraise')
  const reraises = facePlan.filter(r => r.kind === 'reraise')
  const lastCallable = callable.length ? callable[callable.length - 1] : null
  const allCall = callable.length === facePlan.length
  const noneCall = callable.length === 0
  const aFold = tt('plan.aFold'), aCall = tt('plan.aCall')
  let line = '', turn = '', term = ''
  const branches: ProPlan['branches'] = []

  if (action === 'CHECK') {
    if (reraises.length && (isStrongValue || strongDraw)) {
      const semi = strongDraw && !isStrongValue
      line = semi ? tt('plan.checkRaiseSemi') : tt('plan.checkRaiseValue'); term = 'check-raise'
      branches.push({ cond: tt('plan.ifBets'), act: tt('plan.aCheckRaise'), kind: 'reraise' })
      turn = semi ? tt('plan.turnSemibluff') : tt('plan.turnValueBarrel')
    } else if (noneCall) {
      line = tt('plan.checkFold'); term = 'check-fold'
      branches.push({ cond: tt('plan.anyBet'), act: aFold, kind: 'fold' })
      turn = tt('plan.turnGiveUp')
    } else if (allCall) {
      line = tt('plan.checkCallDown'); term = 'check-call'
      branches.push({ cond: tt('plan.anyBet'), act: aCall, kind: 'call' })
      turn = isOnePair ? tt('plan.turnBluffcatch') : tt('plan.turnValueBarrel')
    } else {
      line = tt('plan.checkCallUpTo', { size: lastCallable!.label }); term = 'check-call'
      branches.push({ cond: tt('plan.upTo', { size: lastCallable!.label }), act: aCall, kind: 'call' })
      branches.push({ cond: tt('plan.over', { size: lastCallable!.label }), act: aFold, kind: 'fold' })
      turn = tt('plan.turnReeval')
    }
  } else if (action === 'BET') {
    if (reraises.length) { line = tt('plan.betReraise', { size: sizingText }); term = 'bet-3bet'
      branches.push({ cond: tt('plan.ifRaised'), act: tt('plan.a3bet'), kind: 'reraise' }); turn = tt('plan.turnValueBarrel') }
    else if (callable.length) { line = tt('plan.betCall', { size: sizingText }); term = 'bet-call'
      branches.push({ cond: tt('plan.ifRaised'), act: aCall, kind: 'call' }); turn = isStrongValue ? tt('plan.turnValueBarrel') : tt('plan.turnThinValue') }
    else { line = tt('plan.betFold', { size: sizingText }); term = 'bet-fold'
      branches.push({ cond: tt('plan.ifRaised'), act: aFold, kind: 'fold' })
      turn = isStrongValue || eq >= 0.6 ? tt('plan.turnValueBarrel') : strongDraw ? tt('plan.turnSemibluff') : tt('plan.turnThinValue') }
  } else if (action === 'CALL') {
    line = tt('plan.call'); term = isOnePair ? 'bluff-catch' : 'call'
    turn = isOnePair ? tt('plan.turnBluffcatch') : isStrongValue ? tt('plan.turnRaiseTurn') : tt('plan.turnReeval')
  } else { // RAISE
    line = isStrongValue ? tt('plan.raiseCall') : tt('plan.raiseSemi'); term = 'raise'
    turn = isStrongValue ? tt('plan.turnValueBarrel') : tt('plan.turnSemibluff')
  }
  return { line, branches, turn, term }
}

// ── "How a pro thinks about it" — the equity-vs-pot-odds monologue ─────────────
// A structured breakdown of the price decision, shown BEFORE the explanations:
//   pot → amount to call → pot odds (required equity) → the exact outs (as cards)
//   → the rule-of-2/4 quick estimate → real equity → verdict (I have the price or
//   I don't). Pure data; a shared component renders the cards + sentences.
export type ReasoningVerdict = 'call' | 'fold' | 'implied' | 'raise-value' | 'raise-bluff'
export interface EquityReasoning {
  pot: number          // current pot (includes the bet faced)
  toCall: number       // amount to put in to continue
  potOdds: number      // required equity to call (0..1)
  equity: number       // hero's real equity (0..1)
  cardsToCome: number  // 2 on the flop, 1 on the turn, 0 on the river / preflop
  outs: OutCard[]      // exact cards that improve the hero (empty river/preflop)
  outsApprox: number   // rule of ×4 (flop) / ×2 (turn) quick estimate (0..1)
  hasOdds: boolean     // equity ≥ potOdds (the raw price test)
  verdict: ReasoningVerdict
  preflop: boolean
}
export function buildEquityReasoning(p: {
  hole: Card[]; board: Card[]; pot: number; toCall: number; equity: number
  decision: 'call' | 'fold' | 'aggro'
}): EquityReasoning | null {
  if (p.toCall <= 0 || !p.hole[0] || !p.hole[1]) return null
  const potOdds = p.toCall / (p.pot + p.toCall)
  const cardsToCome = p.board.length === 3 ? 2 : p.board.length === 4 ? 1 : 0
  const outs = cardsToCome > 0 ? computeOuts(p.hole, p.board) : []
  // Dominated (weak) outs count half in the quick estimate — they can complete and
  // still lose. Rule of ×4 on the flop (two cards to come), ×2 on the turn. The ×4
  // rule overstates beyond ~8 outs (you can't catch on both streets), so we taper
  // the surplus to stay close to reality — exactly the correction a pro applies.
  const weighted = outs.reduce((n, o) => n + (o.weak ? 0.5 : 1), 0)
  const outsApprox = cardsToCome === 2
    ? Math.min(0.9, (weighted <= 8 ? weighted * 0.04 : 0.32 + (weighted - 8) * 0.025))
    : Math.min(0.9, weighted * 0.02)
  const hasOdds = p.equity >= potOdds
  const verdict: ReasoningVerdict =
    p.decision === 'fold' ? 'fold'
    : p.decision === 'aggro' ? (hasOdds ? 'raise-value' : 'raise-bluff')
    : hasOdds ? 'call' : 'implied'
  return { pot: p.pot, toCall: p.toCall, potOdds, equity: p.equity, cardsToCome, outs, outsApprox, hasOdds, verdict, preflop: p.board.length < 3 }
}

// ── Hand bucket on the current board — the "which of the 4 boxes am I in?" call ─
// VALUE (beat the calling range) · BLUFFCATCH (beat bluffs, lose to value, no
// improve) · DRAW (behind now, can improve) · AIR (no showdown value, no draw).
// Same made-hand / demotion logic as getPostflopAdvice so the trainer's "correct
// answer" always matches what the live coach would conclude.
export type HandBucket = 'value' | 'bluffcatch' | 'draw' | 'air'
export interface SpotDiagnosis {
  bucket: HandBucket
  madeName: string
  draws: string[]
  wetness: number    // 0..1 board wetness
  paired: boolean    // board has a pair
  effCat: number     // demoted made-hand category (0 high card … 8)
  effPair: PairKind  // demoted pair class
  strongDraw: boolean
}
export function diagnoseSpot(hole: Card[], board: Card[]): SpotDiagnosis {
  const { cat, pair, name } = analyseMade(hole, board)
  const drawCodes = detectDraws(hole, board)
  const draws = drawDisplay(drawCodes)
  const strongDraw = isStrongDraw(drawCodes)
  const wetness = boardWetness(board)
  const paired = (() => { const r: Record<number, number> = {}; board.forEach(c => (r[RV[c.rank]] = (r[RV[c.rank]] ?? 0) + 1)); return Object.values(r).some(n => n >= 2) })()
  const playsBoard = board.length === 5 && best7([...hole, ...board]) <= best7(board)
  // Same demotions as getPostflopAdvice: a board-only pair is air, a board-leaning
  // two pair is really one pair, with the effective pair class recomputed.
  const heroHasRealPair = hole[0].rank === hole[1].rank || hole.some(h => board.some(b => b.rank === h.rank))
  const boardOnlyPair = cat === 1 && !heroHasRealPair
  const holePairRanks = new Set<number>()
  if (hole[0].rank === hole[1].rank) holePairRanks.add(RV[hole[0].rank])
  hole.forEach(h => { if (board.some(b => b.rank === h.rank)) holePairRanks.add(RV[h.rank]) })
  const boardLeanTwoPair = cat === 2 && holePairRanks.size <= 1
  const boardOnlyMade = (cat === 3 || cat === 6 || cat === 7) && !heroHasRealPair  // trips/full/quads entirely on the board
  const effCat = boardOnlyPair || boardOnlyMade ? 0 : boardLeanTwoPair ? 1 : cat
  let effPair: PairKind = pair
  if (boardLeanTwoPair) {
    const pr = [...holePairRanks][0] ?? 0
    const bSorted = board.map(c => RV[c.rank]).sort((a, b) => b - a)
    const pocket = hole[0].rank === hole[1].rank
    effPair = (pocket && pr > bSorted[0]) ? 'overpair' : pr >= bSorted[0] ? 'top' : pr >= (bSorted[1] ?? 0) ? 'second' : 'weak'
  }
  let bucket: HandBucket
  if (playsBoard) bucket = strongDraw ? 'draw' : 'air'
  else if (effCat >= 2 || effPair === 'overpair' || (effCat === 1 && effPair === 'top')) bucket = 'value'
  else if (effCat === 1) bucket = 'bluffcatch'                 // 2nd / weak / under pair
  else if (strongDraw) bucket = 'draw'
  else bucket = 'air'
  return { bucket, madeName: name, draws, wetness, paired, effCat, effPair, strongDraw }
}
