// -----------------------------------------------------------------------------
// Replay reconstruction + the coach's verdict on a hero decision. PURE logic (no
// React, no JSX): rebuild the state at any step of a recorded hand, re-derive the
// exact spot the hero faced, and judge the move with the SAME engine the live coach
// uses -- so the live advice and the "Juge mon coup" verdict can never disagree.
//
// Extracted from GamePage so the perf report, the history page and the simulation
// replay can use it without pulling in the live game engine.
// -----------------------------------------------------------------------------
import i18n from '../i18n'
// Module-level helper: this file is not a component, so there is no useTranslation.
const tc = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string
import { type Scenario, handKeyFromCards, buildRangeMap, buildJamCallMap, handOpenRank, openPctFor } from './preflopRanges'
import { getPostflopAdvice, buildEquityReasoning, type EquityReasoning } from './postflopAdvisor'
import { initRange, applyAction, actionSummary, POS_BONUS, type RangeWeights, type ActCat } from './rangeEstimator'
import type { Card, Phase, HandHistoryRecord, HistoryAction, LeakKind, MoveCritique, Street, StreetStat, SessionMistake, SessionEval } from './handTypes'

export function computeStepState(record: HandHistoryRecord, stepIdx: number): {
  players: Array<HandHistoryRecord['players'][number] & { stack: number }>
  board: (Card|null)[]
  pot: number
  currentPhase: Phase
  streetBets: Record<number, number>   // live bet sitting in front of each player
  lastActorIdx: number                 // who just acted at this step
} {
  // Rebuild state at a given action step
  const players = record.players.map(p => ({
    ...p,
    isFolded: false,
    stack: p.startStack,
  }))
  let pot = 0
  let board: (Card|null)[] = [null,null,null,null,null]
  let currentPhase: Phase = 'preflop'
  let lastActorIdx = -1

  const streetBets: Record<number, number> = {}
  players.forEach(p => { streetBets[p.idx] = 0 })

  for (let i = 0; i <= stepIdx && i < record.actions.length; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) {
      // Phase event — new street: bets are collected into the pot.
      currentPhase = a.phase
      if (a.phase !== 'preflop') players.forEach(p => { streetBets[p.idx] = 0 })
      if (a.phase === 'flop') board = [record.board[0], record.board[1], record.board[2], null, null]
      else if (a.phase === 'turn') board = [record.board[0], record.board[1], record.board[2], record.board[3], null]
      else if (a.phase === 'river' || a.phase === 'showdown') board = [...record.board]
    } else {
      currentPhase = a.phase
      lastActorIdx = a.seatIdx
      const p = players.find(x => x.idx === a.seatIdx)
      if (p) {
        if (a.actionType === 'FOLD') {
          p.isFolded = true
        } else if (a.actionType === 'CHECK') {
          // no chips
        } else {
          const added = a.amount - (streetBets[p.idx] ?? 0)
          p.stack -= Math.max(0, added)
          streetBets[p.idx] = a.amount
          pot = a.potAfter
        }
      }
    }
  }

  return { players, board, pot, currentPhase, streetBets, lastActorIdx }
}

// ─── "Coach juge" — constructive critique of a hero action in the replay ──────
// Stable, language-agnostic leak buckets (for the session perf report aggregation).
export function boardForPhase(board: (Card | null)[], phase: Phase): Card[] {
  const b = board.filter(Boolean) as Card[]
  if (phase === 'flop') return b.slice(0, 3)
  if (phase === 'turn') return b.slice(0, 4)
  if (phase === 'river' || phase === 'showdown') return b
  return []
}
// Pre-flop action order for a seat (0 = first to act = UTG / left of the BB),
// derived from the button position stored on the record. Used to count how many
// live players still act behind the hero (→ RFI steal width).
export function preflopActIndex(seatIdx: number, players: HandHistoryRecord['players']): number {
  const n = players.length
  const dealerIdx = players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
  const bbOffset = n === 2 ? 1 : 2
  const firstOffset = (bbOffset + 1) % n
  return ((((seatIdx - dealerIdx) % n + n) % n) - firstOffset + n) % n
}

// A preflop ALL-IN only escalates the pot type (counts as a raise / 3-bet level)
// if it actually EXCEEDS the prevailing bet. A short stack that jams for LESS than
// the current bet is dead money / effectively a call — NOT a 3-bet — and must not
// be treated as a raise (→ wrong "3-bet pot" premium range) nor as villain
// aggression (→ wrongly deflated equity). Without this, a min-jam under a raise
// made the coach read a single-raised pot as a 3-bet pot and fold top pair to a
// river bluff. Shared by the live coach AND the replay critique so they stay equal.
interface PfAction { seatIdx: number; phase: Phase; actionType: string; amount: number }
export function realPreflopRaises(actions: PfAction[], bb: number): { count: number; lastRaiserSeat: number; amts: number[]; deadAllIn: Set<number> } {
  let currentBet = bb, lastInc = bb, count = 0, lastRaiserSeat = -1
  const amts: number[] = []
  const deadAllIn = new Set<number>()
  for (const a of actions) {
    if (a.phase !== 'preflop' || a.seatIdx < 0) continue
    const inc = a.amount - currentBet
    // A genuine raise reopens the action: a RAISE (engine-enforced full raise), or an
    // ALL-IN that raises by at least the previous increment (a legal full re-raise).
    // A short all-in that only bumps the price a little — a jam UNDER the bet OR an
    // INCOMPLETE raise (~≤2× the bet) — is a short-stack shove, NOT a deep 3-bet: it
    // must not flip the pot to a premium "3-bet" range nor count as aggression.
    if (a.actionType === 'RAISE' || (a.actionType === 'ALL-IN' && inc >= lastInc)) {
      count++; lastRaiserSeat = a.seatIdx; amts.push(a.amount)
      lastInc = inc; currentBet = a.amount
    } else if (a.actionType === 'ALL-IN') {
      deadAllIn.add(a.seatIdx)                 // sub-bet or incomplete jam → dead money, not a 3-bet
      if (a.amount > currentBet) currentBet = a.amount   // it still raises the price to call
    } else if (a.amount > currentBet) {
      currentBet = a.amount
    }
  }
  return { count, lastRaiserSeat, amts, deadAllIn }
}
// A villain action that should count toward "aggression" — excludes a dead short
// all-in (a sub-bet preflop jam isn't a barrel).
export function isAggroAction(a: PfAction & { isHero?: boolean }, deadAllIn: Set<number>): boolean {
  if (a.seatIdx < 0 || a.isHero) return false
  if (a.actionType !== 'BET' && a.actionType !== 'RAISE' && a.actionType !== 'ALL-IN') return false
  return !(a.phase === 'preflop' && a.actionType === 'ALL-IN' && deadAllIn.has(a.seatIdx))
}
export function critiqueHeroMove(record: HandHistoryRecord, actionIdx: number, iters?: number): MoveCritique | null {
  const act = record.actions[actionIdx]
  if (!act || act.seatIdx < 0 || !act.isHero) return null
  if (act.actionType === 'SB' || act.actionType === 'BB') return null // blinds aren't a decision
  const hero = record.players.find(p => p.isHero)
  if (!hero || !hero.holeCards[0] || !hero.holeCards[1]) return null

  // Replay everything BEFORE the hero's action to rebuild the spot they faced.
  let pot = 0, currentBet = 0, phase: Phase = 'preflop'
  const bet: Record<number, number> = {}, committed: Record<number, number> = {}
  const folded = new Set<number>()
  record.players.forEach(p => { bet[p.idx] = 0; committed[p.idx] = 0 })
  let preflopCallers = 0
  let lastAggressorName = ''
  const allInSeats = new Set<number>()
  for (let i = 0; i < actionIdx; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) {
      phase = a.phase
      if (a.phase !== 'preflop') { record.players.forEach(p => (bet[p.idx] = 0)); currentBet = 0 }
      pot = a.potAfter
      continue
    }
    if (a.actionType === 'FOLD') { folded.add(a.seatIdx); pot = a.potAfter; continue }
    if (a.actionType === 'CHECK') { pot = a.potAfter; continue }
    if (a.phase === 'preflop' && a.actionType === 'CALL') preflopCallers++
    const delta = a.amount - (bet[a.seatIdx] ?? 0)
    committed[a.seatIdx] = (committed[a.seatIdx] ?? 0) + Math.max(0, delta)
    bet[a.seatIdx] = a.amount
    if (a.amount > currentBet) {
      currentBet = a.amount
      if (a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN') lastAggressorName = a.name
    }
    if (a.phase === 'preflop' && a.actionType === 'ALL-IN') allInSeats.add(a.seatIdx)
    pot = a.potAfter
  }
  // Genuine preflop raises only (a short jam UNDER the current bet is dead money,
  // not a 3-bet) — shared with the live coach so the verdicts stay identical.
  const pfInfo = realPreflopRaises(record.actions.slice(0, actionIdx), record.bb)
  const preflopRaises = pfInfo.count
  const lastPreflopRaiserIdx = pfInfo.lastRaiserSeat
  const preflopRaiseAmts = pfInfo.amts

  phase = act.phase
  const board = boardForPhase(record.board, phase)
  const toCall = Math.max(0, currentBet - (bet[hero.idx] ?? 0))
  // Only players actually dealt into THIS hand (had hole cards) and not yet folded
  // count as live opponents — eliminated / sat-out seats ($0, no cards) must NOT
  // inflate the opponent count (that wrongly lowers equity vs the live coach).
  const live = record.players.filter(p => !folded.has(p.idx) && (p.holeCards[0] !== null || p.holeCards[1] !== null))
  const opponents = Math.max(1, live.length - 1)
  const heroRemaining = hero.startStack - (committed[hero.idx] ?? 0)
  const oppRemaining = live.filter(p => !p.isHero).map(p => p.startStack - (committed[p.idx] ?? 0))
  const effStack = Math.min(heroRemaining, oppRemaining.length ? Math.max(...oppRemaining) : heroRemaining)
  const latePos = ['BTN', 'BTN/SB', 'CO'].includes(hero.position)
  const heroCat: 'fold' | 'passive' | 'aggr' =
    act.actionType === 'FOLD' ? 'fold' : (act.actionType === 'CALL' || act.actionType === 'CHECK') ? 'passive' : 'aggr'
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const lines: string[] = []
  let verdict: MoveCritique['verdict'] = 'ok'
  let headline = ''
  let reasoning: EquityReasoning | null = null
  // Hoisted out of the per-branch blocks so the leak bucket can be derived once at the end.
  let recCatOut: 'fold' | 'passive' | 'aggr' = 'fold'
  let sizing: 'big' | 'small' | null = null

  if (phase === 'preflop') {
    const scenario: Scenario = preflopRaises >= 3 ? 'vs4bet'
      : preflopRaises === 2 ? 'vs3bet'
      : preflopRaises === 1 ? (preflopCallers > 0 ? 'squeeze' : 'vsopen')
      : preflopCallers > 0 ? 'iso' : 'rfi'
    // Players still to act behind the hero (live, not yet folded) — a fold-around
    // to the SB becomes a true 1-behind blind battle → the RFI width widens to a
    // steal range instead of an early-position open.
    const heroOrder = preflopActIndex(hero.idx, record.players)
    const playersBehind = record.players.filter(p =>
      p.idx !== hero.idx && !folded.has(p.idx) && (p.holeCards[0] !== null || p.holeCards[1] !== null) &&
      preflopActIndex(p.idx, record.players) > heroOrder).length
    // Only a TOP-of-action all-in (bet ≥ currentBet) is a real jam to call off; a
    // short all-in that's been raised over is just dead money (decide vs the raiser).
    const allInTop = [...allInSeats].filter(idx => idx !== hero.idx && !folded.has(idx) && (bet[idx] ?? 0) >= currentBet)
    // …and a SMALL all-in flat-called by a still-deep player isn't a call-off either —
    // it's a SQUEEZE/iso spot (raise to isolate). Mirror the live coach exactly so the
    // verdict matches: don't flag a premium RAISE as "over-aggressive" there.
    const jamShove = allInTop.reduce((m, idx) => Math.max(m, bet[idx] ?? 0), 0)
    const jamIsoable = allInTop.length >= 1 && jamShove < heroRemaining * 0.5
      && record.players.some(p => p.idx !== hero.idx && !folded.has(p.idx) && !allInSeats.has(p.idx)
        && (bet[p.idx] ?? 0) >= currentBet && (p.startStack - (committed[p.idx] ?? 0)) >= record.bb * 10)
    const numAllIn = jamIsoable ? 0 : allInTop.length
    const vsJam = numAllIn >= 1
    const vsOpenerPos = scenario === 'vsopen' ? record.players.find(p => p.idx === lastPreflopRaiserIdx)?.position : undefined
    const reRaiseRatio = scenario === 'vs3bet' && preflopRaiseAmts.length >= 2 && preflopRaiseAmts[0] > 0 ? preflopRaiseAmts[1] / preflopRaiseAmts[0] : undefined
    // 3-bettor in position (acts after us post-flop)? n = seats, dealer = BTN seat.
    const dealerIdxC = record.players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
    const nC = record.players.length
    const postIdx = (s: number) => (((s - dealerIdxC) % nC + nC) % nC - 1 + nC) % nC
    const threeBettorIP = scenario === 'vs3bet' && lastPreflopRaiserIdx >= 0 ? postIdx(lastPreflopRaiserIdx) > postIdx(hero.idx) : undefined
    // A live raiser/squeezer still to act behind the jam (raised above the BB, hasn't
    // matched the jam, not folded/all-in) → tighten the call-off (can't close, can be re-jammed).
    const raiserBehindJam = vsJam && record.players.some(p => p.idx !== hero.idx && !folded.has(p.idx) && !allInSeats.has(p.idx) && (bet[p.idx] ?? 0) > record.bb && (bet[p.idx] ?? 0) < currentBet)
    const map = vsJam
      ? buildJamCallMap(record.bb > 0 ? effStack / record.bb : 100, numAllIn, 1, raiserBehindJam)
      : buildRangeMap(scenario, hero.position, (scenario === 'rfi' || scenario === 'iso') ? playersBehind : undefined,
          { raiseToBB: record.bb > 0 ? currentBet / record.bb : undefined, multiway: live.length > 2, numCallers: preflopCallers, vsOpenerPos, reRaiseRatio, threeBettorIP,
            effBB: record.bb > 0 ? effStack / record.bb : undefined,
            closingAction: playersBehind === 0, potOdds: toCall > 0 ? toCall / (pot + toCall) : 0 })
    const key = handKeyFromCards(hero.holeCards[0], hero.holeCards[1])
    const rec = map.get(key) ?? 'fold'
    const recCat: 'fold' | 'passive' | 'aggr' = rec === 'fold' ? 'fold' : rec === 'call' ? 'passive' : 'aggr'
    recCatOut = recCat
    // NOTE: no equity-vs-pot-odds reasoning block pre-flop — there the decision is a
    // RANGE call (domination / realizability), not a pot-odds one, so the "I have/don't
    // have the price" framing would contradict a correct range fold (e.g. ATo folds a
    // 3-bet despite ~45% raw equity vs the field). The reasoning block is postflop-only.
    // A 'raise' cell in a vs-open/squeeze map is a RE-SHOVE (3-bet jam) — the 14-25bb
    // jam-or-fold zone marks jam hands 'raise' (the normal path would use '3bet').
    const isReshoveCrit = rec === 'raise' && (scenario === 'vsopen' || scenario === 'squeeze')
    // MICRO-STACK forced jam: at ≤~7bb the open range widens toward ANY TWO — you're
    // committed (the blinds dwarf your stack), so a trash hand "opens" only because of
    // that widening. That's a desperation jam, NOT a strength open → narrate it honestly
    // (otherwise it reads as the absurd "72s is strong enough to open, folding is a leak").
    const heroEffBB = record.bb > 0 ? effStack / record.bb : 100
    const microJamOpen = (scenario === 'rfi' || scenario === 'iso') && rec === 'raise'
      && heroEffBB <= 7 && handOpenRank(key) > openPctFor(hero.position, playersBehind)
    const recLabel = rec === 'fold' ? 'FOLD'
      : rec === 'call' ? (vsJam ? tc('crit.recCallJam') : tc('crit.recCall'))
      : rec === '3bet' ? (scenario === 'squeeze' ? tc('crit.recSqueeze') : tc('crit.rec3bet'))
      : rec === '4bet' ? (scenario === 'vs4bet' ? tc('crit.rec5betJam') : tc('crit.rec4bet'))
      : isReshoveCrit ? tc('crit.recReshove')
      : microJamOpen ? tc('crit.recMicroJam')
      : scenario === 'iso' ? tc('crit.recIso') : tc('crit.recOpen')
    const from = lastAggressorName ? tc('crit.ctxFrom', { name: lastAggressorName }) : ''
    const ctx = vsJam ? tc('crit.ctxJam', { pos: hero.position, n: numAllIn })
      : scenario === 'rfi' ? tc('crit.ctxRfi', { pos: hero.position })
      : scenario === 'iso' ? tc('crit.ctxIso', { pos: hero.position })
      : scenario === 'vsopen' ? tc('crit.ctxVsopen', { pos: hero.position, from })
      : scenario === 'squeeze' ? tc('crit.ctxSqueeze', { pos: hero.position })
      : scenario === 'vs4bet' ? tc('crit.ctxVs4bet', { pos: hero.position })
      : tc('crit.ctxVs3bet', { pos: hero.position, from })
    lines.push(tc('crit.pfSituation', { ctx, key }))
    lines.push(tc('crit.pfRefRange', { key, rec: recLabel }))
    // For an "open too wide" call, separate a genuine punt from a borderline open
    // that's only a hair outside the range — the latter is a mix, not a leak.
    const openMargin = scenario === 'rfi' ? handOpenRank(key) - openPctFor(hero.position, playersBehind) : 99
    if (heroCat === recCat) { verdict = 'good'; headline = tc('crit.hGood', { rec: recLabel }); lines.push(tc('crit.lGoodPre')) }
    else if (recCat === 'fold' && heroCat === 'aggr' && openMargin <= 12) { verdict = 'ok'; headline = tc('crit.hOpenBorderline'); lines.push(tc('crit.lOpenBorderline', { key, rec: rec === 'fold' ? tc('crit.foldWord') : recLabel })) }
    else if (recCat === 'fold' && heroCat !== 'fold') { verdict = 'mistake'; headline = tc('crit.hTooWide'); lines.push(tc('crit.lTooWide', { key })) }
    else if (recCat === 'aggr' && heroCat === 'passive') { verdict = 'ok'; headline = tc('crit.hTooPassive'); lines.push(tc('crit.lTooPassivePre', { key, rec: recLabel })) }
    else if (recCat === 'aggr' && heroCat === 'fold' && microJamOpen) { verdict = 'ok'; headline = tc('crit.hMicroJamFold'); lines.push(tc('crit.lMicroJamFold', { key, bb: Math.round(heroEffBB) })) }
    else if (recCat === 'aggr' && heroCat === 'fold') { verdict = 'mistake'; headline = tc('crit.hFoldTooTight'); lines.push(tc('crit.lFoldTooTight', { key, rec: recLabel })) }
    else if (recCat === 'passive' && heroCat === 'aggr') { verdict = 'ok'; headline = tc('crit.hOverAggro'); lines.push(tc('crit.lOverAggroPre', { key })) }
    else if (recCat === 'passive' && heroCat === 'fold') { verdict = 'ok'; headline = tc('crit.hFoldSlightlyTight'); lines.push(tc('crit.lFoldSlightlyTight', { key })) }
  } else {
    const villainBets = record.actions.slice(0, actionIdx).filter(a => isAggroAction(a, pfInfo.deadAllIn))
    const postBets = villainBets.filter(a => a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river')
    const barrels = new Set(postBets.map(a => a.phase)).size
    // Distinct opponents who actually bet/raised postflop — only THEY have a polarized
    // value range; cold-callers stay capped, so a multiway pot doesn't crush a strong
    // hand (mirrors the live coach).
    const aggressors = new Set(postBets.map(a => a.seatIdx)).size
    // CAPPED / "delayed" bet: an earlier postflop street was checked through, now hero
    // faces a bet → range capped (strong hands fire earlier) → soften value (mirrors live).
    const postOrder: Phase[] = ['flop', 'turn', 'river']
    const curIdx = postOrder.indexOf(phase)
    const cappedRange = curIdx > 0 && postOrder.slice(0, curIdx).some(st => {
      const acts = record.actions.slice(0, actionIdx).filter(a => a.seatIdx >= 0 && a.phase === st)
      return acts.length > 0 && !acts.some(a => a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN')
    })
    // Size-aware aggression: a BIG bet polarizes the range to value far more than a
    // small one — counting bets alone under-rates a single large turn/river barrel.
    // pot already includes the bet hero faces, so pot-before-bet = pot - toCall.
    const sizeFrac = toCall > 0 && (pot - toCall) > 0 ? toCall / (pot - toCall) : 0
    const sizeBoost = sizeFrac >= 1 ? 0.55 : sizeFrac >= 0.66 ? 0.45 : sizeFrac >= 0.45 ? 0.36 : sizeFrac >= 0.25 ? 0.22 : 0.08
    // Pre-flop pot type already narrows villain to a strong range BEFORE any flop bet:
    // a 3-bet/4-bet pot means premiums (QQ+/AK heavy), so marginal made hands are far
    // weaker than vs a single-raised/limped pot. This is a floor on the equity model's
    // aggression so it doesn't treat the opponent as a random range in a 4-bet pot.
    const preAggr = preflopRaises >= 3 ? 0.6 : preflopRaises === 2 ? 0.4 : 0
    const aggression = Math.min(0.85, Math.max(preAggr, villainBets.length * 0.28, sizeBoost + (barrels - 1) * 0.18))
    const villainTier = preflopRaises >= 3 ? '4bet' as const : preflopRaises === 2 ? '3bet' as const : undefined
    // Call pressure: opponents who called multiple postflop streets (esp. multiway)
    // have a strong range → de-value a lone overpair/one pair (mirrors the live coach).
    const calledStreets = new Set(record.actions.slice(0, actionIdx).filter(a => a.seatIdx >= 0 && !a.isHero && a.actionType === 'CALL' && (a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river')).map(a => a.phase)).size
    const callPressure = Math.min(0.85, calledStreets * 0.25 + (live.length > 2 ? 0.15 : 0))
    // DONK-LEAD (mirrors live): the bettor hero faces is NOT the pre-flop aggressor —
    // a lead/barrel by a passive caller → value-defined range, fold marginal pairs earlier.
    const postAggOpp = postBets.filter(a => a.seatIdx !== hero.idx)
    const lastPostAggressorIdx = postAggOpp.length ? postAggOpp[postAggOpp.length - 1].seatIdx : -1
    const donkLead = toCall > 0 && lastPreflopRaiserIdx >= 0 && lastPostAggressorIdx >= 0 && lastPostAggressorIdx !== lastPreflopRaiserIdx
    // FACING A RAISE (mirrors live): ≥2 aggressive actions on this street → a bet got raised.
    const curStreetAggro = record.actions.slice(0, actionIdx).filter(a => a.phase === phase && (a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN')).length
    const facingRaise = toCall > 0 && curStreetAggro >= 2  // postflop branch only
    // SANDWICH: facing a bet with a LIVE player still to act behind hero this street (their
    // committed bet is below the current bet, so they haven't responded) → hero doesn't close
    // the action. Postflop order: BTN acts last (highest index).
    const dealerIdxP = record.players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
    const nP = record.players.length
    const postOrderP = (s: number) => ((((s - dealerIdxP) % nP + nP) % nP) - 1 + nP) % nP
    const heroPostO = postOrderP(hero.idx)
    const notClosing = toCall > 0 && live.length >= 3 && record.players.some(p =>
      p.idx !== hero.idx && !folded.has(p.idx) && postOrderP(p.idx) > heroPostO && (bet[p.idx] ?? 0) < currentBet)
    const adv = getPostflopAdvice({ hole: [hero.holeCards[0], hero.holeCards[1]], board, pot, toCall, heroStack: heroRemaining, effStack, opponents, inPosition: latePos, aggression, barrels, bb: record.bb, villainTier, aggressors, cappedRange, callPressure, donkLead, facingRaise, notClosing, iters })
    const recAggr = adv.action === 'BET' || adv.action === 'RAISE'
    const recCat: 'fold' | 'passive' | 'aggr' = adv.action === 'FOLD' ? 'fold' : recAggr ? 'aggr' : 'passive'
    recCatOut = recCat
    if (toCall > 0) reasoning = buildEquityReasoning({ hole: [hero.holeCards[0], hero.holeCards[1]], board, pot, toCall, equity: adv.equity,
      decision: adv.action === 'FOLD' ? 'fold' : adv.action === 'CALL' ? 'call' : 'aggro' })
    const phaseLbl = tc(phase === 'flop' ? 'crit.phaseFlop' : phase === 'turn' ? 'crit.phaseTurn' : phase === 'river' ? 'crit.phaseRiver' : 'crit.phasePreflop')
    lines.push(tc('crit.pSituation', { phase: phaseLbl, board: board.map(c => c.rank + c.suit).join(' '), aggr: lastAggressorName && toCall > 0 ? tc('crit.pBetSuffix', { name: lastAggressorName }) : '' }))
    // Facing a bet, the "COMMENT JE RAISONNE" block already spells out equity vs the price in
    // full → don't restate it here, just name the hand. No bet to call → keep the equity note.
    const drawsTxt = adv.draws.length ? tc('crit.pDraws', { draws: adv.draws.join(' + ') }) : ''
    lines.push(toCall > 0
      ? tc('crit.pHandOnly', { made: adv.madeHand, draws: drawsTxt })
      : tc('crit.pEquityHand', { eq: pct(adv.equity), odds: '', made: adv.madeHand, draws: drawsTxt }))
    lines.push(tc('crit.pOptimal', { action: adv.action, sizing: adv.sizingText }))
    adv.reasons.slice(1, 3).forEach(r => lines.push(r))
    if (heroCat === recCat) {
      verdict = 'good'; headline = tc('crit.hGoodPost', { action: adv.action }); lines.push(tc('crit.lGoodPost'))
      // SIZING check on a value BET: the right action category isn't enough — a giant
      // overbet/jam folds out the worse hands you beat (lost value), while a tiny bet
      // under-charges draws. Only when you opened the betting (toCall === 0).
      if (toCall === 0 && adv.action === 'BET' && pot > 0 && (act.actionType === 'BET' || act.actionType === 'ALL-IN' || act.actionType === 'RAISE')) {
        // Size the bet by what can ACTUALLY be called: a jam for more than the biggest
        // live opponent can match is only effectively `effStack` — the excess is returned,
        // never wagered. Judging the raw shove ($47k) as a 172% overbet when only $22k
        // (0.8× pot) is callable is a false "SURBET". Cap at effStack → the real % of pot.
        const betFrac = Math.min(act.amount, effStack) / pot
        const sprNow = effStack / pot
        const isValue = adv.equity >= 0.6
        if (isValue && betFrac > 1.15) {
          verdict = 'ok'; sizing = 'big'; headline = tc('crit.hSizeOverbet')
          lines.push(tc('crit.lSizeOverbet', { pct: Math.round(betFrac * 100), allin: act.actionType === 'ALL-IN' ? tc('crit.pAllinSuffix') : '', tail: sprNow <= 1.8 ? tc('crit.lSizeOverbetLowSpr', { spr: sprNow.toFixed(1) }) : tc('crit.lSizeOverbetHighSpr') }))
        } else if (isValue && betFrac < 0.4) {
          verdict = 'ok'; sizing = 'small'; headline = tc('crit.hSizeTooSmall')
          lines.push(tc('crit.lSizeTooSmall', { pct: Math.round(betFrac * 100) }))
        }
      }
    }
    else if (recCat === 'fold' && heroCat !== 'fold') { verdict = 'mistake'; headline = tc('crit.hContinueTooMuch'); if (toCall <= 0) lines.push(tc('crit.lContinueTooMuch', { eq: pct(adv.equity), odds: pct(adv.potOdds) })) }
    else if (recCat === 'aggr' && heroCat === 'passive') {
      // CHECKING a LOCKED monster (full house+) multiway is a valid slow-play/trap, not
      // a leak: the hand needs no protection (board paired) and betting folds out the
      // air that would otherwise bluff/jam into you. Don't condemn it.
      const monster = adv.madeCat >= 6 // full house, quads or straight flush — locked, language-agnostic
      if (act.actionType === 'CHECK' && monster && opponents >= 2) {
        verdict = 'good'; headline = tc('crit.hSlowplayOK')
        lines.push(tc('crit.lSlowplayOK', { made: adv.madeHand }))
      } else {
        verdict = 'ok'; headline = tc('crit.hTooPassive'); lines.push(tc('crit.lTooPassivePost'))
      }
    }
    else if (recCat === 'aggr' && heroCat === 'fold') { verdict = 'mistake'; headline = tc('crit.hFoldTooMany'); lines.push(tc('crit.lFoldTooMany')) }
    else if (recCat === 'passive' && heroCat === 'aggr') { verdict = 'ok'; headline = tc('crit.hOverAggro'); lines.push(tc('crit.lOverAggroPost')) }
    else if (recCat === 'passive' && heroCat === 'fold') { verdict = 'mistake'; headline = tc('crit.hMissedFold'); lines.push(tc('crit.lMissedFold', { eq: pct(adv.equity), odds: pct(adv.potOdds) })) }
  }
  // Map the verdict to a stable leak bucket for the session perf report. A 'good' move
  // (incl. the slow-play exception) leaks nothing; otherwise the recommended-vs-actual
  // mismatch (or the sizing flag) tells us WHICH leak it is.
  let leak: LeakKind | null = null
  if (verdict !== 'good') {
    if (sizing) leak = sizing === 'big' ? 'sizing-big' : 'sizing-small'
    else if (recCatOut === 'fold' && heroCat !== 'fold') leak = phase === 'preflop' ? 'pf-loose' : 'overcall'
    else if (recCatOut === 'aggr' && heroCat === 'passive') leak = 'passive'
    else if (recCatOut === 'aggr' && heroCat === 'fold') leak = 'overfold'
    else if (recCatOut === 'passive' && heroCat === 'aggr') leak = 'overaggro'
    else if (recCatOut === 'passive' && heroCat === 'fold') leak = 'overfold'
  }
  return { verdict, headline, lines, reasoning, phase, leak }
}

// ─── Session performance report ──────────────────────────────────────────────
// Run the coach critique over EVERY hero decision of the session and aggregate it
// into a graded report: an alignment score, per-street accuracy, the dominant leaks
// and the worst spots to review. Pure data — the modal just renders it.
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']
export function evaluateSession(records: HandHistoryRecord[]): SessionEval {
  const streets: Record<Street, StreetStat> = {
    preflop: { n: 0, good: 0, ok: 0, mistake: 0, acc: 0 }, flop: { n: 0, good: 0, ok: 0, mistake: 0, acc: 0 },
    turn: { n: 0, good: 0, ok: 0, mistake: 0, acc: 0 }, river: { n: 0, good: 0, ok: 0, mistake: 0, acc: 0 },
  }
  const leakCounts = new Map<LeakKind, number>()
  const flagged: SessionMistake[] = []
  let good = 0, ok = 0, mistake = 0, decisions = 0
  for (const rec of records) {
    for (let i = 0; i < rec.actions.length; i++) {
      const a = rec.actions[i]
      if (a.seatIdx < 0 || !a.isHero) continue
      // Lighter Monte-Carlo for the batch — dozens of spots, accuracy is plenty at ~900.
      const c = critiqueHeroMove(rec, i, 900)
      if (!c) continue
      const ph = (c.phase ?? a.phase) as Phase
      if (ph !== 'preflop' && ph !== 'flop' && ph !== 'turn' && ph !== 'river') continue
      decisions++
      const s = streets[ph]; s.n++
      if (c.verdict === 'good') { good++; s.good++ }
      else if (c.verdict === 'ok') { ok++; s.ok++ }
      else { mistake++; s.mistake++ }
      if (c.leak) leakCounts.set(c.leak, (leakCounts.get(c.leak) ?? 0) + 1)
      if (c.verdict !== 'good') flagged.push({ handId: rec.id, handNum: rec.handNum, actionIdx: i, phase: ph, headline: c.headline, leak: c.leak ?? null, verdict: c.verdict })
    }
  }
  // Alignment with the coach: a 'good' move scores full, an 'ok' (right idea, wrong
  // sizing / a touch off) scores half, a 'mistake' scores zero.
  const score = decisions ? Math.round(((good + ok * 0.5) / decisions) * 100) : 100
  const grade: SessionEval['grade'] = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 68 ? 'B' : score >= 55 ? 'C' : 'D'
  STREETS.forEach(k => { const s = streets[k]; s.acc = s.n ? (s.good + s.ok * 0.5) / s.n : 0 })
  const leaks = [...leakCounts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
  // Best / worst street need a meaningful sample (≥3 decisions) to call out.
  const rated = STREETS.filter(k => streets[k].n >= 3)
  const worstStreet = rated.length ? rated.reduce((w, k) => streets[k].acc < streets[w].acc ? k : w) : null
  const bestStreet = rated.length ? rated.reduce((b, k) => streets[k].acc > streets[b].acc ? k : b) : null
  // Mistakes first, then sizing/borderline 'ok's. Show ALL flagged spots (the modal
  // scrolls) so nothing is hidden — a capped list silently dropped real mistakes.
  const topMistakes = flagged.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'mistake' ? -1 : 1))
  return { score, grade, decisions, good, ok, mistake, streets, leaks, worstStreet, bestStreet: worstStreet === bestStreet ? null : bestStreet, topMistakes }
}

// Replay the hand up to `stepIdx` through the range estimator → each player's
// estimated range at that moment (for the history hover, same engine as in-game).
export function reconstructRanges(record: HandHistoryRecord, stepIdx: number): Record<number, RangeWeights> {
  const ranges: Record<number, RangeWeights> = {}
  record.players.forEach(p => { ranges[p.idx] = initRange() })
  let currentBet = 0, pot = 0, preRaises = 0
  const bet: Record<number, number> = {}
  record.players.forEach(p => { bet[p.idx] = 0 })
  for (let i = 0; i <= stepIdx && i < record.actions.length; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) {
      if (a.phase !== 'preflop') { record.players.forEach(p => (bet[p.idx] = 0)); currentBet = 0; preRaises = 0 }
      pot = a.potAfter
      continue
    }
    const p = record.players.find(x => x.idx === a.seatIdx)
    if (!p) continue
    if (a.actionType !== 'SB' && a.actionType !== 'BB') {
      const preflop = a.phase === 'preflop'
      const board = boardForPhase(record.board, a.phase)
      const toCall = Math.max(0, currentBet - (bet[a.seatIdx] ?? 0))
      const cat: ActCat = a.actionType === 'FOLD' ? 'fold' : a.actionType === 'CHECK' ? 'check' : a.actionType === 'CALL' ? 'call' : 'aggr'
      ranges[a.seatIdx] = applyAction(ranges[a.seatIdx] ?? initRange(board), cat, {
        preflop, board, toCall, potOdds: toCall > 0 ? toCall / (pot + toCall) : 0,
        posBonus: POS_BONUS[p.position] ?? 0.75,
        tier: Math.max(1, Math.min(3, p.level)),
        human: p.seatType === 'human', mood: 0,
        priorRaises: preRaises,
        // size of a BET or RAISE as a fraction of the pot → a big size polarizes the
        // read, a small one merges it.
        betFrac: !preflop && cat === 'aggr' && pot > 0 ? a.amount / pot : undefined,
        // Same price signal as the live table (see trackRange) so the replay's ranges match.
        priceBB: preflop && record.bb > 0 ? toCall / record.bb : 0,
      })
    }
    if (a.actionType === 'FOLD') { /* stays */ }
    else if (a.actionType !== 'CHECK') { bet[a.seatIdx] = a.amount; if (a.amount > currentBet) currentBet = a.amount; pot = a.potAfter }
    if (a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN') preRaises++
  }
  return ranges
}

// Short "move + effect" summary of a player's latest action up to a step.
export function playerLastMeta(record: HandHistoryRecord, idx: number, stepIdx: number): { move: string; effect: string } {
  let last: HistoryAction | null = null, numCallers = 0, raises = 0
  for (let i = 0; i <= stepIdx && i < record.actions.length; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) { if (a.phase !== 'preflop') { numCallers = 0; raises = 0 } continue }
    if (a.actionType === 'CALL') numCallers++
    if (a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN') raises++
    if (a.seatIdx === idx && a.actionType !== 'SB' && a.actionType !== 'BB') last = a
  }
  if (!last) return { move: '—', effect: i18n.t('xtra.notSpokenYet') as string }
  const cat: ActCat = last.actionType === 'FOLD' ? 'fold' : last.actionType === 'CHECK' ? 'check' : last.actionType === 'CALL' ? 'call' : 'aggr'
  return actionSummary(cat, { preflop: last.phase === 'preflop', numCallers, was3betPlus: cat === 'aggr' && raises >= 2 })
}
