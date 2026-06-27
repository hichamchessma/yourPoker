// ─── Pure poker engine core ────────────────────────────────────────────────
// The deterministic, side-effect-free heart of the LIVE game (hand evaluation,
// side pots, and bet/raise resolution incl. the incomplete-raise rule). Extracted
// from GamePage so it can be unit-tested directly by tools/engine-bench.ts — the
// live game delegates to these exact functions, so the bench tests the real code.
// NO React / i18n / asset imports here: keep it importable from a plain node harness.
import type { Card } from './postflopAdvisor'

export const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
}

// ── Hand evaluation ─────────────────────────────────────────────────────────
export function combos5(arr: Card[]): Card[][] {
  if (arr.length < 5) return []
  const r: Card[][] = []
  function go(start: number, cur: Card[]) {
    if (cur.length === 5) { r.push([...cur]); return }
    for (let i = start; i <= arr.length - (5 - cur.length); i++) go(i + 1, [...cur, arr[i]])
  }
  go(0, []); return r
}

// Score a 5-card hand. Higher = better; the score encodes category then kickers so
// raw numeric comparison is a full hand comparison. Category = Math.floor(score/15**5).
export function evalFive(cards: Card[]): number {
  const rv = cards.map(c => RANK_VAL[c.rank] ?? 2)
  const sv = cards.map(c => c.suit)
  const isF = sv.every(s => s === sv[0])
  const u = [...new Set(rv)].sort((a, b) => b - a)
  const wheel = u.length === 5 && u[0] === 14 && u[1] === 5 && u[2] === 4 && u[3] === 3 && u[4] === 2
  const isS = (u.length === 5 && u[0] - u[4] === 4) || wheel
  const cnt: Record<number, number> = {}; rv.forEach(r => cnt[r] = (cnt[r] ?? 0) + 1)
  const cv = Object.values(cnt).sort((a, b) => b - a)
  let rank = 0
  if (isF && isS) rank = 8; else if (cv[0] === 4) rank = 7; else if (cv[0] === 3 && cv[1] === 2) rank = 6
  else if (isF) rank = 5; else if (isS) rank = 4; else if (cv[0] === 3) rank = 3
  else if (cv[0] === 2 && cv[1] === 2) rank = 2; else if (cv[0] === 2) rank = 1
  // Straights compare on their high card (wheel A-2-3-4-5 is 5-high).
  if (isS) return rank * 15 ** 5 + (wheel ? 5 : u[0])
  // Tiebreak ordered by GROUP SIZE first (pairs/trips), then rank — so a pair always
  // outranks a higher kicker (fixes "QQJJ7 vs QQ55A" type comparisons).
  const tb: number[] = []
  Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a).forEach(r => { for (let i = 0; i < cnt[r]; i++) tb.push(r) })
  return rank * 15 ** 5 + (tb[0] ?? 0) * 15 ** 4 + (tb[1] ?? 0) * 15 ** 3 + (tb[2] ?? 0) * 15 ** 2 + (tb[3] ?? 0) * 15 + (tb[4] ?? 0)
}

// Best 5-card score (and its category index) from 2..7 cards. The caller maps the
// category to a localized label; the engine stays i18n-free.
export function bestHandScore(cards: Card[]): { score: number; cat: number } {
  const valid = cards.filter(Boolean) as Card[]
  if (valid.length < 2) return { score: 0, cat: 0 }
  if (valid.length < 5) {
    const pad = [...valid, ...Array(5 - valid.length).fill({ rank: '2', suit: '♠' })]
    const s = evalFive(pad); return { score: s, cat: Math.floor(s / 15 ** 5) }
  }
  let best = 0
  for (const c of combos5(valid)) { const s = evalFive(c); if (s > best) best = s }
  return { score: best, cat: Math.floor(best / 15 ** 5) }
}

// ── Side pots ───────────────────────────────────────────────────────────────
export interface PotSeat { idx: number; totalBet: number; isFolded: boolean }
// Split the total committed chips into the main pot + side pots, layering by each
// player's total contribution. Folded players' chips stay in the pots (dead money)
// but they are never eligible to win. Returns pots ordered main → outermost side.
export function computeSidePots(seats: PotSeat[]): { amount: number; eligible: number[] }[] {
  const pots: { amount: number; eligible: number[] }[] = []
  const pool = seats.filter(s => s.totalBet > 0).map(s => ({ idx: s.idx, amount: s.totalBet, folded: s.isFolded }))
  while (pool.length > 0) {
    const min = Math.min(...pool.map(p => p.amount))
    const potAmt = min * pool.length
    const eligible = pool.filter(p => !p.folded).map(p => p.idx)
    pots.push({ amount: potAmt, eligible })
    for (let i = pool.length - 1; i >= 0; i--) { pool[i].amount -= min; if (pool[i].amount === 0) pool.splice(i, 1) }
  }
  return pots.filter(p => p.amount > 0 && p.eligible.length > 0)
}

// ── Bet / raise resolution + the incomplete-raise rule ──────────────────────
export type ActionType = 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL-IN'
export interface BetSeat { bet: number; stack: number; totalBet: number; actedLevel?: number; isFolded?: boolean }
export interface BetTable { currentBet: number; minRaise: number; raiseLevel?: number }
export interface BetResult {
  bet: number; stack: number; totalBet: number; actedLevel: number
  isFolded: boolean; isAllIn: boolean
  currentBet: number; minRaise: number; raiseLevel: number
  committed: number          // chips this seat just put in (pot delta)
  action: ActionType         // the EFFECTIVE base action (after any demotion)
  lastAction: string         // display/record label, e.g. "RAISE $300", "ALL-IN", "CALL"
  amount: number             // recorded amount (cumulative street bet for commits; raw for fold/check)
}

// Has the action been re-opened to this seat? Re-raising is legal only if the seat
// isn't facing a bet, OR a FULL raise has happened since it last acted this street.
export function isReopened(table: BetTable, seat: BetSeat): boolean {
  const facingBet = table.currentBet > seat.bet
  if (!facingBet) return true
  return (table.raiseLevel ?? 0) > (seat.actedLevel ?? -1)
}

// Resolve one action against the table. PURE: returns the new seat/table values plus
// the effective action. Enforces the incomplete-raise rule — a player facing a bet whose
// action isn't re-opened may only call/fold, so an illegal bet/raise (or an all-in for
// MORE than the call) is DEMOTED to a plain call. A FULL bet/raise bumps the raise level
// (re-opening for everyone); an under-raise all-in does not.
export function resolveAction(seat: BetSeat, action: string, rawAmount: number, table: BetTable): BetResult {
  let bet = seat.bet, stack = seat.stack, totalBet = seat.totalBet
  let newBet = table.currentBet, newMinRaise = table.minRaise
  let isFolded = !!seat.isFolded, isAllIn = false
  let committed = 0

  // Incomplete-raise rule: demote an illegal aggressive action to a call.
  const facingBet = table.currentBet > bet
  const reopened = (table.raiseLevel ?? 0) > (seat.actedLevel ?? -1)
  let act: ActionType = action as ActionType
  if (facingBet && !reopened) {
    if (act === 'BET' || act === 'RAISE') act = 'CALL'
    else if (act === 'ALL-IN' && bet + stack > table.currentBet) act = 'CALL'
  }

  let lastAction: string = act
  let amount = rawAmount

  if (act === 'FOLD') {
    isFolded = true
  } else if (act === 'CHECK') {
    // no chips move
  } else if (act === 'CALL') {
    const toCall = Math.min(table.currentBet - bet, stack)
    stack -= toCall; bet += toCall; totalBet += toCall; committed += toCall
    amount = bet
    if (stack === 0) { isAllIn = true; lastAction = 'ALL-IN' }
  } else if (act === 'BET' || act === 'RAISE') {
    const minTo = table.currentBet + table.minRaise
    const maxTo = bet + stack
    let target = Math.round(rawAmount)
    if (target < minTo) target = minTo
    if (target > maxTo) target = maxTo
    const add = target - bet
    stack -= add; bet = target; totalBet += add; committed += add
    amount = target
    newBet = Math.max(table.currentBet, target)
    const inc = newBet - table.currentBet
    if (inc > newMinRaise) newMinRaise = inc
    if (stack === 0) { isAllIn = true; lastAction = 'ALL-IN' }
    else lastAction = (act === 'BET' ? 'BET $' : 'RAISE $') + target
  } else if (act === 'ALL-IN') {
    const add = stack
    stack = 0; bet += add; totalBet += add; committed += add
    amount = bet
    if (bet > newBet) {
      const inc = bet - table.currentBet
      if (inc > newMinRaise) newMinRaise = inc
      newBet = bet
    }
    isAllIn = true; lastAction = 'ALL-IN'
  }

  if (!isFolded && stack <= 0) isAllIn = true

  // Re-open tracking: a FULL bet/raise (increment ≥ the prior min-raise) bumps the
  // raise level; an incomplete all-in (or a demoted call) does not.
  let raiseLevel = table.raiseLevel ?? 0
  let actedLevel = seat.actedLevel ?? -1
  if (act !== 'FOLD') {
    const raisedBy = newBet - table.currentBet
    if (raisedBy > 0 && raisedBy >= table.minRaise) raiseLevel += 1
    actedLevel = raiseLevel
  }

  return { bet, stack, totalBet, actedLevel, isFolded, isAllIn, currentBet: newBet, minRaise: newMinRaise, raiseLevel, committed, action: act, lastAction, amount }
}
