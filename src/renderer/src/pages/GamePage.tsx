import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
// Module-level helper for the (non-component) hand-history critique builder.
const tc = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Square, ChevronUp, ChevronDown, RefreshCw, Eye, FastForward } from 'lucide-react'
import PlayerAvatar, { avatarForSeat } from '../components/PlayerAvatar'
import { PlayingCard, FaceDown, EmptySlot, ChipStack, FlyingStack, DealerButtonToken, TableSVG, Room, type RoomVariant } from '../components/tableVisuals'
import RangeAssistant from '../components/RangeAssistant'
import RangeHeatmap from '../components/RangeHeatmap'
import RangeEvolution, { type RangeStep } from '../components/RangeEvolution'
import { type Scenario, handKeyFromCards, buildRangeMap, buildJamCallMap, handOpenRank, openPctFor } from '../lib/preflopRanges'
import { getPostflopAdvice, buildEquityReasoning, type EquityReasoning } from '../lib/postflopAdvisor'
import { isElectron } from '../lib/platform'
import { playSound, playDeal } from '../lib/sound'
import SoundToggle from '../components/SoundToggle'
import LanguageSwitcher from '../components/LanguageSwitcher'
import EquityReasoningBlock from '../components/EquityReasoning'
import {
  initRange, applyAction, rangeView, actionSummary, preflopProbs, HAND_KEYS,
  type RangeWeights, type ActCat,
} from '../lib/rangeEstimator'
import {
  type Speed as TourSpeed, blindStructure,
  placesPaid, payoutTable, prizeForPlace, fieldRemaining, estimateRank,
} from '../lib/tournament'
import { saveSession } from '../lib/historyStore'

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
  tournament?: TournamentCfg
}
// MTT config coming from TournamentSetupPage.
interface TournamentCfg {
  field: number; tableSize: number; startBB: number; speed: TourSpeed; levelMinutes: number; antes: boolean
  buyIn: number; paidPct: number; curve: 'standard' | 'topheavy' | 'flat'
  reentry: boolean; botLevel: number
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
export interface HistoryAction {
  phase: Phase; seatIdx: number; name: string; isHero: boolean
  actionType: string; amount: number; potAfter: number
}
export interface HandHistoryRecord {
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
          cards are dimmed when folded; name & stack stay readable. Height is RESERVED
          permanently (always 80) so the profile zone never shifts up/down during the
          deal — only the cards themselves animate (fly in). */}
      <div className={`flex relative mb-0.5 transition-all duration-500 ${seat.isFolded?'opacity-20 grayscale':''}`}
        style={{height:80,overflow:'visible',minWidth:80}}
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
interface MoveCritique { verdict: 'good' | 'ok' | 'mistake'; headline: string; lines: string[]; reasoning?: EquityReasoning | null }
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

// A preflop ALL-IN only escalates the pot type (counts as a raise / 3-bet level)
// if it actually EXCEEDS the prevailing bet. A short stack that jams for LESS than
// the current bet is dead money / effectively a call — NOT a 3-bet — and must not
// be treated as a raise (→ wrong "3-bet pot" premium range) nor as villain
// aggression (→ wrongly deflated equity). Without this, a min-jam under a raise
// made the coach read a single-raised pot as a 3-bet pot and fold top pair to a
// river bluff. Shared by the live coach AND the replay critique so they stay equal.
interface PfAction { seatIdx: number; phase: Phase; actionType: string; amount: number }
function realPreflopRaises(actions: PfAction[], bb: number): { count: number; lastRaiserSeat: number; amts: number[]; deadAllIn: Set<number> } {
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
function isAggroAction(a: PfAction & { isHero?: boolean }, deadAllIn: Set<number>): boolean {
  if (a.seatIdx < 0 || a.isHero) return false
  if (a.actionType !== 'BET' && a.actionType !== 'RAISE' && a.actionType !== 'ALL-IN') return false
  return !(a.phase === 'preflop' && a.actionType === 'ALL-IN' && deadAllIn.has(a.seatIdx))
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
    const numAllIn = [...allInSeats].filter(idx => idx !== hero.idx && !folded.has(idx) && (bet[idx] ?? 0) >= currentBet).length
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
          { raiseToBB: record.bb > 0 ? currentBet / record.bb : undefined, multiway: live.length > 2, vsOpenerPos, reRaiseRatio, threeBettorIP,
            effBB: record.bb > 0 ? effStack / record.bb : undefined,
            closingAction: playersBehind === 0, potOdds: toCall > 0 ? toCall / (pot + toCall) : 0 })
    const key = handKeyFromCards(hero.holeCards[0], hero.holeCards[1])
    const rec = map.get(key) ?? 'fold'
    const recCat: 'fold' | 'passive' | 'aggr' = rec === 'fold' ? 'fold' : rec === 'call' ? 'passive' : 'aggr'
    // NOTE: no equity-vs-pot-odds reasoning block pre-flop — there the decision is a
    // RANGE call (domination / realizability), not a pot-odds one, so the "I have/don't
    // have the price" framing would contradict a correct range fold (e.g. ATo folds a
    // 3-bet despite ~45% raw equity vs the field). The reasoning block is postflop-only.
    // A 'raise' cell in a vs-open/squeeze map is a RE-SHOVE (3-bet jam) — the 14-25bb
    // jam-or-fold zone marks jam hands 'raise' (the normal path would use '3bet').
    const isReshoveCrit = rec === 'raise' && (scenario === 'vsopen' || scenario === 'squeeze')
    const recLabel = rec === 'fold' ? 'FOLD'
      : rec === 'call' ? (vsJam ? tc('crit.recCallJam') : tc('crit.recCall'))
      : rec === '3bet' ? (scenario === 'squeeze' ? tc('crit.recSqueeze') : tc('crit.rec3bet'))
      : rec === '4bet' ? (scenario === 'vs4bet' ? tc('crit.rec5betJam') : tc('crit.rec4bet'))
      : isReshoveCrit ? tc('crit.recReshove')
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
    const adv = getPostflopAdvice({ hole: [hero.holeCards[0], hero.holeCards[1]], board, pot, toCall, heroStack: heroRemaining, effStack, opponents, inPosition: latePos, aggression, barrels, bb: record.bb, villainTier, aggressors, cappedRange, callPressure, donkLead, facingRaise })
    const recAggr = adv.action === 'BET' || adv.action === 'RAISE'
    const recCat: 'fold' | 'passive' | 'aggr' = adv.action === 'FOLD' ? 'fold' : recAggr ? 'aggr' : 'passive'
    if (toCall > 0) reasoning = buildEquityReasoning({ hole: [hero.holeCards[0], hero.holeCards[1]], board, pot, toCall, equity: adv.equity,
      decision: adv.action === 'FOLD' ? 'fold' : adv.action === 'CALL' ? 'call' : 'aggro' })
    const phaseLbl = tc(phase === 'flop' ? 'crit.phaseFlop' : phase === 'turn' ? 'crit.phaseTurn' : phase === 'river' ? 'crit.phaseRiver' : 'crit.phasePreflop')
    lines.push(tc('crit.pSituation', { phase: phaseLbl, board: board.map(c => c.rank + c.suit).join(' '), aggr: lastAggressorName && toCall > 0 ? tc('crit.pBetSuffix', { name: lastAggressorName }) : '' }))
    lines.push(tc('crit.pEquityHand', { eq: pct(adv.equity), odds: toCall > 0 ? tc('crit.pOddsReq', { odds: pct(adv.potOdds) }) : '', made: adv.madeHand, draws: adv.draws.length ? tc('crit.pDraws', { draws: adv.draws.join(' + ') }) : '' }))
    lines.push(tc('crit.pOptimal', { action: adv.action, sizing: adv.sizingText }))
    adv.reasons.slice(1, 3).forEach(r => lines.push(r))
    if (heroCat === recCat) {
      verdict = 'good'; headline = tc('crit.hGoodPost', { action: adv.action }); lines.push(tc('crit.lGoodPost'))
      // SIZING check on a value BET: the right action category isn't enough — a giant
      // overbet/jam folds out the worse hands you beat (lost value), while a tiny bet
      // under-charges draws. Only when you opened the betting (toCall === 0).
      if (toCall === 0 && adv.action === 'BET' && pot > 0 && (act.actionType === 'BET' || act.actionType === 'ALL-IN' || act.actionType === 'RAISE')) {
        const betFrac = act.amount / pot
        const sprNow = effStack / pot
        const isValue = adv.equity >= 0.6
        if (isValue && betFrac > 1.15) {
          verdict = 'ok'; headline = tc('crit.hSizeOverbet')
          lines.push(tc('crit.lSizeOverbet', { pct: Math.round(betFrac * 100), allin: act.actionType === 'ALL-IN' ? tc('crit.pAllinSuffix') : '', tail: sprNow <= 1.8 ? tc('crit.lSizeOverbetLowSpr', { spr: sprNow.toFixed(1) }) : tc('crit.lSizeOverbetHighSpr') }))
        } else if (isValue && betFrac < 0.4) {
          verdict = 'ok'; headline = tc('crit.hSizeTooSmall')
          lines.push(tc('crit.lSizeTooSmall', { pct: Math.round(betFrac * 100) }))
        }
      }
    }
    else if (recCat === 'fold' && heroCat !== 'fold') { verdict = 'mistake'; headline = tc('crit.hContinueTooMuch'); lines.push(tc('crit.lContinueTooMuch', { eq: pct(adv.equity), odds: pct(adv.potOdds) })) }
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
  return { verdict, headline, lines, reasoning }
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

export function HandHistoryModal({ records, onClose, onRevive }: {
  records: HandHistoryRecord[]
  onClose: () => void
  onRevive?: (record: HandHistoryRecord, stepIdx: number) => void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<number|null>(records.length > 0 ? records[records.length-1].id : null)
  const [stepIdx, setStepIdx] = useState<number>(0)
  const [critique, setCritique] = useState<MoveCritique | null>(null)
  // Auto-replay: on open, the last hand plays from the start (0.5s/step); at the end
  // it waits 5s then loops. ANY manual navigation flips this off (see stopAuto).
  const [autoPlay, setAutoPlay] = useState(true)
  const autoPlayRef = useRef(autoPlay)
  useEffect(() => { autoPlayRef.current = autoPlay }, [autoPlay])
  const stopAuto = () => setAutoPlay(false)
  const logRef = useRef<HTMLDivElement>(null)

  const record = records.find(r => r.id === selectedId) ?? null

  // On (re)selecting a hand: auto-replay starts at the very first step; otherwise jump
  // straight to the final result (the previous behaviour).
  useEffect(() => {
    if (record) setStepIdx(autoPlayRef.current ? 0 : record.actions.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Auto-replay driver: advance one step every 0.5s; once at the end, pause 5s then
  // loop back to the start. Cancelled the instant autoPlay turns off.
  useEffect(() => {
    if (!autoPlay || !record) return
    const last = record.actions.length - 1
    const t = setTimeout(() => setStepIdx(i => (i >= last ? 0 : i + 1)), stepIdx >= last ? 5000 : 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, stepIdx, selectedId])
  // Clear the critique whenever we move to another step / hand.
  useEffect(() => { setCritique(null) }, [stepIdx, selectedId])

  // Keyboard: ← step back, → step forward, Space = judge the current move,
  // Esc = close the replay. (stepIdx is in deps so the handler isn't stale.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!record) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); stopAuto(); setStepIdx(i => Math.max(0, i - 1)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stopAuto(); setStepIdx(i => Math.min(record.actions.length - 1, i + 1)) }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault() // never scroll the page
        stopAuto()
        const a = record.actions[stepIdx]
        if (a && a.seatIdx >= 0 && a.isHero && a.actionType !== 'SB' && a.actionType !== 'BB')
          setCritique(c => (c ? null : critiqueHeroMove(record, stepIdx)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [record, stepIdx, onClose])

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
            <span className="text-[10px] text-white/30 hidden lg:inline">{t('sess.replayHint')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Revive: re-create THIS exact spot as a playable sandbox. Opponents'
                cards are re-drawn from the range their line implies at this step. */}
            {onRevive && (
              <button onClick={() => onRevive(record, stepIdx)}
                title="Recrée cette situation exacte en simulation jouable — les adversaires gardent leur range, leurs cartes sont retirées au hasard dedans"
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl font-black uppercase tracking-[0.18em] text-[11px] transition-all hover:scale-[1.03]"
                style={{ background: 'linear-gradient(135deg,#a78bff,#6d4ed6,#3c2a72)', color: '#0a0716', boxShadow: '0 0 22px rgba(140,110,255,0.45)' }}>
                ⚡ Revive situation
              </button>
            )}
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
                <button key={r.id} onClick={() => { stopAuto(); setSelectedId(r.id) }}
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
              <div className="relative flex-1 min-h-0" style={{minHeight:360}}>
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
                {/* Auto-replay toggle: relance le coup depuis le début / stoppe */}
                <button onClick={() => { if (autoPlay) setAutoPlay(false); else { setStepIdx(0); setAutoPlay(true) } }}
                  title={autoPlay ? t('sess.replayStop') : t('sess.replayStart')}
                  className="px-3 py-1.5 rounded border text-sm font-bold transition-all"
                  style={autoPlay
                    ? { background: 'rgba(201,162,39,0.18)', borderColor: 'rgba(201,162,39,0.6)', color: '#f0d98a' }
                    : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                  {autoPlay ? '⏸ Replay' : '↻ Replay'}
                </button>
                <button onClick={() => { stopAuto(); setStepIdx(0) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>|◀</button>
                <button onClick={() => { stopAuto(); setStepIdx(s => Math.max(0, s-1)) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>◀</button>
                <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden cursor-pointer"
                  onClick={e => {
                    stopAuto()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = (e.clientX - rect.left) / rect.width
                    setStepIdx(Math.round(ratio * (record.actions.length - 1)))
                  }}>
                  <div className="h-full bg-[#c9a227] rounded-full transition-all"
                    style={{width:`${record.actions.length>1?(stepIdx/(record.actions.length-1))*100:100}%`}}/>
                </div>
                <button onClick={() => { stopAuto(); setStepIdx(s => Math.min(record.actions.length-1, s+1)) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={isEnd}>▶</button>
                <button onClick={() => { stopAuto(); setStepIdx(record.actions.length-1) }}
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
                      <button onClick={() => { stopAuto(); setCritique(critiqueHeroMove(record, stepIdx)) }}
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
                        {/* Scrollable so the full reasoning (équité block + outs + lines) is always
                            reachable even when it's taller than the room left under the table. */}
                        <div className="overflow-y-auto pr-1" style={{ maxHeight: '34vh' }}>
                          {critique.reasoning && <EquityReasoningBlock r={critique.reasoning} />}
                          <div className="space-y-1.5">
                            {critique.lines.map((l, i) => (
                              <p key={i} className="text-[12.5px] text-white/80 leading-relaxed flex gap-1.5">
                                <span className="text-[#c9a227] mt-0.5">▸</span>{l}
                              </p>
                            ))}
                          </div>
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
                    <span className="text-[10px] text-white/40 uppercase tracking-wide">{t('sess.yourResult')}</span>
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
              name={pl.isHero ? t('sess.youRepRange') : pl.name} heroKey={heroKey}/>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Main GamePage Component ──────────────────────────────────────────────────
export default function GamePage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const cfg = (location.state ?? {}) as Partial<GameConfig>

  const numPlayers = cfg.numPlayers ?? 6
  const selectedSeat = cfg.selectedSeat ?? 0
  const stackBB = cfg.stackBB ?? 100
  const displayName = cfg.displayName ?? 'Hero'
  const slots = cfg.slots ?? Array.from({length: numPlayers - 1}, () => ({type:'bot', level:2}))
  const decisionTimer = cfg.decisionTimer && cfg.decisionTimer > 0 ? cfg.decisionTimer : 25

  // ─── Tournament (MTT) — escalating blinds + field model ────────────────────
  const tournament = cfg.tournament
  const tourLevels = useMemo(() => (tournament ? blindStructure(tournament.speed, tournament.antes) : []), [tournament])
  const [tourLevelIdx, setTourLevelIdx] = useState(0)
  const tourRef = useRef({ levelIdx: 0, secondsLeft: (tournament?.levelMinutes ?? 5) * 60, playersLeft: tournament?.field ?? 0, finalTable: false, busted: false, place: 0 })
  const [tourHud, setTourHud] = useState({ playersLeft: tournament?.field ?? 0, secondsLeft: (tournament?.levelMinutes ?? 5) * 60 })
  const [tourResult, setTourResult] = useState<{ place: number; prize: number } | null>(null)
  const handHistoryRef = useRef<HandHistoryRecord[]>([]) // complete list (state lags via setState)
  const savedSessionRef = useRef(false)                  // guard against double-persisting
  // Fast-forward: bots act near-instantly; the flow only "stops" on the hero's turn.
  const [fastFwd, setFastFwd] = useState(false)   // bots act instantly (fast OR turbo)
  const fastFwdRef = useRef(false)
  // TURBO: on top of fast, auto-play (skip) the hero's spot when the coach would FOLD or
  // CHECK — only STOP for a real money decision (call / bet / raise / all-in). Lets you
  // breeze past hands where you're not involved; the level clock is still charged the
  // virtual time of each skipped action so the blinds rise at a logical pace.
  const [turbo, setTurbo] = useState(false)
  const turboRef = useRef(false)
  // Engine-safe current blinds (read from the ref so timer-driven hands use the
  // up-to-date level even across stale closures).
  const tourBlinds = () => {
    if (!tournament || tourLevels.length === 0) return { sb: cfg.sb ?? 1, bb: cfg.bb ?? 2, ante: cfg.ante ?? 0 }
    const L = tourLevels[Math.min(tourRef.current.levelIdx, tourLevels.length - 1)]
    return { sb: L.sb, bb: L.bb, ante: L.ante }
  }
  const tourPayouts = () => tournament ? payoutTable(tournament.buyIn * tournament.field, placesPaid(tournament.field, tournament.paidPct), tournament.curve) : []
  const curLevel = tournament && tourLevels.length ? tourLevels[Math.min(tourLevelIdx, tourLevels.length - 1)] : null
  const sbAmt = curLevel ? curLevel.sb : (cfg.sb ?? 1)
  const bbAmt = curLevel ? curLevel.bb : (cfg.bb ?? 2)

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
  const pausedByHistoryRef = useRef(false) // we auto-paused for the history modal → auto-resume on close
  const coachMoveRef = useRef<() => void>(() => {}) // latest "follow the coach" executor (fresh closure each render)
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
  const coachOpenRef = useRef(false) // mirrors coachOpen so the tournament clock can read it
  const coachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionRef = useRef(true)
  const rangeRef = useRef<Record<number, RangeWeights>>({})
  const rangeMetaRef = useRef<Record<number, { move: string; effect: string }>>({})
  // Per-seat HISTORY of range snapshots (one per action) so the hover popup can
  // replay the "film" of how that player's range narrowed across the hand.
  const rangeHistoryRef = useRef<Record<number, RangeStep[]>>({})
  // Opponent range popup kept open while the cursor is over it (so the scrubber is
  // usable); a short grace timer lets the cursor travel from the cards to the popup.
  const [oppPanelHover, setOppPanelHover] = useState(false)
  const oppPanelHoverRef = useRef(false)
  const rangeFilmRef = useRef(false) // mirrors rangeFilmOpen for timer reads
  // When the film is "pinned" (the user clicked it or pressed Space) it stays open
  // even if the mouse leaves its zone — only the ✕ / Échap closes it then.
  const [filmPinned, setFilmPinned] = useState(false)

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

  // Tournament CLOCK — levels rise on a real timer; the field shrinks with level
  // progress. Frozen while paused / once the hero is out.
  useEffect(() => {
    if (!tournament) return
    const id = setInterval(() => {
      const t = tourRef.current
      // Frozen while paused, busted, OR while you're studying (coach card open over
      // your cards) — like calling a clock-pause to think; blinds won't go up.
      if (gsRef.current.paused || t.busted || coachOpenRef.current || rangeFilmRef.current) return
      if (t.secondsLeft > 0) t.secondsLeft -= 1
      if (t.secondsLeft <= 0 && t.levelIdx < tourLevels.length - 1) {
        t.levelIdx += 1; t.secondsLeft = tournament.levelMinutes * 60; setTourLevelIdx(t.levelIdx)
      } else if (t.secondsLeft < 0) t.secondsLeft = 0
      if (!t.finalTable) {
        const lf = t.levelIdx + (1 - t.secondsLeft / Math.max(1, tournament.levelMinutes * 60))
        const fm = fieldRemaining(tournament.field, lf)
        if (fm <= tournament.tableSize) t.finalTable = true
        else t.playersLeft = Math.max(tournament.tableSize, fm)
      }
      if (t.finalTable) t.playersLeft = gsRef.current.seats.filter(s => !s.isEliminated && (s.stack > 0 || s.isHero)).length
      setTourHud({ playersLeft: t.playersLeft, secondsLeft: t.secondsLeft })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament])

  // Fast-forward only: bots act in ~0 real time, so the level clock would barely
  // move while a realistic number of hands flies by. Charge each skipped decision
  // its "virtual" think time (~1.5s/player) to the level clock, so blinds rise at
  // the same hands-per-level rate as live play. (Hero's own thinking is real time
  // and is already counted by the 1-second ticker above.)
  function consumeTourTime(secs: number) {
    if (!tournament) return
    const t = tourRef.current
    if (t.busted || gsRef.current.paused) return
    t.secondsLeft -= secs
    while (t.secondsLeft <= 0 && t.levelIdx < tourLevels.length - 1) {
      t.levelIdx += 1
      t.secondsLeft += tournament.levelMinutes * 60
      setTourLevelIdx(t.levelIdx)
    }
    if (t.secondsLeft < 0) t.secondsLeft = 0
    if (!t.finalTable) {
      const lf = t.levelIdx + (1 - t.secondsLeft / Math.max(1, tournament.levelMinutes * 60))
      const fm = fieldRemaining(tournament.field, lf)
      if (fm <= tournament.tableSize) t.finalTable = true
      else t.playersLeft = Math.max(tournament.tableSize, fm)
    }
    if (t.finalTable) t.playersLeft = gsRef.current.seats.filter(s => !s.isEliminated && (s.stack > 0 || s.isHero)).length
    setTourHud({ playersLeft: t.playersLeft, secondsLeft: t.secondsLeft })
  }

  // Persist a CASH session when leaving the table (quit / sidebar nav / unmount).
  // Tournaments persist at bust/win instead, so they're skipped here.
  useEffect(() => {
    return () => { if (!tournament) persistCash() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-start a tournament once on mount (the player already clicked "Lancer").
  const tourStartedRef = useRef(false)
  useEffect(() => {
    if (!tournament) return
    const t = setTimeout(() => {
      if (tourStartedRef.current) return
      tourStartedRef.current = true
      startHand(createSeats(), 0, 0)
    }, 300)
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

    // 🔊 win / loss sting — only when the hero actually had a result this hand.
    if (heroSeat) {
      if (finalGs.winners.includes(heroSeat.idx) && heroProfit > 0) playSound('win')
      else if (heroProfit <= -1) playSound('lose')
    }

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
    handHistoryRef.current = [...handHistoryRef.current, record]
    setHandHistory(handHistoryRef.current)
    currentHandActionsRef.current = []
    // Tournament: if the hero just busted (freezeout), finish the tournament with
    // their placement + prize, and SAVE the session. Re-entry is offered after.
    if (tournament && !tourRef.current.busted && heroIsBusted(finalGs)) {
      tourRef.current.busted = true
      const place = Math.max(2, tourRef.current.playersLeft || tournament.field)
      const prize = prizeForPlace(place, tourPayouts())
      setTourResult({ place, prize })
      persistTournament(place, prize)
      return
    }
    scheduleNextHand()
  }

  // Persist a finished session to the history store (highlights only). Tournament
  // ends on bust/win; cash ends on leaving the table.
  function persistTournament(place: number, prize: number) {
    if (!tournament || savedSessionRef.current) return
    savedSessionRef.current = true
    saveSession('tournament',
      { title: t('sess.tourTitle', { buyIn: tournament.buyIn, n: tournament.field }),
        subtitle: `${place === 1 ? t('sess.tourWinner') : t('sess.tourElim', { place })} · ${prize > 0 ? `+$${prize.toLocaleString()}` : t('sess.tourNoPrize')}`,
        resultBB: prize - tournament.buyIn },
      handHistoryRef.current)
  }
  function persistCash() {
    if (tournament || savedSessionRef.current || handHistoryRef.current.length === 0) return
    savedSessionRef.current = true
    const netBB = Math.round(handHistoryRef.current.reduce((s, h) => s + (h.heroProfit || 0), 0) * 10) / 10
    saveSession('cash',
      { title: isScenario ? t('sess.cashScenario') : t('sess.cashTitle', { n: numPlayers, sb: cfg.sb, bb: cfg.bb }),
        subtitle: t('sess.cashSubtitle', { sign: netBB > 0 ? '+' : '', bb: netBB, count: handHistoryRef.current.length }),
        resultBB: netBB },
      handHistoryRef.current)
  }

  // ─── Blind / seat setup ──────────────────────────────────────────────────
  function findBlinds(seats: Seat[], dealerIdx: number): { sbIdx: number; bbIdx: number } {
    const isLive = (s?: Seat) => !!s && !s.isEliminated && s.stack > 0 && !s.isSittingOut
    const active = seats.filter(isLive)
    const n = active.length
    // Fewer than 2 active players (e.g. you sit out heads-up): never charge a
    // sitting-out player — point both blinds at the lone active seat.
    if (n < 2) { const only = active[0]?.idx ?? dealerIdx; return { sbIdx: only, bbIdx: only } }
    // SB/BB are the next LIVE seats after the button — SKIP eliminated/empty seats.
    // (At a final table players bust without replacement, so dealer+1 / dealer+2 by raw
    // index can land on an empty seat → blinds never posted. This walks to live seats.)
    const nextLive = (from: number) => { let i = (from + 1) % seats.length, g = 0; while (g++ < seats.length && !isLive(seats[i])) i = (i + 1) % seats.length; return i }
    if (n === 2) {
      // HU: dealer is SB (or, if the button sits on a dead seat, the first live seat).
      const sb = isLive(seats[dealerIdx]) ? dealerIdx : active[0].idx
      const bb = active.find(s => s.idx !== sb)?.idx ?? nextLive(sb)
      return { sbIdx: sb, bbIdx: bb }
    }
    const sbIdx = nextLive(dealerIdx)
    const bbIdx = nextLive(sbIdx)
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
  function trackRange(seatIdx: number, action: string, currentGs: GState, amount?: number) {
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
    // Seed the film with the starting range (all hands) as step 0 — keyed on the
    // HISTORY, not rangeRef (which may be pre-seeded with initRange at hand start).
    if (!rangeHistoryRef.current[seatIdx]) {
      rangeHistoryRef.current[seatIdx] = [{
        view: rangeView(rangeRef.current[seatIdx]), move: t('rev.startMove'),
        effect: t('rev.startEffect'), caption: t('rev.startCaption'),
      }]
    }
    // Build the action context ONCE and reuse it for the range update AND the
    // snapshot (so a clicked cell can be explained with the exact same inputs).
    const ctx = {
      preflop, board, toCall, potOdds,
      posBonus: POS_BONUS[seat.position] ?? 0.75,
      tier: Math.max(1, Math.min(3, seat.level)),
      human: seat.seatType === 'human',
      mood: moodRef.current[seatIdx] ?? 0,
      priorRaises: raisesSoFar,  // # of raises this player faced (0/1/2/≥3) → open/3-bet/4-bet logic
    }
    rangeRef.current[seatIdx] = applyAction(rangeRef.current[seatIdx], cat, ctx)
    const meta = actionSummary(cat, { preflop, numCallers, was3betPlus: cat === 'aggr' && raisesSoFar >= 1 })
    rangeMetaRef.current[seatIdx] = meta
    // Append this action's snapshot to the film (for the animated hover popup).
    const phaseLabel = t(preflop ? 'crit.phasePreflop' : board.length === 3 ? 'crit.phaseFlop' : board.length === 4 ? 'crit.phaseTurn' : 'crit.phaseRiver')
    const amt = amount ? ` $${Math.round(amount)}` : ''
    const actLabel = action === 'FOLD' ? t('rev.actFold') : action === 'CHECK' ? t('rev.actCheck')
      : action === 'CALL' ? t('rev.actCall') + amt
      : action === 'ALL-IN' ? t('rev.actAllin') + amt
      : (action === 'BET' ? t('rev.actBet') : t('rev.actRaise')) + amt
    ;(rangeHistoryRef.current[seatIdx] ??= []).push({
      view: rangeView(rangeRef.current[seatIdx]), move: meta.move, effect: meta.effect,
      caption: `${phaseLabel} · ${actLabel}`, ctx, observed: cat,
    })
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

    // 🔊 Sound for the action (all-in trumps the base action).
    {
      const fx = seat.isAllIn ? 'allin'
        : action === 'FOLD' ? 'fold'
        : action === 'CHECK' ? 'check'
        : action === 'CALL' ? 'call'
        : action === 'BET' ? 'bet'
        : action === 'RAISE' ? 'raise'
        : null
      if (fx) playSound(fx)
    }

    // Range Vision: narrow this player's estimated range (uses pre-action context).
    trackRange(seatIdx, action, currentGs, actualAmount)

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
      setTimeout(() => { if (flowGenRef.current !== gen) return; showdown(gsRef.current) }, fastFwdRef.current ? 60 : 650)
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

    // 🔊 board cards landing on the felt
    playDeal(phase === 'flop' ? 3 : 1, 0.13)

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
    }, fastFwdRef.current ? 70 : 750)
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
      if (state.phase === 'river') setTimeout(() => { if (flowGenRef.current !== gen) return; showdown(state) }, fastFwdRef.current ? 50 : 400)
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
    // In the Revive sandbox the whole point is to ANALYSE the hand — reveal every
    // contender's cards (no muck) so the player can study what the opponents had.
    if (simModeRef.current) contenderIdxs.forEach(idx => reveal.add(idx))

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
    delay = fastFwdRef.current ? 20 : delay

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
    const botDelay = fastFwdRef.current ? 20 : 600 + Math.random() * 800

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
      // Fast-forward: this decision took ~0 real time → charge its virtual think
      // time to the level clock so blinds keep rising at a realistic pace.
      if (fastFwdRef.current) consumeTourTime(1.5)
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

  // A busted bot seat is re-seated with a fresh player (moved from a breaking
  // table) so the table stays full while the field is still big.
  function refillSeat(s: Seat, chips: number): Seat {
    const lvl = Math.max(1, Math.min(3, s.level || tournament?.botLevel || 2))
    const pool = BNAMES[lvl as keyof typeof BNAMES] ?? BNAMES[2]
    return {
      ...s, stack: chips, isEliminated: false, isFolded: false, isAllIn: false,
      isSittingOut: false, bet: 0, totalBet: 0, holeCards: [null, null], cardsFaceUp: false,
      isWinner: false, handStrength: undefined, handScore: undefined, lastAction: null,
      name: pool[Math.floor(Math.random() * pool.length)],
    }
  }

  function advanceToNextHand() {
    flowGenRef.current++
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    let seats = gsRef.current.seats
    if (tournament) {
      const t = tourRef.current
      if (!t.finalTable) {
        // Table balancing: refill busted bots with an incoming player from another table.
        // The field's survivors are RIGHT-SKEWED (many short stacks, a few big) → a random
        // arrival has ~the MEDIAN, well BELOW the mean. Refilling at the mean (field×start
        // ÷ left, which GROWS as the field shrinks) makes the hero face an endless wall of
        // ever-bigger stacks → it can never build a dominant stack and almost never reaches
        // the final table. Refill around the MEDIAN (≈0.55× mean) with variance, so a hero
        // that ACCUMULATES stays ahead and can actually run deep / win.
        const startChips = tournament.startBB * tourLevels[0].bb
        const fieldAvg = (tournament.field * startChips) / Math.max(1, t.playersLeft)
        const median = fieldAvg * 0.55
        seats = seats.map(s => (s.isEliminated && !s.isHero)
          ? refillSeat(s, Math.max(Math.round(startChips * 0.15), Math.round(median * (0.4 + Math.random() * 1.4))))
          : s)
      } else {
        // Final table: no refill. If the hero is the last one standing → victory.
        const alive = seats.filter(s => !s.isEliminated && (s.stack > 0 || s.isHero))
        if (alive.length === 1 && alive[0].isHero && !t.busted) {
          t.busted = true; t.place = 1
          const prize = prizeForPlace(1, tourPayouts())
          setTourResult({ place: 1, prize })
          persistTournament(1, prize)
          return
        }
        t.playersLeft = alive.length
        setTourHud(h => ({ ...h, playersLeft: alive.length }))
      }
    }
    // Advance the button to the next LIVE seat — at a final table eliminated seats aren't
    // refilled, so a raw +1 would park the button on an empty seat (and skew the blinds).
    const liveSeat = (i: number) => { const s = seats[i]; return !!s && !s.isEliminated && s.stack > 0 && !s.isSittingOut }
    let newDealerIdx = (gsRef.current.dealerIdx + 1) % numPlayers
    for (let g = 0; g < numPlayers && !liveSeat(newDealerIdx); g++) newDealerIdx = (newDealerIdx + 1) % numPlayers
    startHand(seats, newDealerIdx, gsRef.current.handNum)
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
    }, fastFwdRef.current ? 350 : 3800)
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
    rangeRef.current = {}; rangeMetaRef.current = {}; rangeHistoryRef.current = {}
    seats.forEach(s => { if (!s.isSittingOut) rangeRef.current[s.idx] = initRange() })

    // Current blinds — escalate each level in a tournament, fixed in cash.
    const { sb: sbA, bb: bbA, ante: anteA } = tourBlinds()
    const { sbIdx, bbIdx } = findBlinds(seats, dealerIdx)
    const sbSeat = seats[sbIdx]
    const bbSeat = seats[bbIdx]

    // Antes go straight into the pot: tournament = a single BIG-BLIND ANTE (paid by
    // the BB), cash = the legacy per-seat ante.
    let pot = 0
    if (anteA > 0) {
      if (tournament) {
        const a = Math.min(anteA, bbSeat.stack); bbSeat.stack -= a; bbSeat.totalBet += a; pot += a
      } else {
        seats.forEach(s => { const ante = Math.min(anteA, s.stack); s.stack -= ante; s.totalBet += ante; pot += ante })
      }
    }

    // Post blinds — these sit as bet stacks in front of SB/BB until collected
    const sbPost = Math.min(sbA, sbSeat.stack)
    sbSeat.stack -= sbPost; sbSeat.bet = sbPost; sbSeat.totalBet += sbPost
    if (sbSeat.stack <= 0) sbSeat.isAllIn = true // posted the blind all-in
    pot += sbPost

    const bbPost = Math.min(bbA, bbSeat.stack)
    bbSeat.stack -= bbPost; bbSeat.bet = bbPost; bbSeat.totalBet += bbPost
    if (bbSeat.stack <= 0) bbSeat.isAllIn = true
    pot += bbPost

    // Record blind actions
    recordAction({ phase: 'preflop', seatIdx: sbIdx, name: sbSeat.name, isHero: sbSeat.isHero, actionType: 'SB', amount: sbPost }, pot)
    recordAction({ phase: 'preflop', seatIdx: bbIdx, name: bbSeat.name, isHero: bbSeat.isHero, actionType: 'BB', amount: bbPost }, pot)

    const newState: GState = {
      phase: 'dealing',
      deck, seats, community: [null,null,null,null,null],
      pot, currentBet: bbA, minRaise: bbA,
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
    rangeRef.current = {}; rangeMetaRef.current = {}; moodRef.current = {}; rangeHistoryRef.current = {}
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
    simModeRef.current = true; setSimMode(true); setSimResult(null); setHistoryOpen(false); pausedByHistoryRef.current = false

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
    rangeRef.current = ranges; rangeMetaRef.current = {}; moodRef.current = {}; rangeHistoryRef.current = {}
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
      rangeRef.current = saved.ranges; rangeHistoryRef.current = {}
      rangeMetaRef.current = saved.rangeMeta
      moodRef.current = saved.mood
      // Restore the real hand HALTED — the player resumes it with "Reprendre"
      // (matches "la partie en pause reprend"). Idle/showdown stay as they were.
      const resumePaused = saved.gs.phase !== 'idle' && saved.gs.phase !== 'showdown'
      const restored = resumePaused ? { ...saved.gs, paused: true } : saved.gs
      setGs(restored); gsRef.current = restored
      savedRealRef.current = null
      // Re-entering history over the restored (paused) tournament hand → closing it resumes.
      if (tournament && resumePaused) pausedByHistoryRef.current = true
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

    // Clear any leftover deal timers AND any pending bot-action timer — when
    // fast-forwarding, hands chain so fast that a stale action timer could fire
    // mid-deal and rebuild `seats` from a half-dealt snapshot, losing cards.
    dealTimeoutsRef.current.forEach(t => clearTimeout(t))
    dealTimeoutsRef.current = []
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    // Once every card is dealt, open the pre-flop betting round.
    const openPreflop = () => {
      const cur = gsRef.current
      const { bbIdx } = findBlinds(cur.seats, cur.dealerIdx)
      const firstToAct = numSeats === 2 ? cur.dealerIdx : (bbIdx + 1) % numSeats
      const queue = buildActQueue(cur.seats, firstToAct)

      recordAction({ phase: 'preflop', seatIdx: -1, name: '', isHero: false, actionType: 'PREFLOP', amount: 0 }, cur.pot)

      const newState: GState = { ...cur, phase: 'preflop', actQueue: queue }
      setGs(newState); gsRef.current = newState
      scheduleAutoNext(newState, 300)
    }

    // Fast-forward: deal EVERY card in a single atomic update. Pitching one card at
    // a time via a shared ref races badly when the step is tiny (cards get lost), so
    // in fast mode we skip the animation and set all hole cards at once.
    if (fastFwdRef.current) {
      const dealt = dealingSeats.map(s => {
        const mine = assigns.filter(a => a.seatIdx === s.idx)
        if (!mine.length) return s
        const hc = [...s.holeCards] as [Card|null, Card|null]
        mine.forEach(a => { hc[a.cardIdx] = a.card })
        return { ...s, holeCards: hc }
      })
      const ds: GState = { ...dealingState, seats: dealt }
      setGs(ds); gsRef.current = ds
      playSound('deal')
      const finishT = setTimeout(openPreflop, 40)
      dealTimeoutsRef.current.push(finishT)
      return
    }

    // Normal mode: pitch the cards one by one for the dealing animation.
    const STEP = 80
    playDeal(assigns.length, STEP / 1000) // 🔊 staggered card pitches, in sync with the visual
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

    const finishT = setTimeout(openPreflop, assigns.length * STEP + 220)
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

  // Tournament re-entry: a fresh starting stack, field grows back by one, resume.
  function reEnterTournament() {
    if (!tournament) return
    tourRef.current.busted = false
    tourRef.current.playersLeft += 1
    setTourResult(null)
    rebuyHero(tournament.startBB * tourLevels[0].bb)
  }

  // Replay a brand-new tournament with the SAME config — reset the clock / field /
  // result and deal a fresh hand 1, without going back through the setup page.
  function restartTournament() {
    if (!tournament) return
    flowGenRef.current++
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (nextHandTimeoutRef.current) clearTimeout(nextHandTimeoutRef.current)
    dealTimeoutsRef.current.forEach(t => clearTimeout(t)); dealTimeoutsRef.current = []
    tourRef.current = { levelIdx: 0, secondsLeft: tournament.levelMinutes * 60, playersLeft: tournament.field, finalTable: false, busted: false, place: 0 }
    setTourLevelIdx(0)
    setTourHud({ playersLeft: tournament.field, secondsLeft: tournament.levelMinutes * 60 })
    setTourResult(null)
    sitOutRef.current = false; setSitOut(false)
    // createSeats() sizes stacks as stackBB × bbAmt, but bbAmt is still the END level's
    // (huge) blind here (the level-0 re-render hasn't happened yet) → wrong stacks. Force
    // the configured tournament starting stack (= startBB × level-0 BB, like a re-entry).
    const freshStack = tournament.startBB * tourLevels[0].bb
    startHand(createSeats().map(s => ({ ...s, stack: freshStack })), 0, 0)
  }

  function setPaused(paused: boolean) {
    const cur = gsRef.current
    if (cur.paused === paused) return
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
  function togglePause() { setPaused(!gsRef.current.paused) }

  // Tournament: opening the hand history pauses the game (and the blind clock, which
  // freezes while gs.paused); closing it resumes — but only if WE auto-paused, so a
  // manual pause before opening history is left paused on close.
  function openHistory() {
    if (tournament && !gsRef.current.paused && gsRef.current.phase !== 'idle') {
      pausedByHistoryRef.current = true
      setPaused(true)
    }
    setHistoryOpen(true)
  }
  function closeHistory() {
    setHistoryOpen(false)
    if (pausedByHistoryRef.current) { pausedByHistoryRef.current = false; setPaused(false) }
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
    rangeRef.current = snap.ranges; rangeHistoryRef.current = {}
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
  coachOpenRef.current = coachOpen
  // The opponent range "film" is open while hovering an in-hand opponent (or its
  // popup). Like the coach card, it FREEZES the clock — the point is to LEARN how
  // the range evolved, not to be rushed.
  const rangeFilmOpen = (hoverSeat !== null && hoverSeat !== hero?.idx) || oppPanelHover || filmPinned
  rangeFilmRef.current = rangeFilmOpen
  // Each time the hovered seat changes (incl. closing), start the new film unpinned.
  useEffect(() => { setFilmPinned(false) }, [hoverSeat])
  // SPACE pins the open film (so leaving its zone won't close it). Only when open and
  // not typing in a field; swallow the key so it doesn't scroll / trigger a button.
  useEffect(() => {
    if (!rangeFilmOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      e.preventDefault(); setFilmPinned(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rangeFilmOpen])
  // Hero's represented (perceived) range — shown postflop in the coach panel.
  const heroRepView = (coachOpen && hero && gs.community.filter(Boolean).length >= 3 && rangeRef.current[hero.idx])
    ? rangeView(rangeRef.current[hero.idx]) : null
  const heroRepMeta = hero ? (rangeMetaRef.current[hero.idx] ?? { move: '—', effect: 'range de départ' }) : null
  const preCanCheck = !!hero && gs.currentBet <= hero.bet          // no bet to call → check
  const preCallAmt = hero ? Math.min(gs.currentBet - hero.bet, hero.stack) : 0

  // Situation detection from the RECORDED actions of this hand (robust: a raiser
  // who later folded/re-acted is still counted correctly).
  const handActions = currentHandActionsRef.current
  // Genuine preflop raises only — a short jam UNDER the current bet is dead money,
  // not a 3-bet (mirrors the replay critique exactly).
  const pfLive = realPreflopRaises(handActions, bbAmt)
  const preflopRaiseActions = pfLive.count
  const preflopCallers = handActions.filter(a => a.seatIdx >= 0 && a.phase === 'preflop' && a.actionType === 'CALL').length
  const heroScenario: Scenario | 'postflop' =
    gs.phase !== 'preflop' ? 'postflop'
    : preflopRaiseActions >= 3 ? 'vs4bet'
    : preflopRaiseActions === 2 ? 'vs3bet'
    : preflopRaiseActions === 1 ? (preflopCallers > 0 ? 'squeeze' : 'vsopen')
    : preflopCallers > 0 ? 'iso' : 'rfi'
  // The last GENUINE pre-flop raiser (opener for vs-open, 3-bettor for vs-3bet) —
  // a dead short jam is not the raiser we're facing.
  const lastPreRaiserSeat = pfLive.lastRaiserSeat
  // Position of the opener we're facing (vs-open) → defend wider vs a late/wide
  // open, tighter vs a tight UTG open. Same source as the critique to stay coherent.
  const heroVsOpenerPos = heroScenario === 'vsopen' ? gs.seats[lastPreRaiserSeat]?.position : undefined
  // Number of opponents currently all-in preflop → "facing a jam" call-off coach.
  // Only count an all-in that is at the TOP of the action (its bet ≥ the current
  // bet). A short all-in that's been raised OVER by a bigger live raise (e.g. a SB
  // all-in for 0.4bb behind an 800 raise) is just dead money — the real decision is
  // vs the raiser (vsopen/3bet), not a jam call-off, so it must not trigger vsJam.
  const heroNumAllIn = gs.phase === 'preflop'
    ? gs.seats.filter(s => !s.isHero && !s.isFolded && s.isAllIn && s.bet >= gs.currentBet).length
    : 0
  // Facing a jam but a live RAISER/squeezer is still to act behind (raised above the
  // BB, hasn't matched the jam, not folded/all-in) → you don't close the action; their
  // range is stronger and they can re-jam → the call-off must tighten hard.
  const heroRaiserBehindJam = gs.phase === 'preflop' && heroNumAllIn >= 1 &&
    gs.seats.some(s => !s.isHero && !s.isFolded && !s.isAllIn && s.bet > bbAmt && s.bet < gs.currentBet)
  // Tournament ICM pressure (0..1): peaks on the bubble, lingers ITM from pay
  // jumps. Tightens the coach's gambling ranges (push/fold, call-offs, flats).
  const icmPressure = tournament ? (() => {
    const placesP = placesPaid(tournament.field, tournament.paidPct)
    const left = tourHud.playersLeft
    if (left <= 1) return 0
    const toBubble = left - placesP
    if (toBubble <= 0) return 0.22 // already in the money — mild pay-jump pressure
    return Math.max(0, Math.min(1, 1 - toBubble / (tournament.field * 0.12 + 6)))
  })() : 0
  const icmTighten = 1 - icmPressure * 0.45
  // vs-3bet: size of the 3-bet relative to the open (3 ≈ standard) → continue width.
  const heroReRaiseRatio = pfLive.amts.length >= 2 && pfLive.amts[0] > 0 ? pfLive.amts[1] / pfLive.amts[0] : undefined
  // Villain aggression → range-aware equity. Count opponents' bets/raises this hand
  // (a dead short jam under the bet is NOT a barrel); barrels = post-flop streets fired.
  const villainAggro = handActions.filter(a => isAggroAction(a, pfLive.deadAllIn))
  // Distinct opponents who actually BET/RAISED POSTFLOP — only their range is
  // polarized to value. The others merely called (capped range), so multiway equity
  // isn't crushed by treating every caller as a value-bettor.
  const heroAggressors = new Set(villainAggro.filter(a => a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river').map(a => a.seatIdx)).size
  // Pre-flop pot type → premium-heavy villain range (3-bet/4-bet) for the equity model.
  const heroVillainTier = preflopRaiseActions >= 3 ? '4bet' as const : preflopRaiseActions === 2 ? '3bet' as const : undefined
  const preAggrFloor = preflopRaiseActions >= 3 ? 0.6 : preflopRaiseActions === 2 ? 0.4 : 0
  const heroBarrels = new Set(villainAggro.filter(a => a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river').map(a => a.phase)).size
  // Size-aware aggression — MUST mirror the replay critique exactly, otherwise the live
  // coach (and the "Suivre le coach" auto-play) can CALL a spot the "Juge mon coup"
  // verdict then calls a FOLD. A big bet polarizes the range far more than a bet count.
  const heroToCallNow = hero ? Math.max(0, gs.currentBet - hero.bet) : 0
  const heroSizeFrac = heroToCallNow > 0 && (gs.pot - heroToCallNow) > 0 ? heroToCallNow / (gs.pot - heroToCallNow) : 0
  const heroSizeBoost = heroSizeFrac >= 1 ? 0.55 : heroSizeFrac >= 0.66 ? 0.45 : heroSizeFrac >= 0.45 ? 0.36 : heroSizeFrac >= 0.25 ? 0.22 : 0.08
  const heroAggression = Math.min(0.85, Math.max(preAggrFloor, villainAggro.length * 0.28, heroSizeBoost + (heroBarrels - 1) * 0.18))
  // CAPPED / "delayed" bet: an earlier postflop street was CHECKED THROUGH (no bet)
  // and now the hero faces a bet → the strongest hands usually fired earlier, so this
  // betting range is capped (more bluff-heavy). Softens the value-polarization so a
  // bluff-catcher correctly calls (e.g. QQ vs a turn bet after a checked-back ace flop).
  const heroCappedRange = (['flop', 'turn', 'river'] as Phase[]).indexOf(gs.phase) > 0 &&
    (['flop', 'turn', 'river'] as Phase[]).slice(0, (['flop', 'turn', 'river'] as Phase[]).indexOf(gs.phase)).some(st => {
      const acts = handActions.filter(a => a.seatIdx >= 0 && a.phase === st)
      return acts.length > 0 && !acts.some(a => a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN')
    })
  // DONK-LEAD: the player whose bet the hero faces is NOT the pre-flop aggressor — a
  // passive caller leading/barrelling out (often OOP into the field). That line is far
  // more value-defined than a c-bet → concentrate the villain range on real value so a
  // marginal bluff-catcher (2nd pair / underpair) folds earlier instead of paying down.
  const heroPostAggro = villainAggro.filter(a => (a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river') && a.seatIdx !== hero?.idx)
  const heroLastPostAggressor = heroPostAggro.length ? heroPostAggro[heroPostAggro.length - 1].seatIdx : -1
  const heroDonkLead = heroToCallNow > 0 && lastPreRaiserSeat >= 0 && heroLastPostAggressor >= 0 && heroLastPostAggressor !== lastPreRaiserSeat
  // FACING A RAISE: a bet was RAISED on the current street (≥2 aggressive actions) and
  // the hero must call the raise. A raise is the strongest line (two-pair+/sets) — far
  // stronger than a bet/lead — so a lone (even top) pair should not stack off.
  const heroCurStreetAggro = handActions.filter(a => a.phase === gs.phase && (a.actionType === 'BET' || a.actionType === 'RAISE' || a.actionType === 'ALL-IN')).length
  const heroFacingRaise = heroToCallNow > 0 && gs.phase !== 'preflop' && heroCurStreetAggro >= 2
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
  // CALL PRESSURE: opponents who CALL several postflop streets (esp. multiway) have a
  // strong, value-heavy range → de-value the hero's lone overpair/one-pair (don't keep
  // barrelling / stack off). Distinct postflop streets an opponent called + multiway.
  const heroCalledStreets = new Set(handActions.filter(a => a.seatIdx >= 0 && !a.isHero && a.actionType === 'CALL' && (a.phase === 'flop' || a.phase === 'turn' || a.phase === 'river')).map(a => a.phase)).size
  const heroCallPressure = Math.min(0.85, heroCalledStreets * 0.25 + (heroMultiway ? 0.15 : 0))
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

  // ── "Follow the coach" auto-play: execute EXACTLY the coach's recommended move
  // for the hero's current decision (precise fold/check/call/bet/raise/all-in size).
  // Uses the same engine + inputs as the live coach panel, so the action matches.
  // Compute the coach's recommended move for the hero's CURRENT decision WITHOUT playing
  // it (so Turbo can peek: auto-play folds/checks, stop for real decisions).
  function computeCoachMove(): { action: string; amount: number } | null {
    const cur = gsRef.current
    const h = cur.seats.find(s => s.isHero)
    if (!h || !h.isActive || manualModeRef.current || cur.paused) return null
    const c1 = h.holeCards[0], c2 = h.holeCards[1]
    if (!c1 || !c2) return null
    const toCall = Math.max(0, cur.currentBet - h.bet)
    const allInTo = h.bet + h.stack
    const minTo = Math.min(allInTo, cur.currentBet + cur.minRaise)
    const canCheck = toCall === 0
    const rb = (x: number) => Math.max(bbAmt, Math.round(x / bbAmt) * bbAmt)
    const effBB = (heroEffStack > 0 ? heroEffStack : h.stack) / bbAmt

    if (cur.phase === 'preflop') {
      const heroKey = handKeyFromCards(c1, c2)
      const vsJam = heroNumAllIn >= 1
      const potOddsPre = toCall > 0 ? toCall / (cur.pot + toCall) : 0
      const map = vsJam
        ? buildJamCallMap(effBB, heroNumAllIn, icmTighten, heroRaiserBehindJam)
        : buildRangeMap(heroScenario as Scenario, h.position, heroPlayersBehind,
            { effBB, raiseToBB: heroRaiseToBB, multiway: heroMultiway, vsOpenerPos: heroVsOpenerPos, reRaiseRatio: heroReRaiseRatio, threeBettorIP: heroThreeBettorIP, icmTighten, closingAction: heroPlayersBehind === 0, potOdds: potOddsPre })
      const chart = map.get(heroKey) ?? 'fold'
      if (chart === 'fold') return { action: canCheck ? 'CHECK' : 'FOLD', amount: 0 }
      if (chart === 'call') return { action: canCheck ? 'CHECK' : 'CALL', amount: toCall }
      if (effBB <= 13 || vsJam) return { action: 'ALL-IN', amount: allInTo } // short stack → jam
      if (chart === 'raise' && (heroScenario === 'vsopen' || heroScenario === 'squeeze')) return { action: 'ALL-IN', amount: allInTo } // re-shove zone
      let to: number
      if (chart === '3bet') to = Math.round(cur.currentBet * 3)
      else if (chart === '4bet') to = Math.round(cur.currentBet * 2.3)
      else { // open / iso-raise
        const limpers = cur.seats.filter(s => !s.isFolded && !s.isHero && s.bet >= bbAmt && s.bet < cur.currentBet).length
        to = Math.round((heroScenario === 'iso' ? 3.5 : 2.5) * bbAmt) + limpers * bbAmt
      }
      return { action: 'RAISE', amount: Math.min(allInTo, Math.max(minTo, rb(to))) }
    }

    // ── Postflop: same advice engine as the panel ──
    const board = cur.community.filter(Boolean) as Card[]
    const adv = getPostflopAdvice({ hole: [c1, c2], board, pot: cur.pot, toCall,
      heroStack: h.stack, effStack: heroEffStack, opponents: Math.max(1, heroActiveCount - 1),
      inPosition: heroInPosition, aggression: heroAggression, barrels: heroBarrels, bb: bbAmt, villainTier: heroVillainTier, aggressors: heroAggressors, cappedRange: heroCappedRange, callPressure: heroCallPressure, donkLead: heroDonkLead, facingRaise: heroFacingRaise })
    if (adv.action === 'FOLD') return { action: canCheck ? 'CHECK' : 'FOLD', amount: 0 }
    if (adv.action === 'CHECK') return { action: 'CHECK', amount: 0 }
    if (adv.action === 'CALL') return { action: 'CALL', amount: toCall }
    if (adv.jam) return { action: 'ALL-IN', amount: allInTo }
    if (adv.action === 'BET') return { action: 'BET', amount: Math.min(allInTo, Math.max(bbAmt, rb(cur.pot * (adv.betFrac || 0.6)))) }
    if (adv.action === 'RAISE') return { action: 'RAISE', amount: Math.min(allInTo, Math.max(minTo, cur.currentBet + rb((cur.pot + toCall) * (adv.betFrac || 0.66)))) }
    return null
  }
  function executeCoachMove() { const mv = computeCoachMove(); if (mv) heroAction(mv.action, mv.amount) }
  coachMoveRef.current = executeCoachMove

  // TURBO: when it's the hero's turn, peek the coach's move — auto-play (skip) ONLY a
  // FOLD (you're out of the hand → nothing to see). Everything else, incl. a CHECK,
  // STOPS for you (you're in the hand). Each skipped fold charges its virtual think-time
  // to the level clock (like the bots) so the blinds keep rising at a logical pace.
  useEffect(() => {
    if (!isHeroTurn || gs.paused || manualMode || !turboRef.current) return
    const mv = computeCoachMove()
    if (!mv || mv.action !== 'FOLD') return // only a FOLD is skipped; anything else → wait for you
    const id = setTimeout(() => {
      const h = gsRef.current.seats.find(s => s.isHero)
      if (!gsRef.current.paused && h?.isActive && turboRef.current) {
        if (fastFwdRef.current) consumeTourTime(1.5) // charge the skipped action's virtual time
        heroAction(mv.action, mv.amount)
      }
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHeroTurn, gs.handNum, gs.currentBet, gs.phase, turbo])

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
      if (k === 's') { e.preventDefault(); coachMoveRef.current() } // suivre le conseil du coach
      else if (k === 'f') { e.preventDefault(); heroAction('FOLD') }
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

  // ── "H" — toggle the hand history, any time (cash OR tournament), as long as
  // there are saved hands. Not while typing or in the simulation sandbox. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() !== 'h') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (simMode) return // the sim sandbox replaces the history button
      e.preventDefault()
      if (historyOpen) closeHistory()
      else if (handHistory.length > 0) openHistory()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, handHistory.length, simMode])

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
    if (!isHeroTurn || gs.paused || coachOpen || manualMode || rangeFilmOpen) return
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
  }, [isHeroTurn, gs.paused, coachOpen, gs.handNum, gs.currentBet, manualMode, rangeFilmOpen])

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
        <button onClick={() => (simMode ? exitSim() : navigate(tournament ? '/tournament' : isScenario ? '/setup' : '/training'))}
          className="app-drag-none flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={15}/>
          <span className="text-[10px] uppercase tracking-widest font-bold">{simMode ? t('game.quitSim') : t('game.quit')}</span>
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
        {/* Accélérer — tournament only: bots act near-instantly, flow stops only at the hero's decision. */}
        {tournament && !simMode && gs.phase !== 'idle' && (
          <button onClick={() => {
              // Cycle: Normal → Accéléré → Turbo → Normal.
              let nf: boolean, nt: boolean
              if (!fastFwdRef.current) { nf = true; nt = false }
              else if (!turboRef.current) { nf = true; nt = true }
              else { nf = false; nt = false }
              fastFwdRef.current = nf; setFastFwd(nf); turboRef.current = nt; setTurbo(nt)
              const cur = gsRef.current
              if (nf && !cur.paused && !manualModeRef.current && cur.phase !== 'idle' && cur.phase !== 'showdown') scheduleAutoNext(cur, 20)
            }}
            title={turbo ? t('sess.turboTip') : fastFwd ? t('sess.fastTip') : t('sess.accelTip')}
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[9px] font-bold uppercase tracking-widest"
            style={turbo
              ? { borderColor: 'rgba(168,139,255,0.75)', background: 'rgba(124,78,214,0.28)', color: '#c9b8ff' }
              : fastFwd
              ? { borderColor: 'rgba(201,162,39,0.7)', background: 'rgba(201,162,39,0.22)', color: '#f2d375' }
              : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
            <FastForward size={11}/> {turbo ? 'Turbo 🚀' : fastFwd ? 'Rapide ⚡' : 'Accélérer'}
          </button>
        )}

        {simMode ? (
          <button onClick={restartSim}
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[9px] font-bold uppercase tracking-widest"
            style={{ borderColor: 'rgba(167,139,255,0.5)', background: 'rgba(120,90,230,0.18)', color: '#c8b6ff' }}>
            <RefreshCw size={11}/> Restart
          </button>
        ) : handHistory.length > 0 && (
          <button onClick={openHistory} title="Historique des mains (H)"
            className="app-drag-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all text-[9px] font-bold uppercase tracking-widest">
            Historique ({handHistory.length})
            <kbd className="px-1 rounded bg-black/35 text-[8px] font-mono opacity-70">H</kbd>
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
              {gs.paused ? t('game.resume') : t('game.pause')}
            </button>
            <button onClick={stopGame}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-900/20 border border-red-700/30 text-red-400/70 hover:text-red-400 hover:bg-red-900/30 transition-all text-[9px] font-bold">
              <Square size={11}/> Stop
            </button>
          </div>
        )}

        {/* Language + sound */}
        <LanguageSwitcher className="app-drag-none" />
        <SoundToggle className="app-drag-none" />

        {/* Window controls — desktop only (hidden on web) */}
        {isElectron && (
          <div className="app-drag-none flex items-center gap-2 pl-1">
            <button onClick={() => window.api?.minimizeWindow()} title="Réduire"
              className="w-3.5 h-3.5 rounded-full bg-yellow-400/70 hover:bg-yellow-400 transition-colors"/>
            <button onClick={() => window.api?.maximizeWindow()} title="Agrandir"
              className="w-3.5 h-3.5 rounded-full bg-green-400/70 hover:bg-green-400 transition-colors"/>
            <button onClick={() => window.api?.closeWindow()} title="Fermer"
              className="w-3.5 h-3.5 rounded-full bg-red-400/70 hover:bg-red-400 transition-colors"/>
          </div>
        )}
      </header>

      {/* ── TABLE AREA ── */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <Room variant={roomVariant}/>

        {/* ── TOURNAMENT HUD ── */}
        {tournament && gs.phase !== 'idle' && curLevel && (() => {
          const startChips = tournament.startBB * tourLevels[0].bb
          const totalChips = tournament.field * startChips
          const playersLeft = tourHud.playersLeft
          const avgStack = totalChips / Math.max(1, playersLeft)
          const heroStack = hero?.stack ?? 0
          const rank = estimateRank(heroStack, avgStack, playersLeft)
          const places = placesPaid(tournament.field, tournament.paidPct)
          const itm = rank <= places
          const toBubble = playersLeft - places
          const Cell = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
            <div className="flex flex-col items-center px-3">
              <span className="text-[7px] uppercase tracking-widest text-white/35 font-bold">{label}</span>
              <span className={`text-[12px] font-black font-mono ${accent ? 'text-[#f0c060]' : 'text-white/85'}`}>{value}</span>
            </div>
          )
          return (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center rounded-xl border px-1 py-1.5 backdrop-blur-md divide-x divide-white/10"
              style={{ background: 'rgba(20,14,4,0.92)', borderColor: 'rgba(240,192,96,0.35)' }}>
              <Cell label={t('game.hudLevel')} value={`${tourLevelIdx + 1}`} accent />
              <Cell label={t('game.hudBlinds')} value={`${curLevel.sb.toLocaleString()}/${curLevel.bb.toLocaleString()}${curLevel.ante ? ` (a${curLevel.ante.toLocaleString()})` : ''}`} />
              <Cell label={t('game.hudNextLevel')} value={coachOpen ? t('game.hudPause') : `${Math.floor(tourHud.secondsLeft / 60)}:${String(tourHud.secondsLeft % 60).padStart(2, '0')}`} />
              <Cell label={t('game.hudPlayers')} value={`${playersLeft.toLocaleString()}/${tournament.field.toLocaleString()}`} accent />
              <Cell label={t('game.hudAvgStack')} value={`${Math.round(avgStack / curLevel.bb)} BB`} />
              <Cell label={t('game.hudYourStack')} value={`${Math.round(heroStack / curLevel.bb)} BB`} accent />
              <Cell label={t('game.hudPlace')} value={t('tour.placeN', { n: rank.toLocaleString() })} />
              <div className="flex flex-col items-center px-3">
                <span className="text-[7px] uppercase tracking-widest text-white/35 font-bold">{t('game.hudStatus')}</span>
                <span className={`text-[11px] font-black ${itm ? 'text-emerald-400' : toBubble <= 5 ? 'text-amber-400' : 'text-white/60'}`}>
                  {itm ? t('game.hudItm', { prize: prizeForPlace(rank, tourPayouts()).toLocaleString() }) : toBubble <= 5 ? t('game.hudBubble', { n: toBubble }) : t('game.hudPaid', { n: places })}
                </span>
              </div>
            </div>
          )
        })()}

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
                <p className="text-white/40 text-sm">{t('game.idleStart')}</p>
                <button
                  onClick={() => startHand(gs.seats.length > 0 ? gs.seats : createSeats(), 0, 0)}
                  className="mt-2 px-8 py-3 rounded-xl font-bold text-sm tracking-widest uppercase transition-all"
                  style={{background:'linear-gradient(135deg,#f0d060,#c9a227,#8B6810)',color:'#0a0a0a',boxShadow:'0 0 30px rgba(201,162,39,0.4)'}}>
                  {t('game.startGame')}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table container — note: leaving it must NOT close the opponent range film
            (the film is a fixed popup rendered OUTSIDE this container, so the cursor
            crosses this boundary to reach it). The film closes via its own zone-leave,
            the ✕, or Échap. Only clear a non-film hover (hero coach handles itself). */}
        <div ref={tableRef} className="absolute inset-0 flex items-center justify-center p-2">
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
                  turnPaused={gs.paused || coachOpen || manualMode || rangeFilmOpen}
                  hideTimer={manualMode}
                  onRebuy={!tournament && seat.isEliminated ? () => rebuyPlayer(seat.idx) : undefined}
                  onHoverCards={(entering, e) => {
                    // CARDS zone → range / coach only (and close the bet panel if it
                    // was open for this on-turn seat, so cards = range, never bets).
                    if (entering && manualModeRef.current && gsRef.current.actQueue[0] === seat.idx) setManualPanel(null)
                    if (seat.isHero) {
                      if (entering && e) { if (coachTimerRef.current) clearTimeout(coachTimerRef.current); setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                      else { coachTimerRef.current = setTimeout(() => { if (!heroPanelHoverRef.current) setHoverSeat(s => (s === seat.idx ? null : s)) }, 350) }
                    } else if (entering && e) { setHoverSeat(seat.idx); setHoverPos({ x: e.clientX, y: e.clientY }) }
                    // Opponent: leaving the cards does NOT close — the film popup stays
                    // so the cursor can travel into it (closes via the popup / ✕ / Échap).
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
                    // Opponent: leaving the name/stack does NOT close (see cards handler).
                  }}
                />
              )
            })}

            {/* "Follow the coach" — tournament auto-pilot: one click plays EXACTLY
                the coach's recommended move (precise size). Shortcut: S. */}
            {tournament && isHeroTurn && !manualMode && !heroBusted && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => coachMoveRef.current()}
                title="Joue exactement le conseil du coach (touche S)"
                className="app-drag-none absolute z-30 flex items-center gap-2 px-3.5 py-2 rounded-xl border font-black text-[10px] uppercase tracking-widest"
                style={{ right: '2.5%', bottom: '3%', borderColor: 'rgba(167,139,255,0.6)', background: 'linear-gradient(135deg, rgba(124,92,240,0.32), rgba(78,56,168,0.32))', color: '#dcd0ff', boxShadow: '0 0 24px rgba(124,92,240,0.4)', backdropFilter: 'blur(4px)' }}>
                ✨ Suivre le coach
                <kbd className="px-1 rounded bg-black/35 text-[8px] font-mono opacity-80">S</kbd>
              </motion.button>
            )}

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

          {/* Sit-out notice (cards/name/stack are already shown on the table seat) */}
          {hero && sitOutPending && (
            <div className="flex items-center px-4 py-1.5 border-b border-white/5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold uppercase tracking-wide">
                Sit out à la prochaine main
              </span>
            </div>
          )}

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
                  <p className="text-[9px] text-white/40">{t('game.rechargeTapis')}</p>
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
                      {gs.paused ? t('game.paused') : t('game.handDonePrev')}
                    </p>
                  </div>
                ) : gs.phase === 'dealing' ? (
                  <p className="text-[10px] text-white/30 uppercase tracking-widest animate-pulse">{t('game.distributing')}</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-ping opacity-60"/>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">{t('game.waiting')}</p>
                  </div>
                )}
              </div>
            )}
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

      {/* ── TOURNAMENT result (hero busted) ── */}
      <AnimatePresence>
        {tournament && tourResult && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] flex items-center justify-center" style={{ background: 'rgba(8,5,2,0.82)' }}>
            <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }}
              className="rounded-2xl border p-8 text-center max-w-md"
              style={{ background: '#160f04', borderColor: 'rgba(240,192,96,0.4)', boxShadow: '0 0 60px rgba(200,140,40,0.35)' }}>
              <div className="text-5xl mb-2">{tourResult.prize > 0 ? '🏅' : '☠️'}</div>
              <h2 className="text-lg font-black uppercase tracking-[0.18em] text-[#f0c060]">{t('game.tourFinished')}</h2>
              <p className="text-[15px] text-white/80 mt-2">{t('game.youFinish', { place: tourResult.place.toLocaleString(), field: tournament.field.toLocaleString() })}</p>
              <p className={`text-[13px] mt-1 font-bold ${tourResult.prize > 0 ? 'text-emerald-400' : 'text-white/40'}`}>
                {tourResult.prize > 0 ? t('game.prize', { amount: tourResult.prize.toLocaleString() }) : t('game.noPrize')}
              </p>
              <div className="flex items-center justify-center gap-3 mt-6">
                {tournament.reentry && (
                  <button onClick={reEnterTournament}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black uppercase tracking-[0.16em] text-[12px] transition-all hover:scale-[1.03]"
                    style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#1a0e02' }}>
                    <RefreshCw size={14}/> Re-entry
                  </button>
                )}
                <button onClick={restartTournament} title={t('game.restartTitle')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black uppercase tracking-[0.16em] text-[12px] transition-all hover:scale-[1.03]"
                  style={{ background: 'linear-gradient(135deg,#5ad19a,#2e9e6b)', color: '#04140c' }}>
                  <RefreshCw size={14}/> {t('game.rejouer')}
                </button>
                <button onClick={() => navigate('/tournament')}
                  className="px-5 py-2.5 rounded-xl font-bold uppercase tracking-[0.16em] text-[12px] border border-white/15 bg-white/5 text-white/60 hover:bg-white/10 transition-all">
                  {t('game.quit')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HAND HISTORY MODAL ── */}
      <AnimatePresence>
        {historyOpen && handHistory.length > 0 && (
          <HandHistoryModal records={handHistory} onClose={closeHistory} onRevive={reviveSituation}/>
        )}
      </AnimatePresence>

      {/* ── Revive sandbox: end-of-hand prompt (replay re-draws opponents) ── */}
      <AnimatePresence>
        {simMode && simResult && (
          // Non-blocking dock: the table, the revealed cards and the range popups stay
          // fully visible/interactive so the player can analyse the hand at their own
          // pace, then calmly choose to replay or quit.
          <motion.div initial={{opacity:0, y:-16}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-16}}
            className="fixed top-[64px] left-1/2 -translate-x-1/2 z-[80] pointer-events-none">
            <div className="pointer-events-auto rounded-2xl border px-5 py-3 flex items-center gap-5 backdrop-blur-md"
              style={{ background:'rgba(14,12,34,0.92)', borderColor:'rgba(167,139,255,0.45)', boxShadow:'0 10px 50px rgba(120,90,230,0.4)' }}>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-[#c8b6ff]">{t('game.handDone')}</h2>
                </div>
                <p className="text-[11px] text-white/55 mt-0.5">
                  {simResult.winners.map(wi => simResult.seats.find(s => s.idx === wi)?.name ?? '?').join(', ') || '—'} {t('lb.winVerb')}
                  {(() => { const h = simResult.seats.find(s => s.isHero); return h && simResult.winners.includes(h.idx) ? t('game.youWin') : '' })()}
                </p>
                <p className="text-[9.5px] text-white/35 mt-0.5">Analyse le coup — survole les cartes pour voir les ranges. Prends ton temps.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={restartSim}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-black uppercase tracking-[0.14em] text-[11px] transition-all hover:scale-[1.04]"
                  style={{ background:'linear-gradient(135deg,#a78bff,#6d4ed6)', color:'#0a0716' }}>
                  <RefreshCw size={13}/> Rejouer
                </button>
                <button onClick={exitSim}
                  className="px-4 py-2 rounded-xl font-bold uppercase tracking-[0.14em] text-[11px] border border-white/15 bg-white/5 text-white/60 hover:bg-white/10 transition-all">
                  Quitter
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OPPONENT range "film" popup. Hovering an in-hand opponent freezes the
            clock and replays how their range narrowed across the hand, action by
            action (cells fade to grey, surviving value hands light up). Interactive
            (pointer-events-auto) so the scrubber works; a grace timer on the seat
            lets the cursor reach it. ── */}
      {hoverSeat !== null && hoverSeat !== hero?.idx && hoverPos && (() => {
        const seat = gs.seats.find(s => s.idx === hoverSeat)
        if (!seat || seat.isFolded || seat.isSittingOut || seat.isEliminated || !rangeRef.current[hoverSeat]) return null
        // Prefer the recorded film; fall back to a single static frame (revive/restore).
        const history: RangeStep[] = rangeHistoryRef.current[hoverSeat]?.length
          ? rangeHistoryRef.current[hoverSeat]
          : [{ view: rangeView(rangeRef.current[hoverSeat]), ...(rangeMetaRef.current[hoverSeat] ?? { move: '—', effect: t('rev.noActionYet') }), caption: t('rev.currentRange') }]
        const W = 482, H = 660
        let x = hoverPos.x + 22, y = hoverPos.y - H / 2
        if (x + W > window.innerWidth - 8) x = hoverPos.x - W - 22
        if (x < 8) x = 8
        if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8
        if (y < 8) y = 8
        const closeFilm = () => { oppPanelHoverRef.current = false; setOppPanelHover(false); setFilmPinned(false); setHoverSeat(null) }
        // Pop the per-hand explanation toward the screen centre (room there).
        const explainSide: 'left' | 'right' = x > window.innerWidth / 2 ? 'left' : 'right'
        const heroDead = (hero?.holeCards.filter(Boolean) ?? []) as Card[]
        return (
          <div className="fixed z-[80] pointer-events-auto" style={{ left: x, top: y }}
            onMouseEnter={() => { oppPanelHoverRef.current = true; setOppPanelHover(true) }}
            onMouseLeave={() => { oppPanelHoverRef.current = false; setOppPanelHover(false); if (!filmPinned) closeFilm() }}
            onMouseDown={() => setFilmPinned(true)}>
            <RangeEvolution key={hoverSeat} history={history} name={seat.name} width={462}
              pinned={filmPinned} onClose={closeFilm} side={explainSide} deadCards={heroDead} />
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
                villainTier={heroVillainTier}
                aggressors={heroAggressors}
                cappedRange={heroCappedRange}
                donkLead={heroDonkLead}
                facingRaise={heroFacingRaise}
                callPressure={heroCallPressure}
                bb={bbAmt}
                raiseToBB={heroRaiseToBB}
                multiway={heroMultiway}
                vsOpenerPos={heroVsOpenerPos}
                reRaiseRatio={heroReRaiseRatio}
                threeBettorIP={heroThreeBettorIP}
                numAllIn={heroNumAllIn}
                raiserBehindJam={heroRaiserBehindJam}
                icmTighten={icmTighten}
                icmPressure={icmPressure}
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
