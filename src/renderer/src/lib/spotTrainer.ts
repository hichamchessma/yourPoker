// ─────────────────────────────────────────────────────────────────────────────
// "Lecture de spot" trainer — generates CLEAN, instructive postflop situations
// and derives the 4 questions (texture · board favor · equity · bucket) from the
// SAME engine the live coach uses (diagnoseSpot / rangeEquity), so the correct
// answers always match what the in-game coach would conclude.
//
// v1 keeps spots simple & unambiguous: single-raised pot, heads-up or 3-way, an
// unpaired non-monotone flop, and a hand that falls cleanly into ONE of the four
// boxes (AIR · VALUE · BLUFF-CATCH · DRAW). Rejection sampling + quality gates
// guarantee the spot is textbook, never borderline noise.
// ─────────────────────────────────────────────────────────────────────────────

import { diagnoseSpot, rangeEquity, getPostflopAdvice, type Card, type HandBucket, type SpotDiagnosis, type Advice, type AdviceAction } from './postflopAdvisor'
import i18n from '../i18n'

export type SpotContext = 'cash' | 'mtt'

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS = ['♠', '♥', '♦', '♣']
const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const NAMES = ['Tag Mike', 'Solid Steve', 'Sharp Shawn', 'Range Rita', 'Poker Pat', 'Thinking Tim', 'Steady Sam', 'Pro Paul']

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

function handKey(a: Card, b: Card): string {
  if (a.rank === b.rank) return a.rank + b.rank
  const hi = RV[a.rank] >= RV[b.rank] ? a : b
  const lo = RV[a.rank] >= RV[b.rank] ? b : a
  return hi.rank + lo.rank + (a.suit === b.suit ? 's' : 'o')
}

export type Favor = 'hero' | 'villain' | 'neutral'
export type TextureKind = 'dry' | 'semi' | 'wet' | 'paired'

export interface TrainerSeat {
  name: string; pos: string; isHero: boolean
  stackBB: number; committed: number   // committed = chips in the pot this hand (display)
  holeShown?: [Card, Card]             // only the hero's cards are shown face-up
}
export interface TrainerSpot {
  context: SpotContext
  hero: { c1: Card; c2: Card; key: string }
  board: Card[]                        // 3-card flop (v1)
  seats: TrainerSeat[]
  pot: number                          // in chips
  bb: number
  heroPos: string
  heroIsPFR: boolean
  opponents: number
  story: string
  // ── derived answers ──
  diag: SpotDiagnosis
  equity: number                       // 0..1, hero vs the live range(s)
  favor: Favor
  texture: TextureKind
}

// Board favors the PRE-FLOP RAISER (high cards) or the CALLER (low/connected).
function boardFavor(board: Card[], heroIsPFR: boolean): Favor {
  const flop = board.slice(0, 3).map(c => RV[c.rank])
  const top = Math.max(...flop)
  let pfrFav: 'pfr' | 'caller' | 'neutral'
  if (top >= 12) pfrFav = 'pfr'          // Q/K/A high → raiser's broadways & big pairs
  else if (top <= 9) pfrFav = 'caller'   // 9-high or lower → caller's connectors / small pairs
  else pfrFav = 'neutral'                // T/J high → contested
  if (pfrFav === 'neutral') return 'neutral'
  return (pfrFav === 'pfr') === heroIsPFR ? 'hero' : 'villain'
}

function textureOf(diag: SpotDiagnosis): TextureKind {
  if (diag.paired) return 'paired'
  return diag.wetness >= 0.5 ? 'wet' : diag.wetness >= 0.25 ? 'semi' : 'dry'
}

// Equity band index 0..3 for "≤25 / 26-45 / 46-65 / >65".
export const EQ_BANDS = [
  { id: 'b0', label: '≤ 25 %', lo: 0, hi: 0.25 },
  { id: 'b1', label: '26 – 45 %', lo: 0.25, hi: 0.45 },
  { id: 'b2', label: '46 – 65 %', lo: 0.45, hi: 0.65 },
  { id: 'b3', label: '> 65 %', lo: 0.65, hi: 1.01 },
]
export function eqBandIndex(eq: number): number {
  return EQ_BANDS.findIndex(b => eq >= b.lo && eq < b.hi)
}

// Quality gate per target bucket → keep only clearly-instructive spots (not a
// 50/50 that could be argued either way), and keep the equity well inside a band.
function passesQuality(target: HandBucket, eq: number): boolean {
  // reject equities within 3% of a band boundary (the equity answer must be clean)
  for (const b of EQ_BANDS) if (Math.abs(eq - b.hi) < 0.03 && b.hi < 1) return false
  if (target === 'value') return eq >= 0.6
  if (target === 'air') return eq <= 0.34
  if (target === 'draw') return eq >= 0.2 && eq <= 0.52
  return eq >= 0.32 && eq <= 0.62 // bluffcatch — genuinely beats bluffs, loses to value
}

function dealRandomSpot(): { hole: [Card, Card]; board: Card[] } {
  const deck: Card[] = []
  for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s })
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]] }
  return { hole: [deck[0], deck[1]], board: [deck[2], deck[3], deck[4]] }
}

function boardIsClean(board: Card[]): boolean {
  const ranks = board.map(c => c.rank)
  if (new Set(ranks).size !== 3) return false               // unpaired flop
  const suitCount: Record<string, number> = {}
  board.forEach(c => (suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1))
  if (Math.max(...Object.values(suitCount)) >= 3) return false // not monotone
  return true
}

function buildSeats(context: SpotContext, hero: { c1: Card; c2: Card }, heroIsPFR: boolean, opponents: number, bb: number):
  { seats: TrainerSeat[]; heroPos: string; story: string; pot: number } {
  const stackBB = context === 'mtt' ? 25 + Math.floor(Math.random() * 36) : 100 // MTT 25-60bb, cash 100bb
  const names = [...NAMES].sort(() => Math.random() - 0.5)
  const seats: TrainerSeat[] = []
  // Late open vs blind defense — kept deliberately simple & realistic for v1.
  const heroPos = heroIsPFR ? pick(['CO', 'BTN', 'HJ']) : 'BB'
  const oppPos = heroIsPFR ? (opponents === 2 ? ['BB', 'SB'] : ['BB']) : (opponents === 2 ? [pick(['CO', 'BTN']), 'SB'] : [pick(['UTG', 'MP', 'CO', 'BTN'])])
  const open = 2.5, callAmt = 2.5
  // committed chips (in bb units → chips)
  const heroCommit = (heroIsPFR ? open : callAmt) * bb
  seats.push({ name: 'Toi', pos: heroPos, isHero: true, stackBB, committed: heroCommit, holeShown: [hero.c1, hero.c2] })
  let pot = heroCommit + (heroIsPFR ? 0.5 * bb : 0) // + dead SB when hero opens & SB folds (rough)
  oppPos.forEach((p, i) => {
    const commit = (heroIsPFR ? callAmt : (p === oppPos[0] && !heroIsPFR ? open : callAmt)) * bb
    seats.push({ name: names[i], pos: p, isHero: false, stackBB: stackBB + Math.floor(Math.random() * 20 - 10), committed: commit })
    pot += commit
  })
  const opener = heroIsPFR ? 'Toi' : seats.find(s => !s.isHero)!.name
  const caller = heroIsPFR ? seats.find(s => !s.isHero)!.name : 'Toi'
  const callers = seats.filter(s => !s.isHero).map(s => s.name + ' (' + s.pos + ')').join(' + ')
  const story = heroIsPFR
    ? i18n.t('spotq.storyOpen', { count: opponents, pos: heroPos, callers })
    : i18n.t('spotq.storyDefend', { opener, pos: seats.find(s => !s.isHero)!.pos, multiway: opponents > 1 ? i18n.t('spotq.multiway') : '' })
  void caller
  return { seats, heroPos, story, pot: Math.round(pot) }
}

// Generate one clean spot for the requested target bucket (rejection sampling).
export function generateSpot(context: SpotContext, target: HandBucket): TrainerSpot {
  const bb = context === 'mtt' ? 200 : 100
  let relax = false
  for (let attempt = 0; attempt < 1500; attempt++) {
    if (attempt === 1200) relax = true // safety net: drop quality gates so we always return
    const { hole, board } = dealRandomSpot()
    if (!boardIsClean(board)) continue
    const diag = diagnoseSpot(hole, board)
    if (diag.bucket !== target) continue
    const opponents = Math.random() < 0.7 ? 1 : 2
    const aggression = 0.2 // a normal single-raised-pot continuing range
    const equity = rangeEquity(hole, board, opponents, aggression, 900)
    if (!relax && !passesQuality(target, equity)) continue
    const heroIsPFR = Math.random() < 0.5
    const favor = boardFavor(board, heroIsPFR)
    const { seats, heroPos, story, pot } = buildSeats(context, { c1: hole[0], c2: hole[1] }, heroIsPFR, opponents, bb)
    return {
      context, hero: { c1: hole[0], c2: hole[1], key: handKey(hole[0], hole[1]) },
      board, seats, pot, bb, heroPos, heroIsPFR, opponents, story,
      diag, equity, favor, texture: textureOf(diag),
    }
  }
  // Should never hit — relax guarantees a return. Fallback to a trivial air spot.
  const { hole, board } = dealRandomSpot()
  const diag = diagnoseSpot(hole, board)
  const { seats, heroPos, story, pot } = buildSeats(context, { c1: hole[0], c2: hole[1] }, true, 1, bb)
  return { context, hero: { c1: hole[0], c2: hole[1], key: handKey(hole[0], hole[1]) }, board, seats, pot, bb, heroPos, heroIsPFR: true, opponents: 1, story, diag, equity: rangeEquity(hole, board, 1, 0.2, 800), favor: boardFavor(board, true), texture: textureOf(diag) }
}

// ── Questions ─────────────────────────────────────────────────────────────────
export type QKind = 'texture' | 'rangehit' | 'equity' | 'bucket'
export interface QOption { id: string; label: string; correct: boolean }
export interface SpotQuestion { kind: QKind; title: string; prompt: string; options: QOption[]; explain: string }

const TEXTURE_KEY: Record<TextureKind, string> = { dry: 'spotq.textureDry', semi: 'spotq.textureSemi', wet: 'spotq.textureWet', paired: 'spotq.texturePaired' }
const FAVOR_KEY: Record<Favor, string> = { hero: 'spotq.favorHero', villain: 'spotq.favorVillain', neutral: 'spotq.favorNeutral' }
const BUCKET_KEY: Record<HandBucket, string> = { air: 'spotq.bucketAir', value: 'spotq.bucketValue', bluffcatch: 'spotq.bucketBluffcatch', draw: 'spotq.bucketDraw' }
const EQ_DETAIL: Record<HandBucket, string> = { value: 'spotq.equityValue', draw: 'spotq.equityDraw', bluffcatch: 'spotq.equityBluffcatch', air: 'spotq.equityAir' }
const BUCKET_EXPLAIN: Record<HandBucket, string> = { value: 'spotq.bucketExplainValue', bluffcatch: 'spotq.bucketExplainBluffcatch', draw: 'spotq.bucketExplainDraw', air: 'spotq.bucketExplainAir' }

export function buildQuestions(spot: TrainerSpot): SpotQuestion[] {
  const t = i18n.t.bind(i18n)
  const b = spot.board.map(c => c.rank + c.suit).join(' ')
  const pct = (x: number) => `${Math.round(x * 100)}%`

  // 1 — Texture
  const texture: SpotQuestion = {
    kind: 'texture', title: t('spotq.titleTexture'),
    prompt: t('spotq.promptTexture', { board: b }),
    options: (['dry', 'semi', 'wet', 'paired'] as TextureKind[]).map(k => ({ id: k, label: t(TEXTURE_KEY[k]), correct: k === spot.texture })),
    explain: t(`spotq.explainTexture${spot.texture.charAt(0).toUpperCase() + spot.texture.slice(1)}`),
  }

  // 2 — Range hit
  const who = spot.heroIsPFR ? t('spotq.whoPfr') : t('spotq.whoCaller')
  const rangehit: SpotQuestion = {
    kind: 'rangehit', title: t('spotq.titleRange'),
    prompt: t('spotq.promptRange', { story: spot.story, board: b }),
    options: (['hero', 'villain', 'neutral'] as Favor[]).map(f => ({ id: f, label: t(FAVOR_KEY[f]), correct: f === spot.favor })),
    explain: (() => {
      const top = Math.max(...spot.board.map(c => RV[c.rank]))
      const side = top >= 12 ? t('spotq.rangeSideHigh', { card: top === 14 ? t('spotq.cardAce') : top === 13 ? t('spotq.cardKing') : t('spotq.cardQueen') })
        : top <= 9 ? t('spotq.rangeSideLow')
          : t('spotq.rangeSideMid')
      const concl = spot.favor === 'hero' ? t('spotq.rangeConclHero')
        : spot.favor === 'villain' ? t('spotq.rangeConclVillain')
        : t('spotq.rangeConclNeutral')
      return `${who}. ${side} ${concl}`
    })(),
  }

  // 3 — Equity
  const correctBand = eqBandIndex(spot.equity)
  const equity: SpotQuestion = {
    kind: 'equity', title: t('spotq.titleEquity'),
    prompt: t('spotq.promptEquity', { count: spot.opponents, board: b }),
    options: EQ_BANDS.map((band, i) => ({ id: band.id, label: band.label, correct: i === correctBand })),
    explain: t('spotq.equityExplain', { eq: pct(spot.equity), detail: t(EQ_DETAIL[spot.diag.bucket]) }),
  }

  // 4 — Bucket (the star question)
  const bucket: SpotQuestion = {
    kind: 'bucket', title: t('spotq.titleBucket'),
    prompt: t('spotq.promptBucket', { key: spot.hero.key, board: b }),
    options: (['value', 'bluffcatch', 'draw', 'air'] as HandBucket[]).map(k => ({ id: k, label: t(BUCKET_KEY[k]), correct: k === spot.diag.bucket })),
    explain: t(BUCKET_EXPLAIN[spot.diag.bucket], { made: spot.diag.madeName + (spot.diag.draws.length ? ' + ' + spot.diag.draws.join(' + ') : '') }),
  }

  return [texture, rangehit, equity, bucket]
}

// ─────────────────────────────────────────────────────────────────────────────
// "Le bon coup" — DECISION trainer. A spot is shown WITH the opponent's action (a
// bet of a given size, or checked to you), and the player picks the right MOVE
// (fold/call/raise, or check/bet). The correct answer + reasoning come from
// getPostflopAdvice → it matches the in-game coach. Trains the fast read:
// sizing tell → range → the two golden questions → decision.
// ─────────────────────────────────────────────────────────────────────────────
export interface DecisionSpot extends TrainerSpot {
  facingBet: boolean
  toCall: number
  betFrac: number          // villain's bet as a fraction of the pot (0 if checked to you)
  inPos: boolean
  advice: Advice
  options: AdviceAction[]
  correct: AdviceAction
}
function dealBoardN(n: number): { hole: [Card, Card]; board: Card[] } {
  const deck: Card[] = []
  for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s })
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]] }
  return { hole: [deck[0], deck[1]], board: deck.slice(2, 2 + n) }
}
const DECISION_TARGETS: AdviceAction[] = ['FOLD', 'CALL', 'RAISE', 'BET', 'CHECK']
// Cheap pre-filter (no Monte-Carlo): which hand buckets can plausibly lead to each
// target. We diagnose the hand first (fast) and only run the expensive getPostflopAdvice
// on plausible candidates → ~10x fewer MC calls, fast enough to prefetch.
const WANT_BUCKET: Record<AdviceAction, HandBucket[]> = {
  RAISE: ['value'], BET: ['value', 'air'], FOLD: ['air', 'bluffcatch', 'draw'],
  CALL: ['bluffcatch', 'draw'], CHECK: ['bluffcatch', 'air'],
}
export function generateDecisionSpot(context: SpotContext, target?: AdviceAction): DecisionSpot {
  const bb = context === 'mtt' ? 200 : 100
  const tgt = target ?? pick(DECISION_TARGETS)
  const facingBet = tgt === 'FOLD' || tgt === 'CALL' || tgt === 'RAISE'
  let relax = false
  for (let attempt = 0; attempt < 1400; attempt++) {
    if (attempt === 900) relax = true
    const nBoard = pick([3, 4, 4, 5]) // flop / turn / river
    const { hole, board } = dealBoardN(nBoard)
    const sc: Record<string, number> = {}; board.forEach(c => (sc[c.suit] = (sc[c.suit] ?? 0) + 1))
    if (Math.max(...Object.values(sc)) >= 4) continue // skip a 4-flush board (degenerate)
    const diag = diagnoseSpot(hole, board) // cheap — pre-filter before the costly MC advice
    if (!relax && !WANT_BUCKET[tgt].includes(diag.bucket)) continue
    const opponents = Math.random() < 0.78 ? 1 : 2
    const heroIsPFR = Math.random() < 0.5
    const inPos = Math.random() < 0.5
    const basePot = Math.round((5 + Math.random() * 8) * bb)
    let toCall = 0, betFrac = 0, pot = basePot, aggression = 0.06, barrels = 0
    if (facingBet) {
      betFrac = pick([0.33, 0.5, 0.66, 1])
      barrels = Math.floor(Math.random() * Math.min(3, nBoard - 2))
      toCall = Math.round(basePot * betFrac)
      pot = basePot + toCall
      const sb = betFrac >= 1 ? 0.55 : betFrac >= 0.66 ? 0.45 : betFrac >= 0.45 ? 0.36 : 0.22
      aggression = Math.min(0.85, Math.max(sb + barrels * 0.16, barrels * 0.28))
    }
    const effStack = Math.round(pot * (0.8 + Math.random() * 3.5))
    const adv = getPostflopAdvice({ hole, board, pot, toCall, heroStack: 120 * bb, effStack, opponents, inPosition: inPos, aggression, barrels, bb, iters: 500 })
    if (!relax && adv.confidence === 'basse') continue
    if (!relax && adv.action !== tgt) continue
    const options: AdviceAction[] = facingBet ? ['FOLD', 'CALL', 'RAISE'] : ['CHECK', 'BET']
    if (!options.includes(adv.action)) continue
    const { seats, heroPos, story } = buildSeats(context, { c1: hole[0], c2: hole[1] }, heroIsPFR, opponents, bb)
    seats.forEach(s => { s.committed = 0 })
    if (facingBet) { const v = seats.find(s => !s.isHero); if (v) v.committed = toCall }
    return {
      context, hero: { c1: hole[0], c2: hole[1], key: handKey(hole[0], hole[1]) },
      board, seats, pot, bb, heroPos, heroIsPFR, opponents, story,
      diag, equity: adv.equity, favor: boardFavor(board, heroIsPFR), texture: textureOf(diag),
      facingBet, toCall, betFrac, inPos, advice: adv, options, correct: adv.action,
    }
  }
  return generateDecisionSpot(context, undefined)
}

export const DECISION_LABEL: Record<AdviceAction, string> = {
  FOLD: 'FOLD', CALL: 'CALL', RAISE: 'RAISE', CHECK: 'CHECK', BET: 'BET',
}
export interface DecisionReveal { correctLabel: string; lesson: string; twoQuestions: string; sizingTell?: string; reasons: string[]; equity: number; bucket: HandBucket }
export function decisionReveal(spot: DecisionSpot): DecisionReveal {
  const t = i18n.t.bind(i18n)
  const a = spot.advice, b = spot.diag.bucket, pct = (x: number) => `${Math.round(x * 100)}%`
  let correctLabel = DECISION_LABEL[a.action], lesson = '', twoQuestions = ''
  if (a.action === 'FOLD') { lesson = t('decq.lessonFold', { eq: pct(a.equity) }); twoQuestions = t('decq.twoFold') }
  else if (a.action === 'CALL') {
    correctLabel = 'CALL' + (b === 'bluffcatch' ? t('decq.suffixBluffcatch') : b === 'draw' ? t('decq.suffixDraw') : '')
    lesson = b === 'bluffcatch' ? t('decq.lessonCallBc') : b === 'draw' ? t('decq.lessonCallDraw') : t('decq.lessonCall', { eq: pct(a.equity) })
    twoQuestions = b === 'bluffcatch' ? t('decq.twoCallBc') : t('decq.twoCall')
  } else if (a.action === 'RAISE') { correctLabel = 'RAISE' + t('decq.suffixValue'); lesson = t('decq.lessonRaise'); twoQuestions = t('decq.twoRaise') }
  else if (a.action === 'BET') {
    const isBluff = a.equity < 0.35
    correctLabel = 'BET' + (isBluff ? t('decq.suffixBluff') : t('decq.suffixValue'))
    lesson = isBluff ? t('decq.lessonBetBluff') : t('decq.lessonBetValue', { prot: b === 'value' ? t('decq.protection') : '' })
    twoQuestions = isBluff ? t('decq.twoBetBluff') : t('decq.twoBetValue')
  } else { lesson = t('decq.lessonCheck'); twoQuestions = t('decq.twoCheck') }
  let sizingTell: string | undefined
  if (spot.facingBet) sizingTell = spot.betFrac <= 0.4 ? t('decq.sizeSmall', { pct: Math.round(spot.betFrac * 100) })
    : spot.betFrac >= 1 ? t('decq.sizeBig')
    : t('decq.sizeMid', { pct: Math.round(spot.betFrac * 100) })
  return { correctLabel, lesson, twoQuestions, sizingTell, reasons: a.reasons.slice(1, 3), equity: a.equity, bucket: b }
}
