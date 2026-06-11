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

import { diagnoseSpot, rangeEquity, type Card, type HandBucket, type SpotDiagnosis } from './postflopAdvisor'

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
  const story = heroIsPFR
    ? `Tu ouvres en ${heroPos}, ${seats.filter(s => !s.isHero).map(s => s.name + ' (' + s.pos + ')').join(' + ')} paie${opponents > 1 ? 'nt' : ''}.`
    : `${opener} ouvre en ${seats.find(s => !s.isHero)!.pos}, tu paies en BB${opponents > 1 ? ' (multiway)' : ''}.`
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

const TEXTURE_LABEL: Record<TextureKind, string> = {
  dry: 'Sec — rainbow / déconnecté',
  semi: 'Semi-humide — 2 d’une couleur ou un lien',
  wet: 'Humide — tirages couleur/quinte présents',
  paired: 'Pairé',
}
const FAVOR_LABEL: Record<Favor, string> = {
  hero: 'Il frappe MA range',
  villain: 'Il frappe SA range',
  neutral: 'Plutôt neutre / partagé',
}
const BUCKET_LABEL: Record<HandBucket, string> = {
  air: 'AIRE — rien (ni paire ni tirage)',
  value: 'VALUE — je bats sa range de call',
  bluffcatch: 'BLUFF-CATCH — je bats ses bluffs, pas sa value',
  draw: 'TIRAGE — derrière, mais je peux toucher',
}

export function buildQuestions(spot: TrainerSpot): SpotQuestion[] {
  const b = spot.board.map(c => c.rank + c.suit).join(' ')
  const pct = (x: number) => `${Math.round(x * 100)}%`

  // 1 — Texture
  const texture: SpotQuestion = {
    kind: 'texture', title: 'Texture du board',
    prompt: `Comment qualifies-tu la texture du flop ${b} ?`,
    options: (['dry', 'semi', 'wet', 'paired'] as TextureKind[]).map(t => ({ id: t, label: TEXTURE_LABEL[t], correct: t === spot.texture })),
    explain: spot.texture === 'dry'
      ? 'Board rainbow et déconnecté : peu de tirages possibles → les ranges ne se « connectent » pas beaucoup, l’équité est surtout dans les paires faites.'
      : spot.texture === 'wet'
        ? 'Deux d’une même couleur ET cartes liées : beaucoup de tirages couleur/quinte → les équités sont serrées, les mains faites doivent se protéger.'
        : spot.texture === 'paired'
          ? 'Board pairé : attention aux brelans/full, et les « deux paires » qui s’appuient sur la paire du board valent en réalité une seule paire.'
          : 'Texture intermédiaire : un seul lien ou deux d’une couleur → quelques tirages, sans être trempé.',
  }

  // 2 — Range hit
  const who = spot.heroIsPFR ? 'TU es le relanceur préflop' : 'l’adversaire est le relanceur, TU as payé'
  const rangehit: SpotQuestion = {
    kind: 'rangehit', title: 'Le board frappe quelle range ?',
    prompt: `${spot.story} Sur ce flop ${b}, l’avantage de range va à qui ?`,
    options: (['hero', 'villain', 'neutral'] as Favor[]).map(f => ({ id: f, label: FAVOR_LABEL[f], correct: f === spot.favor })),
    explain: (() => {
      const top = Math.max(...spot.board.map(c => RV[c.rank]))
      const side = top >= 12 ? `Un board ${top === 14 ? 'As' : top === 13 ? 'Roi' : 'Dame'}-haut colle à la range du RELANCEUR (gros As/Rois, broadways, grosses paires).`
        : top <= 9 ? 'Un board bas (9-haut ou moins) colle à la range du SUIVEUR (connecteurs, petites paires, suités) — le relanceur a surtout des cartes hautes ratées.'
          : 'Un board T/J-haut sans As ni Roi est contesté : les deux ranges le touchent à peu près autant → neutre.'
      return `${who}. ${side}`
    })(),
  }

  // 3 — Equity
  const correctBand = eqBandIndex(spot.equity)
  const equity: SpotQuestion = {
    kind: 'equity', title: 'Ton équité',
    prompt: `Face à ${spot.opponents} adversaire${spot.opponents > 1 ? 's' : ''} sur ${b}, ton équité approximative ?`,
    options: EQ_BANDS.map((band, i) => ({ id: band.id, label: band.label, correct: i === correctBand })),
    explain: `Ton équité réelle ≈ ${pct(spot.equity)} (simulation vs leur range). ${spot.diag.bucket === 'value' ? 'Main faite forte → tu domines une grosse part de sa range.' : spot.diag.bucket === 'draw' ? 'Tu es derrière maintenant, ton équité vient de ton tirage (tu touches ~1 fois sur 3).' : spot.diag.bucket === 'bluffcatch' ? 'Une paire moyenne : tu bats ses bluffs/ratés mais perds vs ses mains faites → équité moyenne.' : 'Quasi rien de fait : ton équité vient surtout de tes surcartes / du peu de showdown value.'}`,
  }

  // 4 — Bucket (the star question)
  const bucket: SpotQuestion = {
    kind: 'bucket', title: 'Dans quel seau es-tu ?',
    prompt: `Ta main ${spot.hero.key} sur ${b} — tu es dans quel seau ?`,
    options: (['value', 'bluffcatch', 'draw', 'air'] as HandBucket[]).map(k => ({ id: k, label: BUCKET_LABEL[k], correct: k === spot.diag.bucket })),
    explain: (() => {
      const made = spot.diag.madeName
      const draws = spot.diag.draws.length ? ' + ' + spot.diag.draws.join(' + ') : ''
      if (spot.diag.bucket === 'value') return `${made}${draws} : tu bats sa range de CALL → c’est de la VALUE, tu mises/relances pour te faire payer par pire. Question clé : « est-ce que des pires mains me paient ? » → oui.`
      if (spot.diag.bucket === 'bluffcatch') return `${made}${draws} : tu bats ses bluffs mais perds contre ses mains de valeur, et tu n’améliores pas → BLUFF-CATCH. Tu checkes/paies, tu ne mises PAS (des pires se couchent, des meilleures paient).`
      if (spot.diag.bucket === 'draw') return `${made}${draws} : derrière maintenant, mais un tirage qui peut toucher → TIRAGE. Tu joues par la cote + les cotes implicites, ou en semi-bluff.`
      return `${made}${draws} : ni paire utile ni tirage → AIRE. Soit tu abandonnes, soit tu bluffes si le board et l’adversaire s’y prêtent.`
    })(),
  }

  return [texture, rangehit, equity, bucket]
}
