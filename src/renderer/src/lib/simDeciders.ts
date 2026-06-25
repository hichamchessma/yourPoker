// Decision functions for the simulation engine. The BOT decider ports the in-game
// decideBotAction; the COACH decider reuses the REAL coach brain (buildRangeMap /
// buildJamCallMap pre-flop, getPostflopAdvice post-flop) with the same context the
// live coach reconstructs — so the sim measures the actual coach, not an approximation.
import { preflopProbs, policyFor, madeStrength, preflopStrength, hasStrongDraw } from './rangeEstimator'
import { getPostflopAdvice, type VillainTier } from './postflopAdvisor'
import { buildRangeMap, buildJamCallMap, handKeyFromCards, type Scenario } from './preflopRanges'
import type { SimSeat, HandState, SimDecision, Decider } from './simEngine'

const POS_BONUS: Record<string, number> = { BTN: 1.0, CO: 0.88, HJ: 0.78, MP: 0.72, 'MP+1': 0.72, UTG: 0.62, 'UTG+1': 0.65, SB: 0.95, BB: 0.82 }

const totalPot = (hs: HandState) => hs.pot + hs.seats.reduce((a, s) => a + s.bet, 0)
const liveSeats = (hs: HandState) => hs.seats.filter(s => s.inHand && !s.folded)

// Count REAL pre-flop raises so far (open + 3-bet + 4-bet + all-in raises) by walking
// the bet level; an all-in CALL doesn't raise the level so it isn't counted.
function preflopRaises(hs: HandState): number {
  let mx = hs.bb, r = 0
  for (const a of hs.actions) { if (a.street !== 'preflop') continue; if ((a.type === 'BET' || a.type === 'RAISE' || a.type === 'ALL-IN') && a.amount > mx) { r++; mx = a.amount } }
  return r
}
const preflopCallers = (hs: HandState) => hs.actions.filter(a => a.street === 'preflop' && a.type === 'CALL').length

// Action-order helpers (seat distance from the first actor of the street).
function orderIdx(hs: HandState, seatIdx: number, firstActorIdx: number): number {
  const n = hs.seats.length
  return ((seatIdx - firstActorIdx) % n + n) % n
}
function firstActor(hs: HandState, preflop: boolean): number {
  const n = hs.seats.length
  // pre-flop: first live seat after the BB (button+2, or button+1 heads-up); post-flop: first live after button
  const nLive = hs.seats.filter(s => s.inHand).length
  const base = preflop ? (nLive === 2 ? hs.buttonIdx : (hs.buttonIdx + 2) % n) : hs.buttonIdx
  for (let k = 1; k <= n; k++) { const i = (base + k) % n; const s = hs.seats[i]; if (s.inHand && !s.folded) return i }
  return (base + 1) % n
}

function effectiveStack(hs: HandState, seat: SimSeat): number {
  const mine = seat.stack + seat.bet
  const villains = liveSeats(hs).filter(s => s.id !== seat.id).map(s => s.stack + s.bet)
  return villains.length ? Math.min(mine, Math.max(...villains)) : mine
}

// ── BOT ──────────────────────────────────────────────────────────────────────
function botDecision(seat: SimSeat, hs: HandState): SimDecision {
  const c1 = seat.hole![0], c2 = seat.hole![1]
  const tier = Math.max(1, Math.min(3, seat.tier))
  const posBonus = POS_BONUS[seat.position] ?? 0.75
  const toCall = hs.currentBet - seat.bet
  const pot = totalPot(hs)
  const potOdds = pot > 0 ? toCall / (pot + toCall) : 0
  const board = hs.board
  const onBoard = board.length >= 3
  const strength = onBoard ? madeStrength([c1, c2], board) : (preflopStrength(c1, c2) * posBonus) / 10
  const draw = onBoard ? hasStrongDraw([c1, c2], board) : false
  const rand = Math.random()
  const p = policyFor(tier, false)
  const bb = hs.bb
  const allInTo = seat.bet + seat.stack
  const minTo = hs.currentBet + hs.minRaise
  const roundBB = (x: number) => Math.max(bb, Math.round(x / bb) * bb)
  const betTo = (frac: number) => Math.min(allInTo, roundBB(pot * frac))
  const raiseTo = (frac: number) => Math.min(allInTo, Math.max(minTo, hs.currentBet + roundBB((pot + toCall) * frac)))
  if (!onBoard) {
    const psv = preflopStrength(c1, c2)
    const pp = preflopProbs(psv, posBonus, preflopRaises(hs), tier, toCall, bb > 0 ? toCall / bb : 0)
    let acc = pp.aggr
    if (rand < acc) { const size = preflopRaises(hs) === 0 ? 0.8 : 0.9; return toCall === 0 ? { action: 'bet', to: raiseTo(size) } : { action: 'raise', to: raiseTo(size) } }
    acc += pp.call; if (rand < acc) return toCall > 0 ? { action: 'call' } : { action: 'check' }
    acc += pp.check; if (rand < acc) return { action: 'check' }
    return { action: 'fold' }
  }
  if (toCall === 0) {
    if (strength >= p.betValue) { if (rand < p.betFreqStrong) return { action: 'bet', to: betTo(strength >= 0.85 ? 0.78 : 0.62) }; return { action: 'check' } }
    if (draw && rand < p.semiBluff) return { action: 'bet', to: betTo(0.5) }
    if (rand < p.bluff) return { action: 'bet', to: betTo(0.55) }
    return { action: 'check' }
  }
  if (strength >= p.raiseValue) return { action: 'raise', to: raiseTo(strength >= 0.85 ? 0.95 : 0.65) }
  if (draw && rand < p.semiBluff * 0.7) return { action: 'raise', to: raiseTo(0.8) }
  if (strength >= potOdds + p.callEdge) return { action: 'call' }
  if (draw && strength + 0.18 >= potOdds) return { action: 'call' }
  if (rand < p.spew) return { action: 'call' }
  if (tier >= 2 && rand < p.bluff * 0.6) return { action: 'raise', to: raiseTo(0.8) }
  return { action: 'fold' }
}

// ── COACH (the real brain) ─────────────────────────────────────────────────────
function coachDecision(seat: SimSeat, hs: HandState): SimDecision {
  const c1 = seat.hole![0], c2 = seat.hole![1]
  const board = hs.board
  const toCall = hs.currentBet - seat.bet
  const allInTo = seat.bet + seat.stack
  const minTo = hs.currentBet + hs.minRaise
  const bb = hs.bb
  const pot = totalPot(hs)
  const seatIdx = hs.seats.indexOf(seat)
  const live = liveSeats(hs)
  const opponents = Math.max(1, live.length - 1)
  const effStack = effectiveStack(hs, seat)
  const effBB = effStack / bb
  const rb = (x: number) => Math.max(bb, Math.round(x / bb) * bb)

  if (board.length < 3) {
    // ── pre-flop: REAL charts ──
    const raises = preflopRaises(hs)
    const callers = preflopCallers(hs)
    const scenario: Scenario = raises >= 3 ? 'vs4bet' : raises === 2 ? 'vs3bet'
      : raises === 1 ? (callers > 0 ? 'squeeze' : 'vsopen') : (callers > 0 ? 'iso' : 'rfi')
    const fa = firstActor(hs, true)
    const myOrder = orderIdx(hs, seatIdx, fa)
    const playersBehind = live.filter(s => s.id !== seat.id && orderIdx(hs, hs.seats.indexOf(s), fa) > myOrder).length
    const numAllIn = live.filter(s => s.id !== seat.id && s.allIn).length
    const raiseToBB = bb > 0 ? hs.currentBet / bb : 2.5
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
    const lastRaiserSeat = (() => { let mx = hs.bb, idx = -1; for (const a of hs.actions) { if (a.street === 'preflop' && (a.type === 'BET' || a.type === 'RAISE' || a.type === 'ALL-IN') && a.amount > mx) { mx = a.amount; idx = a.id } } return idx })()
    const vsOpenerPos = scenario === 'vsopen' && lastRaiserSeat >= 0 ? hs.seats.find(s => s.id === lastRaiserSeat)?.position : undefined
    const key = handKeyFromCards(c1, c2)
    const vsJam = numAllIn >= 1
    const map = vsJam
      ? buildJamCallMap(effBB, numAllIn, 1, false)
      : buildRangeMap(scenario, seat.position, playersBehind, { effBB, raiseToBB, multiway: live.length > 2, vsOpenerPos, closingAction: playersBehind === 0, potOdds })
    const chart = map.get(key) ?? 'fold'
    if (chart === 'fold') return toCall <= 0 ? { action: 'check' } : { action: 'fold' }
    if (chart === 'call') return toCall <= 0 ? { action: 'check' } : { action: 'call' }
    if (effBB <= 13 || vsJam) return { action: 'allin' }
    if (chart === 'raise' && (scenario === 'vsopen' || scenario === 'squeeze')) return { action: 'allin' } // re-shove zone
    let to: number
    if (chart === '3bet') to = Math.round(hs.currentBet * 3)
    else if (chart === '4bet') to = Math.round(hs.currentBet * 2.3)
    else { const limpers = hs.seats.filter(s => s.inHand && !s.folded && s.id !== seat.id && s.bet >= bb && s.bet < hs.currentBet).length; to = Math.round((scenario === 'iso' ? 3.5 : 2.5) * bb) + limpers * bb }
    return { action: toCall <= 0 ? 'bet' : 'raise', to: Math.min(allInTo, Math.max(minTo, rb(to))) }
  }

  // ── post-flop: REAL getPostflopAdvice with reconstructed context ──
  const isAggro = (a: typeof hs.actions[number]) => a.type === 'BET' || a.type === 'RAISE' || a.type === 'ALL-IN'
  const villainAggro = hs.actions.filter(a => isAggro(a) && a.id !== seat.id && a.street !== 'preflop')
  const postBets = villainAggro
  const barrels = new Set(postBets.map(a => a.street)).size
  const aggressors = new Set(postBets.map(a => a.id)).size
  const streets: ('flop' | 'turn' | 'river')[] = ['flop', 'turn', 'river']
  const curStreetIdx = streets.indexOf(hs.street as 'flop' | 'turn' | 'river')
  const cappedRange = curStreetIdx > 0 && streets.slice(0, curStreetIdx).some(st => {
    const acts = hs.actions.filter(a => a.street === st && a.id !== seat.id)
    return acts.length > 0 && !acts.some(a => isAggro(a))
  })
  const sizeFrac = toCall > 0 && (pot - toCall) > 0 ? toCall / (pot - toCall) : 0
  const sizeBoost = sizeFrac >= 1 ? 0.55 : sizeFrac >= 0.66 ? 0.45 : sizeFrac >= 0.45 ? 0.36 : sizeFrac >= 0.25 ? 0.22 : 0.08
  const raisesPre = preflopRaises(hs)
  const preAggr = raisesPre >= 3 ? 0.6 : raisesPre === 2 ? 0.4 : 0
  const aggression = Math.min(0.85, Math.max(preAggr, villainAggro.length * 0.28, sizeBoost + (barrels - 1) * 0.18))
  const villainTier: VillainTier | undefined = raisesPre >= 3 ? '4bet' : raisesPre === 2 ? '3bet' : undefined
  const calledStreets = new Set(hs.actions.filter(a => a.id !== seat.id && a.type === 'CALL' && a.street !== 'preflop').map(a => a.street)).size
  const callPressure = Math.min(0.85, calledStreets * 0.25 + (live.length > 2 ? 0.15 : 0))
  const lastPostAgg = postBets.length ? postBets[postBets.length - 1].id : -1
  const preRaiserId = (() => { let mx = hs.bb, idx = -1; for (const a of hs.actions) { if (a.street === 'preflop' && isAggro(a) && a.amount > mx) { mx = a.amount; idx = a.id } } return idx })()
  const donkLead = toCall > 0 && preRaiserId >= 0 && lastPostAgg >= 0 && lastPostAgg !== preRaiserId
  const curAggro = hs.actions.filter(a => a.street === hs.street && isAggro(a)).length
  const facingRaise = toCall > 0 && curAggro >= 2
  // in position: no live opponent acts after the coach post-flop (button acts last)
  const faPost = hs.buttonIdx
  const myPost = orderIdx(hs, seatIdx, (faPost + 1) % hs.seats.length)
  const inPosition = !live.some(s => s.id !== seat.id && !s.allIn && orderIdx(hs, hs.seats.indexOf(s), (faPost + 1) % hs.seats.length) > myPost)

  const adv = getPostflopAdvice({
    hole: [c1, c2], board, pot, toCall, heroStack: seat.stack, effStack, opponents, inPosition,
    aggression, barrels, bb, villainTier, aggressors, cappedRange, callPressure, donkLead, facingRaise,
    iters: 400, // lighter Monte-Carlo: fast enough for thousands of tournaments, stats stay stable
  })
  if (adv.action === 'FOLD') return toCall <= 0 ? { action: 'check' } : { action: 'fold' }
  if (adv.action === 'CHECK') return { action: 'check' }
  if (adv.action === 'CALL') return { action: 'call' }
  if (adv.jam) return { action: 'allin' }
  if (adv.action === 'BET') return { action: 'bet', to: Math.min(allInTo, Math.max(bb, rb(pot * (adv.betFrac || 0.6)))) }
  if (adv.action === 'RAISE') return { action: 'raise', to: Math.min(allInTo, Math.max(minTo, rb(hs.currentBet + (pot + toCall) * (adv.betFrac || 0.66)))) }
  return toCall <= 0 ? { action: 'check' } : { action: 'fold' }
}

export function makeSimDecider(seats: SimSeat[]): Decider {
  return (id, hs) => {
    const seat = seats.find(s => s.id === id)!
    if (!seat.hole) return { action: 'fold' }
    return seat.kind === 'coach' ? coachDecision(seat, hs) : botDecision(seat, hs)
  }
}
