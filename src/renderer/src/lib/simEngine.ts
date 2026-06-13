// ─────────────────────────────────────────────────────────────────────────────
// HEADLESS Texas Hold'em engine for the SIMULATION lab. No React, no timers —
// a pure function loop so we can play thousands of single-table tournaments and
// measure whether the coach is profitable vs the bots. Decisions are delegated to
// a `Decider` callback (the coach decider reuses the real getPostflopAdvice +
// charts; the bot decider ports decideBotAction), so the sim tests the REAL coach.
// ─────────────────────────────────────────────────────────────────────────────
import type { Card } from './rangeEstimator'

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS = ['♠', '♥', '♦', '♣']
const RVAL: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }

export interface SimSeat {
  id: number
  stack: number
  kind: 'coach' | 'bot'
  tier: number              // 1 amateur · 2 pro · 3 expert (bots); coach ignores it
  // per-hand state (engine-managed)
  hole: [Card, Card] | null
  bet: number               // chips in front THIS street
  totalBet: number          // chips committed THIS hand (for side pots)
  folded: boolean
  allIn: boolean
  position: string          // UTG / HJ / CO / BTN / SB / BB …
  inHand: boolean           // dealt in (not busted)
}

export interface HandAction { id: number; street: Street; type: 'BET' | 'RAISE' | 'CALL' | 'CHECK' | 'FOLD' | 'ALL-IN'; amount: number; pos: string }
export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export interface HandState {
  seats: SimSeat[]
  board: Card[]
  pot: number               // collected pot (committed, excluding current street bets)
  currentBet: number        // highest bet THIS street
  minRaise: number
  street: Street
  buttonIdx: number
  sb: number; bb: number; ante: number
  actions: HandAction[]
}
export type SimDecision = { action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'; to?: number }
export type Decider = (seatId: number, hs: HandState) => SimDecision

// ── Hand evaluation (7-card best-5, integer score) ───────────────────────────
function ev5(cs: Card[]): number {
  const rv = cs.map(c => RVAL[c.rank]).sort((a, b) => b - a)
  const isF = cs.every(c => c.suit === cs[0].suit)
  const u = [...new Set(rv)]
  const wheel = u.length === 5 && u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2
  const isS = (u.length === 5 && u[0] - u[4] === 4) || wheel
  const cnt: Record<number, number> = {}; rv.forEach(r => (cnt[r] = (cnt[r] ?? 0) + 1))
  const cv = Object.values(cnt).sort((a, b) => b - a)
  let rk = 0
  if (isF && isS) rk = 8; else if (cv[0] === 4) rk = 7; else if (cv[0] === 3 && cv[1] === 2) rk = 6
  else if (isF) rk = 5; else if (isS) rk = 4; else if (cv[0] === 3) rk = 3
  else if (cv[0] === 2 && cv[1] === 2) rk = 2; else if (cv[0] === 2) rk = 1
  if (isS) return rk * 15 ** 5 + (wheel ? 5 : u[0])
  const tb: number[] = []
  Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a).forEach(r => { for (let i = 0; i < cnt[r]; i++) tb.push(r) })
  return rk * 15 ** 5 + (tb[0] ?? 0) * 15 ** 4 + (tb[1] ?? 0) * 15 ** 3 + (tb[2] ?? 0) * 15 ** 2 + (tb[3] ?? 0) * 15 + (tb[4] ?? 0)
}
export function rank7(cards: Card[]): number {
  let best = 0
  const n = cards.length
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const s = ev5([cards[a], cards[b], cards[c], cards[d], cards[e]]); if (s > best) best = s
    }
  return best
}

function freshDeck(): Card[] { const d: Card[] = []; for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s }); return d }
function shuffle(d: Card[]): Card[] { const a = [...d]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]] } return a }

// ── Position labels relative to the button (drive bot posBonus + coach charts) ─
const MIDDLE = ['UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO']  // earliest → latest, for seats between BB and BTN
export function assignPositions(seats: SimSeat[], buttonIdx: number): void {
  const live = seats.filter(s => s.inHand)
  const n = live.length
  // order live seats starting from the button
  const order: SimSeat[] = []
  for (let k = 0; k < seats.length; k++) { const s = seats[(buttonIdx + k) % seats.length]; if (s.inHand) order.push(s) }
  if (n === 2) { order[0].position = 'BTN'; order[1].position = 'BB'; return } // heads-up: button is SB
  order[0].position = 'BTN'; order[1].position = 'SB'; order[2].position = 'BB'
  const mids = order.slice(3) // from UTG … to CO (just before BTN)
  const m = mids.length
  for (let i = 0; i < m; i++) {
    // last middle seat is CO, second-last HJ, etc.; fill from the end of MIDDLE
    mids[i].position = MIDDLE[Math.min(MIDDLE.length - 1, MIDDLE.length - (m - i))] ?? 'MP'
  }
}

// ── One hand ─────────────────────────────────────────────────────────────────
function activeCount(seats: SimSeat[]): number { return seats.filter(s => s.inHand && !s.folded).length }

export function playHand(seats: SimSeat[], buttonIdx: number, sb: number, bb: number, ante: number, decider: Decider): void {
  const inHand = seats.filter(s => s.inHand && s.stack > 0)
  if (inHand.length < 2) return
  assignPositions(seats, buttonIdx)
  // reset per-hand
  const deck = shuffle(freshDeck())
  let di = 0
  seats.forEach(s => { s.bet = 0; s.totalBet = 0; s.folded = false; s.allIn = false; s.hole = null })
  for (const s of inHand) s.hole = [deck[di++], deck[di++]]
  const board: Card[] = []

  const hs: HandState = { seats, board, pot: 0, currentBet: 0, minRaise: bb, street: 'preflop', buttonIdx, sb, bb, ante, actions: [] }

  const post = (s: SimSeat, amt: number) => { const a = Math.min(amt, s.stack); s.stack -= a; s.bet += a; s.totalBet += a; if (s.stack === 0) s.allIn = true; return a }

  // antes
  if (ante > 0) for (const s of inHand) { const a = post(s, ante); hs.pot += a; s.bet = 0 } // antes go to pot, not a "bet"
  // blinds
  const ordered: SimSeat[] = []
  for (let k = 0; k < seats.length; k++) { const s = seats[(buttonIdx + k) % seats.length]; if (s.inHand && s.stack >= 0 && inHand.includes(s)) ordered.push(s) }
  const sbSeat = ordered.length === 2 ? ordered[0] : ordered[1]
  const bbSeat = ordered.length === 2 ? ordered[1] : ordered[2]
  post(sbSeat, sb); post(bbSeat, bb)
  hs.currentBet = bb; hs.minRaise = bb

  // betting: first to act preflop = seat after BB; postflop = first live seat after button
  const seatIdxOf = (s: SimSeat) => seats.indexOf(s)
  const firstPreflop = (() => { const bbPos = seatIdxOf(bbSeat); for (let k = 1; k <= seats.length; k++) { const s = seats[(bbPos + k) % seats.length]; if (s.inHand && !s.folded && !s.allIn) return seats.indexOf(s) } return seatIdxOf(bbSeat) })()

  runBetting(hs, decider, firstPreflop)

  const dealAdvance = () => {
    // collect street bets into the pot
    seats.forEach(s => { hs.pot += s.bet; s.bet = 0 })
    hs.currentBet = 0; hs.minRaise = bb
  }

  for (const street of ['flop', 'turn', 'river'] as Street[]) {
    if (activeCount(seats) < 2) break
    dealAdvance()
    if (street === 'flop') { board.push(deck[di++], deck[di++], deck[di++]) } else board.push(deck[di++])
    hs.street = street
    // postflop first to act = first live (not folded, not all-in) seat left of the button
    const allCanActDone = seats.filter(s => s.inHand && !s.folded && !s.allIn).length < 2
    if (allCanActDone) continue // everyone all-in → just run it out
    let first = -1
    for (let k = 1; k <= seats.length; k++) { const s = seats[(buttonIdx + k) % seats.length]; if (s.inHand && !s.folded && !s.allIn) { first = seats.indexOf(s); break } }
    if (first >= 0) runBetting(hs, decider, first)
  }
  // final collect
  seats.forEach(s => { hs.pot += s.bet; s.bet = 0 })

  awardPots(seats, board)
}

function runBetting(hs: HandState, decider: Decider, startIdx: number): void {
  const seats = hs.seats
  const n = seats.length
  let idx = startIdx
  let toAct = seats.filter(s => s.inHand && !s.folded && !s.allIn).length
  let guard = 0
  while (toAct > 0 && guard++ < 400) {
    if (activeCount(seats) < 2) break
    const s = seats[idx]
    if (!s.inHand || s.folded || s.allIn) { idx = (idx + 1) % n; continue }
    const owed = hs.currentBet - s.bet
    let dec = decider(s.id, hs)
    let raised = false
    if (dec.action === 'fold') {
      if (owed <= 0) { /* never fold when you can check */ s.bet = s.bet; logAct(hs, s, 'CHECK', 0) }
      else { s.folded = true; logAct(hs, s, 'FOLD', 0) }
    } else if (dec.action === 'check') {
      if (owed > 0) { // illegal check → treat as call
        commit(hs, s, owed); logAct(hs, s, s.allIn ? 'ALL-IN' : 'CALL', s.bet)
      } else logAct(hs, s, 'CHECK', 0)
    } else if (dec.action === 'call') {
      commit(hs, s, owed); logAct(hs, s, s.allIn ? 'ALL-IN' : 'CALL', s.bet)
    } else { // bet / raise / allin
      const target = dec.action === 'allin' ? s.bet + s.stack : Math.round(dec.to ?? 0)
      const minTo = hs.currentBet + hs.minRaise
      let to = target
      const cap = s.bet + s.stack
      if (to > cap) to = cap
      if (to < minTo && to < cap) to = (owed <= 0 && to >= hs.bb) ? to : minTo // a bet must be >= bb; a raise >= minTo
      if (owed <= 0 && to < hs.bb) to = Math.min(cap, hs.bb)
      const inc = to - hs.currentBet
      commit(hs, s, to - s.bet)
      if (to > hs.currentBet) {
        if (inc >= hs.minRaise) hs.minRaise = inc
        hs.currentBet = to
        raised = true
      }
      logAct(hs, s, owed <= 0 ? (s.allIn ? 'ALL-IN' : 'BET') : (s.allIn ? 'ALL-IN' : 'RAISE'), to)
    }
    if (raised) toAct = seats.filter(x => x.inHand && !x.folded && !x.allIn && x.id !== s.id).length
    else toAct--
    idx = (idx + 1) % n
  }
}

function commit(_hs: HandState, s: SimSeat, amt: number): void { const a = Math.min(Math.max(0, amt), s.stack); s.stack -= a; s.bet += a; s.totalBet += a; if (s.stack === 0) s.allIn = true }
function logAct(hs: HandState, s: SimSeat, type: HandAction['type'], amount: number): void { hs.actions.push({ id: s.id, street: hs.street, type, amount, pos: s.position }) }

// ── Side pots + showdown ─────────────────────────────────────────────────────
function awardPots(seats: SimSeat[], board: Card[]): void {
  const contributors = seats.filter(s => s.totalBet > 0)
  const live = seats.filter(s => s.inHand && !s.folded)
  if (live.length === 1) { live[0].stack += contributors.reduce((a, s) => a + s.totalBet, 0); return }
  // build side pots from distinct contribution levels
  const levels = [...new Set(contributors.map(s => s.totalBet))].sort((a, b) => a - b)
  let prev = 0
  const remaining = [...contributors]
  for (const lvl of levels) {
    const slice = lvl - prev
    const potSeats = remaining.filter(s => s.totalBet >= lvl)
    const potAmt = slice * potSeats.length
    if (potAmt <= 0) { prev = lvl; continue }
    // eligible = those at this level who are still live (not folded)
    const eligible = potSeats.filter(s => s.inHand && !s.folded)
    if (eligible.length) {
      let best = -1; let winners: SimSeat[] = []
      for (const s of eligible) { const sc = rank7([...(s.hole as Card[]), ...board]); if (sc > best) { best = sc; winners = [s] } else if (sc === best) winners.push(s) }
      const share = Math.floor(potAmt / winners.length)
      winners.forEach(w => (w.stack += share))
      winners[0].stack += potAmt - share * winners.length // odd chip to first winner
    } else {
      // everyone at this level folded → give to the live contributor(s) (rare)
      potSeats[0].stack += potAmt
    }
    prev = lvl
  }
}

// ── Tournament loop ──────────────────────────────────────────────────────────
export interface BlindLevel { sb: number; bb: number; ante: number }
export interface TourConfig {
  players: { kind: 'coach' | 'bot'; tier: number }[]
  startStack: number
  levels: BlindLevel[]
  handsPerLevel: number
  maxHands?: number
}
// Returns the finish order: index 0 = FIRST player eliminated … last = WINNER.
export function playTournament(cfg: TourConfig, makeDecider: (seats: SimSeat[]) => Decider): { finishOrder: number[]; coachPlace: number; hands: number } {
  const seats: SimSeat[] = cfg.players.map((p, i) => ({ id: i, stack: cfg.startStack, kind: p.kind, tier: p.tier, hole: null, bet: 0, totalBet: 0, folded: false, allIn: false, position: '', inHand: true }))
  const decider = makeDecider(seats)
  const finishOrder: number[] = []
  let buttonIdx = 0
  let hands = 0
  const maxHands = cfg.maxHands ?? 100000
  while (seats.filter(s => s.inHand).length > 1 && hands < maxHands) {
    const levelIdx = Math.min(cfg.levels.length - 1, Math.floor(hands / cfg.handsPerLevel))
    const lvl = cfg.levels[levelIdx]
    // advance button to next live seat
    do { buttonIdx = (buttonIdx + 1) % seats.length } while (!seats[buttonIdx].inHand)
    playHand(seats, buttonIdx, lvl.sb, lvl.bb, lvl.ante, decider)
    hands++
    // bust players (record finish order)
    const justOut = seats.filter(s => s.inHand && s.stack <= 0)
    // order busts by who had less committed is hard; for simplicity record them (multiple in one hand: arbitrary)
    for (const s of justOut) { s.inHand = false; finishOrder.push(s.id) }
  }
  const survivors = seats.filter(s => s.inHand).map(s => s.id)
  finishOrder.push(...survivors) // winner(s) last
  const coachId = cfg.players.findIndex(p => p.kind === 'coach')
  const coachPlace = seats.length - finishOrder.indexOf(coachId) // 1 = winner
  return { finishOrder, coachPlace, hands }
}
