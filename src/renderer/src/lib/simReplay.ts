// ─────────────────────────────────────────────────────────────────────────────
// "Watch the coach play a tournament" — runs ONE single-table tournament with the
// real coach brain vs the configured bots, and RECORDS every hand as a faithful
// HandHistoryRecord. Those records feed the SAME replay / critique / range-evolution
// UI as the live game, so each hand is fully analysable. The aggregate sim engine
// (simEngine.playTournament) only measures outcomes; this one keeps the full story.
// ─────────────────────────────────────────────────────────────────────────────
import type { HandHistoryRecord, HistoryAction } from '../pages/GamePage'
import { playHand, type SimSeat, type HandState, type BlindLevel } from './simEngine'
import { makeSimDecider } from './simDeciders'
import { fieldRemaining } from './tournament'
import type { Card } from './rangeEstimator'

// HandHistoryRecord uses GamePage's Card (suit is a glyph union); our deck cards are
// structurally identical (suit: string) — a safe cast at the boundary.
type RecCard = HandHistoryRecord['board'][number]
const rc = (c: Card | null | undefined): RecCard => (c ?? null) as unknown as RecCard

const BOT_NAMES: Record<number, string[]> = {
  1: ['Fish Bob', 'Calling Carl', 'Loose Lou', 'Passive Pete', 'Rookie Ray', 'Avg Joe', 'Basic Ben', 'Lucky Luke'],
  2: ['Solid Steve', 'Tag Mike', 'Thinking Tim', 'Steady Sam', 'Range Rita', 'Poker Pat', 'Sharp Shawn', 'Pro Paul'],
  3: ['GTO Greg', 'Solver Sven', 'Exploit Ed', 'Optimal Opus', 'Smart Sara', 'PIO Master', 'Balanced Bo', 'Semi-Pro Kim'],
}

export interface SimTourConfig {
  players: { kind: 'coach' | 'bot'; tier: number }[]
  startStack: number
  levels: BlindLevel[]
  handsPerLevel: number
  numTables?: number       // >1 → multi-table tournament (field = numTables × players)
  maxHands?: number
  coachName?: string
}
export interface SimTourResult {
  place: number            // 1 = winner of the field
  totalPlayers: number     // the whole field (numTables × players)
  hands: number            // hands the coach was dealt into
  coachProfit: number      // final chips − start chips (negative if busted)
  busted: boolean
  records: HandHistoryRecord[]
  stackTimeline: number[]  // coach stack after each of its hands (for a chart)
}

// Blind structure from a chosen STARTING big blind (same escalation as the sim page).
export function buildLevels(startBB: number): BlindLevel[] {
  const lv: BlindLevel[] = []
  let bb = Math.max(2, Math.round(startBB / 5) * 5 || 2)
  for (let i = 0; i < 30; i++) {
    lv.push({ sb: Math.max(1, Math.round(bb / 2)), bb, ante: i >= 2 ? Math.max(1, Math.round(bb / 8)) : 0 })
    bb = Math.max(bb + 5, Math.round((bb * 1.4) / 5) * 5)
  }
  return lv
}

// A hand is worth surfacing if there was real action the coach took part in — it saw
// a flop without folding pre, OR the coach put in a raise/3-bet/jam (even if it took
// it down pre). Fold-arounds and limped blind walks are filtered out.
export function isInterestingHand(rec: HandHistoryRecord): boolean {
  const coach = rec.players.find(p => p.isHero)
  if (!coach) return false
  const acts = rec.actions.filter(a => a.seatIdx === coach.idx)
  const coachFoldedPre = acts.some(a => a.phase === 'preflop' && a.actionType === 'FOLD')
  const coachAggro = acts.some(a => a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN')
  const sawFlop = (rec.board.filter(Boolean).length >= 3) && !coachFoldedPre && acts.length > 0
  return coachAggro || sawFlop
}

// ── Per-hand recorder: HandState (+ snapshots) → faithful HandHistoryRecord ───────
function buildRecord(
  handNum: number, seats: SimSeat[], hs: HandState, buttonIdx: number,
  startStacks: Record<number, number>, names: Record<number, string>,
  sb: number, bb: number, ante: number,
): HandHistoryRecord {
  const dealt = seats.filter(s => s.hole) // only seats that were dealt this hand
  const nameOf = (id: number) => names[id] ?? `Seat ${id}`
  const isHero = (id: number) => seats.find(s => s.id === id)?.kind === 'coach'

  // Running pot reconstruction (mirrors the live recorder so the replay/critique math
  // lines up exactly): antes are collected immediately; blinds + bets are "this street"
  // until a street marker collects them into the pot. The engine posts the ANTE first
  // (capped at stack), THEN the blind (capped at what's left) — so a short stack that's
  // all-in across ante+blind pays a partial ante and a partial/zero blind. We replicate
  // that exactly, otherwise the reconstructed pot drifts by the ante on those hands.
  const antePaid = (id: number) => (ante > 0 ? Math.min(ante, startStacks[id] ?? 0) : 0)
  let collected = dealt.reduce((sum, s) => sum + antePaid(s.id), 0)
  const curBet: Record<number, number> = {}
  const sumCur = () => Object.values(curBet).reduce((a, b) => a + b, 0)
  const out: HistoryAction[] = []
  const marker = (phase: 'preflop' | 'flop' | 'turn' | 'river') =>
    out.push({ phase, seatIdx: -1, name: '', isHero: false, actionType: phase, amount: 0, potAfter: collected })

  marker('preflop')
  // Blinds — find the SB/BB seats EXACTLY like the engine does (don't trust position
  // labels: heads-up labels the button 'BTN' even though it posts the small blind).
  // ordered = dealt seats walking from the button; SB = ordered[0] heads-up else [1].
  const ordered: SimSeat[] = []
  for (let k = 0; k < seats.length; k++) { const s = seats[(buttonIdx + k) % seats.length]; if (dealt.includes(s)) ordered.push(s) }
  const sbSeat = ordered.length === 2 ? ordered[0] : ordered[1]
  const bbSeat = ordered.length === 2 ? ordered[1] : ordered[2]
  const postBlind = (s: SimSeat | undefined, amt: number, label: 'SB' | 'BB') => {
    if (!s) return
    const a = Math.max(0, Math.min(amt, (startStacks[s.id] ?? amt) - antePaid(s.id)))
    curBet[s.id] = a
    out.push({ phase: 'preflop', seatIdx: s.id, name: nameOf(s.id), isHero: isHero(s.id), actionType: label, amount: a, potAfter: collected + sumCur() })
  }
  postBlind(sbSeat, sb, 'SB')
  postBlind(bbSeat, bb, 'BB')

  let street: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop'
  for (const a of hs.actions) {
    if (a.street !== street) {
      collected += sumCur()
      for (const k of Object.keys(curBet)) delete curBet[+k]
      street = a.street as typeof street
      marker(street)
    }
    if (a.type === 'FOLD' || a.type === 'CHECK') {
      out.push({ phase: street, seatIdx: a.id, name: nameOf(a.id), isHero: isHero(a.id), actionType: a.type, amount: 0, potAfter: collected + sumCur() })
    } else {
      curBet[a.id] = a.amount // a.amount = cumulative bet-to this street
      out.push({ phase: street, seatIdx: a.id, name: nameOf(a.id), isHero: isHero(a.id), actionType: a.type, amount: a.amount, potAfter: collected + sumCur() })
    }
  }

  // ALL-IN run-out: the engine deals the remaining board with NO betting, so no street
  // marker was emitted for it — the replay (driven by markers) would then never reveal
  // the board. Emit the missing markers for every street the board actually reached, in
  // order, so the run-out board shows up exactly like a normal showdown.
  const marked = new Set(out.filter(o => o.seatIdx === -1).map(o => o.phase))
  const reachedStreets = (['flop', 'turn', 'river'] as const).filter((_st, i) => hs.board.length >= 3 + i)
  for (const st of reachedStreets) {
    if (marked.has(st)) continue
    collected += sumCur(); for (const k of Object.keys(curBet)) delete curBet[+k]
    marker(st)
  }

  const finalPot = dealt.reduce((s, x) => s + x.totalBet, 0)
  const board5: (Card | null)[] = [0, 1, 2, 3, 4].map(i => hs.board[i] ?? null)
  const coach = dealt.find(s => s.kind === 'coach')
  // heroProfit is stored in BIG BLINDS (like the live recorder), not chips.
  const heroProfit = coach && bb > 0 ? Math.round(((coach.stack - (startStacks[coach.id] ?? coach.stack)) / bb) * 10) / 10 : 0

  return {
    id: handNum, handNum, date: new Date(),
    players: dealt.map(s => ({
      idx: s.id, name: nameOf(s.id), isHero: s.kind === 'coach', position: s.position,
      startStack: startStacks[s.id] ?? s.stack, endStack: s.stack,
      holeCards: [rc(s.hole?.[0]), rc(s.hole?.[1])] as HandHistoryRecord['players'][number]['holeCards'],
      isFolded: s.folded, isWinner: !!hs.winners?.has(s.id),
      level: s.kind === 'coach' ? 0 : s.tier, seatType: s.kind === 'coach' ? 'human' : 'bot',
    })),
    board: board5.map(rc), actions: out,
    finalPot, sb, bb,
    heroProfit, winnerNames: [...(hs.winners ?? [])].map(nameOf),
  }
}

// ── Tournament with full recording — single-table OR multi-table (MTT field model) ──
export function simulateTournament(cfg: SimTourConfig): SimTourResult {
  const tableSize = cfg.players.length
  const numTables = Math.max(1, cfg.numTables ?? 1)
  const seats: SimSeat[] = cfg.players.map((p, i) => ({
    id: i, stack: cfg.startStack, kind: p.kind, tier: p.tier, hole: null,
    bet: 0, totalBet: 0, folded: false, allIn: false, position: '', inHand: true,
  }))
  const coachId = cfg.players.findIndex(p => p.kind === 'coach')
  const coachTier = (cfg.players.find(p => p.kind === 'bot')?.tier) ?? 2
  const names: Record<number, string> = {}
  // (Re)assign opponent names — called once for a single table, and on each rebalance
  // in MTT mode (new table = fresh opponents = fresh names).
  function nameOpponents() {
    const pool = BOT_NAMES[coachTier] ?? BOT_NAMES[2]
    let k = 0
    for (const s of seats) {
      if (s.kind === 'coach') { names[s.id] = cfg.coachName || 'Coach'; continue }
      names[s.id] = pool[k % pool.length] + (k >= pool.length ? ' ' + (Math.floor(k / pool.length) + 1) : '')
      k++
    }
  }
  nameOpponents()

  const decider = makeSimDecider(seats)
  const records: HandHistoryRecord[] = []
  const stackTimeline: number[] = []
  const maxHands = cfg.maxHands ?? 12000
  let buttonIdx = 0, hands = 0
  const levelAt = (h: number) => cfg.levels[Math.min(cfg.levels.length - 1, Math.floor(h / cfg.handsPerLevel))]

  // Play one hand at the coach's table, recording it if the coach was dealt in.
  const playAndRecord = (lvl: BlindLevel) => {
    do { buttonIdx = (buttonIdx + 1) % seats.length } while (!seats[buttonIdx].inHand || seats[buttonIdx].stack <= 0)
    const startStacks: Record<number, number> = {}
    seats.forEach(s => (startStacks[s.id] = s.stack))
    const coachWasIn = seats[coachId]?.inHand && seats[coachId].stack > 0
    const hs = playHand(seats, buttonIdx, lvl.sb, lvl.bb, lvl.ante, decider)
    hands++
    if (hs && coachWasIn) {
      records.push(buildRecord(records.length + 1, seats, hs, buttonIdx, startStacks, names, lvl.sb, lvl.bb, lvl.ante))
      stackTimeline.push(seats[coachId].stack)
    }
    return hs
  }

  // ── SINGLE TABLE ─────────────────────────────────────────────────────────────
  if (numTables <= 1) {
    const finishOrder: number[] = []
    while (seats.filter(s => s.inHand).length > 1 && hands < maxHands) {
      playAndRecord(levelAt(hands))
      for (const s of seats.filter(s => s.inHand && s.stack <= 0)) { s.inHand = false; finishOrder.push(s.id) }
    }
    finishOrder.push(...seats.filter(s => s.inHand).map(s => s.id))
    const place = seats.length - finishOrder.indexOf(coachId)
    return { place, totalPlayers: tableSize, hands: records.length, coachProfit: seats[coachId].stack - cfg.startStack, busted: seats[coachId].stack <= 0, records, stackTimeline }
  }

  // ── MULTI-TABLE (MTT) — fully simulate the coach's table, model the field's attrition
  //    (rebalancing the coach to fresh tables at the field's median depth) until the final
  //    table, which is played to a winner. Mirrors simEngine.playMTT, but recording. ──
  const field = tableSize * numTables
  const coach = seats[coachId]
  let fieldAlive = field
  // Rebalance: reseat the coach (keeps its stack) at a fresh table of opponents drawn at
  // the field's typical depth (median < mean), and give them fresh names.
  const reseat = () => {
    const median = (field * cfg.startStack / Math.max(1, fieldAlive)) * 0.5
    for (const s of seats) {
      s.hole = null; s.bet = 0; s.totalBet = 0; s.folded = false; s.allIn = false; s.inHand = true
      if (s.id !== coach.id) { s.stack = Math.max(cfg.startStack * 0.15, Math.round(median * (0.35 + Math.random() * 1.3))); s.tier = coachTier }
    }
    nameOpponents()
  }

  while (hands < maxHands && coach.stack > 0) {
    fieldAlive = Math.min(fieldAlive, Math.max(1, fieldRemaining(field, hands / cfg.handsPerLevel)))
    if (fieldAlive <= tableSize) {
      // FINAL TABLE
      reseat()
      const ftSize = Math.max(2, Math.round(fieldAlive))
      for (const s of seats) if (s.id !== coach.id && seats.filter(x => x.inHand).length > ftSize) s.inHand = false
      const finish: number[] = []
      while (seats.filter(s => s.inHand).length > 1 && hands < maxHands) {
        playAndRecord(levelAt(hands))
        for (const s of seats) if (s.inHand && s.stack <= 0) { s.inHand = false; finish.push(s.id) }
      }
      finish.push(...seats.filter(s => s.inHand).map(s => s.id))
      const ftCount = Math.min(ftSize, seats.length)
      const place = Math.max(1, ftCount - finish.indexOf(coach.id))
      return { place, totalPlayers: field, hands: records.length, coachProfit: coach.stack - cfg.startStack, busted: coach.stack <= 0, records, stackTimeline }
    }
    // REGULAR PHASE: chip-conserved table down to short-handed, then rebalance.
    reseat()
    const breakAt = Math.max(2, Math.ceil(tableSize / 2))
    while (seats.filter(s => s.inHand).length > breakAt && coach.stack > 0 && hands < maxHands) {
      fieldAlive = Math.min(fieldAlive, Math.max(1, fieldRemaining(field, hands / cfg.handsPerLevel)))
      if (fieldAlive <= tableSize) break
      playAndRecord(levelAt(hands))
      for (const s of seats) if (s.inHand && s.stack <= 0) s.inHand = false
    }
    if (coach.stack <= 0) return { place: Math.round(fieldAlive), totalPlayers: field, hands: records.length, coachProfit: -cfg.startStack, busted: true, records, stackTimeline }
  }
  return { place: Math.max(1, Math.round(fieldAlive)), totalPlayers: field, hands: records.length, coachProfit: coach.stack - cfg.startStack, busted: coach.stack <= 0, records, stackTimeline }
}
