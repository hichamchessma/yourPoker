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

export interface Advice {
  action: AdviceAction
  sizingText: string
  equity: number
  potOdds: number
  madeHand: string
  draws: string[]
  reasons: string[]
  confidence: 'haute' | 'moyenne' | 'basse'
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const SUITS = ['♠', '♥', '♦', '♣']
const HAND_NAMES = ['Carte haute', 'Paire', 'Double paire', 'Brelan', 'Suite', 'Couleur', 'Full', 'Carré', 'Quinte flush']

// ── Evaluation ───────────────────────────────────────────────────────────────
function eval5(c: Card[]): number {
  const rv = c.map(x => RV[x.rank]).sort((a, b) => b - a)
  const sv = c.map(x => x.suit)
  const isF = sv.every(s => s === sv[0])
  const u = [...new Set(rv)].sort((a, b) => b - a)
  const isS = (u.length === 5 && u[0] - u[4] === 4) || (u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2)
  const cnt: Record<number, number> = {}; rv.forEach(r => (cnt[r] = (cnt[r] ?? 0) + 1))
  const cv = Object.values(cnt).sort((a, b) => b - a)
  let rank = 0
  if (isF && isS) rank = 8; else if (cv[0] === 4) rank = 7; else if (cv[0] === 3 && cv[1] === 2) rank = 6
  else if (isF) rank = 5; else if (isS) rank = 4; else if (cv[0] === 3) rank = 3
  else if (cv[0] === 2 && cv[1] === 2) rank = 2; else if (cv[0] === 2) rank = 1
  return rank * 15 ** 5 + rv[0] * 15 ** 4 + rv[1] * 15 ** 3 + rv[2] * 15 ** 2 + rv[3] * 15 + rv[4]
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

// ── Range-aware Monte-Carlo equity ───────────────────────────────────────────
function fullDeck(): Card[] { return SUITS.flatMap(s => RANKS.map(r => ({ rank: r, suit: s }))) }

// Plain equity vs N uniformly random opponents (used preflop / aggression 0).
export function monteCarloEquity(hole: Card[], board: Card[], opponents: number, iters = 1500): number {
  return rangeEquity(hole, board, opponents, 0, iters)
}

// Equity where each opponent hand is importance-weighted by how well it connects
// with the CURRENT board, scaled by `aggression` (0 = random … ~0.85 = barreled).
// A small bluff floor keeps some air in the range (polarized barreling range).
export function rangeEquity(hole: Card[], board: Card[], opponents: number, aggression: number, iters = 1400): number {
  if (opponents < 1) return 1
  const known = new Set([...hole, ...board].map(c => c.rank + c.suit))
  const deck = fullDeck().filter(c => !known.has(c.rank + c.suit))
  const needBoard = 5 - board.length
  const a = Math.max(0, Math.min(0.9, aggression))
  const bluffFloor = 0.10

  const keepProb = (oppHole: Card[]): number => {
    if (a <= 0 || board.length < 3) return 1
    const cat = categoryOf(best7([...oppHole, ...board])) // strength on the board they bet
    const s = Math.min(1, cat / 5) // highcard 0 … set .6 … flush+ 1
    return Math.max(bluffFloor, (1 - a) + a * s)
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

  const reasons: string[] = []
  reasons.push(`Ton équité réelle ≈ ${pct(eq)}${aggression > 0 ? ` face à une range ${barrels >= 2 ? 'forte (plusieurs mises)' : 'resserrée'}` : ` face à ${opponents} adversaire${opponents > 1 ? 's' : ''}`}.`)
  if (toCall > 0) reasons.push(`Cote du pot : il te faut ${pct(potOdds)} d'équité pour payer ${toCall}.`)
  reasons.push(`Ta main : ${name}${pair !== 'none' ? ` (${pair === 'overpair' ? 'overpaire' : pair === 'top' ? 'top paire' : pair === 'second' ? '2e paire' : 'paire faible'})` : ''}${draws.length ? ' + ' + draws.join(' + ') : ''}.`)
  reasons.push(inPosition ? 'Tu es en position (tu parles après).' : 'Tu es hors de position : sois plus prudent.')
  if (pot > 0 && spr < 4) reasons.push(`SPR ≈ ${spr.toFixed(1)} (tapis/pot) : ${spr <= 1.5 ? 'engagé — avec une main forte, joue all-in.' : 'assez bas, prêt à investir gros avec une main forte.'}`)

  const isStrongValue = cat >= 2 || pair === 'overpair' // two pair+, sets, overpair
  const isOnePair = cat === 1
  const valueRaiseSize = wet > 0.4 ? round(pot * 0.85) : round(pot * 0.66)
  const valueBetSize = wet > 0.4 ? round(pot * 0.75) : round(pot * 0.6)

  let action: AdviceAction
  let sizingText = ''
  let confidence: Advice['confidence'] = 'moyenne'

  if (toCall > 0) {
    // ── Facing a bet/raise ──
    if (isStrongValue && eq >= 0.55) {
      if (spr <= 1.5) { action = 'RAISE'; sizingText = `relance ALL-IN (SPR bas)` }
      else { action = 'RAISE'; sizingText = `relance pour la valeur (~${wet > 0.4 ? '¾' : '⅔'} pot, +$${valueRaiseSize})` }
      reasons.push('Main forte : tu domines une bonne partie de sa range → relance pour la valeur.')
      confidence = eq >= 0.7 ? 'haute' : 'moyenne'
    } else if (isStrongValue) {
      action = 'CALL'; sizingText = `paie $${toCall}`
      reasons.push('Main de valeur, mais sa range d’agression est lourde : call (relancer te fait payer surtout par mieux).')
      confidence = 'moyenne'
    } else if (isOnePair) {
      // Bluffcatcher — call/fold only, NEVER raise into aggression.
      if (eq >= potOdds + 0.02) {
        action = 'CALL'; sizingText = `paie $${toCall} (bluffcatch)`
        reasons.push('Une paire face à de l’agression = bluffcatcher : tu paies pour battre ses bluffs, mais ne relance pas (tu ferais fuir ses bluffs et payer ses grosses mains).')
        confidence = eq >= potOdds + 0.12 ? 'moyenne' : 'basse'
      } else if (strongDraw && eq >= potOdds - 0.08) {
        action = 'CALL'; sizingText = `paie $${toCall}`
        reasons.push('Paire + tirage : assez d’équité avec les gains implicites pour suivre.')
        confidence = 'basse'
      } else {
        action = 'FOLD'; sizingText = 'couche-toi'
        reasons.push('Bluffcatcher trop faible face à cette agression : se coucher est le plus rentable.')
        confidence = eq < potOdds - 0.08 ? 'haute' : 'moyenne'
      }
    } else if (strongDraw) {
      if (eq >= potOdds - 0.04) { action = 'CALL'; sizingText = `paie $${toCall} (tirage)`; reasons.push('Tirage fort : la cote (+ gains implicites) justifie le call.'); confidence = 'moyenne' }
      else { action = 'FOLD'; sizingText = 'couche-toi'; reasons.push('Tirage trop cher payé par rapport à la cote.'); confidence = 'basse' }
    } else {
      action = 'FOLD'; sizingText = 'couche-toi'
      reasons.push('Pas de main ni de tirage : relancer en bluff ici est très risqué, le fold est correct.')
      confidence = 'haute'
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
      action = 'CHECK'; sizingText = 'checke'
      reasons.push('Main faible : checke (un bluff n’est rentable que sur les bons board et adversaires).')
      confidence = 'moyenne'
    }
  }

  return { action, sizingText, equity: eq, potOdds, madeHand: name, draws, reasons, confidence }
}
