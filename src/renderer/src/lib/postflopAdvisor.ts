// ─────────────────────────────────────────────────────────────────────────────
// Postflop coaching engine (offline) — "boosted".
//   • RANGE-AWARE equity: opponents aren't random, their range is weighted by how
//     aggressively they've played (barrels → stronger, more polarized range).
//   • Hand-class logic: value-raise only strong made hands; one pair = bluffcatch
//     (call/fold, never raise into aggression); draws = call / semi-bluff.
//   • SPR / effective-stack aware (commit decisions), board-texture aware sizing.
// Heuristic, not a solver — but a much sharper "expert beside you".
// ─────────────────────────────────────────────────────────────────────────────

export interface Card { rank: string; suit: string }
export type AdviceAction = 'BET' | 'CHECK' | 'CALL' | 'RAISE' | 'FOLD'

export interface FacePlanRow {
  label: string      // "⅓ pot", "pot", "all-in"…
  reqEq: number      // equity needed to call that bet/raise
  equation: string   // the math: "B = ⅔·pot ($X) ; req = B/(pot+2B) = 2/7 ≈ 29%"
  action: string     // "CALL", "FOLD", "RE-RAISE / 4-BET (valeur)"…
  why: string        // short math rationale
}
export interface OutCard { card: Card; cat: number; label: string }
export interface Advice {
  action: AdviceAction
  sizingText: string
  equity: number
  potOdds: number
  madeHand: string
  draws: string[]
  reasons: string[]
  confidence: 'haute' | 'moyenne' | 'basse'
  facePlan?: FacePlanRow[] // plan vs a bet/raise behind — when CHECK / BET / CALL
  outs: OutCard[]          // specific cards (flop/turn) that improve the hero's hand
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const SUITS = ['♠', '♥', '♦', '♣']
const HAND_NAMES = ['Carte haute', 'Paire', 'Double paire', 'Brelan', 'Suite', 'Couleur', 'Full', 'Carré', 'Quinte flush']

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
export function handCategory(cards: Card[]): string { return HAND_NAMES[categoryOf(best7(cards))] ?? 'Carte haute' }

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
    res.push({ card: c, cat: heroCat, label: HAND_NAMES[heroCat] ?? 'Carte haute' })
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
  if (Object.values(bySuit).some(n => n === 4)) return true
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
function betFrequency(oppHole: Card[], board: Card[], a: number): number {
  const cat = categoryOf(best7([...oppHole, ...board]))
  if (cat >= 3) return 0.95                              // set / straight / flush+ → almost always bets
  if (cat === 2) return 0.90                             // two pair
  if (cat === 1) {                                       // one pair — bet frequency scales with the PAIR's strength
    const bRanks = board.map(c => RV[c.rank]).sort((x, y) => y - x)
    const hRanks = oppHole.map(c => RV[c.rank])
    const pocket = oppHole[0].rank === oppHole[1].rank
    // Rank of the pair held: the pocket value, or the highest board card it pairs.
    let pairRank = 0
    if (pocket) pairRank = hRanks[0]
    else for (const b of bRanks) if (hRanks.includes(b)) { pairRank = b; break }
    const above = bRanks.filter(r => r > pairRank).length // board cards out-ranking the pair
    if (pocket && pairRank > bRanks[0]) return 0.80        // overpair → value bets a lot
    if (above === 0) return 0.78                           // top pair
    if (above === 1) return Math.max(0.30, 0.55 * (1 - a * 0.2))  // 2nd pair / strong middle pair → real value
    return Math.max(0.12, 0.40 * (1 - a * 0.45))          // weak / bottom pair barrels rarely
  }
  if (hasStrongDraw(oppHole, board)) return 0.58         // semi-bluff
  return Math.max(0.05, 0.18 * (1 - a * 0.6))            // air bluff — shrinks as barrels pile up
}

// Equity where each opponent hand is importance-weighted by how likely a player
// would actually be betting/continuing it (see betFrequency), scaled by `aggression`
// (0 = random range … ~0.85 = multi-barreled, very polarized to value).
export function rangeEquity(hole: Card[], board: Card[], opponents: number, aggression: number, iters = 1800): number {
  if (opponents < 1) return 1
  const known = new Set([...hole, ...board].map(c => c.rank + c.suit))
  const deck = fullDeck().filter(c => !known.has(c.rank + c.suit))
  const needBoard = 5 - board.length
  const a = Math.max(0, Math.min(0.9, aggression))

  const keepProb = (oppHole: Card[]): number => {
    if (a <= 0 || board.length < 3) return 1
    // Blend a uniform range with the bet-frequency-shaped (polarized-to-value) range.
    // The blend ramps to 100% by the time we've seen ~2 barrels, so a barreled range
    // is fully shaped (weak hands carry little weight) rather than half-uniform air.
    const blend = Math.min(1, a / 0.45)
    return (1 - blend) * 1 + blend * betFrequency(oppHole, board, a)
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
      w *= keepProb(oh)
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
  return { cat, pair, name: HAND_NAMES[cat] ?? 'Carte haute' }
}

// ── Draw detection ───────────────────────────────────────────────────────────
function detectDraws(hole: Card[], board: Card[]): string[] {
  const draws: string[] = []
  if (board.length >= 5) return draws
  const all = [...hole, ...board]
  const bySuit: Record<string, number> = {}
  all.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  if (Object.values(bySuit).some(n => n === 4)) draws.push('Tirage couleur')
  const vals = new Set(all.map(c => RV[c.rank]))
  if (vals.has(14)) vals.add(1)
  let oesd = false, gut = false
  for (let lo = 1; lo <= 10; lo++) {
    let count = 0
    for (let k = lo; k < lo + 5; k++) if (vals.has(k)) count++
    if (count === 4) { if (!vals.has(lo + 4) || !vals.has(lo)) oesd = true; else gut = true }
  }
  if (oesd) draws.push('Tirage quinte (ouvert)')
  else if (gut) draws.push('Tirage quinte (ventral)')
  return draws
}

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

// ── Main advice ──────────────────────────────────────────────────────────────
export function getPostflopAdvice(input: {
  hole: Card[]; board: Card[]; pot: number; toCall: number
  heroStack: number; effStack?: number; opponents: number; inPosition: boolean
  aggression?: number; barrels?: number; bb?: number
}): Advice {
  const { hole, board, pot, toCall, opponents, inPosition } = input
  const aggression = Math.max(0, Math.min(0.9, input.aggression ?? 0))
  const effStack = input.effStack ?? input.heroStack
  const barrels = input.barrels ?? 0

  const eq = rangeEquity(hole, board, Math.max(1, opponents), aggression)
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  const { cat, pair, name } = analyseMade(hole, board)
  const draws = detectDraws(hole, board)
  const strongDraw = draws.some(d => d.includes('couleur') || d.includes('ouvert'))
  const wet = boardWetness(board)
  const spr = pot > 0 ? effStack / pot : 99
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const round = (v: number) => Math.max(1, Math.round(v))

  // Villain bet earlier streets but now it's checked to us → their range is CAPPED
  // (strong hands would usually keep betting). Key signal for turning air into a bluff.
  const villainGaveUp = toCall <= 0 && aggression > 0
  const reasons: string[] = []
  reasons.push(`Ton équité réelle ≈ ${pct(eq)}${villainGaveUp ? ' — l’adversaire a misé puis checké : son range est plafonné/faible' : aggression > 0 ? ` face à une range ${barrels >= 2 ? 'forte (plusieurs mises)' : 'resserrée'}` : ` face à ${opponents} adversaire${opponents > 1 ? 's' : ''}`}.`)
  if (toCall > 0) reasons.push(`Cote du pot : il te faut ${pct(potOdds)} d'équité pour payer ${toCall}.`)
  // "Playing the board" is strictly a RIVER concept (5 community cards) where your
  // hole cards add nothing. Pre-river you always hold at least high-card / a draw,
  // so we never mislabel it (and we avoid padding the board with fake cards).
  const playsBoard = board.length === 5 && best7([...hole, ...board]) <= best7(board)
  // A "pair" that comes only from the BOARD (hero's hole cards don't pair anything)
  // is NOT a real made hand — treat it as air + draw, not a bluffcatcher.
  const heroHasRealPair = hole[0].rank === hole[1].rank || hole.some(h => board.some(b => b.rank === h.rank))
  const boardOnlyPair = cat === 1 && !heroHasRealPair
  const effCat = boardOnlyPair ? 0 : cat
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
  const dominatedPair = effCat === 1 && (pair === 'second' || pair === 'weak' || (pair === 'top' && wet > 0.4))
  const onePairMargin = dominatedPair
    ? 0.03 + (Math.max(1, opponents) >= 2 ? 0.03 : 0) + (aggression >= 0.4 ? 0.02 : 0)
    : 0.01
  const callMargin = drawIsOnlyEquity
    ? (vulnerableDraw ? (aggression >= 0.5 ? 0.05 : 0.03) : (board.length <= 3 ? -0.05 : -0.01))
    : onePairMargin
  // Implied-odds buffer below direct pot odds: generous on the flop (two cards to
  // come), almost none on the turn (one card, little room to get paid).
  const impliedBuf = board.length <= 3 ? 0.05 : 0.01

  reasons.push((playsBoard || boardOnlyPair)
    ? `Ta main : ${boardOnlyPair ? 'tu joues la paire du board' : `tu joues le board (${name})`} — pas de main à toi${draws.length ? ', seulement ' + draws.join(' + ') : ''}.`
    : `Ta main : ${name}${pair !== 'none' ? ` (${pair === 'overpair' ? 'overpaire' : pair === 'top' ? 'top paire' : pair === 'second' ? '2e paire' : 'paire faible'})` : ''}${draws.length ? ' + ' + draws.join(' + ') : ''}.`)
  reasons.push(inPosition ? 'Tu es en position (tu parles après).' : 'Tu es hors de position : sois plus prudent.')
  if (effCat === 0 && !playsBoard && !drawIsOnlyEquity && toCall > 0) reasons.push('Ta « carte haute » n’est pas rien : ton équité vient de tes surcartes (tu peux toucher la paire), de tirages de secours, et tu bats ses mains ratées/bluffs au showdown.')
  if (pot > 0 && spr < 4) reasons.push(`SPR ≈ ${spr.toFixed(1)} (tapis/pot) : ${spr <= 1.5 ? 'engagé — avec une main forte, joue all-in.' : 'assez bas, prêt à investir gros avec une main forte.'}`)

  const isStrongValue = !playsBoard && (effCat >= 2 || pair === 'overpair') // two pair+, sets, overpair
  const isOnePair = !playsBoard && effCat === 1
  const valueRaiseSize = wet > 0.4 ? round(pot * 0.85) : round(pot * 0.66)
  const valueBetSize = wet > 0.4 ? round(pot * 0.75) : round(pot * 0.6)

  let action: AdviceAction
  let sizingText = ''
  let confidence: Advice['confidence'] = 'moyenne'

  if (toCall > 0) {
    // ── Facing a bet/raise. Golden rule: NEVER fold when equity beats the pot
    // odds — only raise (strong value) or call/fold around the price. ──
    if (isStrongValue && eq >= 0.55) {
      // Strong made hand with the edge → value raise.
      if (spr <= 1.5) { action = 'RAISE'; sizingText = `relance ALL-IN (SPR bas)` }
      else { action = 'RAISE'; sizingText = `relance pour la valeur (~${wet > 0.4 ? '¾' : '⅔'} pot, +$${valueRaiseSize})` }
      reasons.push('Main forte : tu domines une bonne partie de sa range → relance pour la valeur.')
      confidence = eq >= 0.7 ? 'haute' : 'moyenne'
    } else if (eq >= potOdds + callMargin) {
      // Profitable continue, given the required margin (implied odds lower it for clean
      // draws, reverse implied odds raise it for vulnerable ones). Frame by hand type.
      action = 'CALL'
      if (isStrongValue) { sizingText = `paie $${toCall}`; reasons.push('Main de valeur, mais relancer te ferait payer surtout par mieux : call.'); confidence = 'moyenne' }
      else if (drawIsOnlyEquity) {
        sizingText = `paie $${toCall} (tirage)`
        reasons.push(callMargin < 0
          ? `Tirage : ${pct(eq)} d'équité + gains implicites (tu gagnes plus en touchant) → call rentable.`
          : `Tirage : ${pct(eq)} ≥ ${pct(potOdds + callMargin)} requis → call, mais serré.`)
        if (vulnerableDraw) reasons.push('⚠️ Tirage vulnérable (couleur basse ou board pairé) : reverse implied odds — tu peux toucher et perdre quand même, joue prudemment.')
        confidence = 'basse'
      }
      else if (isOnePair) { sizingText = `paie $${toCall} (bluffcatch)`; reasons.push(`Bluffcatcher : ton équité (${pct(eq)}) dépasse la cote (${pct(potOdds)}) → tu paies pour battre ses bluffs, mais ne relance pas.`); confidence = eq >= potOdds + 0.12 ? 'moyenne' : 'basse' }
      else { sizingText = `paie $${toCall}`; reasons.push(`Ton équité (${pct(eq)}) dépasse la cote du pot (${pct(potOdds)}) → call rentable, même sans grosse main.`); confidence = eq >= potOdds + 0.15 ? 'moyenne' : 'basse' }
    } else {
      action = 'FOLD'; sizingText = 'couche-toi'
      if (vulnerableDraw) reasons.push(`Tirage vulnérable trop cher : ${pct(eq)} d'équité, mais reverse implied odds (couleur basse / board pairé, face à l'agression) → tu touches parfois pour perdre. Il te faudrait ${pct(potOdds + callMargin)}. Fold.`)
      else if (strongDraw) reasons.push(`Tirage trop cher : ${pct(eq)} d'équité contre ${pct(potOdds)} requis${board.length >= 4 ? ' — et une seule carte à venir (peu de gains implicites)' : ''}. Fold.`)
      else if (eq >= potOdds) reasons.push(`Tu as tout juste la cote brute (${pct(eq)} vs ${pct(potOdds)}), MAIS ${effCat === 1 ? 'ta paire est dominable' : 'ta main est trop marginale'}${Math.max(1, opponents) >= 2 ? ' en multiway' : ''}${aggression > 0 ? ' face à l’agression' : ''}${!inPosition ? ' et tu ne fermes pas l’action (hors de position)' : ''} : il te faut une marge de sécurité (~${pct(potOdds + callMargin)}) contre les reverse implied odds → fold marginal.`)
      else reasons.push(`Équité (${pct(eq)}) sous la cote (${pct(potOdds)}) et pas de tirage : se coucher est le plus rentable.`)
      confidence = eq < potOdds - 0.08 ? 'haute' : 'moyenne'
    }
  } else {
    // ── No bet to call (checked to you / you open the action) ──
    if (isStrongValue || (isOnePair && pair === 'top' && eq >= 0.6)) {
      action = 'BET'; sizingText = `mise pour la valeur (~${wet > 0.4 ? '¾' : '⅔'} pot, $${valueBetSize})`
      reasons.push('Main forte : mise pour la valeur et fais payer les tirages.')
      confidence = eq >= 0.72 ? 'haute' : 'moyenne'
    } else if (strongDraw) {
      action = 'BET'; sizingText = `semi-bluff (~½ pot, $${round(pot * 0.5)})`
      reasons.push('Tirage fort : un semi-bluff gagne le pot tout de suite ou en touchant.')
      confidence = 'basse'
    } else if (isOnePair) {
      action = 'CHECK'; sizingText = 'checke (contrôle du pot)'
      reasons.push('Paire moyenne : checke pour contrôler la taille du pot et bluffcatcher ensuite.')
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
        const jam = spr <= 1.2
        sizingText = jam ? 'bluff ALL-IN (SPR bas)' : `bluff polarisé (~pot, $${round(pot * 0.9)})`
        reasons.push(`Tu n’as aucune showdown value (${pct(eq)}) → checker abandonne presque toujours le pot.`)
        reasons.push(`L’adversaire a misé puis checké (range plafonné) et le board ${wet >= 0.5 ? 'à couleur/quinte complétée' : 'connecté'} favorise TON range de caller en position : tu rep le nuts → grosse fold equity. C’est un bluff, pas de la sur-agressivité.`)
        confidence = 'moyenne'
      } else {
        action = 'CHECK'; sizingText = 'checke'
        reasons.push(noSDV
          ? 'Main sans showdown value, mais ici un bluff serait spéculatif (board peu crédible, adversaire non plafonné ou hors de position) → checke.'
          : 'Main faible : checke (un bluff n’est rentable que sur les bons board et adversaires).')
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
  if (action === 'CHECK' || action === 'BET' || action === 'CALL') {
    const sizes: { label: string; fracTxt: string; reqTxt: string; frac?: number; allin?: boolean; pen: number }[] = [
      { label: '⅓ pot', fracTxt: '⅓·pot', reqTxt: '1/5', frac: 1 / 3, pen: 0.00 },
      { label: '½ pot', fracTxt: '½·pot', reqTxt: '1/4', frac: 1 / 2, pen: 0.02 },
      { label: '⅔ pot', fracTxt: '⅔·pot', reqTxt: '2/7', frac: 2 / 3, pen: 0.03 },
      { label: 'pot', fracTxt: 'pot', reqTxt: '1/3', frac: 1, pen: 0.06 },
      { label: 'all-in', fracTxt: 'tapis', reqTxt: '', allin: true, pen: 0.10 },
    ]
    facePlan = sizes.map(s => {
      const B = s.allin ? Math.max(effStack, pot) : pot * (s.frac as number)
      const reqEq = B / (pot + 2 * B)
      const effEq = Math.max(0, eq - s.pen)
      const small = !s.allin && (s.frac as number) <= 0.5
      const equation = s.allin
        ? `B = tapis ($${round(B)}) ; req = B/(pot+2B) = ${round(B)}/(${round(pot)}+2·${round(B)}) ≈ ${pct(reqEq)}`
        : `B = ${s.fracTxt} ($${round(B)}) ; req = B/(pot+2B) = ${s.reqTxt} ≈ ${pct(reqEq)}`
      let act: string, why: string
      if (isStrongValue) {
        if (s.allin || spr <= 1.5) { act = 'CALL / ALL-IN (valeur)'; why = `main forte (équité ${pct(eq)}) → tu encaisses.` }
        else { act = 'RE-RAISE / 4-BET (valeur)'; why = `tu domines sa range${small ? ' — petit sizing = re-raise pour la valeur' : ''}.` }
      } else if (strongDraw && small) {
        act = 'RE-RAISE (semi-bluff)'; why = `petit sizing + ton tirage → fold equity + outs si payé.`
      } else if (effEq >= reqEq) {
        act = isOnePair ? 'CALL (bluffcatch)' : 'CALL'
        why = `équité ${pct(eq)} ≥ ${pct(reqEq)} requis → rentable.`
      } else if (strongDraw && effEq >= reqEq - impliedBuf) {
        act = 'CALL (tirage)'; why = `${pct(eq)} ≈ ${pct(reqEq)} requis + gains implicites.`
      } else {
        act = 'FOLD'; why = `équité ${pct(eq)} < ${pct(reqEq)} requis${s.allin || (s.frac as number) >= 1 ? ' (grosse mise = range forte)' : ''}.`
      }
      return { label: s.label, reqEq, equation, action: act, why }
    })
  }

  return { action, sizingText, equity: eq, potOdds, madeHand: name, draws, reasons, confidence, facePlan, outs: computeOuts(hole, board) }
}
