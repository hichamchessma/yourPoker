import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Square, ChevronUp, ChevronDown, RefreshCw, Eye } from 'lucide-react'
import PlayerAvatar, { avatarForSeat } from '../components/PlayerAvatar'
import RangeAssistant from '../components/RangeAssistant'
import RangeHeatmap from '../components/RangeHeatmap'
import { type Scenario, handKeyFromCards, buildRangeMap, buildJamCallMap, handOpenRank, openPctFor } from '../lib/preflopRanges'
import { getPostflopAdvice } from '../lib/postflopAdvisor'
import {
  initRange, applyAction, rangeView, actionSummary, preflopProbs, HAND_KEYS,
  type RangeWeights, type ActCat,
} from '../lib/rangeEstimator'

// ─── Types ──────────────────────────────────────────────────────────────────
type Suit = '♠' | '♥' | '♦' | '♣'
type Phase = 'idle' | 'dealing' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

interface Card { rank: string; suit: Suit }
interface Seat {
  idx: number; name: string; isHero: boolean; stack: number
  holeCards: [Card | null, Card | null]; cardsFaceUp: boolean
  bet: number; totalBet: number; isFolded: boolean; isAllIn: boolean
  isActive: boolean; lastAction: string | null; level: number
  position: string; isDealer: boolean; isSB: boolean; isBB: boolean
  handStrength?: string; handScore?: number; isWinner?: boolean
  isEliminated: boolean; isSittingOut: boolean
  seatType: 'bot' | 'human'
}
interface GState {
  phase: Phase; deck: Card[]; seats: Seat[]; community: (Card | null)[]
  pot: number; currentBet: number; minRaise: number; actQueue: number[]
  dealerIdx: number; handNum: number; log: string[]; winners: number[]
  paused: boolean; autoRunning: boolean
}
interface GameConfig {
  numPlayers: number; selectedSeat: number; stackBB: number; sb: number
  bb: number; ante: number; decisionTimer: number; displayName: string
  slots: Array<{ type: string; level: number }>
  scenario?: ScenarioCfg
  playLive?: boolean
}
// Custom-scenario start state coming from SetupPositionPage.
interface ScenarioCfg {
  numPlayers: number; heroPos: string; stackBB: number; sb: number; bb: number
  startStreet: 'preflop' | 'flop' | 'turn' | 'river'
  heroCards: [Card | null, Card | null]
  board: (Card | null)[]
  potBB: number
  opponents: Array<{ level: number; discipline: string; cards?: [Card | null, Card | null] }>
}
interface ChipFlight {
  id: number; fromX: number; fromY: number; toX: number; toY: number
  amount: number; kind: 'collect' | 'payout'
}
interface HistoryAction {
  phase: Phase; seatIdx: number; name: string; isHero: boolean
  actionType: string; amount: number; potAfter: number
}
interface HandHistoryRecord {
  id: number; handNum: number; date: Date
  players: Array<{
    idx: number; name: string; isHero: boolean; position: string
    startStack: number; endStack: number
    holeCards: [Card|null, Card|null]; isFolded: boolean; isWinner: boolean
    level: number; seatType: 'bot' | 'human'
  }>
  board: (Card|null)[]; actions: HistoryAction[]
  finalPot: number; sb: number; bb: number
  heroProfit: number; winnerNames: string[]
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']
const RV: Record<string, number> = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:11,Q:12,K:13,A:14}
const POS: Record<number, string[]> = {
  2:['BTN/SB','BB'], 3:['BTN','SB','BB'], 4:['BTN','SB','BB','UTG'],
  5:['BTN','SB','BB','UTG','CO'], 6:['BTN','SB','BB','UTG','HJ','CO'],
  7:['BTN','SB','BB','UTG','UTG+1','HJ','CO'],
  8:['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO'],
  9:['BTN','SB','BB','UTG','UTG+1','MP','MP+1','HJ','CO'],
}
// 3 bot tiers (1 Amateur, 2 Pro, 3 Expert) + a Human-style pool.
const BNAMES: Record<number, string[]> = {
  1:['Lucky Luke','Fish Bob','Passive Pete','Rookie Ray','Calling Carl','Avg Joe','Loose Lou','Basic Ben'],
  2:['Solid Steve','Tag Mike','Thinking Tim','Steady Sam','Range Rita','Poker Pat','Sharp Shawn','Pro Paul'],
  3:['Semi-Pro Kim','GTO Greg','Smart Sara','Exploit Ed','Optimal Opus','Solver Sven','PIO Master','Balanced Bo'],
}
const HUMAN_NAMES = ['Alex','Marco','Nadia','Leo','Sofia','Yanis','Karim','Lina','Diego','Emma','Hugo','Inès']
const LGRAD: Record<number,[string,string]> = {
  0:['#0d2235','#00d4ff'], 1:['#0d2a0d','#22aa44'], 2:['#2a2008','#c9a227'], 3:['#300818','#cc3366'],
}
const HUMAN_GRAD: [string,string] = ['#1a0830','#9933dd']
const HNAMES = ['Haute carte','Paire','Double paire','Brelan','Suite','Couleur','Full','Carré','Quinte flush']
const PHASE_LABEL: Record<Phase, string> = {
  idle:'Prêt', dealing:'Distribution', preflop:'Pré-flop',
  flop:'Flop', turn:'Turn', river:'River', showdown:'Showdown',
}
const POT_POS = { x: 50, y: 50 }
// Offset (in % of table box) of a player's committed-bet chip stack, placed
// on the line from the seat toward the table center.
function betOffset(leftPct: number, topPct: number): { x: number; y: number } {
  const dx = 50 - leftPct, dy = 50 - topPct
  const len = Math.hypot(dx, dy) || 1
  // Bottom seats (the hero) need a longer reach so the chips clear the hole
  // cards that are drawn above the seat panel.
  const dist = topPct > 62 ? 21 : 13
  return { x: (dx / len) * dist, y: (dy / len) * dist }
}

// ─── Range → concrete cards sampling (used by "Revive situation") ─────────────
// Expand a 169-hand key (e.g. "AKs", "99", "T9o") into every concrete two-card
// combo that doesn't collide with already-used cards (board + other hands).
function combosForKey(key: string, used: Set<string>): [Card, Card][] {
  const r1 = key[0], r2 = key[1], kind = key[2] // 's' | 'o' | undefined (pair)
  const out: [Card, Card][] = []
  const free = (r: string, s: Suit) => !used.has(r + s)
  if (r1 === r2) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++)
      if (free(r1, SUITS[i]) && free(r1, SUITS[j])) out.push([{ rank: r1, suit: SUITS[i] }, { rank: r1, suit: SUITS[j] }])
  } else if (kind === 's') {
    for (const s of SUITS) if (free(r1, s) && free(r2, s)) out.push([{ rank: r1, suit: s }, { rank: r2, suit: s }])
  } else {
    for (const s1 of SUITS) for (const s2 of SUITS)
      if (s1 !== s2 && free(r1, s1) && free(r2, s2)) out.push([{ rank: r1, suit: s1 }, { rank: r2, suit: s2 }])
  }
  return out
}
// Draw ONE concrete hand from a weighted range, ∝ each hand's posterior weight
// (the weight already encodes how the player's actions narrowed their range).
// Respects card removal so two players never share a card with the board/hero.
function sampleHandFromRange(range: RangeWeights, used: Set<string>): [Card, Card] | null {
  const feasible: { combos: [Card, Card][]; w: number }[] = []
  let total = 0
  for (const key of HAND_KEYS) {
    const w = range[key] ?? 0
    if (w <= 0) continue
    const combos = combosForKey(key, used)
    if (combos.length === 0) continue
    feasible.push({ combos, w }); total += w
  }
  if (total <= 0 || feasible.length === 0) return null
  let r = Math.random() * total
  for (const f of feasible) { r -= f.w; if (r <= 0) return f.combos[Math.floor(Math.random() * f.combos.length)] }
  const last = feasible[feasible.length - 1]
  return last.combos[Math.floor(Math.random() * last.combos.length)]
}

// ─── Bot AI helpers ───────────────────────────────────────────────────────────
// Chen formula — fine-grained preflop hand ranking (~ -1 … 20). MUST stay
// identical to the copy in lib/rangeEstimator.ts so bots & the range estimator
// share the exact same preflop strength scale.
function preflopStrength(c1: Card, c2: Card): number {
  const r1 = RV[c1.rank] ?? 2, r2 = RV[c2.rank] ?? 2
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2)
  const val = (r: number) => r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2
  if (r1 === r2) return Math.max(5, val(hi) * 2)            // pair
  let s = val(hi)
  if (c1.suit === c2.suit) s += 2                            // suited bonus
  const gap = hi - lo - 1                                    // cards between
  if (gap === 1) s -= 1; else if (gap === 2) s -= 2; else if (gap === 3) s -= 4; else if (gap >= 4) s -= 5
  if (hi - lo <= 2 && hi < 12) s += 1                        // straight bonus (both below Q)
  return s                                                   // unrounded → finer thresholds
}
// Position bonus drives the OPEN width (preflopProbs.openTh) for bots & the range
// estimator. When folded to, the SB is a STEAL seat (only the BB behind + dead
// money), so it opens nearly as wide as the button — not like an early seat.
// (Only affects the unopened/open branch; SB's defend-vs-raise ranges are
// threshold-based and unchanged.)
const POS_BONUS: Record<string, number> = {
  'BTN':1.00,'BTN/SB':1.00,'CO':0.88,'HJ':0.78,
  'MP':0.72,'MP+1':0.72,'UTG':0.62,'UTG+1':0.65,'SB':0.95,'BB':0.82,
}

// ─── Deck & evaluation ───────────────────────────────────────────────────────
function mkDeck(): Card[] { return SUITS.flatMap(s => RANKS.map(r => ({ rank: r, suit: s }))) }
function shuffle(d: Card[]): Card[] {
  const a = [...d]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]] }
  return a
}
function combos5(arr: Card[]): Card[][] {
  if (arr.length < 5) return []
  const r: Card[][] = []
  function go(start: number, cur: Card[]) {
    if (cur.length === 5) { r.push([...cur]); return }
    for (let i = start; i <= arr.length - (5 - cur.length); i++) go(i+1, [...cur, arr[i]])
  }
  go(0, []); return r
}
function evalFive(cards: Card[]): number {
  const rv = cards.map(c => RV[c.rank] ?? 2)
  const sv = cards.map(c => c.suit)
  const isF = sv.every(s=>s===sv[0])
  const u = [...new Set(rv)].sort((a,b)=>b-a)
  const wheel = u.length===5 && u[0]===14 && u[1]===5 && u[2]===4 && u[3]===3 && u[4]===2
  const isS = (u.length===5 && u[0]-u[4]===4) || wheel
  const cnt: Record<number,number> = {}; rv.forEach(r=>cnt[r]=(cnt[r]??0)+1)
  const cv = Object.values(cnt).sort((a,b)=>b-a)
  let rank=0
  if(isF&&isS) rank=8; else if(cv[0]===4) rank=7; else if(cv[0]===3&&cv[1]===2) rank=6
  else if(isF) rank=5; else if(isS) rank=4; else if(cv[0]===3) rank=3
  else if(cv[0]===2&&cv[1]===2) rank=2; else if(cv[0]===2) rank=1
  // Straights compare on their high card (wheel A-2-3-4-5 is 5-high).
  if (isS) return rank*15**5 + (wheel ? 5 : u[0])
  // Tiebreak ordered by GROUP SIZE first (pairs/trips), then rank — so a pair
  // always outranks a higher kicker (fixes "QQJJ7 vs QQ55A" type comparisons).
  const tb: number[] = []
  Object.keys(cnt).map(Number).sort((a,b)=> cnt[b]-cnt[a] || b-a).forEach(r => { for(let i=0;i<cnt[r];i++) tb.push(r) })
  return rank*15**5 + (tb[0]??0)*15**4 + (tb[1]??0)*15**3 + (tb[2]??0)*15**2 + (tb[3]??0)*15 + (tb[4]??0)
}
function bestHand(cards: Card[]): { score:number; name:string } {
  const valid = cards.filter(Boolean) as Card[]
  if (valid.length < 2) return { score:0, name:'—' }
  if (valid.length < 5) {
    const pad = [...valid, ...Array(5-valid.length).fill({rank:'2',suit:'♠'})]
    const s = evalFive(pad); return { score:s, name:HNAMES[Math.floor(s/15**5)]??'Haute carte' }
  }
  let best=0
  for (const c of combos5(valid)) { const s=evalFive(c); if(s>best) best=s }
  return { score:best, name:HNAMES[Math.floor(best/15**5)]??'Haute carte' }
}
// Realistic 0..1 made-hand strength (category-based, with pair refinement) so
// bots actually value-bet strong hands instead of checking down monsters.
const CAT_STRENGTH = [0.08, 0.42, 0.68, 0.80, 0.86, 0.91, 0.96, 0.99, 1.0]
function madeStrength(hole: Card[], board: Card[]): number {
  const score = bestHand([...hole, ...board]).score
  const cat = Math.floor(score / 15 ** 5)
  if (cat !== 1) return CAT_STRENGTH[cat] ?? 0.08
  // One pair → refine by overpair / top / second / weak.
  const bRanks = board.map(c => RV[c.rank]).sort((a, b) => b - a)
  const hRanks = hole.map(c => RV[c.rank])
  const pocket = hole.length >= 2 && hole[0].rank === hole[1].rank
  if (pocket && hRanks[0] > (bRanks[0] ?? 0)) return 0.62 // overpair
  if (hRanks.includes(bRanks[0] ?? -1)) return 0.55       // top pair
  if (bRanks[1] !== undefined && hRanks.includes(bRanks[1])) return 0.42 // second pair
  return 0.32                                              // weak / board pair
}
// Flush draw or open-ended straight draw → fuel for semi-bluffs.
function hasStrongDraw(hole: Card[], board: Card[]): boolean {
  if (board.length >= 5 || board.length < 3) return false
  const all = [...hole, ...board]
  const bySuit: Record<string, number> = {}
  all.forEach(c => (bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1))
  if (Object.values(bySuit).some(n => n === 4)) return true
  const vals = new Set(all.map(c => RV[c.rank])); if (vals.has(14)) vals.add(1)
  for (let lo = 1; lo <= 10; lo++) {
    let cnt = 0; for (let k = lo; k < lo + 5; k++) if (vals.has(k)) cnt++
    if (cnt === 4 && (!vals.has(lo) || !vals.has(lo + 4))) return true
  }
  return false
}
function computeSidePots(seats: Seat[]): {amount:number; eligible:number[]}[] {
  const pots: {amount:number; eligible:number[]}[] = []
  const pool = seats.filter(s=>s.totalBet>0).map(s=>({idx:s.idx,amount:s.totalBet,folded:s.isFolded}))
  while (pool.length > 0) {
    const min = Math.min(...pool.map(p=>p.amount))
    const potAmt = min * pool.length
    const eligible = pool.filter(p=>!p.folded).map(p=>p.idx)
    pots.push({amount:potAmt,eligible})
    for (let i = pool.length-1; i >= 0; i--) { pool[i].amount-=min; if(pool[i].amount===0) pool.splice(i,1) }
  }
  return pots.filter(p=>p.amount>0&&p.eligible.length>0)
}

// ─── Casino chip denomination system ─────────────────────────────────────────
const CHIP_DENOMS = [25000, 10000, 2500, 500, 100, 25, 5, 1]
const CHIP_CFG: Record<number, {bg:string; rim:string; spot:string}> = {
  25000: {bg:'#f97316', rim:'#7c2d12', spot:'#fed7aa'},
  10000: {bg:'#3b82f6', rim:'#1e3a8a', spot:'#bfdbfe'},
  2500:  {bg:'#eab308', rim:'#713f12', spot:'#fef08a'},
  500:   {bg:'#a855f7', rim:'#3b0764', spot:'#e9d5ff'},
  100:   {bg:'#27272a', rim:'#52525b', spot:'#a1a1aa'},
  25:    {bg:'#16a34a', rim:'#14532d', spot:'#86efac'},
  5:     {bg:'#dc2626', rim:'#7f1d1d', spot:'#fca5a5'},
  1:     {bg:'#d1d5db', rim:'#6b7280', spot:'#f9fafb'},
}
function getChipBreakdown(amount: number): {denom:number; count:number}[] {
  const out: {denom:number; count:number}[] = []
  let rem = Math.max(0, Math.round(amount))
  for (const d of CHIP_DENOMS) {
    if (rem >= d) { out.push({denom:d, count:Math.floor(rem/d)}); rem %= d }
  }
  return out
}
function CasinoChip({ denom, sz=24 }: { denom:number; sz?:number }) {
  const c = CHIP_CFG[denom] ?? CHIP_CFG[1]
  const R = sz / 2
  const spotR = R * 0.77
  const spotSz = sz * 0.088
  const spots = Array.from({length: 8}, (_, i) => {
    const a = i * Math.PI / 4 - Math.PI / 8
    return {x: R + spotR * Math.cos(a), y: R + spotR * Math.sin(a)}
  })
  return (
    <svg width={sz} height={sz + 3} viewBox={`0 0 ${sz} ${sz + 3}`}
      style={{filter:'drop-shadow(0 2px 5px rgba(0,0,0,0.85))'}}>
      <circle cx={R + 0.3} cy={R + 2.8} r={R - 0.5} fill={c.rim} opacity={0.45}/>
      <circle cx={R}       cy={R + 1.6} r={R - 0.5} fill={c.rim}/>
      <circle cx={R} cy={R} r={R - 0.5} fill={c.bg}/>
      <circle cx={R} cy={R} r={R - 0.5} fill="none" stroke={c.rim} strokeWidth={sz * 0.1}/>
      {spots.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={spotSz} fill={c.spot}/>)}
      <circle cx={R} cy={R} r={R * 0.52} fill="none" stroke={c.spot} strokeWidth={0.7} opacity={0.65}/>
      <circle cx={R} cy={R} r={R * 0.19} fill={c.spot} opacity={0.45}/>
      <ellipse cx={R * 0.65} cy={R * 0.60} rx={R * 0.30} ry={R * 0.19}
        fill="white" opacity={0.22} transform={`rotate(-35,${R},${R})`}/>
    </svg>
  )
}
function ChipStack({ amount, maxVisible=7, sz=22 }: { amount:number; maxVisible?:number; sz?:number }) {
  const breakdown = getChipBreakdown(amount)
  const chips: {denom:number}[] = []
  for (const {denom, count} of breakdown) {
    const show = Math.min(count, 2)
    for (let i = 0; i < show && chips.length < maxVisible; i++) chips.push({denom})
  }
  if (chips.length === 0) return null
  const SZ = sz, STEP = Math.max(4, Math.round(sz * 0.23))
  return (
    <div style={{position:'relative', width:SZ, height: SZ + 3 + (chips.length - 1) * STEP}}>
      {chips.map((chip, i) => (
        <div key={i} style={{position:'absolute', bottom:i * STEP, left:0, zIndex:i}}>
          <CasinoChip denom={chip.denom} sz={SZ}/>
        </div>
      ))}
    </div>
  )
}
// A small stack of chips used for in-flight animation (collect / payout).
function FlyingStack({ amount, sz=18 }: { amount:number; sz?:number }) {
  return <ChipStack amount={amount} sz={sz} maxVisible={5}/>
}

// ─── Card image components — PNG assets from /assets/cards/ ──────────────────
const RANK_MAP: Record<string, string> = {
  'A':'1','2':'2','3':'3','4':'4','5':'5','6':'6',
  '7':'7','8':'8','9':'9','T':'10','J':'j','Q':'q','K':'k'
}
const SUIT_MAP: Record<string, string> = { '♠':'s','♥':'h','♦':'d','♣':'c' }
function cardSrc(rank: string, suit: string): string {
  return `/assets/cards/card_${RANK_MAP[rank] ?? rank.toLowerCase()}${SUIT_MAP[suit] ?? 's'}.png`
}
function PlayingCard({ rank, suit, w=58, h=82 }: { rank:string; suit:Suit; w?:number; h?:number }) {
  return (
    <img src={cardSrc(rank, suit)} alt={`${rank}${suit}`} width={w} height={h} draggable={false}
      style={{display:'block',borderRadius:Math.round(w*0.10),
        boxShadow:'0 8px 22px rgba(0,0,0,0.72), 0 2px 6px rgba(0,0,0,0.4)',
        objectFit:'cover',userSelect:'none'}}/>
  )
}
function FaceDown({ w=40, h=56 }: { w?:number; h?:number }) {
  return (
    <img src="/assets/cards/card_back.png" alt="face down" width={w} height={h} draggable={false}
      style={{display:'block',borderRadius:Math.round(w*0.10),
        boxShadow:'0 4px 12px rgba(0,0,0,0.75)',objectFit:'cover',userSelect:'none'}}/>
  )
}
function EmptySlot({ w=50, h=70 }: { w?:number; h?:number }) {
  return (
    <div style={{width:w,height:h}} className="border border-dashed border-white/10 rounded-md flex items-center justify-center bg-black/15">
      <span className="text-white/10 text-sm">?</span>
    </div>
  )
}

// ─── Dealer button token ──────────────────────────────────────────────────────
function DealerButtonToken({ size=46 }: { size?:number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 46"
      style={{filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.9)) drop-shadow(0 0 8px rgba(200,0,0,0.3))'}}>
      <circle cx="23" cy="23" r="22.5" fill="#0d0d0d"/>
      <circle cx="23" cy="23" r="21"   fill="#1a1a1a"/>
      <circle cx="23" cy="23" r="19.5" fill="#0a0a0a"/>
      <circle cx="23" cy="23" r="18.5" fill="#cc1111"/>
      <circle cx="23" cy="23" r="17"   fill="#0a0a0a"/>
      <circle cx="23" cy="23" r="15.8" fill="white"/>
      <path d="M23 8 C23 8 32 15 32 20 C32 24 27.5 25 23 22 C18.5 25 14 24 14 20 C14 15 23 8 23 8Z" fill="#cc1111"/>
      <path d="M20.5 22 L19 27 L27 27 L25.5 22 C24.5 23.5 21.5 23.5 20.5 22Z" fill="#cc1111"/>
      <polygon points="23,10 24.3,14.1 28.6,14.1 25.2,16.6 26.5,20.7 23,18.2 19.5,20.7 20.8,16.6 17.4,14.1 21.7,14.1" fill="white"/>
      <text x="23" y="36" textAnchor="middle" fontSize="4.8" fontFamily="Arial Black,Arial,sans-serif"
        fontWeight="900" fill="#111" letterSpacing="0.6">DEALER</text>
      <circle cx="23" cy="23" r="15.8" fill="none" stroke="#ff3333" strokeWidth="0.6"/>
    </svg>
  )
}

// ─── Seat Panel ───────────────────────────────────────────────────────────────
function SeatPanel({ seat, style, isWinner, isShowdown, onRebuy, turnSeconds=25, turnNonce, turnPaused, hideTimer, onHover, onHoverCards }: {
  seat:Seat; style:React.CSSProperties; isWinner:boolean; isShowdown:boolean; onRebuy?:()=>void; turnSeconds?:number; turnNonce?:string; turnPaused?:boolean; hideTimer?:boolean; onHover?:(entering:boolean, e?:React.MouseEvent)=>void; onHoverCards?:(entering:boolean, e?:React.MouseEvent)=>void
}) {
  const [bgD,bgL] = seat.seatType === 'human' ? HUMAN_GRAD : (LGRAD[seat.level] ?? LGRAD[2])
  const initial = seat.name[0].toUpperCase()
  const hasCard0 = seat.holeCards[0] !== null
  const hasCard1 = seat.holeCards[1] !== null
  const isLoser = isShowdown && !isWinner && !seat.isFolded

  if (seat.isEliminated) {
    return (
      <div className="absolute flex flex-col items-center gap-0.5" style={{...style,zIndex:4}}>
        <div className="rounded-2xl border border-red-900/40 min-w-[100px] overflow-hidden"
          style={{background:'rgba(8,0,0,0.85)'}}>
          <div className="px-2.5 py-1.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border border-red-900/40 shrink-0 text-red-900/50"
              style={{background:`linear-gradient(135deg,${bgL}22,${bgD})`}}>{initial}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-red-900/50 truncate">{seat.name}</p>
              <p className="text-[7px] text-red-900/40">Éliminé</p>
            </div>
          </div>
          {onRebuy && (
            <button onClick={onRebuy}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 border-t border-red-900/30 text-[7px] font-bold text-emerald-400/70 hover:text-emerald-400 hover:bg-emerald-900/20 transition-all uppercase tracking-widest">
              <RefreshCw size={8}/> Rebuy
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`absolute flex flex-col items-center gap-0.5 transition-all duration-500 ${seat.isSittingOut?'opacity-50':''}`}
      style={{...style,zIndex:seat.isActive?20:8}}>
      {/* Hole cards — hovering here shows the RANGE (not the bet panel). Only the
          cards are dimmed when folded; name & stack stay readable */}
      <div className={`flex relative mb-0.5 transition-all duration-500 ${seat.isFolded?'opacity-20 grayscale':''}`}
        style={{height:hasCard0||hasCard1?80:0,overflow:'visible',minWidth:80}}
        onMouseEnter={onHoverCards ? (e) => onHoverCards(true, e) : undefined}
        onMouseLeave={onHoverCards ? () => onHoverCards(false) : undefined}>
        <AnimatePresence>
          {hasCard0 && (
            <motion.div key="c0" initial={{y:-30,opacity:0,scale:0.6}} animate={{y:0,opacity:1,scale:1}}
              transition={{type:'spring',stiffness:400,damping:28}}>
              {seat.cardsFaceUp&&seat.holeCards[0]
                ? <PlayingCard rank={seat.holeCards[0].rank} suit={seat.holeCards[0].suit} w={56} h={78}/>
                : <FaceDown w={40} h={56}/>}
            </motion.div>
          )}
          {hasCard1 && (
            <motion.div key="c1" initial={{y:-30,opacity:0,scale:0.6}} animate={{y:0,opacity:1,scale:1}}
              transition={{type:'spring',stiffness:400,damping:28,delay:0.1}} style={{marginLeft:-18,marginTop:-4}}>
              {seat.cardsFaceUp&&seat.holeCards[1]
                ? <PlayingCard rank={seat.holeCards[1].rank} suit={seat.holeCards[1].suit} w={56} h={78}/>
                : <FaceDown w={40} h={56}/>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info panel — hovering here (name / stack) shows the BET panel in manual mode */}
      <div className={`relative rounded-2xl border backdrop-blur-md overflow-hidden min-w-[115px] transition-all duration-500
        ${seat.isActive?'border-[#00d4ff]/55 shadow-[0_0_20px_rgba(0,212,255,0.28)]'
        :isWinner?'border-[#c9a227]/80 shadow-[0_0_30px_rgba(201,162,39,0.65)]'
        :isLoser?'border-white/5':'border-white/10'}`}
        style={{background:isLoser?'rgba(0,0,0,0.8)':'rgba(4,10,24,0.94)'}}
        onMouseEnter={onHover ? (e) => onHover(true, e) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}>
        {seat.isActive&&<div className="h-[2px] bg-gradient-to-r from-transparent via-[#00d4ff] to-transparent"/>}
        {isWinner&&<div className="h-[2px] bg-gradient-to-r from-transparent via-[#c9a227] to-transparent"/>}
        {seat.isSB&&!seat.isDealer&&(
          <span className="absolute -top-2.5 -left-1 w-5 h-5 rounded-full bg-blue-500 text-white text-[7px] font-black flex items-center justify-center shadow z-10">SB</span>
        )}
        {seat.isBB&&(
          <span className="absolute -top-2.5 -left-1 w-5 h-5 rounded-full bg-red-600 text-white text-[7px] font-black flex items-center justify-center shadow z-10">BB</span>
        )}
        {seat.isActive&&!hideTimer&&(
          <div className="mx-2.5 mt-1.5 h-[3px] rounded-full bg-white/8 overflow-hidden">
            <div key={`${turnNonce}:${turnPaused ? 'p' : 'r'}`} className="h-full rounded-full bg-[#00d4ff]"
              style={{ animation:`turnDrain ${turnSeconds}s linear forwards`, animationPlayState: turnPaused ? 'paused' : 'running' }}/>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-1">
          <div className="relative shrink-0 rounded-full"
            style={{boxShadow:seat.isActive?'0 0 0 2px rgba(0,212,255,0.6)':'0 0 0 1px rgba(255,255,255,0.12)'}}>
            <PlayerAvatar spec={avatarForSeat(seat.level, seat.idx, seat.isHero, seat.seatType === 'human')} size={42}/>
            {seat.isActive&&(
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00d4ff] border-2 border-[#040a18]">
                <div className="w-full h-full rounded-full bg-[#00d4ff] animate-ping opacity-70"/>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className={`text-[11px] font-bold font-display truncate transition-colors duration-500 ${isLoser?'text-white/60':'text-white'}`}>{seat.name}</p>
              <span className="text-[8px] font-bold px-1 rounded text-[#c9a227] bg-[#c9a227]/12 border border-[#c9a227]/25 shrink-0">{seat.position}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 shrink-0 shadow-[0_0_4px_rgba(52,211,153,0.7)]"/>
              <span className={`text-[12px] font-bold font-mono tabular-nums tracking-tight ${isLoser?'text-emerald-300/60':'text-emerald-300'}`}
                style={{textShadow:'0 1px 3px rgba(0,0,0,0.9)'}}>
                ${seat.stack.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        {seat.isSittingOut&&(
          <div className="mx-2 mb-1.5 px-2 py-0.5 rounded text-center text-[8px] font-bold uppercase tracking-widest border text-amber-300/70 bg-amber-900/15 border-amber-700/25">
            Absent
          </div>
        )}
        {seat.lastAction&&!seat.isSittingOut&&(
          <div className={`mx-2 mb-1.5 px-2 py-0.5 rounded text-center text-[8px] font-bold uppercase tracking-widest border
            ${seat.lastAction==='FOLD'?'text-red-400/60 bg-red-900/15 border-red-700/20'
            :seat.lastAction.startsWith('RAISE')||seat.lastAction.startsWith('BET')?'text-yellow-300 bg-yellow-900/30 border-yellow-700/40'
            :seat.lastAction==='ALL-IN'?'text-purple-300 bg-purple-900/30 border-purple-700/40'
            :seat.lastAction==='CHECK'?'text-sky-400 bg-sky-900/20 border-sky-700/30'
            :'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'}`}>
            {seat.lastAction}
          </div>
        )}
        {isWinner&&seat.handStrength&&(
          <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{delay:0.2}}
            className="mx-2 mb-1.5 px-2 py-0.5 text-[8px] text-[#c9a227] font-bold text-center bg-[#c9a227]/12 rounded border border-[#c9a227]/35">
            🏆 {seat.handStrength}
          </motion.div>
        )}
        {isLoser&&seat.handStrength&&(
          <div className="mx-2 mb-1.5 text-[8px] text-white/18 text-center">{seat.handStrength}</div>
        )}
        {isLoser&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.25,duration:0.4}}
            className="absolute inset-0 rounded-2xl pointer-events-none" style={{background:'rgba(0,0,0,0.28)'}}/>
        )}
      </div>
    </div>
  )
}

// ─── Table SVG ────────────────────────────────────────────────────────────────
type RoomVariant = 'default' | 'scenario' | 'sim'
const FELT_STOPS: Record<RoomVariant, [string, string, string, string]> = {
  default:  ['#1b7e8c', '#0e5b67', '#083e48', '#041a20'], // teal — the live training table
  scenario: ['#9a4150', '#6a2c39', '#3d1620', '#180809'], // warm garnet — "Setup Position" studio
  sim:      ['#5b3fa6', '#3c2a72', '#241848', '#0c0820'], // indigo — "Revive" sandbox
}
function TableSVG({ variant = 'default' }: { variant?: RoomVariant }) {
  const f = FELT_STOPS[variant]
  return (
    <svg viewBox="0 0 840 450" width="100%" style={{display:'block'}}>
      <defs>
        <radialGradient id="tF" cx="50%" cy="38%" r="58%">
          <stop offset="0%" stopColor={f[0]}/><stop offset="42%" stopColor={f[1]}/>
          <stop offset="78%" stopColor={f[2]}/><stop offset="100%" stopColor={f[3]}/>
        </radialGradient>
        <radialGradient id="tG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(28,180,200,0.12)"/><stop offset="100%" stopColor="transparent"/>
        </radialGradient>
        <linearGradient id="tR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8e870"/><stop offset="12%" stopColor="#d8b030"/>
          <stop offset="45%" stopColor="#a07818"/><stop offset="100%" stopColor="#2e1a02"/>
        </linearGradient>
        <linearGradient id="tW" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a4e20"/><stop offset="100%" stopColor="#1c0e04"/>
        </linearGradient>
        <filter id="tS" x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="16" stdDeviation="24" floodColor="black" floodOpacity="0.9"/>
        </filter>
        <filter id="tRG" x="-4%" y="-4%" width="108%" height="116%">
          <feGaussianBlur stdDeviation="5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="tC" cx="50%" cy="50%" r="45%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)"/><stop offset="100%" stopColor="transparent"/>
        </radialGradient>
      </defs>
      <ellipse cx="420" cy="235" rx="430" ry="245" fill="url(#tG)"/>
      <ellipse cx="424" cy="248" rx="390" ry="210" fill="black" opacity="0.75" filter="url(#tS)"/>
      <ellipse cx="420" cy="228" rx="388" ry="208" fill="url(#tR)" filter="url(#tRG)"/>
      <ellipse cx="420" cy="220" rx="384" ry="203" fill="none" stroke="rgba(255,245,160,0.22)" strokeWidth="2"/>
      <ellipse cx="420" cy="228" rx="370" ry="190" fill="url(#tW)"/>
      <ellipse cx="420" cy="228" rx="352" ry="172" fill="url(#tF)"/>
      <ellipse cx="420" cy="228" rx="350" ry="170" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1.5"/>
      <ellipse cx="420" cy="228" rx="308" ry="134" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1.2" strokeDasharray="12 9"/>
      <ellipse cx="420" cy="228" rx="200" ry="95" fill="url(#tC)"/>
      <g opacity="0.06" transform="translate(420,228)">
        <polygon points="0,-46 31,0 0,46 -31,0" fill="white"/>
        <circle cx="0" cy="0" r="12" fill="none" stroke="white" strokeWidth="1.2"/>
        <text x="0" y="5" textAnchor="middle" fontSize="12" fill="white" fontFamily="serif">♠</text>
      </g>
      {variant !== 'default' && (
        <text x="420" y="300" textAnchor="middle" fontSize="20" letterSpacing="9" fontWeight="bold"
          fill={variant === 'scenario' ? '#f0c060' : '#b9a6ff'} opacity="0.16" fontFamily="sans-serif">
          {variant === 'scenario' ? 'SETUP POSITION' : 'SIMULATION'}
        </text>
      )}
    </svg>
  )
}
function Room({ variant = 'default' }: { variant?: RoomVariant }) {
  if (variant === 'scenario') {
    // "Setup Position" studio — warm garnet/amber, distinct from the teal training
    // room and the indigo Revive sandbox. Same logic, just its own identity.
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0" style={{background:'radial-gradient(120% 95% at 50% 26%, #2a1018 0%, #1a0a10 50%, #0a0406 100%)'}}/>
        <div className="absolute inset-x-0 top-0" style={{height:'82%',background:'radial-gradient(ellipse 70% 60% at 50% -6%, rgba(240,180,80,0.30) 0%, rgba(180,90,40,0.14) 42%, transparent 72%)'}}/>
        <div className="absolute inset-x-0 bottom-0" style={{height:'70%',background:'radial-gradient(ellipse 62% 56% at 50% 84%, rgba(200,70,90,0.16) 0%, transparent 64%)'}}/>
        <div className="absolute inset-0" style={{background:'radial-gradient(125% 105% at 50% 46%, transparent 54%, rgba(0,0,0,0.58) 100%)'}}/>
        <div className="absolute inset-x-0 top-0" style={{height:'24%',background:'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)'}}/>
        <div className="absolute inset-x-0 bottom-0" style={{height:'20%',background:'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, transparent 100%)'}}/>
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{background:'rgba(255,220,150,0.95)',boxShadow:'0 0 22px 11px rgba(230,170,70,0.45), 0 0 72px 34px rgba(200,110,40,0.25)'}}/>
      </div>
    )
  }
  if (variant === 'sim') {
    // "Lab / simulation" ambiance — cool desaturated indigo, blueprint grid,
    // so the test table reads instantly as a sandbox, not the real cash game.
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0" style={{background:'radial-gradient(120% 95% at 50% 26%, #1a1840 0%, #0e0c26 50%, #060512 100%)'}}/>
        <div className="absolute inset-x-0 top-0" style={{height:'82%',background:'radial-gradient(ellipse 70% 60% at 50% -6%, rgba(150,120,255,0.30) 0%, rgba(90,70,200,0.12) 42%, transparent 72%)'}}/>
        {/* blueprint grid */}
        <div className="absolute inset-0" style={{opacity:0.16,backgroundImage:'linear-gradient(rgba(150,170,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(150,170,255,0.5) 1px, transparent 1px)',backgroundSize:'46px 46px'}}/>
        <div className="absolute inset-0" style={{background:'radial-gradient(125% 105% at 50% 46%, transparent 52%, rgba(0,0,0,0.6) 100%)'}}/>
        <div className="absolute inset-x-0 top-0" style={{height:'24%',background:'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)'}}/>
        <div className="absolute inset-x-0 bottom-0" style={{height:'20%',background:'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, transparent 100%)'}}/>
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{background:'rgba(190,170,255,0.95)',boxShadow:'0 0 22px 11px rgba(150,120,255,0.45), 0 0 72px 34px rgba(110,80,220,0.25)'}}/>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* deep cool lounge base */}
      <div className="absolute inset-0" style={{background:'radial-gradient(120% 95% at 50% 28%, #0f2230 0%, #0a1622 46%, #050a12 100%)'}}/>
      {/* warm gold spotlight from the chandelier above */}
      <div className="absolute inset-x-0 top-0" style={{height:'82%',background:'radial-gradient(ellipse 68% 62% at 50% -6%, rgba(214,172,64,0.42) 0%, rgba(150,100,28,0.16) 40%, transparent 72%)'}}/>
      {/* cool teal glow rising from the felt */}
      <div className="absolute inset-x-0 bottom-0" style={{height:'72%',background:'radial-gradient(ellipse 62% 56% at 50% 82%, rgba(24,150,170,0.20) 0%, transparent 64%)'}}/>
      {/* soft side ambiance */}
      <div className="absolute top-0 bottom-0 left-0" style={{width:'30%',background:'radial-gradient(ellipse at 0% 45%, rgba(184,124,40,0.16) 0%, transparent 60%)'}}/>
      <div className="absolute top-0 bottom-0 right-0" style={{width:'30%',background:'radial-gradient(ellipse at 100% 45%, rgba(184,124,40,0.16) 0%, transparent 60%)'}}/>
      {/* focus vignette */}
      <div className="absolute inset-0" style={{background:'radial-gradient(125% 105% at 50% 46%, transparent 54%, rgba(0,0,0,0.55) 100%)'}}/>
      <div className="absolute inset-x-0 top-0" style={{height:'26%',background:'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, transparent 100%)'}}/>
      <div className="absolute inset-x-0 bottom-0" style={{height:'20%',background:'linear-gradient(0deg, rgba(0,0,0,0.80) 0%, transparent 100%)'}}/>
      {/* chandelier point + cool accent lights */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{background:'rgba(255,236,152,0.95)',boxShadow:'0 0 22px 11px rgba(222,182,62,0.5), 0 0 72px 34px rgba(180,120,30,0.28)'}}/>
      <div className="absolute top-[30%] left-12 w-1.5 h-1.5 rounded-full" style={{background:'rgba(120,214,232,0.7)',boxShadow:'0 0 14px 7px rgba(40,168,196,0.35)'}}/>
      <div className="absolute top-[30%] right-12 w-1.5 h-1.5 rounded-full" style={{background:'rgba(120,214,232,0.7)',boxShadow:'0 0 14px 7px rgba(40,168,196,0.35)'}}/>
    </div>
  )
}

// ─── Hand History Modal ───────────────────────────────────────────────────────
function computeStepState(record: HandHistoryRecord, stepIdx: number): {
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
interface MoveCritique { verdict: 'good' | 'ok' | 'mistake'; headline: string; lines: string[] }
function boardForPhase(board: (Card | null)[], phase: Phase): Card[] {
  const b = board.filter(Boolean) as Card[]
  if (phase === 'flop') return b.slice(0, 3)
  if (phase === 'turn') return b.slice(0, 4)
  if (phase === 'river' || phase === 'showdown') return b
  return []
}
// Pre-flop action order for a seat (0 = first to act = UTG / left of the BB),
// derived from the button position stored on the record. Used to count how many
// live players still act behind the hero (→ RFI steal width).
function preflopActIndex(seatIdx: number, players: HandHistoryRecord['players']): number {
  const n = players.length
  const dealerIdx = players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
  const bbOffset = n === 2 ? 1 : 2
  const firstOffset = (bbOffset + 1) % n
  return ((((seatIdx - dealerIdx) % n + n) % n) - firstOffset + n) % n
}
function critiqueHeroMove(record: HandHistoryRecord, actionIdx: number): MoveCritique | null {
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
  let preflopRaises = 0
  let preflopCallers = 0
  let lastAggressorName = ''
  let lastPreflopRaiserIdx = -1
  const allInSeats = new Set<number>()
  const preflopRaiseAmts: number[] = []
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
    if (a.phase === 'preflop' && (a.actionType === 'RAISE' || a.actionType === 'ALL-IN')) { preflopRaises++; lastPreflopRaiserIdx = a.seatIdx; preflopRaiseAmts.push(a.amount) }
    if (a.phase === 'preflop' && a.actionType === 'ALL-IN') allInSeats.add(a.seatIdx)
    pot = a.potAfter
  }

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
    const numAllIn = [...allInSeats].filter(idx => idx !== hero.idx && !folded.has(idx)).length
    const vsJam = numAllIn >= 1
    const vsOpenerPos = scenario === 'vsopen' ? record.players.find(p => p.idx === lastPreflopRaiserIdx)?.position : undefined
    const reRaiseRatio = scenario === 'vs3bet' && preflopRaiseAmts.length >= 2 && preflopRaiseAmts[0] > 0 ? preflopRaiseAmts[1] / preflopRaiseAmts[0] : undefined
    // 3-bettor in position (acts after us post-flop)? n = seats, dealer = BTN seat.
    const dealerIdxC = record.players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
    const nC = record.players.length
    const postIdx = (s: number) => (((s - dealerIdxC) % nC + nC) % nC - 1 + nC) % nC
    const threeBettorIP = scenario === 'vs3bet' && lastPreflopRaiserIdx >= 0 ? postIdx(lastPreflopRaiserIdx) > postIdx(hero.idx) : undefined
    const map = vsJam
      ? buildJamCallMap(record.bb > 0 ? effStack / record.bb : 100, numAllIn)
      : buildRangeMap(scenario, hero.position, (scenario === 'rfi' || scenario === 'iso') ? playersBehind : undefined,
          { raiseToBB: record.bb > 0 ? currentBet / record.bb : undefined, multiway: live.length > 2, vsOpenerPos, reRaiseRatio, threeBettorIP, effBB: record.bb > 0 ? effStack / record.bb : undefined })
    const key = handKeyFromCards(hero.holeCards[0], hero.holeCards[1])
    const rec = map.get(key) ?? 'fold'
    const recCat: 'fold' | 'passive' | 'aggr' = rec === 'fold' ? 'fold' : rec === 'call' ? 'passive' : 'aggr'
    const recLabel = rec === 'fold' ? 'FOLD'
      : rec === 'call' ? (vsJam ? 'CALL (paie le tapis)' : 'CALL')
      : rec === '3bet' ? (scenario === 'squeeze' ? 'SQUEEZE (3-bet)' : '3-BET')
      : rec === '4bet' ? (scenario === 'vs4bet' ? '5-BET / TAPIS' : '4-BET')
      : scenario === 'iso' ? 'ISO-RAISE' : 'OPEN/RAISE'
    const ctx = vsJam ? `en ${hero.position}, face à ${numAllIn} tapis (all-in)`
      : scenario === 'rfi' ? `en ${hero.position}, personne n’a ouvert`
      : scenario === 'iso' ? `en ${hero.position}, des limpers devant (iso-raise)`
      : scenario === 'vsopen' ? `en ${hero.position}, face à l’ouverture${lastAggressorName ? ' de ' + lastAggressorName : ''}`
      : scenario === 'squeeze' ? `en ${hero.position}, face à une relance + suiveur (squeeze)`
      : scenario === 'vs4bet' ? `en ${hero.position}, face à un 4-bet`
      : `en ${hero.position}, face au 3-bet${lastAggressorName ? ' de ' + lastAggressorName : ''}`
    lines.push(`Situation : ${ctx}. Ta main : ${key}.`)
    lines.push(`Range de référence : ${key} se joue ${recLabel}.`)
    // For an "open too wide" call, separate a genuine punt from a borderline open
    // that's only a hair outside the range — the latter is a mix, not a leak.
    const openMargin = scenario === 'rfi' ? handOpenRank(key) - openPctFor(hero.position, playersBehind) : 99
    if (heroCat === recCat) { verdict = 'good'; headline = `Bon coup — ${recLabel}` ; lines.push('Ton choix colle à la range standard de cette position/situation. ✅') }
    else if (recCat === 'fold' && heroCat === 'aggr' && openMargin <= 12) { verdict = 'ok'; headline = 'Open borderline'; lines.push(`${key} est juste en dehors de la range standard (${recLabel === 'FOLD' ? 'fold' : recLabel}) — un open marginal qui se défend/se mixe ici, pas une fuite.`) }
    else if (recCat === 'fold' && heroCat !== 'fold') { verdict = 'mistake'; headline = 'Trop large'; lines.push(`${key} n’est pas dans ta range ici — jouer ce coup perd de l’argent sur le long terme.`) }
    else if (recCat === 'aggr' && heroCat === 'passive') { verdict = 'ok'; headline = 'Trop passif'; lines.push(`${key} devrait ${recLabel} (value + initiative), pas seulement suivre — tu laisses de la valeur et de la fold equity.`) }
    else if (recCat === 'aggr' && heroCat === 'fold') { verdict = 'mistake'; headline = 'Fold trop serré'; lines.push(`${key} est assez fort pour ${recLabel} — le coucher est une fuite.`) }
    else if (recCat === 'passive' && heroCat === 'aggr') { verdict = 'ok'; headline = 'Sur-agressif'; lines.push(`${key} est plutôt un call ici ; relancer te fait jouer un gros pot dominé une partie du temps.`) }
    else if (recCat === 'passive' && heroCat === 'fold') { verdict = 'ok'; headline = 'Fold un peu serré'; lines.push(`${key} pouvait suivre (cote/jouabilité), mais le fold reste défendable.`) }
  } else {
    const villainBets = record.actions.slice(0, actionIdx).filter(a => a.seatIdx >= 0 && !a.isHero && (a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))
    const aggression = Math.min(0.85, villainBets.length * 0.28)
    const barrels = new Set(villainBets.filter(a => a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river').map(a => a.phase)).size
    const adv = getPostflopAdvice({ hole: [hero.holeCards[0], hero.holeCards[1]], board, pot, toCall, heroStack: heroRemaining, effStack, opponents, inPosition: latePos, aggression, barrels, bb: record.bb })
    const recAggr = adv.action === 'BET' || adv.action === 'RAISE'
    const recCat: 'fold' | 'passive' | 'aggr' = adv.action === 'FOLD' ? 'fold' : recAggr ? 'aggr' : 'passive'
    const phaseLbl = PHASE_LABEL[phase] ?? phase
    lines.push(`Situation : ${phaseLbl}, board ${board.map(c => c.rank + c.suit).join(' ')}${lastAggressorName && toCall > 0 ? `, ${lastAggressorName} a misé` : ''}.`)
    lines.push(`Ton équité ≈ ${pct(adv.equity)}${toCall > 0 ? ` — cote requise ${pct(adv.potOdds)}` : ''} ; ta main : ${adv.madeHand}${adv.draws.length ? ' + ' + adv.draws.join(' + ') : ''}.`)
    lines.push(`Coup optimal : ${adv.action} (${adv.sizingText}).`)
    adv.reasons.slice(1, 3).forEach(r => lines.push(r))
    if (heroCat === recCat) { verdict = 'good'; headline = `Bon coup — ${adv.action}`; lines.push('Ta décision correspond au coup recommandé. ✅') }
    else if (recCat === 'fold' && heroCat !== 'fold') { verdict = 'mistake'; headline = 'Tu continues trop'; lines.push(`Ton équité (${pct(adv.equity)}) est sous la cote (${pct(adv.potOdds)}) : payer/relancer perd à long terme.`) }
    else if (recCat === 'aggr' && heroCat === 'passive') { verdict = 'ok'; headline = 'Trop passif'; lines.push('Tu avais une main/équité pour miser ou relancer (value + protection) — checker/suivre laisse de la valeur.') }
    else if (recCat === 'aggr' && heroCat === 'fold') { verdict = 'mistake'; headline = 'Fold de trop'; lines.push('Tu te couches une main qui devait miser pour la valeur.') }
    else if (recCat === 'passive' && heroCat === 'aggr') { verdict = 'ok'; headline = 'Sur-agressif'; lines.push('Relancer transforme une main de showdown/bluffcatch en cible : tu fais fuir les pires mains et payer les meilleures.') }
    else if (recCat === 'passive' && heroCat === 'fold') { verdict = 'mistake'; headline = 'Fold rentable manqué'; lines.push(`Tu avais la cote (${pct(adv.equity)} ≥ ${pct(adv.potOdds)}) : se coucher jette de l’EV.`) }
  }
  return { verdict, headline, lines }
}

// Replay the hand up to `stepIdx` through the range estimator → each player's
// estimated range at that moment (for the history hover, same engine as in-game).
function reconstructRanges(record: HandHistoryRecord, stepIdx: number): Record<number, RangeWeights> {
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
      })
    }
    if (a.actionType === 'FOLD') { /* stays */ }
    else if (a.actionType !== 'CHECK') { bet[a.seatIdx] = a.amount; if (a.amount > currentBet) currentBet = a.amount; pot = a.potAfter }
    if (a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN') preRaises++
  }
  return ranges
}

// Short "move + effect" summary of a player's latest action up to a step.
function playerLastMeta(record: HandHistoryRecord, idx: number, stepIdx: number): { move: string; effect: string } {
  let last: HistoryAction | null = null, numCallers = 0, raises = 0
  for (let i = 0; i <= stepIdx && i < record.actions.length; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) { if (a.phase !== 'preflop') { numCallers = 0; raises = 0 } continue }
    if (a.actionType === 'CALL') numCallers++
    if (a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN') raises++
    if (a.seatIdx === idx && a.actionType !== 'SB' && a.actionType !== 'BB') last = a
  }
  if (!last) return { move: '—', effect: 'pas encore parlé ce coup' }
  const cat: ActCat = last.actionType === 'FOLD' ? 'fold' : last.actionType === 'CHECK' ? 'check' : last.actionType === 'CALL' ? 'call' : 'aggr'
  return actionSummary(cat, { preflop: last.phase === 'preflop', numCallers, was3betPlus: cat === 'aggr' && raises >= 2 })
}

function HandHistoryModal({ records, onClose, onRevive }: {
  records: HandHistoryRecord[]
  onClose: () => void
  onRevive: (record: HandHistoryRecord, stepIdx: number) => void
}) {
  const [selectedId, setSelectedId] = useState<number|null>(records.length > 0 ? records[records.length-1].id : null)
  const [stepIdx, setStepIdx] = useState<number>(0)
  const [critique, setCritique] = useState<MoveCritique | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const record = records.find(r => r.id === selectedId) ?? null

  useEffect(() => {
    if (record) setStepIdx(record.actions.length - 1)
  }, [selectedId, record])
  // Clear the critique whenever we move to another step / hand.
  useEffect(() => { setCritique(null) }, [stepIdx, selectedId])

  // Range Vision in the replay — hover a player to see their estimated range.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverXY, setHoverXY] = useState<{ x: number; y: number } | null>(null)
  const stepRanges = useMemo(() => (record ? reconstructRanges(record, stepIdx) : {}), [record?.id, stepIdx])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [stepIdx, selectedId])

  if (!record) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.85)'}}>
        <div className="bg-[#070d1a] border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-white/60 mb-4">Aucun historique disponible</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/15">Fermer</button>
        </div>
      </div>
    )
  }

  const isEnd = stepIdx >= record.actions.length - 1
  const stepState = computeStepState(record, stepIdx)

  // Position players around mini ellipse (hero at bottom)
  const CX = 50, CY = 46, RX = 38, RY = 30
  const heroIdx = record.players.findIndex(p => p.isHero)
  const n = record.players.length

  function getPlayerPos(playerArrayIdx: number): {x:number; y:number} {
    const offset = heroIdx >= 0 ? playerArrayIdx - heroIdx : playerArrayIdx
    const angle = (offset / n) * 2 * Math.PI + Math.PI / 2
    return {
      x: CX + RX * Math.cos(angle),
      y: CY + RY * Math.sin(angle),
    }
  }

  // Action log entries up to stepIdx
  const visibleActions = record.actions.slice(0, stepIdx + 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{background:'rgba(0,0,0,0.9)'}}>
      <motion.div initial={{opacity:0,scale:0.94,y:16}} animate={{opacity:1,scale:1,y:0}}
        className="w-full max-w-[1480px] h-[94vh] flex flex-col rounded-2xl border border-white/10 overflow-hidden"
        style={{background:'#070d1a'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white/70 uppercase tracking-widest">Historique des mains</span>
            <span className="text-sm text-[#c9a227] font-bold">{records.length} main{records.length>1?'s':''}</span>
            <span className="text-[10px] text-[#c9a227]/70 hidden md:inline">👁 survole un joueur → sa range</span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Revive: re-create THIS exact spot as a playable sandbox. Opponents'
                cards are re-drawn from the range their line implies at this step. */}
            <button onClick={() => onRevive(record, stepIdx)}
              title="Recrée cette situation exacte en simulation jouable — les adversaires gardent leur range, leurs cartes sont retirées au hasard dedans"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl font-black uppercase tracking-[0.18em] text-[11px] transition-all hover:scale-[1.03]"
              style={{ background: 'linear-gradient(135deg,#a78bff,#6d4ed6,#3c2a72)', color: '#0a0716', boxShadow: '0 0 22px rgba(140,110,255,0.45)' }}>
              ⚡ Revive situation
            </button>
            <button onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-lg">
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">

          {/* Hand list */}
          <div className="w-52 flex-shrink-0 border-r border-white/8 overflow-y-auto">
            {[...records].reverse().map(r => {
              const profit = r.heroProfit
              return (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 transition-all
                    ${r.id===selectedId?'bg-[#c9a227]/10 border-l-2 border-l-[#c9a227]':'hover:bg-white/5'}`}>
                  <div className="text-[13px] font-bold text-white/80">Main #{r.handNum}</div>
                  <div className={`text-xs font-mono font-bold ${profit>0?'text-emerald-400':profit<0?'text-red-400':'text-white/30'}`}>
                    {profit>0?'+':''}{profit} BB
                  </div>
                  <div className="text-[10px] text-white/30">{r.date.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})}</div>
                </button>
              )
            })}
          </div>

          {/* Main content */}
          <div className="flex-1 flex min-w-0 min-h-0">

            {/* Mini table view */}
            <div className="flex-1 flex flex-col min-w-0 p-5 gap-3">
              <div className="text-xs font-bold text-white/50 uppercase tracking-widest">
                Main #{record.handNum} — {record.date.toLocaleDateString('fr')} {record.date.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})}
              </div>

              {/* Table area */}
              <div className="relative flex-1 min-h-0" style={{minHeight:480}}>
                {/* Table SVG bg */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div style={{width:'100%',maxWidth:900,opacity:0.78}}>
                    <TableSVG/>
                  </div>
                </div>

                {/* Players */}
                {record.players.map((pl, i) => {
                  const pos = getPlayerPos(i)
                  const stepPl = stepState.players.find(sp => sp.idx === pl.idx)
                  const isFolded = stepPl?.isFolded ?? false
                  // At the final step show the real end stack (includes winnings);
                  // mid-replay show the reconstructed committed stack.
                  const stack = isEnd ? pl.endStack : (stepPl?.stack ?? pl.startStack)
                  const isWinner = isEnd && pl.isWinner
                  const showCards = pl.isHero || isEnd

                  const inHand = !isFolded && (pl.holeCards[0] !== null || pl.holeCards[1] !== null)
                  return (
                    <div key={pl.idx}
                      className={`absolute flex flex-col items-center transition-all duration-300 ${isFolded?'opacity-30 grayscale':''} ${inHand?'cursor-help':''}`}
                      style={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                      }}
                      onMouseEnter={inHand ? (e) => { setHoverIdx(pl.idx); setHoverXY({ x: e.clientX, y: e.clientY }) } : undefined}
                      onMouseLeave={inHand ? () => { setHoverIdx(null); setHoverXY(null) } : undefined}>
                      {/* Cards */}
                      {(pl.holeCards[0] || pl.holeCards[1]) && (
                        <div className="flex gap-0.5 mb-1">
                          {[0,1].map(ci => {
                            const card = pl.holeCards[ci as 0|1]
                            if (!card) return null
                            if (showCards && card) {
                              return <PlayingCard key={ci} rank={card.rank} suit={card.suit as Suit} w={44} h={62}/>
                            }
                            return <FaceDown key={ci} w={36} h={50}/>
                          })}
                        </div>
                      )}
                      {/* Name badge */}
                      <div className={`px-2.5 py-0.5 rounded-lg border text-[12.5px] font-bold whitespace-nowrap
                        ${pl.isHero?'border-[#00d4ff]/50 bg-[#00d4ff]/10 text-[#00d4ff]'
                        :isWinner?'border-[#c9a227]/60 bg-[#c9a227]/10 text-[#c9a227]'
                        :'border-white/10 bg-black/40 text-white/70'}`}>
                        {pl.isHero ? 'Vous' : pl.name}
                      </div>
                      <div className="text-[12px] font-bold text-emerald-300/90 font-mono mt-0.5">${stack}</div>
                      {isWinner && <div className="text-lg">🏆</div>}
                    </div>
                  )
                })}

                {/* Live bets in front of players (re-enacted street by street) */}
                {record.players.map((pl, i) => {
                  const amt = stepState.streetBets[pl.idx] ?? 0
                  if (amt <= 0) return null
                  const pos = getPlayerPos(i)
                  const off = betOffset(pos.x, pos.y)
                  return (
                    <div key={`bet-${pl.idx}`} className="absolute pointer-events-none flex flex-col items-center gap-0.5"
                      style={{ left: `${pos.x + off.x}%`, top: `${pos.y + off.y}%`, transform: 'translate(-50%,-50%)', zIndex: 12 }}>
                      <ChipStack amount={amt} sz={16} maxVisible={5}/>
                      <span className="text-[10px] font-mono text-[#c9a227] font-bold bg-black/55 px-1 rounded">${amt}</span>
                    </div>
                  )
                })}

                {/* Board cards */}
                <div className="absolute left-1/2 -translate-x-1/2" style={{top:'41%',transform:'translate(-50%,-50%)'}}>
                  <div className="flex gap-2 items-center">
                    {stepState.board.map((card, i) => (
                      <div key={i}>
                        {card
                          ? <PlayingCard rank={card.rank} suit={card.suit as Suit} w={60} h={84}/>
                          : <EmptySlot w={60} h={84}/>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pot */}
                <div className="absolute left-1/2 top-[59%] -translate-x-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-2 bg-black/65 border border-[#c9a227]/30 rounded-lg px-4 py-1.5">
                    <span className="text-[11px] text-white/45 uppercase tracking-wide">Pot</span>
                    <span className="text-base font-bold text-[#c9a227] font-mono">${stepState.pot}</span>
                  </div>
                </div>
              </div>

              {/* Step controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setStepIdx(0)}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>|◀</button>
                <button onClick={() => setStepIdx(s => Math.max(0, s-1))}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>◀</button>
                <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden cursor-pointer"
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = (e.clientX - rect.left) / rect.width
                    setStepIdx(Math.round(ratio * (record.actions.length - 1)))
                  }}>
                  <div className="h-full bg-[#c9a227] rounded-full transition-all"
                    style={{width:`${record.actions.length>1?(stepIdx/(record.actions.length-1))*100:100}%`}}/>
                </div>
                <button onClick={() => setStepIdx(s => Math.min(record.actions.length-1, s+1))}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={isEnd}>▶</button>
                <button onClick={() => setStepIdx(record.actions.length-1)}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={isEnd}>▶|</button>
                <span className="text-xs text-white/40 font-mono">{stepIdx+1}/{record.actions.length}</span>
              </div>

              {/* Coach juge — appears only on the hero's own moves */}
              {(() => {
                const a = record.actions[stepIdx]
                if (!a || a.seatIdx < 0 || !a.isHero || a.actionType === 'SB' || a.actionType === 'BB') return null
                return (
                  <div className="flex-shrink-0">
                    {!critique ? (
                      <button onClick={() => setCritique(critiqueHeroMove(record, stepIdx))}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#c9a227]/40 bg-[#c9a227]/10 text-[#c9a227] font-bold text-xs uppercase tracking-widest hover:bg-[#c9a227]/20 transition-all">
                        👁 Juge mon coup ({a.actionType}{a.amount > 0 ? ` $${a.amount}` : ''})
                      </button>
                    ) : (
                      <div className="rounded-xl border p-3.5" style={{
                        background: critique.verdict === 'good' ? 'rgba(31,157,94,0.10)' : critique.verdict === 'mistake' ? 'rgba(192,57,49,0.10)' : 'rgba(201,162,39,0.08)',
                        borderColor: critique.verdict === 'good' ? 'rgba(31,157,94,0.45)' : critique.verdict === 'mistake' ? 'rgba(192,57,49,0.45)' : 'rgba(201,162,39,0.35)',
                      }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{critique.verdict === 'good' ? '✅' : critique.verdict === 'mistake' ? '❌' : '⚠️'}</span>
                            <span className="text-sm font-black uppercase tracking-wide" style={{ color: critique.verdict === 'good' ? '#34d399' : critique.verdict === 'mistake' ? '#f87171' : '#e8c547' }}>{critique.headline}</span>
                          </div>
                          <button onClick={() => setCritique(null)} className="text-white/40 hover:text-white text-sm">✕</button>
                        </div>
                        <div className="space-y-1.5">
                          {critique.lines.map((l, i) => (
                            <p key={i} className="text-[12.5px] text-white/80 leading-relaxed flex gap-1.5">
                              <span className="text-[#c9a227] mt-0.5">▸</span>{l}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Summary */}
              {isEnd && (
                <div className="flex-shrink-0 bg-[#c9a227]/8 border border-[#c9a227]/20 rounded-xl p-4 flex items-center gap-8">
                  <div>
                    <span className="text-[10px] text-white/40 uppercase tracking-wide">Gagnant</span>
                    <p className="text-sm font-bold text-[#c9a227]">{record.winnerNames.join(', ')}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-white/40 uppercase tracking-wide">Pot final</span>
                    <p className="text-sm font-bold text-white/70">${record.finalPot}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-white/40 uppercase tracking-wide">Votre résultat</span>
                    <p className={`text-sm font-bold ${record.heroProfit>0?'text-emerald-400':record.heroProfit<0?'text-red-400':'text-white/50'}`}>
                      {record.heroProfit>0?'+':''}{record.heroProfit} BB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action log */}
            <div className="w-72 flex-shrink-0 border-l border-white/8 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-white/8 flex-shrink-0">
                <span className="text-xs font-bold text-white/50 uppercase tracking-widest">Journal des actions</span>
              </div>
              <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-1">
                {visibleActions.map((a, i) => {
                  const isCurrentStep = i === stepIdx
                  if (a.seatIdx === -1) {
                    // Phase divider
                    return (
                      <div key={i} className={`text-center py-1.5 ${isCurrentStep?'text-[#c9a227]':'text-white/30'}`}>
                        <span className="text-[10px] font-bold uppercase tracking-widest border-t border-b border-current px-2">
                          — {PHASE_LABEL[a.phase] ?? a.phase} —
                        </span>
                      </div>
                    )
                  }
                  const pl = record.players.find(p => p.idx === a.seatIdx)
                  const isHero = pl?.isHero ?? false
                  return (
                    <div key={i} onClick={() => setStepIdx(i)}
                      className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-[12px] flex items-center gap-2
                        ${isCurrentStep?'bg-[#c9a227]/15 border border-[#c9a227]/30':'hover:bg-white/5 border border-transparent'}`}>
                      <span className={`font-bold truncate max-w-[90px] ${isHero?'text-[#00d4ff]':'text-white/70'}`}>
                        {pl?.name ?? `Seat${a.seatIdx}`}
                      </span>
                      <span className={`font-bold uppercase
                        ${a.actionType==='FOLD'?'text-red-400/70'
                        :a.actionType==='RAISE'||a.actionType==='BET'||a.actionType==='ALL-IN'?'text-yellow-300'
                        :a.actionType==='CHECK'?'text-sky-400'
                        :'text-emerald-400'}`}>
                        {a.actionType}
                      </span>
                      {a.amount > 0 && <span className="text-white/50 font-mono">${a.amount}</span>}
                      <span className="ml-auto text-white/25 font-mono text-[10px]">pot${a.potAfter}</span>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      </motion.div>

      {/* Range Vision popup in the replay (fixed + clamped to the viewport) */}
      {hoverIdx !== null && hoverXY && stepRanges[hoverIdx] && (() => {
        const pl = record.players.find(p => p.idx === hoverIdx)
        if (!pl) return null
        const view = rangeView(stepRanges[hoverIdx])
        const meta = playerLastMeta(record, hoverIdx, stepIdx)
        const heroKey = pl.isHero && pl.holeCards[0] && pl.holeCards[1] ? handKeyFromCards(pl.holeCards[0], pl.holeCards[1]) : null
        const W = 312, H = 372
        let x = hoverXY.x + 18, y = hoverXY.y - H / 2
        if (x + W > window.innerWidth - 8) x = hoverXY.x - W - 18
        if (x < 8) x = 8
        if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8
        if (y < 8) y = 8
        return (
          <div className="fixed z-[60] pointer-events-none" style={{ left: x, top: y }}>
            <RangeHeatmap view={view} move={meta.move} effect={meta.effect}
              name={pl.isHero ? 'Toi (range représentée)' : pl.name} heroKey={heroKey}/>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Main GamePage Component ──────────────────────────────────────────────────
export default function GamePage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const cfg = (location.state ?? {}) as Partial<GameConfig>

  const numPlayers = cfg.numPlayers ?? 6
  const selectedSeat = cfg.selectedSeat ?? 0
  const stackBB = cfg.stackBB ?? 100
  const sbAmt = cfg.sb ?? 1
  const bbAmt = cfg.bb ?? 2
  const anteAmt = cfg.ante ?? 0
  const displayName = cfg.displayName ?? 'Hero'
  const slots = cfg.slots ?? Array.from({length: numPlayers - 1}, () => ({type:'bot', level:2}))
  const decisionTimer = cfg.decisionTimer && cfg.decisionTimer > 0 ? cfg.decisionTimer : 25

  // ─── State ───────────────────────────────────────────────────────────────
  const [gs, setGs] = useState<GState>(() => ({
    phase: 'idle', deck: [], seats: [], community: [null,null,null,null,null],
    pot: 0, currentBet: 0, minRaise: bbAmt, actQueue: [],
    dealerIdx: 0, handNum: 0, log: [], winners: [],
    paused: false, autoRunning: false,
  }))
  const [chipFlights, setChipFlights] = useState<ChipFlight[]>([])
  const [heroBetAmt, setHeroBetAmt] = useState(bbAmt * 2)
  const [handHistory, setHandHistory] = useState<HandHistoryRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  // ── "Revive situation" — replay a historical spot as a playable sandbox.
  const [simMode, setSimMode] = useState(false)
  const simModeRef = useRef(false)
  const [simResult, setSimResult] = useState<GState | null>(null)   // set at sim showdown → prompt
  const simSeedRef = useRef<{ record: HandHistoryRecord; stepIdx: number } | null>(null)
  // ── Scenario "manual authoring" mode: you drive every action in turn order by
  // clicking the on-turn player; bots never auto-play; the coach updates live.
  const [manualMode, setManualMode] = useState(false)
  const manualModeRef = useRef(false)
  const [manualPanel, setManualPanel] = useState<number | null>(null) // seat whose action panel is open
  const [manualBet, setManualBet] = useState('')                       // bet/raise "to" amount input (in BB)
  // Undo stack for manual authoring — one snapshot per action so you can step back.
  const manualUndoRef = useRef<Array<{ gs: GState; actions: HistoryAction[]; ranges: Record<number, RangeWeights>; rangeMeta: Record<number, { move: string; effect: string }> }>>([])
  const [manualUndoDepth, setManualUndoDepth] = useState(0)
  const savedRealRef = useRef<null | {
    gs: GState; actions: HistoryAction[]; handStartStacks: Record<number, number>
    ranges: Record<number, RangeWeights>; rangeMeta: Record<number, { move: string; effect: string }>
    mood: Record<number, number>
  }>(null)
  const [showLog, setShowLog] = useState(false)
  const [sitOut, setSitOut] = useState(false)
  const [rebuyAmt, setRebuyAmt] = useState(stackBB * bbAmt)
  // Pre-action ("check box") queued while waiting for the hero's turn.
  const [preAction, setPreActionState] = useState<'none' | 'fold' | 'checkcall'>('none')
  const preActionRef = useRef<'none' | 'fold' | 'checkcall'>('none')
  function setPreAction(v: 'none' | 'fold' | 'checkcall') { preActionRef.current = v; setPreActionState(v) }
  // ── Range Vision: estimated ranges, tracked live per seat — ALWAYS ON now.
  // Hover any in-hand player → their range. Hover your own profile → range +
  // full coach advice (no buttons to click; it's a hover-card kept open while
  // the cursor is over the profile or the panel).
  const [hoverSeat, setHoverSeat] = useState<number | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [heroPanelHover, setHeroPanelHover] = useState(false)
  const heroPanelHoverRef = useRef(false)
  const coachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionRef = useRef(true)
  const rangeRef = useRef<Record<number, RangeWeights>>({})
  const rangeMetaRef = useRef<Record<number, { move: string; effect: string }>>({})

  const gsRef = useRef<GState>(gs)
  // Bumped on every flow transition (revive / exit-sim / stop / next-hand) so a
  // deferred street-transition timer (showdown/dealCommunity) from a previous
  // context bails instead of mutating the wrong game state. Pause does NOT bump
  // it — paused transitions must still resolve, exactly as before.
  const flowGenRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextHandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dealTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const sitOutRef = useRef(false)
  // Per-seat "mood" for Human-style players (-1 tilted … 0 neutral … +1 confident).
  const moodRef = useRef<Record<number, number>>({})
  const chipIdRef = useRef(0)
  const currentHandActionsRef = useRef<HistoryAction[]>([])
  const handStartStacksRef = useRef<Record<number, number>>({})
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => { gsRef.current = gs }, [gs])

  // Auto-start a custom scenario (from SetupPositionPage) once, on mount. The guard
  // is checked when the timer FIRES (not when scheduled) so React StrictMode's
  // mount→cleanup→remount in dev can't cancel it permanently.
  const scenarioStartedRef = useRef(false)
  useEffect(() => {
    if (!cfg.scenario) return
    const t = setTimeout(() => {
      if (scenarioStartedRef.current) return
      scenarioStartedRef.current = true
      startScenario(cfg.scenario as ScenarioCfg, cfg.playLive !== false)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function getSeatPosPct(idx: number, total: number): { left: string; top: string; transform: string } {
    // Hero always at bottom center (index maps to anglular position)
    // seats are ordered: hero at bottom, others clockwise
    const heroLocal = selectedSeat
    const offset = ((idx - heroLocal) + total) % total
    const angle = (offset / total) * 2 * Math.PI + Math.PI / 2

    // Ellipse radii in percent of container — seats sit just outside the felt
    const rx = 45, ry = 40
    const cx = 50, cy = 49
    const x = cx + rx * Math.cos(angle)
    const y = cy + ry * Math.sin(angle)
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }
  }

  // Collect a player's committed bet stack and slide it into the central pot.
  // The stack starts beside the seat (same spot the live bet stack is drawn)
  // and travels to the pot, where it merges into the displayed pot chips.
  function fireStackToPot(fromSeatIdx: number, amount: number, total: number, startDelay = 0) {
    if (amount <= 0) return
    setTimeout(() => {
      const id = chipIdRef.current++
      const seatPos = getSeatPosPct(fromSeatIdx, total)
      const fromX = parseFloat(seatPos.left)
      const fromY = parseFloat(seatPos.top)
      const off = betOffset(fromX, fromY)
      const flight: ChipFlight = {
        id, fromX: fromX + off.x, fromY: fromY + off.y,
        toX: POT_POS.x, toY: POT_POS.y, amount, kind: 'collect',
      }
      setChipFlights(f => [...f, flight])
      setTimeout(() => setChipFlights(f => f.filter(c => c.id !== id)), 750)
    }, startDelay)
  }

  // Collect every live bet on the table into the pot, staggered so the stacks
  // visibly file in one after another before merging.
  function collectBetsToPot(seats: Seat[]) {
    let delay = 0
    seats.forEach(s => {
      if (s.bet > 0) { fireStackToPot(s.idx, s.bet, seats.length, delay); delay += 110 }
    })
  }

  function fireStackToWinner(toSeatIdx: number, amount: number, total: number, startDelay = 0) {
    if (amount <= 0) return
    setTimeout(() => {
      const id = chipIdRef.current++
      const seatPos = getSeatPosPct(toSeatIdx, total)
      const toX = parseFloat(seatPos.left)
      const toY = parseFloat(seatPos.top)
      const flight: ChipFlight = {
        id, fromX: POT_POS.x, fromY: POT_POS.y,
        toX, toY, amount, kind: 'payout',
      }
      setChipFlights(f => [...f, flight])
      setTimeout(() => setChipFlights(f => f.filter(c => c.id !== id)), 850)
    }, startDelay)
  }

  function recordAction(action: Omit<HistoryAction, 'potAfter'>, pot: number) {
    currentHandActionsRef.current.push({ ...action, potAfter: pot })
  }

  function saveCurrentHand(finalGs: GState) {
    // In a "Revive" sandbox we don't persist to history nor auto-deal a new
    // hand — the showdown is reached, so prompt to replay or quit the sim.
    if (simModeRef.current) { setSimResult(finalGs); return }
    updateMoods(finalGs)
    const heroSeat = finalGs.seats.find(s => s.isHero)
    const heroBefore = handStartStacksRef.current[heroSeat?.idx ?? -1] ?? 0
    const heroAfter = heroSeat?.stack ?? 0
    const heroProfit = bbAmt > 0 ? Math.round(((heroAfter - heroBefore) / bbAmt) * 10) / 10 : 0
    const winnerNames = finalGs.winners.map(wi => finalGs.seats[wi]?.name ?? '?')

    const record: HandHistoryRecord = {
      id: Date.now(),
      handNum: finalGs.handNum,
      date: new Date(),
      players: finalGs.seats.map(s => ({
        idx: s.idx,
        name: s.name,
        isHero: s.isHero,
        position: s.position,
        startStack: handStartStacksRef.current[s.idx] ?? s.stack,
        endStack: s.stack,
        holeCards: s.holeCards,
        isFolded: s.isFolded,
        isWinner: finalGs.winners.includes(s.idx),
        level: s.level, seatType: s.seatType,
      })),
      board: finalGs.community,
      actions: [...currentHandActionsRef.current],
      // The live pot is already 0 here (awarded to the winner), so take the real
      // size from the largest recorded pot during the hand.
      finalPot: currentHandActionsRef.current.reduce((m, a) => Math.max(m, a.potAfter), finalGs.pot),
      sb: sbAmt,
      bb: bbAmt,
      heroProfit,
      winnerNames,
    }
    setHandHistory(h => [...h, record])
    currentHandActionsRef.current = []
    scheduleNextHand()
  }

  // ─── Blind / seat setup ──────────────────────────────────────────────────
  function findBlinds(seats: Seat[], dealerIdx: number): { sbIdx: number; bbIdx: number } {
    const active = seats.filter(s => !s.isEliminated && s.stack > 0 && !s.isSittingOut)
    const n = active.length
    // Fewer than 2 active players (e.g. you sit out heads-up): never charge a
    // sitting-out player — point both blinds at the lone active seat.
    if (n < 2) { const only = active[0]?.idx ?? dealerIdx; return { sbIdx: only, bbIdx: only } }
    if (n === 2) {
      // HU: dealer is SB
      return { sbIdx: dealerIdx, bbIdx: (dealerIdx + 1) % seats.length }
    }
    const sbIdx = (dealerIdx + 1) % seats.length
    const bbIdx = (dealerIdx + 2) % seats.length
    return { sbIdx, bbIdx }
  }

  function createSeats(): Seat[] {
    const stack = stackBB * bbAmt
    const positions = POS[numPlayers] ?? POS[6]
    const botNames = { ...BNAMES }
    const usedNames: Set<string> = new Set()

    return Array.from({ length: numPlayers }, (_, i) => {
      const isHero = i === selectedSeat
      let name: string
      let level: number
      let seatType: 'bot' | 'human' = 'bot'

      if (isHero) {
        name = displayName
        level = 0
      } else {
        const slotIdx = i < selectedSeat ? i : i - 1
        const slot = slots[slotIdx] ?? { type: 'bot', level: 2 }
        seatType = slot.type === 'human' ? 'human' : 'bot'
        // Clamp to the 3 bot tiers; a human plays on a Pro base + a live mood.
        level = Math.max(1, Math.min(3, slot.level ?? 2))
        const pool = seatType === 'human' ? HUMAN_NAMES : (botNames[level as keyof typeof botNames] ?? botNames[2])
        const available = pool.filter(n => !usedNames.has(n))
        name = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : `Bot ${i + 1}`
        usedNames.add(name)
      }

      return {
        idx: i, name, isHero, stack, level, seatType,
        holeCards: [null, null], cardsFaceUp: isHero,
        bet: 0, totalBet: 0, isFolded: false, isAllIn: false,
        isActive: false, lastAction: null,
        position: positions[i] ?? `S${i+1}`,
        isDealer: false, isSB: false, isBB: false,
        isEliminated: false, isSittingOut: false,
      }
    })
  }

  function updateSeatsForHand(seats: Seat[], dealerIdx: number): Seat[] {
    const positions = POS[numPlayers] ?? POS[6]
    // Decide who is dealt out this hand: the hero if they chose to sit out, and
    // anyone with no chips left (busted / eliminated). Sitting-out players start
    // the hand "folded" so every action/contention filter skips them.
    const prepared = seats.map(s => ({
      ...s,
      isSittingOut: (s.isHero && sitOutRef.current) || s.stack <= 0 || s.isEliminated,
    }))
    const { sbIdx, bbIdx } = findBlinds(prepared, dealerIdx)
    const n = prepared.length
    return prepared.map((s, i) => ({
      ...s,
      isDealer: i === dealerIdx,
      isSB: i === sbIdx,
      isBB: i === bbIdx,
      // Position is relative to the dealer button: offset 0 = BTN, then SB, BB,
      // UTG … so the labels rotate every hand as the button moves.
      position: positions[((i - dealerIdx) % n + n) % n] ?? `S${i+1}`,
      holeCards: [null, null],
      bet: 0, totalBet: 0,
      isFolded: s.isSittingOut, isAllIn: false,
      isActive: false, lastAction: null,
      cardsFaceUp: s.isHero && !s.isSittingOut,
      handStrength: undefined, handScore: undefined, isWinner: undefined,
    }))
  }

  // ─── Bot AI ──────────────────────────────────────────────────────────────
  // Anti-cheat: hand a bot a BLINDED view of the game — every other player's
  // hole cards are stripped, and the deck is emptied. A bot physically cannot
  // see opponents' cards or future board cards, no matter how the AI evolves.
  function blindStateForBot(state: GState, actingIdx: number): GState {
    return {
      ...state,
      deck: [],
      seats: state.seats.map(s =>
        s.idx === actingIdx ? s : { ...s, holeCards: [null, null] as [Card | null, Card | null] }),
    }
  }

  // Decision knobs for an archetype (all 0..1-ish).
  interface BotParams {
    betValue: number      // min made-hand strength to value-bet when checked to
    betFreqStrong: number // how often a value hand actually bets (vs trap-check)
    semiBluff: number     // freq to bet/raise draws as a semi-bluff
    bluff: number         // freq of a pure bluff
    raiseValue: number    // min strength to raise for value vs a bet
    callEdge: number      // strength margin above pot odds needed to call
    spew: number          // chance to ignore ranges (loose call) — tilt only
  }
  const BASE_PARAMS: Record<number, BotParams> = {
    1: { betValue: 0.62, betFreqStrong: 0.70, semiBluff: 0.15, bluff: 0.05, raiseValue: 0.82, callEdge: -0.06, spew: 0.10 }, // Amateur (loose-passive station)
    2: { betValue: 0.55, betFreqStrong: 0.86, semiBluff: 0.55, bluff: 0.08, raiseValue: 0.78, callEdge: 0.07, spew: 0 },     // Pro (solid TAG)
    3: { betValue: 0.52, betFreqStrong: 0.92, semiBluff: 0.66, bluff: 0.13, raiseValue: 0.74, callEdge: 0.04, spew: 0 },     // Expert (aggressive, balanced)
  }

  function decideBotAction(seat: Seat, state: GState): { action: string; amount: number } {
    const c1 = seat.holeCards[0], c2 = seat.holeCards[1]
    if (!c1 || !c2) return { action: 'FOLD', amount: 0 }

    const tier = Math.max(1, Math.min(3, seat.level))
    const posBonus = POS_BONUS[seat.position] ?? 0.75
    const toCall = state.currentBet - seat.bet
    const potOdds = state.pot > 0 ? toCall / (state.pot + toCall) : 0
    const board = state.community.filter(Boolean) as Card[]
    const onBoard = board.length >= 3
    const strength = onBoard ? madeStrength([c1, c2], board) : (preflopStrength(c1, c2) * posBonus) / 10
    const draw = onBoard ? hasStrongDraw([c1, c2], board) : false
    const rand = Math.random()

    // Build params: bots use their tier; Humans use a Pro base modulated by mood.
    let p: BotParams = { ...BASE_PARAMS[tier] }
    if (seat.seatType === 'human') {
      const m = moodRef.current[seat.idx] ?? 0
      const tilt = Math.max(0, -m), conf = Math.max(0, m)
      p = { ...BASE_PARAMS[2] }
      p.betValue -= conf * 0.04
      p.bluff += tilt * 0.24 + conf * 0.05          // tilt/over-confidence → more bluffs
      p.semiBluff += tilt * 0.15
      p.callEdge -= tilt * 0.13                      // tilt → calls much looser
      p.raiseValue -= tilt * 0.08
      p.spew = tilt * 0.30                           // tilt → ignore ranges (loose calls)
    }

    // Sizing helpers (target "raise to" totals).
    const minTo = state.currentBet + state.minRaise
    const allInTo = seat.bet + seat.stack
    const roundBB = (x: number) => Math.max(bbAmt, Math.round(x / bbAmt) * bbAmt)
    const betTo = (frac: number) => Math.min(allInTo, roundBB(state.pot * frac))
    const raiseTo = (frac: number) => Math.min(allInTo, Math.max(minTo, state.currentBet + roundBB((state.pot + toCall) * frac)))
    const valueBetFrac = () => (strength >= 0.85 ? 0.78 : 0.62)
    const valueRaiseFrac = () => (strength >= 0.85 ? 0.95 : 0.65)

    // ── Pre-flop ── decision shared with the range estimator (preflopProbs), keyed
    // on how many raises have been made before us → open / 3-bet / 4-bet logic.
    if (!onBoard) {
      const psv = preflopStrength(c1, c2)            // 1..10 hand chart value
      const preRaises = currentHandActionsRef.current
        .filter(a => a.phase === 'preflop' && (a.actionType === 'RAISE' || a.actionType === 'ALL-IN')).length
      const pp = preflopProbs(psv, posBonus, preRaises, tier, toCall)
      let acc = pp.aggr
      if (rand < acc) {
        const size = preRaises === 0 ? 0.8 : 0.9     // opens a touch smaller than re-raises
        return toCall === 0
          ? { action: 'BET', amount: raiseTo(size) }
          : { action: 'RAISE', amount: raiseTo(size) }
      }
      acc += pp.call
      if (rand < acc) return toCall > 0 ? { action: 'CALL', amount: toCall } : { action: 'CHECK', amount: 0 }
      acc += pp.check
      if (rand < acc) return { action: 'CHECK', amount: 0 }
      return { action: 'FOLD', amount: 0 }
    }

    // ── Post-flop ──
    if (toCall === 0) {
      // Checked to us → bet for value, semi-bluff draws, or occasionally bluff.
      if (strength >= p.betValue) {
        if (rand < p.betFreqStrong) return { action: 'BET', amount: betTo(valueBetFrac()) }
        return { action: 'CHECK', amount: 0 } // trap
      }
      if (draw && rand < p.semiBluff) return { action: 'BET', amount: betTo(0.5) }
      if (rand < p.bluff) return { action: 'BET', amount: betTo(0.55) }
      return { action: 'CHECK', amount: 0 }
    }
    // Facing a bet/raise.
    if (strength >= p.raiseValue) return { action: 'RAISE', amount: raiseTo(valueRaiseFrac()) }       // value raise
    if (draw && rand < p.semiBluff * 0.7) return { action: 'RAISE', amount: raiseTo(0.8) }            // semi-bluff raise
    if (strength >= potOdds + p.callEdge) return { action: 'CALL', amount: toCall }                   // call with showdown value
    if (draw && strength + 0.18 >= potOdds) return { action: 'CALL', amount: toCall }                 // call the draw on odds
    if (rand < p.spew) return { action: 'CALL', amount: toCall }                                      // tilt: loose call
    if (tier >= 2 && rand < p.bluff * 0.6) return { action: 'RAISE', amount: raiseTo(0.8) }           // occasional bluff raise
    return { action: 'FOLD', amount: 0 }
  }

  // Update Human players' mood at the end of each hand: big losses tilt them
  // (looser/wilder), wins make them confident; moods drift back to neutral.
  function updateMoods(finalGs: GState) {
    finalGs.seats.forEach(s => {
      if (s.seatType !== 'human') return
      const start = handStartStacksRef.current[s.idx] ?? s.stack
      const deltaBB = bbAmt > 0 ? (s.stack - start) / bbAmt : 0
      let m = (moodRef.current[s.idx] ?? 0) * 0.7 // drift toward neutral
      if (deltaBB <= -15) m -= 0.5
      else if (deltaBB < 0) m -= 0.15
      else if (deltaBB >= 30) m += 0.3
      else if (deltaBB > 0) m += 0.1
      moodRef.current[s.idx] = Math.max(-1, Math.min(1, m))
    })
  }

  // Narrow a player's estimated range by the action they just took (Vision mode).
  function trackRange(seatIdx: number, action: string, currentGs: GState) {
    if (!visionRef.current) return
    const seat = currentGs.seats[seatIdx]
    if (!seat) return
    const cat: ActCat = action === 'FOLD' ? 'fold' : action === 'CHECK' ? 'check' : action === 'CALL' ? 'call' : 'aggr'
    const preflop = currentGs.phase === 'preflop'
    const board = currentGs.community.filter(Boolean) as Card[]
    const toCall = Math.max(0, currentGs.currentBet - seat.bet)
    const potOdds = toCall > 0 ? toCall / (currentGs.pot + toCall) : 0
    const phaseActs = currentHandActionsRef.current.filter(a => a.phase === currentGs.phase && a.seatIdx >= 0)
    const numCallers = phaseActs.filter(a => a.actionType === 'CALL').length
    const raisesSoFar = phaseActs.filter(a => a.actionType === 'RAISE' || a.actionType === 'BET' || a.actionType === 'ALL-IN').length
    if (!rangeRef.current[seatIdx]) rangeRef.current[seatIdx] = initRange(board)
    rangeRef.current[seatIdx] = applyAction(rangeRef.current[seatIdx], cat, {
      preflop, board, toCall, potOdds,
      posBonus: POS_BONUS[seat.position] ?? 0.75,
      tier: Math.max(1, Math.min(3, seat.level)),
      human: seat.seatType === 'human',
      mood: moodRef.current[seatIdx] ?? 0,
      priorRaises: raisesSoFar,  // # of raises this player faced (0/1/2/≥3) → open/3-bet/4-bet logic
    })
    rangeMetaRef.current[seatIdx] = actionSummary(cat, { preflop, numCallers, was3betPlus: cat === 'aggr' && raisesSoFar >= 1 })
  }

  // ─── Action execution ────────────────────────────────────────────────────
  function activatePlayer(seatIdx: number) {
    setGs(prev => ({
      ...prev,
      seats: prev.seats.map((s, i) => ({ ...s, isActive: i === seatIdx })),
    }))
  }

  function executeAction(seatIdx: number, action: string, rawAmount: number, currentGs: GState): GState {
    const seats = currentGs.seats.map(s => ({ ...s }))
    const seat = seats[seatIdx]
    if (!seat) return currentGs

    let newPot = currentGs.pot
    let newBet = currentGs.currentBet
    let newMinRaise = currentGs.minRaise
    let lastAction = action
    let actualAmount = rawAmount

    if (action === 'FOLD') {
      seat.isFolded = true
      seat.lastAction = 'FOLD'
      seat.isActive = false
    } else if (action === 'CHECK') {
      seat.lastAction = 'CHECK'
      seat.isActive = false
    } else if (action === 'CALL') {
      const toCall = Math.min(currentGs.currentBet - seat.bet, seat.stack)
      seat.stack -= toCall
      seat.bet += toCall
      seat.totalBet += toCall
      newPot += toCall
      // Record the cumulative street bet (matches BET/RAISE/ALL-IN) so the
      // history replay reconstructs stacks correctly.
      actualAmount = seat.bet
      if (seat.stack === 0) { seat.isAllIn = true; lastAction = 'ALL-IN' }
      seat.lastAction = lastAction
      seat.isActive = false
    } else if (action === 'BET' || action === 'RAISE') {
      // rawAmount is the TARGET total bet to reach ("raise to"). Clamp it to a
      // legal minimum (currentBet + min raise increment) and to the all-in cap.
      const minTo = currentGs.currentBet + currentGs.minRaise
      const maxTo = seat.bet + seat.stack
      let target = Math.round(rawAmount)
      if (target < minTo) target = minTo
      if (target > maxTo) target = maxTo
      const add = target - seat.bet
      seat.stack -= add
      seat.bet = target
      seat.totalBet += add
      newPot += add
      actualAmount = target
      newBet = Math.max(currentGs.currentBet, target)
      const increment = newBet - currentGs.currentBet
      if (increment > newMinRaise) newMinRaise = increment
      if (seat.stack === 0) { seat.isAllIn = true; lastAction = 'ALL-IN' }
      else lastAction = (action === 'BET' ? 'BET $' : 'RAISE $') + target
      seat.lastAction = lastAction
      seat.isActive = false
    } else if (action === 'ALL-IN') {
      const add = seat.stack
      seat.stack = 0
      seat.bet += add
      seat.totalBet += add
      newPot += add
      actualAmount = seat.bet
      if (seat.bet > newBet) {
        const increment = seat.bet - currentGs.currentBet
        if (increment > newMinRaise) newMinRaise = increment
        newBet = seat.bet
      }
      seat.isAllIn = true
      seat.lastAction = 'ALL-IN'
      seat.isActive = false
    }

    // Safety net: any committing action that empties the stack is all-in.
    if (!seat.isFolded && seat.stack <= 0) seat.isAllIn = true

    // Range Vision: narrow this player's estimated range (uses pre-action context).
    trackRange(seatIdx, action, currentGs)

    // Record the action
    const phase = currentGs.phase
    recordAction({
      phase, seatIdx, name: seat.name, isHero: seat.isHero,
      actionType: lastAction.split(' ')[0],
      amount: actualAmount,
    }, newPot)

    const newLog = [...currentGs.log, `${seat.name}: ${lastAction}`]
    return {
      ...currentGs,
      seats,
      pot: newPot,
      currentBet: newBet,
      minRaise: newMinRaise,
      log: newLog,
    }
  }

  function foldWin(seatIdx: number, state: GState): GState {
    // Pull any live bets into the pot, then push the whole pot to the winner.
    const potTotal = state.pot
    collectBetsToPot(state.seats)
    fireStackToWinner(seatIdx, potTotal, state.seats.length, 350)
    const seats = state.seats.map(s => ({ ...s, isActive: false, bet: 0 }))
    const winner = seats[seatIdx]
    if (winner) {
      winner.stack += potTotal
      winner.isWinner = true
      winner.handStrength = 'Tous foldé'
    }
    const log = [...state.log, `${winner?.name ?? '?'} remporte ${potTotal} (tous ont foldé)`]
    return { ...state, seats, pot: 0, currentBet: 0, winners: [seatIdx], phase: 'showdown', log, autoRunning: false }
  }

  // ─── Street management ───────────────────────────────────────────────────
  function buildActQueue(seats: Seat[], firstToAct: number): number[] {
    const active = seats
      .filter(s => !s.isFolded && !s.isAllIn && !s.isEliminated && s.stack > 0)
      .map(s => s.idx)
    if (active.length === 0) return []
    const sorted: number[] = []
    const cur = firstToAct
    for (let i = 0; i < seats.length; i++) {
      const idx = (cur + i) % seats.length
      if (active.includes(idx)) sorted.push(idx)
    }
    return sorted
  }

  // Compute the action queue after a player acts. A bet/raise that increases
  // the current bet re-opens the round: every other live player must act again.
  // A call/check/fold simply advances to the next player in the existing queue.
  function nextQueueAfter(stateAfter: GState, actedIdx: number, prev: GState): number[] {
    const seats = stateAfter.seats
    // A player can still be given the floor only if they're live AND have chips
    // (an all-in / 0-stack player must never be re-prompted).
    const canAct = (idx: number) => {
      const s = seats[idx]
      return !!s && !s.isFolded && !s.isAllIn && !s.isEliminated && s.stack > 0
    }
    const aggressive = stateAfter.currentBet > prev.currentBet
    if (!aggressive) {
      // Advance past the actor, dropping anyone who can no longer act.
      return stateAfter.actQueue.slice(1).filter(canAct)
    }
    // A raise re-opens the round for every other live player.
    const sorted: number[] = []
    for (let i = 1; i <= seats.length; i++) {
      const idx = (actedIdx + i) % seats.length
      if (idx !== actedIdx && canAct(idx)) sorted.push(idx)
    }
    return sorted
  }

  // First active player to act on a post-flop street: first non-folded,
  // non-all-in seat clockwise from the dealer (SB seat, or next live seat).
  function firstActivePostflop(seats: Seat[], dealerIdx: number): number {
    for (let i = 1; i <= seats.length; i++) {
      const idx = (dealerIdx + i) % seats.length
      const s = seats[idx]
      if (s && !s.isFolded && !s.isAllIn && !s.isEliminated && s.stack > 0) return idx
    }
    return -1
  }

  function endStreet(state: GState): void {
    // Slide every committed bet into the central pot, then reset the bets.
    collectBetsToPot(state.seats)
    const seats = state.seats.map(s => ({ ...s, bet: 0, lastAction: null, isActive: false }))
    const newState = { ...state, seats, currentBet: 0, minRaise: bbAmt }

    if (newState.phase === 'river' || newState.phase === 'showdown') {
      // Clear the front bets now so they merge into the pot, then reveal.
      setGs(newState); gsRef.current = newState
      const gen = flowGenRef.current
      setTimeout(() => { if (flowGenRef.current !== gen) return; showdown(gsRef.current) }, 650)
    } else {
      const nextPhase: Phase =
        newState.phase === 'preflop' ? 'flop' :
        newState.phase === 'flop' ? 'turn' :
        newState.phase === 'turn' ? 'river' : 'showdown'
      dealCommunity(newState, nextPhase)
    }
  }

  function dealCommunity(state: GState, phase: Phase) {
    const deck = [...state.deck]
    const community = [...state.community]

    if (phase === 'flop') {
      community[0] = deck.pop() ?? null
      community[1] = deck.pop() ?? null
      community[2] = deck.pop() ?? null
    } else if (phase === 'turn') {
      community[3] = deck.pop() ?? null
    } else if (phase === 'river') {
      community[4] = deck.pop() ?? null
    }

    // Record phase event
    recordAction({ phase, seatIdx: -1, name: '', isHero: false, actionType: PHASE_LABEL[phase], amount: 0 }, state.pot)

    const newState = { ...state, deck, community, phase, currentBet: 0, minRaise: bbAmt }
    setGs(newState)
    gsRef.current = newState
    // Let the board land, then open a fresh betting round on this street.
    const gen = flowGenRef.current
    setTimeout(() => {
      if (flowGenRef.current !== gen) return
      const first = firstActivePostflop(newState.seats, newState.dealerIdx)
      startStreet(newState, first)
    }, 750)
  }

  function startStreet(state: GState, firstToAct: number) {
    const queue = firstToAct < 0 ? [] : buildActQueue(state.seats, firstToAct)
    const activePlayers = state.seats.filter(s => !s.isFolded && !s.isEliminated)

    // Only one player left in the hand → award immediately.
    if (activePlayers.length <= 1) {
      if (activePlayers.length === 1) {
        const winner = foldWin(activePlayers[0].idx, state)
        setGs(winner); gsRef.current = winner
        saveCurrentHand(winner)
      }
      return
    }

    // 0 or 1 player can still act (others all-in) → no more betting, run the
    // rest of the board out to showdown.
    if (queue.length <= 1) {
      const gen = flowGenRef.current
      if (state.phase === 'river') setTimeout(() => { if (flowGenRef.current !== gen) return; showdown(state) }, 400)
      else {
        const nextPhase: Phase =
          state.phase === 'preflop' ? 'flop' :
          state.phase === 'flop' ? 'turn' :
          state.phase === 'turn' ? 'river' : 'showdown'
        dealCommunity(state, nextPhase)
      }
      return
    }

    if (manualModeRef.current) {
      // Manual authoring: just light up the first player to act and wait for input.
      const first = queue[0]
      const ns = { ...state, actQueue: queue, seats: state.seats.map((s, i) => ({ ...s, isActive: i === first })) }
      setGs(ns); gsRef.current = ns
      return
    }
    const newState = { ...state, actQueue: queue }
    setGs(newState)
    gsRef.current = newState
    scheduleAutoNext(newState, 300)
  }

  function showdown(state: GState) {
    const contenders = state.seats.filter(s => !s.isFolded && !s.isEliminated)
    if (contenders.length === 0) {
      setGs(prev => ({ ...prev, phase: 'showdown', autoRunning: false }))
      return
    }

    // Compute hand strengths (don't reveal cards yet — muck rules decide that).
    const board = state.community.filter(Boolean) as Card[]
    const evaluated = state.seats.map(s => {
      if (s.isFolded || !s.holeCards[0] || !s.holeCards[1]) return { ...s, isActive: false }
      const allCards = [...(s.holeCards.filter(Boolean) as Card[]), ...board]
      const { score, name } = bestHand(allCards)
      return { ...s, isActive: false, handScore: score, handStrength: name }
    })

    // Compute side pots and determine winners
    const sidePots = computeSidePots(evaluated)
    const winnerSet = new Set<number>()
    const payouts: Record<number, number> = {}

    if (sidePots.length === 0) {
      // No side pots — give pot to best hand among contenders
      const best = contenders.reduce((a, b) => {
        const sa = evaluated.find(e => e.idx === a.idx)?.handScore ?? 0
        const sb2 = evaluated.find(e => e.idx === b.idx)?.handScore ?? 0
        return sa >= sb2 ? a : b
      })
      payouts[best.idx] = (payouts[best.idx] ?? 0) + state.pot
      winnerSet.add(best.idx)
    } else {
      for (const sp of sidePots) {
        if (sp.eligible.length === 0) continue
        const bestScore = Math.max(...sp.eligible.map(idx => evaluated.find(e => e.idx === idx)?.handScore ?? 0))
        const potWinners = sp.eligible.filter(idx => (evaluated.find(e => e.idx === idx)?.handScore ?? 0) === bestScore)
        const share = Math.floor(sp.amount / potWinners.length)
        potWinners.forEach(idx => {
          payouts[idx] = (payouts[idx] ?? 0) + share
          winnerSet.add(idx)
        })
      }
    }

    // ── International showdown order + muck rules ──
    // The last aggressor (last bet/raise/all-in) shows first; if there was no bet
    // on the last street, the first live player left of the button shows first.
    // Going in order, a player only TABLES their hand if it beats (or ties) the
    // best hand shown so far — otherwise they MUCK (cards stay hidden). Winners
    // always table. The hero always sees their own cards.
    const n = state.seats.length
    const contenderIdxs = evaluated.filter(s => !s.isFolded && !s.isSittingOut && !!s.holeCards[0] && !!s.holeCards[1]).map(s => s.idx)
    const aggrActs = currentHandActionsRef.current.filter(a => a.seatIdx >= 0 && (a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))
    let startIdx = aggrActs.length ? aggrActs[aggrActs.length - 1].seatIdx : -1
    if (startIdx < 0 || !contenderIdxs.includes(startIdx)) {
      startIdx = -1
      for (let i = 1; i <= n; i++) { const idx = (state.dealerIdx + i) % n; if (contenderIdxs.includes(idx)) { startIdx = idx; break } }
    }
    const order: number[] = []
    for (let i = 0; i < n; i++) { const idx = (startIdx + i) % n; if (contenderIdxs.includes(idx)) order.push(idx) }
    const scoreOf = (idx: number) => evaluated.find(e => e.idx === idx)?.handScore ?? -1
    const isAllInSeat = (idx: number) => !!evaluated.find(e => e.idx === idx)?.isAllIn
    const reveal = new Set<number>()
    let bestShown = -1
    // All-in players are FORCED to table their hand (they have no action left).
    order.forEach(idx => { if (isAllInSeat(idx)) { reveal.add(idx); bestShown = Math.max(bestShown, scoreOf(idx)) } })
    // Then show/muck in order: the aggressor (order[0]) always tables; everyone
    // else only tables if they beat (or tie) the best hand shown so far.
    order.forEach((idx, i) => {
      if (reveal.has(idx)) return
      const sc = scoreOf(idx)
      if (i === 0 || sc >= bestShown) { reveal.add(idx); bestShown = Math.max(bestShown, sc) }
    })
    winnerSet.forEach(w => reveal.add(w)) // winners must table to claim

    const finalSeats = evaluated.map(s => {
      const shown = !s.isFolded && (s.isHero || reveal.has(s.idx))
      return {
        ...s,
        cardsFaceUp: shown,
        handStrength: shown ? s.handStrength : undefined,
        stack: s.stack + (payouts[s.idx] ?? 0),
        isWinner: winnerSet.has(s.idx),
        isEliminated: s.stack + (payouts[s.idx] ?? 0) === 0 && !s.isHero,
      }
    })

    // Fire winner chips from the pot to each winning seat
    let payDelay = 200
    for (const [idxStr, amount] of Object.entries(payouts)) {
      fireStackToWinner(parseInt(idxStr), amount, state.seats.length, payDelay)
      payDelay += 150
    }

    const winners = [...winnerSet]
    const winLog = winners.map(wi => {
      const s = finalSeats.find(x => x.idx === wi)
      return `${s?.name ?? '?'} remporte ${payouts[wi] ?? 0} avec ${s?.handStrength ?? '?'}`
    })

    const finalState: GState = {
      ...state,
      seats: finalSeats,
      pot: 0,
      winners,
      phase: 'showdown',
      log: [...state.log, ...winLog],
      autoRunning: false,
    }

    setGs(finalState)
    gsRef.current = finalState
    saveCurrentHand(finalState)
  }

  // ─── Auto-advance logic ──────────────────────────────────────────────────
  function scheduleAutoNext(state: GState, delay: number) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (state.paused || manualModeRef.current) return  // manual mode never auto-advances

    timeoutRef.current = setTimeout(() => {
      const cur = gsRef.current
      if (cur.paused) return
      processNextAction(cur)
    }, delay)
  }

  function processNextAction(state: GState) {
    const queue = [...state.actQueue]
    if (queue.length === 0) {
      endStreet(state)
      return
    }

    const nextIdx = queue[0]
    const seat = state.seats[nextIdx]

    if (!seat || seat.isFolded || seat.isAllIn || seat.isEliminated || seat.stack === 0) {
      const newState = { ...state, actQueue: queue.slice(1) }
      setGs(newState)
      gsRef.current = newState
      scheduleAutoNext(newState, 100)
      return
    }

    // Check if only one player left → award the pot and move on (must apply the
    // result, otherwise the hand stalls — e.g. when you sit out heads-up).
    const activePlayers = state.seats.filter(s => !s.isFolded && !s.isEliminated)
    if (activePlayers.length === 1) {
      const winner = foldWin(activePlayers[0].idx, { ...state, actQueue: [] })
      setGs(winner); gsRef.current = winner
      saveCurrentHand(winner)
      return
    }
    if (activePlayers.length === 0) { // safety: nobody left → just end the hand
      setGs(prev => ({ ...prev, phase: 'showdown', autoRunning: false })); return
    }

    if (seat.isHero) {
      // Hero's turn — activate and wait for input
      activatePlayer(nextIdx)
      const newState = { ...state, actQueue: queue, seats: state.seats.map((s,i) => ({...s, isActive: i===nextIdx})) }
      setGs(newState)
      gsRef.current = newState
      return
    }

    // Bot's turn
    activatePlayer(nextIdx)
    const botDelay = 600 + Math.random() * 800

    timeoutRef.current = setTimeout(() => {
      const cur = gsRef.current
      if (cur.paused) return
      const botSeat = cur.seats[nextIdx]
      if (!botSeat || botSeat.isFolded) {
        const ns = { ...cur, actQueue: cur.actQueue.slice(1) }
        setGs(ns); gsRef.current = ns
        scheduleAutoNext(ns, 100)
        return
      }
      // Decide from a blinded view — the bot can't see anyone else's cards.
      const { action, amount } = decideBotAction(botSeat, blindStateForBot(cur, nextIdx))
      let newState = executeAction(nextIdx, action, amount, cur)
      newState = { ...newState, actQueue: nextQueueAfter(newState, nextIdx, cur) }

      // Check if all others folded
      const stillIn = newState.seats.filter(s => !s.isFolded && !s.isEliminated)
      if (stillIn.length === 1) {
        const winner = foldWin(stillIn[0].idx, newState)
        setGs(winner); gsRef.current = winner
        saveCurrentHand(winner)
        return
      }

      setGs(newState); gsRef.current = newState
      scheduleAutoNext(newState, 400)
    }, botDelay)
  }

  function advanceToNextHand() {
    flowGenRef.current++
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    const cur = gsRef.current
    const newDealerIdx = (cur.dealerIdx + 1) % numPlayers
    startHand(cur.seats, newDealerIdx, cur.handNum)
  }

  // Continuous flow: after a hand resolves, automatically deal the next one
  // unless the player has paused or chosen to sit out.
  function heroIsBusted(state: GState): boolean {
    const h = state.seats.find(s => s.isHero)
    return !!h && h.stack <= 0
  }

  function scheduleNextHand() {
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    // A manually-authored scenario is a one-off spot — never auto-deal a new hand.
    if (manualModeRef.current) return
    // Don't deal a new hand while the hero is busted (waiting on a rebuy).
    // Sitting out does NOT halt the table — the hero is simply dealt out.
    if (heroIsBusted(gsRef.current)) return
    nextHandTimeoutRef.current = setTimeout(() => {
      if (gsRef.current.paused || heroIsBusted(gsRef.current)) return
      advanceToNextHand()
    }, 3800)
  }

  // ─── Hand start ──────────────────────────────────────────────────────────
  function startHand(prevSeats: Seat[], dealerIdx: number, prevHandNum: number) {
    const handNum = prevHandNum + 1
    const deck = shuffle(mkDeck())
    const seats = updateSeatsForHand(prevSeats, dealerIdx)

    // Save start stacks
    seats.forEach(s => { handStartStacksRef.current[s.idx] = s.stack })
    currentHandActionsRef.current = []
    // Fresh estimated ranges for everyone (full range, narrowed by their actions).
    rangeRef.current = {}; rangeMetaRef.current = {}
    seats.forEach(s => { if (!s.isSittingOut) rangeRef.current[s.idx] = initRange() })

    // Post antes (go straight into the pot)
    let pot = 0
    if (anteAmt > 0) {
      seats.forEach(s => {
        const ante = Math.min(anteAmt, s.stack)
        s.stack -= ante
        s.totalBet += ante
        pot += ante
      })
    }

    // Post blinds — these sit as bet stacks in front of SB/BB until collected
    const { sbIdx, bbIdx } = findBlinds(seats, dealerIdx)
    const sbSeat = seats[sbIdx]
    const bbSeat = seats[bbIdx]

    const sbPost = Math.min(sbAmt, sbSeat.stack)
    sbSeat.stack -= sbPost; sbSeat.bet = sbPost; sbSeat.totalBet += sbPost
    if (sbSeat.stack <= 0) sbSeat.isAllIn = true // posted the blind all-in
    pot += sbPost

    const bbPost = Math.min(bbAmt, bbSeat.stack)
    bbSeat.stack -= bbPost; bbSeat.bet = bbPost; bbSeat.totalBet += bbPost
    if (bbSeat.stack <= 0) bbSeat.isAllIn = true
    pot += bbPost

    // Record blind actions
    recordAction({ phase: 'preflop', seatIdx: sbIdx, name: sbSeat.name, isHero: sbSeat.isHero, actionType: 'SB', amount: sbPost }, pot)
    recordAction({ phase: 'preflop', seatIdx: bbIdx, name: bbSeat.name, isHero: bbSeat.isHero, actionType: 'BB', amount: bbPost }, pot)

    const newState: GState = {
      phase: 'dealing',
      deck, seats, community: [null,null,null,null,null],
      pot, currentBet: bbAmt, minRaise: bbAmt,
      actQueue: [], dealerIdx, handNum,
      log: [`=== Main #${handNum} ===`, `Dealer: ${seats[dealerIdx]?.name}`, `SB: ${sbSeat.name} (${sbPost})`, `BB: ${bbSeat.name} (${bbPost})`],
      winners: [], paused: false, autoRunning: true,
    }
    setGs(newState)
    gsRef.current = newState

    // Deal hole cards after a short delay (blinds settle first)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    const t = setTimeout(() => startHandContinue(newState), 450)
    dealTimeoutsRef.current.push(t)
  }

  // Start a hand directly from a custom SCENARIO state (chosen street, fixed hero
  // cards + board, set pot). Opponents get random cards (Phase 1); the existing
  // street/betting machinery takes over from there.
  function startScenario(sc: ScenarioCfg, live: boolean) {
    // "Jouer en live" off ⇒ manual authoring: you drive every action by clicking.
    manualModeRef.current = !live
    setManualMode(!live)
    setManualPanel(null)
    manualUndoRef.current = []; setManualUndoDepth(0)
    const n = sc.numPlayers
    const positions = POS[n] ?? POS[6]
    const posIdx = Math.max(0, positions.indexOf(sc.heroPos))
    const dealerIdx = ((0 - posIdx) % n + n) % n   // hero (seat 0) gets heroPos

    // Opponent forced hole cards (seat i ↔ sc.opponents[i-1], hero = seat 0). Both
    // cards must be set to count as "imposed", otherwise the seat draws randomly.
    const oppCardsFor = (seatIdx: number): [Card | null, Card | null] | null => {
      const o = sc.opponents[seatIdx - 1]
      return o?.cards && o.cards[0] && o.cards[1] ? [o.cards[0], o.cards[1]] : null
    }

    const known = new Set<string>()
    sc.heroCards.forEach(c => c && known.add(c.rank + c.suit))
    sc.board.forEach(c => c && known.add(c.rank + c.suit))
    // Block every forced opponent card too, so the random draw never duplicates it.
    for (let i = 1; i < n; i++) oppCardsFor(i)?.forEach(c => c && known.add(c.rank + c.suit))
    const deck = shuffle(mkDeck().filter(c => !known.has(c.rank + c.suit)))

    const boardCount = sc.startStreet === 'preflop' ? 0 : sc.startStreet === 'flop' ? 3 : sc.startStreet === 'turn' ? 4 : 5
    const community: (Card | null)[] = [null, null, null, null, null]
    for (let i = 0; i < boardCount; i++) community[i] = sc.board[i] as Card

    let seats = createSeats().map((s, i) => ({
      ...s,
      isDealer: i === dealerIdx,
      position: positions[((i - dealerIdx) % n + n) % n] ?? `S${i + 1}`,
      holeCards: (s.isHero ? [sc.heroCards[0], sc.heroCards[1]] : (oppCardsFor(i) ?? [deck.pop() ?? null, deck.pop() ?? null])) as [Card | null, Card | null],
      cardsFaceUp: s.isHero,
      isFolded: false, isAllIn: false, bet: 0, totalBet: 0, isSittingOut: false, isActive: false, lastAction: null,
    }))
    const { sbIdx, bbIdx } = findBlinds(seats, dealerIdx)
    seats = seats.map((s, i) => ({ ...s, isSB: i === sbIdx, isBB: i === bbIdx }))

    currentHandActionsRef.current = []
    rangeRef.current = {}; rangeMetaRef.current = {}; moodRef.current = {}
    handStartStacksRef.current = {}
    seats.forEach(s => { rangeRef.current[s.idx] = initRange(community.filter(Boolean) as Card[]) })

    if (sc.startStreet === 'preflop') {
      let pot = 0
      const sbPost = Math.min(sbAmt, seats[sbIdx].stack)
      seats[sbIdx] = { ...seats[sbIdx], stack: seats[sbIdx].stack - sbPost, bet: sbPost, totalBet: sbPost }
      pot += sbPost
      const bbPost = Math.min(bbAmt, seats[bbIdx].stack)
      seats[bbIdx] = { ...seats[bbIdx], stack: seats[bbIdx].stack - bbPost, bet: bbPost, totalBet: bbPost }
      pot += bbPost
      seats.forEach(s => { handStartStacksRef.current[s.idx] = s.stack + s.bet })
      recordAction({ phase: 'preflop', seatIdx: sbIdx, name: seats[sbIdx].name, isHero: seats[sbIdx].isHero, actionType: 'SB', amount: sbPost }, pot)
      recordAction({ phase: 'preflop', seatIdx: bbIdx, name: seats[bbIdx].name, isHero: seats[bbIdx].isHero, actionType: 'BB', amount: bbPost }, pot)
      const state: GState = { phase: 'preflop', deck, seats, community: [null, null, null, null, null], pot, currentBet: bbAmt, minRaise: bbAmt, actQueue: [], dealerIdx, handNum: 1, log: ['=== Scénario (préflop) ==='], winners: [], paused: false, autoRunning: live }
      setGs(state); gsRef.current = state
      const firstToAct = (bbIdx + 1) % n
      setTimeout(() => startStreet(gsRef.current, firstToAct), 420)
    } else {
      const potChips = Math.max(0, Math.round(sc.potBB * bbAmt))
      const share = n > 0 ? Math.round(potChips / n) : 0
      seats = seats.map(s => ({ ...s, stack: Math.max(0, s.stack - share), totalBet: share }))
      const pot = share * n
      seats.forEach(s => { handStartStacksRef.current[s.idx] = s.stack + share })
      // Street markers so the coach / history see the right board context.
      recordAction({ phase: 'preflop', seatIdx: -1, name: '', isHero: false, actionType: 'Pré-flop', amount: 0 }, pot)
      if (boardCount >= 3) recordAction({ phase: 'flop', seatIdx: -1, name: '', isHero: false, actionType: 'Flop', amount: 0 }, pot)
      if (boardCount >= 4) recordAction({ phase: 'turn', seatIdx: -1, name: '', isHero: false, actionType: 'Turn', amount: 0 }, pot)
      if (boardCount >= 5) recordAction({ phase: 'river', seatIdx: -1, name: '', isHero: false, actionType: 'River', amount: 0 }, pot)
      const state: GState = { phase: sc.startStreet, deck, seats, community, pot, currentBet: 0, minRaise: bbAmt, actQueue: [], dealerIdx, handNum: 1, log: [`=== Scénario (${sc.startStreet}) ===`], winners: [], paused: false, autoRunning: live }
      setGs(state); gsRef.current = state
      const first = firstActivePostflop(seats, dealerIdx)
      setTimeout(() => startStreet(gsRef.current, first), 450)
    }
  }

  // ─── "Revive situation" — re-create a historical spot as a playable sandbox ──
  // Rebuilds the EXACT state at `stepIdx` of `record` (board, pot, stacks, live
  // bets, who folded) and re-draws every still-in opponent's hole cards FROM THE
  // RANGE their betting line implies at that step (reconstructRanges). The hero
  // keeps their real cards; the board replays identically. Then play continues.
  function reviveSituation(record: HandHistoryRecord, stepIdx: number) {
    // Invalidate any deferred street-transition timer from the current context.
    flowGenRef.current++
    // Stop any pending real-game timers so they don't fire under the sim.
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []

    // Snapshot the real game ONCE (first entry), to restore it on quit.
    if (!simModeRef.current) {
      savedRealRef.current = {
        gs: gsRef.current,
        actions: [...currentHandActionsRef.current],
        handStartStacks: { ...handStartStacksRef.current },
        ranges: JSON.parse(JSON.stringify(rangeRef.current)),
        rangeMeta: JSON.parse(JSON.stringify(rangeMetaRef.current)),
        mood: { ...moodRef.current },
      }
    }
    simSeedRef.current = { record, stepIdx }
    simModeRef.current = true; setSimMode(true); setSimResult(null); setHistoryOpen(false)

    const step = computeStepState(record, stepIdx)
    const ranges = reconstructRanges(record, stepIdx)
    const phase: Phase = step.currentPhase === 'showdown' ? 'river' : step.currentPhase
    const boardCount = phase === 'preflop' ? 0 : phase === 'flop' ? 3 : phase === 'turn' ? 4 : 5
    const dealerIdx = record.players.find(p => p.position === 'BTN' || p.position === 'BTN/SB')?.idx ?? 0
    const heroP = record.players.find(p => p.isHero)

    // Card removal: hero cards + the WHOLE original board (so a re-drawn hand can
    // never collide with a future community card we'll deal later).
    const used = new Set<string>()
    record.board.forEach(c => c && used.add(c.rank + c.suit))
    heroP?.holeCards.forEach(c => c && used.add(c.rank + c.suit))

    const community: (Card | null)[] = [null, null, null, null, null]
    for (let i = 0; i < boardCount; i++) community[i] = record.board[i] as Card
    const boardCards = community.filter(Boolean) as Card[]

    let seats: Seat[] = record.players.map(p => {
      const ss = step.players.find(x => x.idx === p.idx)!
      const folded = ss.isFolded
      let hole: [Card | null, Card | null]
      if (p.isHero) hole = [p.holeCards[0], p.holeCards[1]]
      else if (folded) hole = [null, null]
      else {
        const combo = sampleHandFromRange(ranges[p.idx] ?? initRange(boardCards), used)
        if (combo) { used.add(combo[0].rank + combo[0].suit); used.add(combo[1].rank + combo[1].suit); hole = [combo[0], combo[1]] }
        else hole = [null, null]
      }
      const streetBet = step.streetBets[p.idx] ?? 0
      const stack = ss.stack
      const committed = (p.startStack ?? stack) - stack
      return {
        idx: p.idx, name: p.name, isHero: p.isHero, stack,
        holeCards: hole, cardsFaceUp: p.isHero,
        bet: streetBet, totalBet: committed,
        isFolded: folded, isAllIn: stack <= 0 && !folded && committed > 0,
        isActive: false, lastAction: null, level: p.level,
        position: p.position, isDealer: p.idx === dealerIdx, isSB: false, isBB: false,
        isEliminated: false, isSittingOut: false, seatType: p.seatType,
      }
    })
    const { sbIdx, bbIdx } = findBlinds(seats, dealerIdx)
    seats = seats.map((s, i) => ({ ...s, isSB: i === sbIdx, isBB: i === bbIdx }))

    // Seed the deck so future community cards replay IDENTICALLY to the original.
    const remaining = (record.board.filter(Boolean) as Card[]).slice(boardCount)
    const blocked = new Set(used); remaining.forEach(c => blocked.add(c.rank + c.suit))
    const others = shuffle(mkDeck().filter(c => !blocked.has(c.rank + c.suit)))
    const deck = [...others, ...[...remaining].reverse()]

    const currentBet = seats.reduce((m, s) => Math.max(m, s.bet), 0)

    // Continue the SAME hand's bookkeeping → live coach (aggression/barrels/
    // priorRaises) stays coherent with what built the spot.
    currentHandActionsRef.current = record.actions.slice(0, stepIdx + 1).map(a => ({ ...a }))
    rangeRef.current = ranges; rangeMetaRef.current = {}; moodRef.current = {}
    handStartStacksRef.current = {}
    record.players.forEach(p => { handStartStacksRef.current[p.idx] = p.startStack })

    const state: GState = {
      phase, deck, seats, community, pot: step.pot, currentBet, minRaise: bbAmt,
      actQueue: [], dealerIdx, handNum: record.handNum,
      log: [`=== Simulation (${PHASE_LABEL[phase]}) ===`], winners: [],
      paused: false, autoRunning: true,
    }
    setGs(state); gsRef.current = state

    // Resume betting where the hand was: fresh street if nobody has acted on it
    // yet, else only re-prompt the players who still owe action.
    const phaseActs = record.actions.slice(0, stepIdx + 1)
      .filter(a => a.seatIdx >= 0 && a.phase === phase && a.actionType !== 'SB' && a.actionType !== 'BB')
    const actedThisStreet = new Set(phaseActs.map(a => a.seatIdx))
    setTimeout(() => resumeReviveBetting(gsRef.current, dealerIdx, bbIdx, step.lastActorIdx, currentBet, actedThisStreet), 480)
  }

  function resumeReviveBetting(state: GState, dealerIdx: number, bbIdx: number, lastActorIdx: number, currentBet: number, actedThisStreet: Set<number>) {
    const n = state.seats.length
    const canAct = (idx: number) => {
      const s = state.seats[idx]
      return !!s && !s.isFolded && !s.isAllIn && !s.isEliminated && s.stack > 0
    }
    if (actedThisStreet.size === 0) {
      // Fresh street — open the round normally (engine builds the full queue).
      const first = state.phase === 'preflop'
        ? (n === 2 ? dealerIdx : (bbIdx + 1) % n)   // HU: dealer/SB acts first pre-flop
        : firstActivePostflop(state.seats, dealerIdx)
      startStreet(state, first)
      return
    }
    // Mid-street — queue only those who still owe action, clockwise from the
    // last actor. A later raise re-opens the round via nextQueueAfter as usual.
    const first = (Math.max(0, lastActorIdx) + 1) % n
    const queue: number[] = []
    for (let i = 0; i < n; i++) {
      const idx = (first + i) % n
      if (!canAct(idx)) continue
      if (state.seats[idx].bet < currentBet || !actedThisStreet.has(idx)) queue.push(idx)
    }
    if (queue.length === 0) { endStreet(state); return }
    const ns = { ...state, actQueue: queue }
    setGs(ns); gsRef.current = ns
    scheduleAutoNext(ns, 420)
  }

  // Restart / replay the sandbox: re-draw opponents (hero keeps their cards).
  function restartSim() {
    const seed = simSeedRef.current
    if (seed) reviveSituation(seed.record, seed.stepIdx)
  }

  // Leave the sandbox: restore the real game exactly as it was, reopen history.
  function exitSim() {
    flowGenRef.current++
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    const saved = savedRealRef.current
    simModeRef.current = false; setSimMode(false); setSimResult(null); simSeedRef.current = null
    if (saved) {
      currentHandActionsRef.current = saved.actions
      handStartStacksRef.current = saved.handStartStacks
      rangeRef.current = saved.ranges
      rangeMetaRef.current = saved.rangeMeta
      moodRef.current = saved.mood
      // Restore the real hand HALTED — the player resumes it with "Reprendre"
      // (matches "la partie en pause reprend"). Idle/showdown stay as they were.
      const resumePaused = saved.gs.phase !== 'idle' && saved.gs.phase !== 'showdown'
      const restored = resumePaused ? { ...saved.gs, paused: true } : saved.gs
      setGs(restored); gsRef.current = restored
      savedRealRef.current = null
    }
    setHistoryOpen(true)
  }

  function startHandContinue(state: GState) {
    const deck = [...state.deck]
    const numSeats = state.seats.length

    // Build the deal order: one card at a time, going clockwise from the SB
    // (dealer+1), two rounds — exactly how a live dealer pitches the cards.
    const order: number[] = []
    for (let i = 1; i <= numSeats; i++) {
      const idx = (state.dealerIdx + i) % numSeats
      if (!state.seats[idx].isSittingOut) order.push(idx)
    }
    const assigns: { seatIdx: number; cardIdx: 0 | 1; card: Card }[] = []
    for (let round = 0; round < 2; round++) {
      for (const idx of order) {
        const c = deck.pop()
        if (c) assigns.push({ seatIdx: idx, cardIdx: round as 0 | 1, card: c })
      }
    }

    // Start from an empty (no hole cards) dealing state; deck already holds the
    // remainder for the board.
    const dealingSeats = state.seats.map(s => ({ ...s, holeCards: [null, null] as [Card|null, Card|null] }))
    const dealingState: GState = { ...state, deck, seats: dealingSeats, phase: 'dealing' }
    setGs(dealingState)
    gsRef.current = dealingState

    // Clear any leftover deal timers, then pitch the cards one by one.
    dealTimeoutsRef.current.forEach(t => clearTimeout(t))
    dealTimeoutsRef.current = []

    const STEP = 80
    assigns.forEach((a, i) => {
      const t = setTimeout(() => {
        const cur = gsRef.current
        const seats = cur.seats.map(s => {
          if (s.idx !== a.seatIdx) return s
          const hc = [...s.holeCards] as [Card|null, Card|null]
          hc[a.cardIdx] = a.card
          return { ...s, holeCards: hc }
        })
        const ns = { ...cur, seats }
        setGs(ns); gsRef.current = ns
      }, i * STEP)
      dealTimeoutsRef.current.push(t)
    })

    // Once every card is dealt, open the pre-flop betting round.
    const finishT = setTimeout(() => {
      const cur = gsRef.current
      const { bbIdx } = findBlinds(cur.seats, cur.dealerIdx)
      const firstToAct = numSeats === 2 ? cur.dealerIdx : (bbIdx + 1) % numSeats
      const queue = buildActQueue(cur.seats, firstToAct)

      recordAction({ phase: 'preflop', seatIdx: -1, name: '', isHero: false, actionType: 'PREFLOP', amount: 0 }, cur.pot)

      const newState: GState = { ...cur, phase: 'preflop', actQueue: queue }
      setGs(newState); gsRef.current = newState
      scheduleAutoNext(newState, 300)
    }, assigns.length * STEP + 220)
    dealTimeoutsRef.current.push(finishT)
  }

  function stopGame() {
    flowGenRef.current++
    manualModeRef.current = false; setManualMode(false); setManualPanel(null)
    manualUndoRef.current = []; setManualUndoDepth(0)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    setGs(prev => ({ ...prev, phase: 'idle', autoRunning: false, actQueue: [] }))
  }

  // Sit out / sit in always takes effect on the NEXT hand — you can't leave in
  // the middle of a hand. The flag just controls whether the hero is dealt in.
  function toggleSitOut() {
    const nv = !sitOutRef.current
    sitOutRef.current = nv
    setSitOut(nv)
  }

  function rebuyPlayer(seatIdx: number) {
    setGs(prev => ({
      ...prev,
      seats: prev.seats.map((s, i) => i === seatIdx
        ? { ...s, stack: stackBB * bbAmt, isEliminated: false, isSittingOut: false }
        : s),
    }))
  }

  // Hero rebuy with a chosen amount: refund the stack and resume the flow.
  function rebuyHero(amount: number) {
    const amt = Math.max(bbAmt, Math.round(amount))
    setGs(prev => {
      const seats = prev.seats.map(s => s.isHero
        ? { ...s, stack: amt, isEliminated: false, isSittingOut: false }
        : s)
      const ns = { ...prev, seats }
      gsRef.current = ns
      return ns
    })
    // Deal a fresh hand now that the hero is funded again.
    setTimeout(() => advanceToNextHand(), 250)
  }

  function togglePause() {
    const cur = gsRef.current
    const paused = !cur.paused
    // Update the ref synchronously so the (un)paused state is visible to any
    // timer we schedule right now — relying on gsRef after setGs would read the
    // stale (still-paused) value and silently skip resuming.
    const ns = { ...cur, paused }
    setGs(ns)
    gsRef.current = ns

    if (paused) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
      dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    } else {
      // Resume: at showdown restart the next-hand countdown, otherwise the action loop.
      if (ns.phase === 'showdown') {
        if (!heroIsBusted(ns)) scheduleNextHand()
      } else if (ns.phase !== 'idle' && ns.phase !== 'dealing') {
        scheduleAutoNext(ns, 300)
      }
    }
  }

  // ─── Hero actions ────────────────────────────────────────────────────────
  function heroAction(action: string, amount = 0) {
    const cur = gsRef.current
    const hero = cur.seats.find(s => s.isHero)
    if (!hero || !hero.isActive) return
    if (manualModeRef.current) pushManualUndo()

    let newState = executeAction(hero.idx, action, amount, cur)
    newState = { ...newState, actQueue: nextQueueAfter(newState, hero.idx, cur) }

    // Check fold win
    const stillIn = newState.seats.filter(s => !s.isFolded && !s.isEliminated)
    if (stillIn.length === 1) {
      const winner = foldWin(stillIn[0].idx, newState)
      setGs(winner); gsRef.current = winner
      saveCurrentHand(winner)
      return
    }

    if (manualModeRef.current) { advanceManual(newState); return }
    setGs(newState); gsRef.current = newState
    scheduleAutoNext(newState, 400)
  }

  // ── Manual authoring (scenario): apply one player's action, then light up the
  // next player to act — never auto-running bots. The coach updates because
  // executeAction feeds currentHandActionsRef + trackRange like any real action.
  function advanceManual(ns: GState) {
    if (ns.actQueue.length === 0) {
      // Street complete → collect + deal the next street; startStreet re-lights the
      // first actor (manual branch) once the board lands.
      setGs(ns); gsRef.current = ns
      endStreet(ns)
      return
    }
    const nextIdx = ns.actQueue[0]
    const s2 = { ...ns, seats: ns.seats.map((s, i) => ({ ...s, isActive: i === nextIdx })) }
    setGs(s2); gsRef.current = s2
  }

  // Snapshot the live state before a manual action so it can be undone.
  function pushManualUndo() {
    manualUndoRef.current.push({
      gs: gsRef.current,
      actions: [...currentHandActionsRef.current],
      ranges: JSON.parse(JSON.stringify(rangeRef.current)),
      rangeMeta: JSON.parse(JSON.stringify(rangeMetaRef.current)),
    })
    setManualUndoDepth(manualUndoRef.current.length)
  }
  // Step back one manual action — restores pot, bets, board, ranges and the
  // on-turn player. Multiple undos walk back across street boundaries too.
  function undoManual() {
    const snap = manualUndoRef.current.pop()
    setManualUndoDepth(manualUndoRef.current.length)
    if (!snap) return
    flowGenRef.current++  // cancel any pending street-transition timer
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    setManualPanel(null); setManualBet('')
    currentHandActionsRef.current = snap.actions
    rangeRef.current = snap.ranges
    rangeMetaRef.current = snap.rangeMeta
    setGs(snap.gs); gsRef.current = snap.gs
  }

  function manualAct(seatIdx: number, action: string, rawAmount = 0) {
    const cur = gsRef.current
    if (!manualModeRef.current) return
    if (cur.actQueue[0] !== seatIdx) return           // turn-order guard: only the on-turn seat
    pushManualUndo()
    setManualPanel(null); setManualBet('')
    let ns = executeAction(seatIdx, action, rawAmount, cur)
    ns = { ...ns, actQueue: nextQueueAfter(ns, seatIdx, cur) }
    const stillIn = ns.seats.filter(s => !s.isFolded && !s.isEliminated)
    if (stillIn.length === 1) {
      const winner = foldWin(stillIn[0].idx, ns)
      setGs(winner); gsRef.current = winner
      saveCurrentHand(winner)
      return
    }
    advanceManual(ns)
  }

  // ─── Bot style label ─────────────────────────────────────────────────────
  function botStyle(seat: Seat): string {
    if (seat.seatType === 'human') return 'Humain'
    return ['', 'Amateur', 'Pro', 'Expert'][seat.level] ?? 'Bot'
  }

  // ─── Derived state ───────────────────────────────────────────────────────
  const hero = gs.seats.find(s => s.isHero)
  const isHeroTurn = hero?.isActive ?? false
  const isScenario = !!cfg.scenario
  const roomVariant: RoomVariant = simMode ? 'sim' : isScenario ? 'scenario' : 'default'
  // Hero is all-in inside a still-running hand (chips committed, board to come).
  const heroAllInLive = !!hero && hero.stack <= 0 && hero.isAllIn && !hero.isFolded
    && (hero.holeCards[0] !== null || hero.holeCards[1] !== null)
    && (gs.phase === 'preflop' || gs.phase === 'flop' || gs.phase === 'turn' || gs.phase === 'river')
  // Busted = no chips AND not in a live all-in (→ show the rebuy prompt).
  const heroBusted = !!hero && hero.stack <= 0 && !heroAllInLive
  const heroOut = !!hero && hero.isSittingOut          // actually dealt out this hand
  const sitOutPending = sitOut && !heroOut             // queued for the next hand
  const isShowdown = gs.phase === 'showdown'
  // Hero is live in the current hand (has cards, not folded/out) — used to show
  // the pre-action check boxes while waiting for other players.
  const heroInHand = !!hero && !hero.isFolded && !hero.isSittingOut && !heroBusted && !hero.isAllIn
    && (hero.holeCards[0] !== null || hero.holeCards[1] !== null)
    && gs.phase !== 'idle' && gs.phase !== 'dealing' && gs.phase !== 'showdown'
  // Coach hover-card is open when hovering the hero's own profile (or the panel).
  const coachOpen = !!hero && heroInHand && (hoverSeat === hero.idx || heroPanelHover)
  // Hero's represented (perceived) range — shown postflop in the coach panel.
  const heroRepView = (coachOpen && hero && gs.community.filter(Boolean).length >= 3 && rangeRef.current[hero.idx])
    ? rangeView(rangeRef.current[hero.idx]) : null
  const heroRepMeta = hero ? (rangeMetaRef.current[hero.idx] ?? { move: '—', effect: 'range de départ' }) : null
  const preCanCheck = !!hero && gs.currentBet <= hero.bet          // no bet to call → check
  const preCallAmt = hero ? Math.min(gs.currentBet - hero.bet, hero.stack) : 0

  // Situation detection from the RECORDED actions of this hand (robust: a raiser
  // who later folded/re-acted is still counted correctly).
  const handActions = currentHandActionsRef.current
  const preflopRaiseActions = handActions.filter(a => a.seatIdx >= 0 && a.phase === 'preflop' && (a.actionType === 'RAISE' || a.actionType === 'ALL-IN')).length
  const preflopCallers = handActions.filter(a => a.seatIdx >= 0 && a.phase === 'preflop' && a.actionType === 'CALL').length
  const heroScenario: Scenario | 'postflop' =
    gs.phase !== 'preflop' ? 'postflop'
    : preflopRaiseActions >= 3 ? 'vs4bet'
    : preflopRaiseActions === 2 ? 'vs3bet'
    : preflopRaiseActions === 1 ? (preflopCallers > 0 ? 'squeeze' : 'vsopen')
    : preflopCallers > 0 ? 'iso' : 'rfi'
  // The last pre-flop raiser (opener for vs-open, 3-bettor for vs-3bet).
  const lastPreRaiserSeat = [...handActions].reverse().find(a => a.seatIdx >= 0 && a.phase === 'preflop' && (a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))?.seatIdx ?? -1
  // Position of the opener we're facing (vs-open) → defend wider vs a late/wide
  // open, tighter vs a tight UTG open. Same source as the critique to stay coherent.
  const heroVsOpenerPos = heroScenario === 'vsopen' ? gs.seats[lastPreRaiserSeat]?.position : undefined
  // Number of opponents currently all-in preflop → "facing a jam" call-off coach.
  const heroNumAllIn = gs.phase === 'preflop'
    ? gs.seats.filter(s => !s.isHero && !s.isFolded && s.isAllIn).length
    : 0
  // vs-3bet: size of the 3-bet relative to the open (3 ≈ standard) → continue width.
  const heroReRaiseRatio = (() => {
    const amts = handActions.filter(a => a.seatIdx >= 0 && a.phase === 'preflop' && (a.actionType === 'RAISE' || a.actionType === 'ALL-IN')).map(a => a.amount)
    return amts.length >= 2 && amts[0] > 0 ? amts[1] / amts[0] : undefined
  })()
  // Villain aggression → range-aware equity. Count opponents' bets/raises this
  // hand; barrels = how many post-flop streets they've fired.
  const villainAggro = handActions.filter(a => a.seatIdx >= 0 && !a.isHero && (a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN'))
  const heroAggression = Math.min(0.85, villainAggro.length * 0.28)
  const heroBarrels = new Set(villainAggro.filter(a => a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river').map(a => a.phase)).size
  // Range width is driven by how many *active* players (still in the hand, dealt
  // in, not folded / sitting out / busted) remain to act after the hero — NOT by
  // the static table size. So a fold-around to the SB becomes a true blind-vs-
  // blind spot, and eliminations/sit-outs shrink the effective table.
  const seatsN = gs.seats.length
  const bbOffsetN = seatsN === 2 ? 1 : 2
  const firstOffsetN = (bbOffsetN + 1) % seatsN
  const actIndexOf = (seatIdx: number) =>
    ((((seatIdx - gs.dealerIdx) % seatsN + seatsN) % seatsN) - firstOffsetN + seatsN) % seatsN
  const inHand = (s: Seat) => !s.isSittingOut && !s.isEliminated && (s.holeCards[0] !== null || s.holeCards[1] !== null)
  const heroActiveCount = gs.seats.filter(s => inHand(s) && !s.isFolded).length // players still live in the hand
  const heroPlayersBehind = hero
    ? gs.seats.filter(s => s.idx !== hero.idx && inHand(s) && !s.isFolded && actIndexOf(s.idx) > actIndexOf(hero.idx)).length
    : 1
  // Postflop action order starts left of the button (offset 1), button acts last
  // → hero is "in position" if no live opponent acts after them postflop.
  const postActIndexOf = (seatIdx: number) =>
    ((((seatIdx - gs.dealerIdx) % seatsN + seatsN) % seatsN) - 1 + seatsN) % seatsN
  const heroInPosition = hero
    ? !gs.seats.some(s => s.idx !== hero.idx && inHand(s) && !s.isFolded && postActIndexOf(s.idx) > postActIndexOf(hero.idx))
    : true
  // vs-3bet: is the 3-bettor in position (acts after us post-flop) → flat tighter.
  const heroThreeBettorIP = heroScenario === 'vs3bet' && lastPreRaiserSeat >= 0 && hero
    ? postActIndexOf(lastPreRaiserSeat) > postActIndexOf(hero.idx)
    : undefined
  // Effective stack (chips that can actually be played for) = min of hero's and
  // the biggest live opponent's total chips → drives SPR / commit decisions.
  const heroEffStack = (() => {
    if (!hero) return 0
    const live = gs.seats.filter(s => s.idx !== hero.idx && inHand(s) && !s.isFolded)
    const heroTotal = hero.stack + hero.bet
    const maxVill = live.length ? Math.max(...live.map(s => s.stack + s.bet)) : heroTotal
    return Math.min(heroTotal, maxVill)
  })()
  const heroMultiway = heroActiveCount > 2
  const heroRaiseToBB = bbAmt > 0 ? gs.currentBet / bbAmt : 2.5
  const canCheck = isHeroTurn && gs.currentBet === (hero?.bet ?? 0)
  const callAmt = isHeroTurn ? Math.min((gs.currentBet - (hero?.bet ?? 0)), hero?.stack ?? 0) : 0
  // Raise sizing (all "raise to" totals): minimum legal raise, all-in cap, and
  // whether the hero has enough chips behind the call to raise at all.
  const heroBet = hero?.bet ?? 0
  const heroStack = hero?.stack ?? 0
  const minRaiseTo = gs.currentBet + gs.minRaise
  const heroMaxTo = heroBet + heroStack
  const isOpenBet = gs.currentBet === 0
  const canRaise = isHeroTurn && heroStack > callAmt
  const clampRaise = (v: number) => Math.max(Math.min(minRaiseTo, heroMaxTo), Math.min(v, heroMaxTo))
  // Pot shown in the center = everything committed minus the live bets that are
  // still sitting in front of players (those are drawn as separate stacks).
  const collectedPot = gs.pot - gs.seats.reduce((a, s) => a + s.bet, 0)

  // Reset the raise amount to a sensible default each time it becomes the hero's turn.
  useEffect(() => {
    if (isHeroTurn) {
      const def = isOpenBet
        ? Math.max(bbAmt, Math.round(gs.pot * 0.5 / bbAmt) * bbAmt)
        : gs.currentBet + Math.round((gs.pot) * 0.5 / bbAmt) * bbAmt
      setHeroBetAmt(Math.max(Math.min(minRaiseTo, heroMaxTo), Math.min(def, heroMaxTo)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeroTurn, gs.handNum, gs.currentBet])

  // ── Keyboard shortcuts — only on the hero's turn, ignored while typing ──
  //   f = fold · c = check/call · &(1) = ⅓ pot · é(2) = ⅔ pot · p = pot · a = all-in
  //   (& and é are the AZERTY 1/2 keys; the bare 1/2 digits work too as a fallback)
  useEffect(() => {
    if (!isHeroTurn || gs.paused || manualMode) return  // manual mode has its own panel shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      const sizeTo = (frac: number) => clampRaise(gs.currentBet + Math.round((gs.pot + callAmt) * frac / bbAmt) * bbAmt)
      const aggro = (amt: number) => { if (canRaise) heroAction(isOpenBet ? 'BET' : 'RAISE', amt) }
      if (k === 'f') { e.preventDefault(); heroAction('FOLD') }
      else if (k === 'c') { e.preventDefault(); if (canCheck) heroAction('CHECK'); else heroAction('CALL', callAmt) }
      else if (k === '&' || k === '1') { e.preventDefault(); aggro(sizeTo(1 / 3)) }
      else if (k === 'é' || k === '2') { e.preventDefault(); aggro(sizeTo(2 / 3)) }
      else if (k === 'p') { e.preventDefault(); aggro(sizeTo(1)) }
      else if (k === 'a') { e.preventDefault(); if (canRaise) heroAction('ALL-IN', heroMaxTo) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeroTurn, gs.paused, gs.currentBet, gs.pot, callAmt, canCheck, canRaise, isOpenBet, heroMaxTo, bbAmt, manualMode])

  // Manual-mode shortcuts — active while the bet panel is open, for ANY on-turn
  // player: f = fold · c = check/call · a = all-in · Enter = send typed amount ·
  // Esc = close the panel. Work even with the number input focused (letters don't
  // type into it), and the digits still go to the input normally.
  useEffect(() => {
    if (!manualMode || manualPanel === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const idx = manualPanel
      const cur = gsRef.current
      const s = cur.seats[idx]
      if (!s) return
      const toCall = Math.max(0, cur.currentBet - s.bet)
      const maxTo = s.bet + s.stack
      const canCheckP = toCall === 0
      const k = e.key.toLowerCase()
      if (k === 'escape') { e.preventDefault(); setManualPanel(null); setManualBet('') }
      else if (k === 'f') { e.preventDefault(); manualAct(idx, 'FOLD', 0) }
      else if (k === 'c') { e.preventDefault(); manualAct(idx, canCheckP ? 'CHECK' : 'CALL', toCall) }
      else if (k === 'a') { e.preventDefault(); manualAct(idx, canCheckP ? 'BET' : 'RAISE', maxTo) }
      else if (k === 'enter') {
        const minTo = Math.min(maxTo, cur.currentBet + cur.minRaise)
        const typedTo = Math.round((parseFloat(manualBet) || 0) * bbAmt)
        if (typedTo >= (canCheckP ? bbAmt : minTo)) { e.preventDefault(); manualAct(idx, canCheckP ? 'BET' : 'RAISE', typedTo) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMode, manualPanel, manualBet, bbAmt])

  // Backspace (the "Retour" key) undoes the last manual action — except while
  // editing the bet field, where it deletes a digit as usual.
  useEffect(() => {
    if (!manualMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      e.preventDefault()
      undoManual()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMode])

  // Decision clock: when the hero's time runs out, auto-act. Facing a bet that
  // must be called/raised → auto-fold and sit out next hand. Otherwise (a free
  // check is available) → auto-check and the hand continues normally.
  useEffect(() => {
    // The clock freezes while the coach hover-card is open (resumes on leave).
    // In manual authoring mode there is no clock at all — you take your time.
    if (!isHeroTurn || gs.paused || coachOpen || manualMode) return
    const t = setTimeout(() => {
      const cur = gsRef.current
      const h = cur.seats.find(s => s.isHero)
      if (!h || !h.isActive || cur.paused) return
      const toCall = cur.currentBet - h.bet
      if (toCall <= 0) {
        heroAction('CHECK')
      } else {
        sitOutRef.current = true
        setSitOut(true)
        heroAction('FOLD')
      }
    }, decisionTimer * 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeroTurn, gs.paused, coachOpen, gs.handNum, gs.currentBet, manualMode])

  // Apply a queued pre-action ("check box") the instant it's the hero's turn.
  useEffect(() => {
    if (!isHeroTurn || preActionRef.current === 'none') return
    const pa = preActionRef.current
    setPreAction('none')
    const cur = gsRef.current
    const h = cur.seats.find(s => s.isHero)
    if (!h) return
    const toCall = cur.currentBet - h.bet
    if (pa === 'fold') heroAction('FOLD')
    else { if (toCall <= 0) heroAction('CHECK'); else heroAction('CALL', Math.min(toCall, h.stack)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeroTurn])

  // A new hand clears any queued pre-action.
  useEffect(() => { setPreAction('none') }, [gs.handNum])

  // ─── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
      dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    }
  }, [])

  // ─── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden select-none" style={{background:'#0c0907'}}>

      {/* ── HEADER (draggable title bar) ── */}
      <header className="app-drag flex items-center gap-3 px-4 py-2 border-b border-white/8 flex-shrink-0 relative z-30"
        style={{background:'rgba(5,8,16,0.97)'}}>
        <button onClick={() => (simMode ? exitSim() : navigate(isScenario ? '/setup' : '/training'))}
          className="app-drag-none flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={15}/>
          <span className="text-[10px] uppercase tracking-widest font-bold">{simMode ? 'Quitter la simulation' : 'Quitter'}</span>
        </button>
        <div className="h-4 w-px bg-white/10"/>
        {simMode && (
          <span className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-[0.18em]"
            style={{ borderColor: 'rgba(167,139,255,0.5)', background: 'rgba(120,90,230,0.18)', color: '#c8b6ff' }}>
            ⚡ Simulation · partie réelle en pause
          </span>
        )}
        {!simMode && isScenario && (
          <span className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-[0.18em]"
            style={{ borderColor: 'rgba(240,192,96,0.5)', background: 'rgba(200,120,50,0.16)', color: '#f0c878' }}>
            ✦ Setup Position{manualMode ? ' · mode manuel' : ''}
          </span>
        )}
        {manualMode && (
          <button onClick={undoManual} disabled={manualUndoDepth === 0}
            title="Annuler la dernière action saisie (touche Retour ⌫)"
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-30 enabled:hover:bg-white/10"
            style={{ borderColor: 'rgba(240,192,96,0.4)', background: 'rgba(255,255,255,0.05)', color: '#f0c878' }}>
            <ArrowLeft size={11}/> Annuler{manualUndoDepth > 0 ? ` (${manualUndoDepth})` : ''} <span className="opacity-50">⌫</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Main</span>
          <span className="text-[10px] font-bold text-[#c9a227]">#{gs.handNum}</span>
          <span className="text-[8px] px-2 py-0.5 rounded border border-white/10 text-white/40 font-bold uppercase tracking-widest">
            {PHASE_LABEL[gs.phase]}
          </span>
        </div>
        <div className="h-4 w-px bg-white/10"/>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/30 uppercase tracking-wide">Pot</span>
          <span className="text-[11px] font-bold text-[#c9a227] font-mono">${gs.pot.toLocaleString()}</span>
        </div>
        <div className="flex-1"/>

        {/* History button — replaced by Restart inside a Revive sandbox. */}
        {simMode ? (
          <button onClick={restartSim}
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[9px] font-bold uppercase tracking-widest"
            style={{ borderColor: 'rgba(167,139,255,0.5)', background: 'rgba(120,90,230,0.18)', color: '#c8b6ff' }}>
            <RefreshCw size={11}/> Restart
          </button>
        ) : handHistory.length > 0 && (
          <button onClick={() => setHistoryOpen(true)}
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all text-[9px] font-bold uppercase tracking-widest">
            Historique ({handHistory.length})
          </button>
        )}

        {/* Sit out / sit in — always applies on the next hand */}
        {gs.phase !== 'idle' && (
          <button onClick={toggleSitOut}
            title={sitOut ? 'Revenir à la prochaine main' : 'Sortir à la prochaine main'}
            className={`app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[9px] font-bold uppercase tracking-widest
              ${sitOut ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}`}>
            {sitOut ? 'Sit In' : 'Sit Out'}
          </button>
        )}

        {/* Range Vision is always on now — hover any in-hand player for their range,
            hover your own profile for range + full coach advice (no button). */}
        {gs.phase !== 'idle' && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#c9a227]/30 bg-[#c9a227]/10 text-[#c9a227]/80 text-[9px] font-bold uppercase tracking-widest">
            <Eye size={11}/> Survole un joueur
          </span>
        )}

        {/* Game controls — flow is automatic; Pause halts it (incl. at showdown) */}
        {gs.phase === 'idle' ? (
          <button onClick={() => startHand(gs.seats.length > 0 ? gs.seats : createSeats(), gs.dealerIdx, gs.handNum)}
            className="app-drag-none flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all"
            style={{background:'linear-gradient(135deg,#c9a227,#8B6810)',color:'#0a0a0a'}}>
            <Play size={12}/> Démarrer
          </button>
        ) : (
          <div className="app-drag-none flex items-center gap-2">
            <button onClick={togglePause}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition-all text-[9px] font-bold">
              {gs.paused ? <Play size={11}/> : <Pause size={11}/>}
              {gs.paused ? 'Reprendre' : 'Pause'}
            </button>
            <button onClick={stopGame}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-900/20 border border-red-700/30 text-red-400/70 hover:text-red-400 hover:bg-red-900/30 transition-all text-[9px] font-bold">
              <Square size={11}/> Stop
            </button>
          </div>
        )}

        {/* Window controls — always visible, even mid-game */}
        <div className="app-drag-none flex items-center gap-2 pl-1">
          <button onClick={() => window.api?.minimizeWindow()} title="Réduire"
            className="w-3.5 h-3.5 rounded-full bg-yellow-400/70 hover:bg-yellow-400 transition-colors"/>
          <button onClick={() => window.api?.maximizeWindow()} title="Agrandir"
            className="w-3.5 h-3.5 rounded-full bg-green-400/70 hover:bg-green-400 transition-colors"/>
          <button onClick={() => window.api?.closeWindow()} title="Fermer"
            className="w-3.5 h-3.5 rounded-full bg-red-400/70 hover:bg-red-400 transition-colors"/>
        </div>
      </header>

      {/* ── TABLE AREA ── */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <Room variant={roomVariant}/>

        {/* Idle overlay */}
        <AnimatePresence>
          {gs.phase === 'idle' && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="absolute inset-0 z-20 flex items-center justify-center"
              style={{background:'rgba(0,0,0,0.7)'}}>
              <motion.div initial={{scale:0.9,y:20}} animate={{scale:1,y:0}}
                className="text-center flex flex-col items-center gap-4">
                <div className="text-6xl opacity-60">♠</div>
                <h2 className="font-display font-bold text-2xl tracking-[0.3em] uppercase text-white/80">
                  Poker Elite
                </h2>
                <p className="text-white/40 text-sm">Appuyez sur Démarrer pour commencer</p>
                <button
                  onClick={() => startHand(gs.seats.length > 0 ? gs.seats : createSeats(), 0, 0)}
                  className="mt-2 px-8 py-3 rounded-xl font-bold text-sm tracking-widest uppercase transition-all"
                  style={{background:'linear-gradient(135deg,#f0d060,#c9a227,#8B6810)',color:'#0a0a0a',boxShadow:'0 0 30px rgba(201,162,39,0.4)'}}>
                  ✦ Démarrer la partie ✦
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table container */}
        <div ref={tableRef} className="absolute inset-0 flex items-center justify-center p-2"
          onMouseLeave={() => setHoverSeat(s => (s !== null && s !== hero?.idx ? null : s))}>
          <div className="relative w-full h-full" style={{maxWidth:1240,maxHeight:700}}>

            {/* Table SVG */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{padding:'18px 28px'}}>
              <div style={{width:'100%',maxWidth:1120}}>
                <TableSVG variant={roomVariant}/>
              </div>
            </div>

            {/* Community cards */}
            {gs.phase !== 'idle' && gs.phase !== 'dealing' && (
              <div className="absolute left-1/2 -translate-x-1/2" style={{top:'34%',transform:'translate(-50%,-50%)'}}>
                <div className="flex gap-2 items-end">
                  {gs.community.map((card, i) => (
                    <AnimatePresence key={i}>
                      {card ? (
                        <motion.div key={`${card.rank}${card.suit}`}
                          initial={{y:-40,opacity:0,scale:0.5,rotateY:90}}
                          animate={{y:0,opacity:1,scale:1,rotateY:0}}
                          transition={{type:'spring',stiffness:300,damping:25,delay:i*0.08}}>
                          <PlayingCard rank={card.rank} suit={card.suit} w={62} h={88}/>
                        </motion.div>
                      ) : (
                        <EmptySlot key={`empty-${i}`} w={62} h={88}/>
                      )}
                    </AnimatePresence>
                  ))}
                </div>
              </div>
            )}

            {/* Pot display — always shows the TOTAL pot (incl. live bets). The
                central chip pile represents what's already collected; live bets
                still sit in front of players until the street ends. */}
            {gs.phase !== 'idle' && gs.pot > 0 && (
              <div className="absolute left-1/2 -translate-x-1/2" style={{top:`${POT_POS.y}%`,transform:'translate(-50%,-50%)'}}>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/70 border border-[#c9a227]/30 backdrop-blur-sm">
                  {collectedPot > 0 && <ChipStack amount={collectedPot} sz={20} maxVisible={6}/>}
                  <div className="flex flex-col leading-none">
                    <span className="text-[7px] text-white/40 uppercase tracking-widest">Pot total</span>
                    <span className="text-[13px] font-bold text-[#c9a227] font-mono">${gs.pot.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Seats */}
            {gs.seats.map((seat) => {
              const pos = getSeatPosPct(seat.idx, gs.seats.length)
              const isWinner = gs.winners.includes(seat.idx)
              return (
                <SeatPanel
                  key={seat.idx}
                  seat={seat}
                  style={{ left: pos.left, top: pos.top, transform: pos.transform }}
                  isWinner={isWinner}
                  isShowdown={isShowdown}
                  turnSeconds={decisionTimer}
                  turnNonce={`${gs.handNum}:${gs.currentBet}`}
                  turnPaused={gs.paused || coachOpen || manualMode}
                  hideTimer={manualMode}
                  onRebuy={seat.isEliminated ? () => rebuyPlayer(seat.idx) : undefined}
                  onHoverCards={(entering, e) => {
                    // CARDS zone → range / coach only (and close the bet panel if it
                    // was open for this on-turn seat, so cards = range, never bets).
                    if (entering && manualModeRef.current && gsRef.current.actQueue[0] === seat.idx) setManualPanel(null)
                    if (seat.isHero) {
                      if (entering && e) { if (coachTimerRef.current) clearTimeout(coachTimerRef.current); setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                      else { coachTimerRef.current = setTimeout(() => { if (!heroPanelHoverRef.current) setHoverSeat(s => (s === seat.idx ? null : s)) }, 350) }
                    } else if (entering && e) { setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                  }}
                  onHover={(entering, e) => {
                    // NAME / STACK zone. For the on-turn player in manual mode this
                    // reveals the BET panel only (and hides the range). Otherwise it
                    // behaves like a normal range/coach hover.
                    const onTurnManual = manualModeRef.current && gsRef.current.actQueue[0] === seat.idx && !seat.isFolded
                      && gsRef.current.phase !== 'showdown' && gsRef.current.phase !== 'idle'
                    if (onTurnManual) {
                      if (entering) { setHoverSeat(s => (s === seat.idx ? null : s)); if (manualPanel !== seat.idx) { setManualBet(''); setManualPanel(seat.idx) } }
                      return
                    }
                    if (seat.isHero) {
                      if (entering && e) { if (coachTimerRef.current) clearTimeout(coachTimerRef.current); setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                      else { coachTimerRef.current = setTimeout(() => { if (!heroPanelHoverRef.current) setHoverSeat(s => (s === seat.idx ? null : s)) }, 350) }
                    } else if (entering && e) { setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                  }}
                />
              )
            })}

            {/* Manual authoring: a stylish arrow marks whose turn it is. Hovering the
                seat (like for the range) reveals the action panel — no click needed. */}
            {manualMode && gs.phase !== 'idle' && gs.phase !== 'dealing' && gs.phase !== 'showdown' && (() => {
              const idx = gs.actQueue[0]
              if (idx === undefined) return null
              const seat = gs.seats[idx]
              if (!seat || seat.isFolded) return null
              const pos = getSeatPosPct(idx, gs.seats.length)
              return (
                <div className="absolute z-20 pointer-events-none flex flex-col items-center"
                  style={{ left: pos.left, top: `calc(${pos.top} - 7.5%)`, transform: 'translate(-50%,-50%)' }}>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#f0c878] mb-0.5 animate-pulse"
                    style={{ textShadow: '0 0 8px rgba(240,192,96,0.7)' }}>à parler</span>
                  <svg width="26" height="16" viewBox="0 0 26 16" className="animate-bounce" style={{ filter: 'drop-shadow(0 2px 4px rgba(240,180,70,0.6))' }}>
                    <path d="M13 16 L2 3 Q13 8 24 3 Z" fill="#f0c060" stroke="#fff3c0" strokeWidth="0.8"/>
                  </svg>
                </div>
              )
            })()}

            {/* Dealer button */}
            {gs.phase !== 'idle' && gs.seats.length > 0 && (() => {
              const dealerSeat = gs.seats[gs.dealerIdx]
              if (!dealerSeat) return null
              const pos = getSeatPosPct(gs.dealerIdx, gs.seats.length)
              const leftPct = parseFloat(pos.left)
              const topPct = parseFloat(pos.top)
              // Offset dealer button slightly toward center
              const offX = leftPct < 50 ? 8 : -8
              const offY = topPct < 50 ? 6 : -6
              return (
                <div className="absolute pointer-events-none" style={{
                  left: `calc(${pos.left} + ${offX}%)`,
                  top: `calc(${pos.top} + ${offY}%)`,
                  transform: 'translate(-50%,-50%)',
                  zIndex: 15,
                }}>
                  <DealerButtonToken size={34}/>
                </div>
              )
            })()}

            {/* Live bet stacks — one in front of every player who has committed chips */}
            {gs.phase !== 'idle' && gs.seats.map(seat => {
              if (seat.bet <= 0 || seat.isFolded) return null
              const pos = getSeatPosPct(seat.idx, gs.seats.length)
              const off = betOffset(parseFloat(pos.left), parseFloat(pos.top))
              return (
                <motion.div key={`bet-${seat.idx}`}
                  className="absolute pointer-events-none flex flex-col items-center gap-0.5"
                  initial={{opacity:0,scale:0.7}} animate={{opacity:1,scale:1}}
                  style={{
                    left: `calc(${pos.left} + ${off.x}%)`,
                    top: `calc(${pos.top} + ${off.y}%)`,
                    transform: 'translate(-50%,-50%)',
                    zIndex: 12,
                  }}>
                  <ChipStack amount={seat.bet} sz={17} maxVisible={5}/>
                  <span className="text-[9px] font-mono text-[#c9a227] font-bold bg-black/55 px-1 rounded">${seat.bet.toLocaleString()}</span>
                </motion.div>
              )
            })}

            {/* Chip flights — stacks sliding to the pot (collect) or to a winner (payout) */}
            {chipFlights.map(flight => (
              <motion.div key={flight.id}
                className="absolute pointer-events-none"
                style={{zIndex:50}}
                initial={{ left:`${flight.fromX}%`, top:`${flight.fromY}%`, x:'-50%', y:'-50%', opacity:0.95, scale:0.95 }}
                animate={{ left:`${flight.toX}%`, top:`${flight.toY}%`, x:'-50%', y:'-50%', opacity:flight.kind==='payout'?1:0.9, scale:1 }}
                transition={{ duration: flight.kind==='payout'?0.7:0.6, ease:'easeInOut' }}>
                <FlyingStack amount={flight.amount} sz={17}/>
              </motion.div>
            ))}

          </div>
        </div>
      </div>

      {/* ── HERO CONTROLS ── */}
      {gs.phase !== 'idle' && (
        <div className="flex-shrink-0 border-t border-white/8 relative z-20"
          style={{background:'rgba(4,7,16,0.98)', minHeight: 100}}>

          {/* Hero info bar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5">
            {hero && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-white/40 uppercase tracking-wide">Vous</span>
                  <span className="text-[11px] font-bold text-[#00d4ff]">{hero.name}</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#c9a227]/10 border border-[#c9a227]/20 text-[#c9a227] font-bold">{hero.position}</span>
                </div>
                <div className="h-3 w-px bg-white/10"/>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-white/40">Stack</span>
                  <span className="text-[12px] font-mono font-bold text-emerald-300 tabular-nums" style={{textShadow:'0 1px 3px rgba(0,0,0,0.8)'}}>${hero.stack.toLocaleString()}</span>
                </div>
                {sitOutPending && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold uppercase tracking-wide">
                    Sit out à la prochaine main
                  </span>
                )}
                {hero.holeCards[0] && hero.holeCards[1] && (
                  <>
                    <div className="h-3 w-px bg-white/10"/>
                    <div className="flex gap-1">
                      <PlayingCard rank={hero.holeCards[0].rank} suit={hero.holeCards[0].suit} w={32} h={46}/>
                      <PlayingCard rank={hero.holeCards[1].rank} suit={hero.holeCards[1].suit} w={32} h={46}/>
                    </div>
                    {gs.phase !== 'preflop' && gs.community.some(Boolean) && (
                      <span className="text-[9px] text-white/50 italic">
                        {bestHand([...(hero.holeCards.filter(Boolean) as Card[]), ...(gs.community.filter(Boolean) as Card[])]).name}
                      </span>
                    )}
                  </>
                )}
                <div className="flex-1"/>
                {/* Log toggle */}
                <button onClick={() => setShowLog(v => !v)}
                  className="text-[8px] text-white/30 hover:text-white/60 uppercase tracking-widest">
                  {showLog ? <ChevronDown size={12}/> : <ChevronUp size={12}/>}
                </button>
              </>
            )}
          </div>

          {/* Log */}
          <AnimatePresence>
            {showLog && (
              <motion.div initial={{height:0,opacity:0}} animate={{height:72,opacity:1}} exit={{height:0,opacity:0}}
                className="overflow-hidden border-b border-white/5">
                <div className="h-18 overflow-y-auto px-4 py-1.5 space-y-0.5" style={{maxHeight:72}}>
                  {gs.log.slice(-12).map((line, i) => (
                    <p key={i} className="text-[8px] text-white/35 font-mono">{line}</p>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons — fixed height so the bar never jumps between states */}
          <div className="flex items-center gap-3 px-4 py-3 min-h-[92px]">
            {heroAllInLive ? (
              <div className="flex-1 flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"/>
                <p className="text-[10px] text-purple-300/90 uppercase tracking-widest font-bold">All-in — en attente du tableau…</p>
              </div>
            ) : heroBusted ? (
              <div className="flex-1 flex items-center justify-center gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-red-400/80 uppercase tracking-widest font-bold">Plus de jetons</p>
                  <p className="text-[9px] text-white/40">Rechargez votre tapis pour continuer</p>
                </div>
                <div className="flex items-center rounded-lg border border-[#c9a227]/40 bg-black/45 overflow-hidden">
                  <span className="pl-2.5 text-[12px] text-white/40 font-mono">$</span>
                  <input
                    type="number"
                    value={rebuyAmt}
                    min={bbAmt}
                    step={bbAmt}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10)
                      setRebuyAmt(Number.isNaN(n) ? 0 : Math.max(0, n))
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && rebuyAmt >= bbAmt) rebuyHero(rebuyAmt) }}
                    className="w-24 bg-transparent text-[14px] font-bold text-[#c9a227] font-mono px-1.5 py-2.5 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="flex gap-1">
                  {[50, 100, 200].map(bb => (
                    <button key={bb} onClick={() => setRebuyAmt(bb * bbAmt)}
                      className="px-2 py-1 rounded text-[8px] font-bold bg-white/5 border border-white/10 text-white/45 hover:text-[#c9a227] hover:border-[#c9a227]/30 transition-all">
                      {bb}BB
                    </button>
                  ))}
                </div>
                <motion.button whileTap={{scale:0.95}}
                  onClick={() => rebuyAmt >= bbAmt && rebuyHero(rebuyAmt)}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm tracking-widest uppercase transition-all"
                  style={{background:'linear-gradient(135deg,#22aa44,#145c22)',color:'white'}}>
                  Rebuy
                </motion.button>
              </div>
            ) : isHeroTurn ? (
              <>
                {/* Fold */}
                <motion.button whileTap={{scale:0.95}}
                  onClick={() => heroAction('FOLD')}
                  className="flex-1 py-2.5 rounded-xl border border-red-700/40 bg-red-900/20 text-red-400 font-bold text-sm uppercase tracking-widest hover:bg-red-900/35 transition-all">
                  Fold <kbd className="ml-1 px-1 rounded bg-black/30 text-[8px] font-mono opacity-70 align-middle">F</kbd>
                </motion.button>

                {/* Check / Call */}
                {canCheck ? (
                  <motion.button whileTap={{scale:0.95}}
                    onClick={() => heroAction('CHECK')}
                    className="flex-1 py-2.5 rounded-xl border border-sky-700/40 bg-sky-900/20 text-sky-400 font-bold text-sm uppercase tracking-widest hover:bg-sky-900/35 transition-all">
                    Check <kbd className="ml-1 px-1 rounded bg-black/30 text-[8px] font-mono opacity-70 align-middle">C</kbd>
                  </motion.button>
                ) : (
                  <motion.button whileTap={{scale:0.95}}
                    onClick={() => heroAction('CALL', callAmt)}
                    className="flex-1 py-2.5 rounded-xl border border-emerald-700/40 bg-emerald-900/20 text-emerald-400 font-bold text-sm uppercase tracking-widest hover:bg-emerald-900/35 transition-all">
                    Call ${callAmt.toLocaleString()} <kbd className="ml-1 px-1 rounded bg-black/30 text-[8px] font-mono opacity-70 align-middle">C</kbd>
                  </motion.button>
                )}

                {/* Bet / Raise — typeable amount + sizing shortcuts (all "raise to" totals) */}
                {canRaise && (
                  <div className="flex-1 flex flex-col gap-1">
                    {/* Keyboard input above the raise button */}
                    <div className="flex items-center gap-1">
                      <div className="flex items-center rounded-lg border border-[#c9a227]/30 bg-black/45 overflow-hidden shrink-0">
                        <span className="pl-1.5 text-[11px] text-white/35 font-mono">$</span>
                        <input
                          type="number"
                          value={heroBetAmt}
                          min={Math.min(minRaiseTo, heroMaxTo)}
                          max={heroMaxTo}
                          step={bbAmt}
                          onChange={e => {
                            // Allow free typing (only cap at all-in); enforce the
                            // minimum on blur / submit so large numbers can be typed.
                            const n = parseInt(e.target.value, 10)
                            setHeroBetAmt(Number.isNaN(n) ? 0 : Math.min(Math.max(0, n), heroMaxTo))
                          }}
                          onBlur={() => setHeroBetAmt(v => clampRaise(v))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') heroAction(isOpenBet ? 'BET' : 'RAISE', clampRaise(heroBetAmt))
                          }}
                          className="w-[68px] bg-transparent text-[13px] font-bold text-[#c9a227] font-mono px-1 py-2 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <motion.button whileTap={{scale:0.95}}
                        onClick={() => heroAction(isOpenBet ? 'BET' : 'RAISE', clampRaise(heroBetAmt))}
                        className="flex-1 py-2.5 rounded-xl border border-[#c9a227]/40 bg-[#c9a227]/15 text-[#c9a227] font-bold text-sm uppercase tracking-widest hover:bg-[#c9a227]/25 transition-all whitespace-nowrap">
                        {clampRaise(heroBetAmt) >= heroMaxTo ? 'All-in' : isOpenBet ? `Bet $${heroBetAmt.toLocaleString()}` : `Raise to $${heroBetAmt.toLocaleString()}`}
                      </motion.button>
                    </div>
                    {/* Sizing shortcuts */}
                    <div className="flex items-center gap-1 justify-center">
                      <button onClick={() => setHeroBetAmt(v => clampRaise(v - bbAmt))}
                        className="w-5 h-5 rounded bg-white/8 border border-white/10 flex items-center justify-center text-white/50 hover:bg-white/15 transition-colors">
                        <ChevronDown size={10}/>
                      </button>
                      <div className="flex gap-1">
                        {([
                          ['3bb', clampRaise(3 * bbAmt), ''],
                          ['⅓', clampRaise(gs.currentBet + Math.round((gs.pot + callAmt) / 3 / bbAmt) * bbAmt), '&'],
                          ['½', clampRaise(gs.currentBet + Math.round((gs.pot + callAmt) / 2 / bbAmt) * bbAmt), ''],
                          ['⅔', clampRaise(gs.currentBet + Math.round((gs.pot + callAmt) * 2 / 3 / bbAmt) * bbAmt), 'é'],
                          ['Pot', clampRaise(gs.currentBet + Math.round((gs.pot + callAmt) / bbAmt) * bbAmt), 'P'],
                        ] as [string, number, string][]).map(([label, amt, key]) => (
                          <button key={label} onClick={() => setHeroBetAmt(amt)}
                            title={key ? `${label} pot — touche « ${key} »` : label}
                            className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-white/5 border border-white/10 text-white/45 hover:text-[#c9a227] hover:border-[#c9a227]/30 transition-all">
                            {label}{key && <span className="ml-0.5 opacity-50">{key}</span>}
                          </button>
                        ))}
                        <button onClick={() => setHeroBetAmt(heroMaxTo)} title="All-in — touche « A »"
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-900/20 border border-purple-700/30 text-purple-400 hover:bg-purple-900/30 transition-all">
                          All-in <span className="opacity-50">A</span>
                        </button>
                      </div>
                      <button onClick={() => setHeroBetAmt(v => clampRaise(v + bbAmt))}
                        className="w-5 h-5 rounded bg-white/8 border border-white/10 flex items-center justify-center text-white/50 hover:bg-white/15 transition-colors">
                        <ChevronUp size={10}/>
                      </button>
                    </div>
                  </div>
                )}

                {/* All-in shortcut */}
                {canRaise && (
                  <motion.button whileTap={{scale:0.95}}
                    onClick={() => heroAction('ALL-IN', heroMaxTo)}
                    className="px-3 py-2.5 rounded-xl border border-purple-700/40 bg-purple-900/20 text-purple-400 font-bold text-xs uppercase tracking-widest hover:bg-purple-900/35 transition-all">
                    All-in <kbd className="ml-1 px-1 rounded bg-black/30 text-[8px] font-mono opacity-70 align-middle">A</kbd>
                  </motion.button>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center gap-3">
                {heroOut ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
                      <p className="text-[10px] text-amber-300/80 uppercase tracking-widest">
                        {sitOut ? 'Vous êtes absent — cliquez sur Sit In pour revenir' : 'Vous reviendrez à la prochaine main'}
                      </p>
                    </div>
                    <button onClick={toggleSitOut}
                      className="px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                      style={{background:sitOut?'linear-gradient(135deg,#22aa44,#145c22)':'linear-gradient(135deg,#c9a227,#8B6810)',color:sitOut?'white':'#0a0a0a'}}>
                      {sitOut ? 'Sit In' : 'Sit Out'}
                    </button>
                  </div>
                ) : heroInHand ? (
                  /* Pre-action check boxes — clickable while it's not yet our turn */
                  <div className="w-full flex items-center gap-3">
                    <div className="flex items-center gap-2 mr-1">
                      <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-ping opacity-60"/>
                      <p className="text-[9px] text-white/35 uppercase tracking-widest whitespace-nowrap">En attente — pré-sélection</p>
                    </div>
                    <button onClick={() => setPreAction(preAction==='fold'?'none':'fold')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-bold text-sm uppercase tracking-widest transition-all
                        ${preAction==='fold' ? 'border-red-500 bg-red-600/30 text-red-200 shadow-[0_0_16px_rgba(220,40,40,0.35)]' : 'border-red-700/40 bg-red-900/15 text-red-400/80 hover:bg-red-900/30'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${preAction==='fold'?'bg-red-500 border-red-400 text-white':'border-red-500/50'}`}>{preAction==='fold'?'✓':''}</span>
                      Fold
                    </button>
                    <button onClick={() => setPreAction(preAction==='checkcall'?'none':'checkcall')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-bold text-sm uppercase tracking-widest transition-all
                        ${preAction==='checkcall'
                          ? (preCanCheck ? 'border-sky-400 bg-sky-600/30 text-sky-100 shadow-[0_0_16px_rgba(40,140,220,0.35)]' : 'border-emerald-400 bg-emerald-600/30 text-emerald-100 shadow-[0_0_16px_rgba(40,200,120,0.35)]')
                          : (preCanCheck ? 'border-sky-700/40 bg-sky-900/15 text-sky-400/80 hover:bg-sky-900/30' : 'border-emerald-700/40 bg-emerald-900/15 text-emerald-400/80 hover:bg-emerald-900/30')}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${preAction==='checkcall'?(preCanCheck?'bg-sky-400 border-sky-300 text-white':'bg-emerald-400 border-emerald-300 text-white'):(preCanCheck?'border-sky-500/50':'border-emerald-500/50')}`}>{preAction==='checkcall'?'✓':''}</span>
                      {preCanCheck ? 'Check' : `Call $${preCallAmt.toLocaleString()}`}
                    </button>
                  </div>
                ) : gs.phase === 'showdown' ? (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#c9a227] animate-pulse"/>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">
                      {gs.paused ? 'En pause' : 'Main terminée — prochaine main…'}
                    </p>
                  </div>
                ) : gs.phase === 'dealing' ? (
                  <p className="text-[10px] text-white/30 uppercase tracking-widest animate-pulse">Distribution des cartes...</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-ping opacity-60"/>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">En attente des autres joueurs...</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Opponents summary */}
          <div className="flex items-center gap-3 px-4 pb-2 overflow-x-auto">
            {gs.seats.filter(s => !s.isHero && !s.isEliminated).map(s => (
              <div key={s.idx} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border flex-shrink-0 text-[8px] transition-all
                ${s.isActive?'border-[#00d4ff]/40 bg-[#00d4ff]/8':'border-white/8 bg-white/3'}`}>
                <div className={`w-2 h-2 rounded-full ${s.isFolded?'bg-red-500/40':s.isAllIn?'bg-purple-500':'bg-white/20'}`}/>
                <span className={`font-bold ${s.isActive?'text-[#00d4ff]':'text-white/65'}`}>{s.name}</span>
                <span className="text-[9px] font-bold font-mono tabular-nums text-emerald-300/90">${s.stack.toLocaleString()}</span>
                <span className="text-[7px] text-white/25 italic">{botStyle(s)}</span>
                {s.lastAction && (
                  <span className={`px-1 rounded font-bold uppercase ${s.lastAction==='FOLD'?'text-red-400/60':s.lastAction.startsWith('RAISE')||s.lastAction.startsWith('BET')?'text-yellow-300':'text-emerald-400'}`}>
                    {s.lastAction}
                  </span>
                )}
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ── MANUAL action panel (scenario authoring) ── */}
      <AnimatePresence>
        {manualMode && manualPanel !== null && (() => {
          const seat = gs.seats[manualPanel]
          if (!seat) return null
          const toCall = Math.max(0, gs.currentBet - seat.bet)
          const maxTo = seat.bet + seat.stack
          const minTo = Math.min(maxTo, gs.currentBet + gs.minRaise)
          const canCheck = toCall === 0
          const potNow = gs.pot
          // "raise to" total for a fraction of the pot (bet vs raise math).
          const sizeTo = (frac: number) => Math.min(maxTo, canCheck
            ? Math.max(bbAmt, Math.round(potNow * frac))
            : Math.max(minTo, gs.currentBet + Math.round((potNow + toCall) * frac)))
          const typedTo = Math.round((parseFloat(manualBet) || 0) * bbAmt)
          const sendBet = (to: number) => manualAct(manualPanel, canCheck ? 'BET' : 'RAISE', to)
          return (
            <div className="fixed inset-x-0 bottom-24 z-[85] flex justify-center pointer-events-none">
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
                className="rounded-2xl border p-4 w-[440px] pointer-events-auto" style={{ background: '#180c08', borderColor: 'rgba(240,192,96,0.45)', boxShadow: '0 0 50px rgba(200,120,40,0.3)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-black uppercase tracking-widest text-[#f0c878]">
                    {seat.isHero ? 'Toi' : seat.name} <span className="text-[#c9a227]/70">{seat.position}</span> — action
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/45">{toCall > 0 ? `à payer $${toCall}` : 'aucune mise à payer'} · pot ${potNow}</span>
                    <button onClick={() => { setManualPanel(null); setManualBet('') }} className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-white text-xs">✕</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => manualAct(manualPanel, 'FOLD', 0)}
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border border-red-700/40 bg-red-900/25 text-red-300 hover:bg-red-900/40">Fold</button>
                  <button onClick={() => manualAct(manualPanel, canCheck ? 'CHECK' : 'CALL', toCall)}
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border border-emerald-600/40 bg-emerald-900/25 text-emerald-300 hover:bg-emerald-900/40">
                    {canCheck ? 'Check' : `Call $${toCall}`}</button>
                </div>
                <div className="mt-2.5 rounded-xl border border-white/10 bg-black/30 p-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{canCheck ? 'Bet' : 'Raise'} to (BB)</span>
                    <input autoFocus type="number" value={manualBet} onChange={e => setManualBet(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && typedTo >= (canCheck ? bbAmt : minTo)) { e.preventDefault(); sendBet(typedTo) } }}
                      placeholder={(() => { const v = minTo / bbAmt; return v % 1 === 0 ? String(v) : v.toFixed(1) })()}
                      className="w-20 bg-black/50 border border-white/15 rounded px-2 py-1 text-[13px] text-white text-center outline-none focus:border-[#c9a227]/60" />
                    <button disabled={typedTo < (canCheck ? bbAmt : minTo)} onClick={() => sendBet(typedTo)}
                      className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest disabled:opacity-30"
                      style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#1a0e02' }}>
                      {canCheck ? 'Bet' : 'Raise'} ${typedTo || 0}
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {([['½ pot', 0.5], ['¾ pot', 0.75], ['pot', 1]] as const).map(([lbl, f]) => (
                      <button key={lbl} onClick={() => sendBet(sizeTo(f))}
                        className="flex-1 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest border border-white/10 bg-white/5 text-white/60 hover:bg-white/10">
                        {lbl} <span className="text-white/35">${sizeTo(f)}</span></button>
                    ))}
                    <button onClick={() => sendBet(maxTo)}
                      className="flex-1 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest border border-[#c9a227]/30 bg-[#c9a227]/10 text-[#c9a227] hover:bg-[#c9a227]/20">All-in ${maxTo}</button>
                  </div>
                </div>
              </motion.div>
            </div>
          )
        })()}
      </AnimatePresence>

      {/* ── HAND HISTORY MODAL ── */}
      <AnimatePresence>
        {historyOpen && handHistory.length > 0 && (
          <HandHistoryModal records={handHistory} onClose={() => setHistoryOpen(false)} onRevive={reviveSituation}/>
        )}
      </AnimatePresence>

      {/* ── Revive sandbox: end-of-hand prompt (replay re-draws opponents) ── */}
      <AnimatePresence>
        {simMode && simResult && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-[90] flex items-center justify-center" style={{background:'rgba(6,5,18,0.78)'}}>
            <motion.div initial={{scale:0.92,y:18}} animate={{scale:1,y:0}}
              className="rounded-2xl border p-7 text-center max-w-md"
              style={{ background:'#0e0c22', borderColor:'rgba(167,139,255,0.4)', boxShadow:'0 0 60px rgba(120,90,230,0.35)' }}>
              <div className="text-4xl mb-2">⚡</div>
              <h2 className="text-lg font-black uppercase tracking-[0.18em] text-[#c8b6ff]">Main terminée</h2>
              <p className="text-[12px] text-white/55 mt-2 mb-1">
                {simResult.winners.map(wi => simResult.seats.find(s => s.idx === wi)?.name ?? '?').join(', ') || '—'} remporte le coup
                {(() => { const h = simResult.seats.find(s => s.isHero); return h && simResult.winners.includes(h.idx) ? ' — tu gagnes 🎉' : '' })()}
              </p>
              <p className="text-[10px] text-white/35 mb-5">Rejouer redistribue de nouvelles cartes aux adversaires (dans leur range) — tes cartes ne changent pas.</p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={restartSim}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black uppercase tracking-[0.16em] text-[12px] transition-all hover:scale-[1.03]"
                  style={{ background:'linear-gradient(135deg,#a78bff,#6d4ed6)', color:'#0a0716' }}>
                  <RefreshCw size={14}/> Rejouer le coup
                </button>
                <button onClick={exitSim}
                  className="px-5 py-2.5 rounded-xl font-bold uppercase tracking-[0.16em] text-[12px] border border-white/15 bg-white/5 text-white/60 hover:bg-white/10 transition-all">
                  Quitter
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OPPONENT range popup (read-only). Stays while the cursor is anywhere
            inside the table; cleared by the table's onMouseLeave (or on switching
            to another player). Bigger & readable. ── */}
      {hoverSeat !== null && hoverSeat !== hero?.idx && hoverPos && (() => {
        const seat = gs.seats.find(s => s.idx === hoverSeat)
        if (!seat || seat.isFolded || seat.isSittingOut || seat.isEliminated || !rangeRef.current[hoverSeat]) return null
        const view = rangeView(rangeRef.current[hoverSeat])
        const meta = rangeMetaRef.current[hoverSeat] ?? { move: '—', effect: 'aucune action encore' }
        const W = 482, H = 560
        let x = hoverPos.x + 22, y = hoverPos.y - H / 2
        if (x + W > window.innerWidth - 8) x = hoverPos.x - W - 22
        if (x < 8) x = 8
        if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8
        if (y < 8) y = 8
        return (
          <div className="fixed z-[80] pointer-events-none" style={{ left: x, top: y }}>
            <RangeHeatmap view={view} move={meta.move} effect={meta.effect} name={seat.name} width={462}/>
          </div>
        )
      })()}

      {/* ── HERO coach hover-card: range représentée + conseil complet (no click) ── */}
      <AnimatePresence>
        {coachOpen && hero && (
          <div className="fixed inset-x-0 top-[3vh] z-[70] flex justify-center pointer-events-none">
            <div className="pointer-events-auto"
              onMouseEnter={() => { if (coachTimerRef.current) clearTimeout(coachTimerRef.current); heroPanelHoverRef.current = true; setHeroPanelHover(true) }}
              onMouseLeave={() => { heroPanelHoverRef.current = false; setHeroPanelHover(false); setHoverSeat(s => (s === hero.idx ? null : s)) }}>
              <RangeAssistant
                embedded
                representedView={heroRepView}
                representedMeta={heroRepMeta}
                card1={hero.holeCards[0]}
                card2={hero.holeCards[1]}
                position={hero.position}
                scenario={heroScenario}
                activePlayers={heroActiveCount}
                playersBehind={heroPlayersBehind}
                board={gs.community.filter(Boolean) as Card[]}
                pot={gs.pot}
                toCall={Math.max(0, gs.currentBet - hero.bet)}
                heroStack={hero.stack}
                effStack={heroEffStack}
                inPosition={heroInPosition}
                aggression={heroAggression}
                barrels={heroBarrels}
                bb={bbAmt}
                raiseToBB={heroRaiseToBB}
                multiway={heroMultiway}
                vsOpenerPos={heroVsOpenerPos}
                reRaiseRatio={heroReRaiseRatio}
                threeBettorIP={heroThreeBettorIP}
                numAllIn={heroNumAllIn}
                actionRecap={gs.log.slice(-10)}
                onClose={() => { heroPanelHoverRef.current = false; setHeroPanelHover(false); setHoverSeat(null) }}
              />
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  )
}
