import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Square, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react'
import PlayerAvatar, { avatarForSeat } from '../components/PlayerAvatar'

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
const BNAMES: Record<number, string[]> = {
  1:['Lucky Luke','Fish Bob','Noobie Ned','Rookie Ray','Passive Pete','Clueless Carl'],
  2:['Regular Rob','Tag Mike','Basic Ben','ABC Andy','Steady Sam','Avg Joe'],
  3:['Solid Steve','Semi-Pro Kim','Thinking Tim','Range Rita','Smart Sara','Poker Pat'],
  4:['Expert Emma','GTO Greg','Balanced Bob','Exploit Ed','Pro Paul','Sharp Shawn'],
  5:['GTO Bot','Solver AI','PIO Master','Range Rover','Optimal Opus','Neural Net'],
}
const LGRAD: Record<number,[string,string]> = {
  0:['#0d2235','#00d4ff'], 1:['#0d2a0d','#22aa44'], 2:['#102038','#2266cc'],
  3:['#2a2008','#c9a227'], 4:['#300808','#cc3333'], 5:['#1a0830','#9933dd'],
}
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

// ─── Bot AI helpers ───────────────────────────────────────────────────────────
function preflopStrength(c1: Card, c2: Card): number {
  const r1 = RV[c1.rank] ?? 2, r2 = RV[c2.rank] ?? 2
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2)
  const pair = r1 === r2, suited = c1.suit === c2.suit, gap = hi - lo
  if (pair) return hi>=14?10:hi>=12?9:hi>=10?8:hi>=8?7:6
  if (hi===14) {
    if (lo>=13) return suited?10:9
    if (lo>=11) return suited?8:7
    if (lo>=9)  return suited?7:6
    return suited?6:5
  }
  if (hi>=13&&lo>=11) return suited?8:7
  if (hi>=12&&lo>=10) return suited?7:6
  if (gap<=1&&lo>=9)  return suited?7:6
  if (gap<=1&&lo>=7)  return suited?6:5
  if (suited&&gap<=1&&lo>=5) return 5
  if (suited&&gap<=2&&lo>=5) return 4
  if (hi>=10&&gap<=2) return 4
  return Math.max(1, 2.5 - gap*0.3 + (suited?0.5:0))
}
const POS_BONUS: Record<string, number> = {
  'BTN':1.00,'BTN/SB':1.00,'CO':0.88,'HJ':0.78,
  'MP':0.72,'MP+1':0.72,'UTG':0.62,'UTG+1':0.65,'SB':0.70,'BB':0.82,
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
  const rv = cards.map(c => RV[c.rank] ?? 2).sort((a,b)=>b-a)
  const sv = cards.map(c => c.suit)
  const isF = sv.every(s=>s===sv[0])
  const u = [...new Set(rv)].sort((a,b)=>b-a)
  const isS = (u.length===5&&u[0]-u[4]===4)||(u[0]===14&&u[1]===5&&u[2]===4&&u[3]===3&&u[4]===2)
  const cnt: Record<number,number> = {}; rv.forEach(r=>cnt[r]=(cnt[r]??0)+1)
  const cv = Object.values(cnt).sort((a,b)=>b-a)
  let rank=0
  if(isF&&isS) rank=8; else if(cv[0]===4) rank=7; else if(cv[0]===3&&cv[1]===2) rank=6
  else if(isF) rank=5; else if(isS) rank=4; else if(cv[0]===3) rank=3
  else if(cv[0]===2&&cv[1]===2) rank=2; else if(cv[0]===2) rank=1
  return rank*15**5+rv[0]*15**4+rv[1]*15**3+rv[2]*15**2+rv[3]*15+rv[4]
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
function SeatPanel({ seat, style, isWinner, isShowdown, onRebuy, turnSeconds=25 }: {
  seat:Seat; style:React.CSSProperties; isWinner:boolean; isShowdown:boolean; onRebuy?:()=>void; turnSeconds?:number
}) {
  const [bgD,bgL] = LGRAD[seat.level] ?? LGRAD[3]
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
      {/* Hole cards — only the cards are dimmed when folded; name & stack stay readable */}
      <div className={`flex relative mb-0.5 transition-all duration-500 ${seat.isFolded?'opacity-20 grayscale':''}`}
        style={{height:hasCard0||hasCard1?80:0,overflow:'visible',minWidth:80}}>
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

      {/* Info panel */}
      <div className={`relative rounded-2xl border backdrop-blur-md overflow-hidden min-w-[115px] transition-all duration-500
        ${seat.isActive?'border-[#00d4ff]/55 shadow-[0_0_20px_rgba(0,212,255,0.28)]'
        :isWinner?'border-[#c9a227]/80 shadow-[0_0_30px_rgba(201,162,39,0.65)]'
        :isLoser?'border-white/5':'border-white/10'}`}
        style={{background:isLoser?'rgba(0,0,0,0.8)':'rgba(4,10,24,0.94)'}}>
        {seat.isActive&&<div className="h-[2px] bg-gradient-to-r from-transparent via-[#00d4ff] to-transparent"/>}
        {isWinner&&<div className="h-[2px] bg-gradient-to-r from-transparent via-[#c9a227] to-transparent"/>}
        {seat.isSB&&!seat.isDealer&&(
          <span className="absolute -top-2.5 -left-1 w-5 h-5 rounded-full bg-blue-500 text-white text-[7px] font-black flex items-center justify-center shadow z-10">SB</span>
        )}
        {seat.isBB&&(
          <span className="absolute -top-2.5 -left-1 w-5 h-5 rounded-full bg-red-600 text-white text-[7px] font-black flex items-center justify-center shadow z-10">BB</span>
        )}
        {seat.isActive&&(
          <div className="mx-2.5 mt-1.5 h-[3px] rounded-full bg-white/8 overflow-hidden">
            <motion.div className="h-full rounded-full bg-[#00d4ff]"
              initial={{width:'100%'}} animate={{width:'0%'}} transition={{duration:turnSeconds,ease:'linear'}}/>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-1">
          <div className="relative shrink-0 rounded-full"
            style={{boxShadow:seat.isActive?'0 0 0 2px rgba(0,212,255,0.6)':'0 0 0 1px rgba(255,255,255,0.12)'}}>
            <PlayerAvatar spec={avatarForSeat(seat.level, seat.idx, seat.isHero)} size={42}/>
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
function TableSVG() {
  return (
    <svg viewBox="0 0 840 450" width="100%" style={{display:'block'}}>
      <defs>
        <radialGradient id="tF" cx="50%" cy="40%" r="56%">
          <stop offset="0%" stopColor="#116638"/><stop offset="45%" stopColor="#0a5228"/>
          <stop offset="80%" stopColor="#073a1c"/><stop offset="100%" stopColor="#041808"/>
        </radialGradient>
        <radialGradient id="tG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(14,130,60,0.10)"/><stop offset="100%" stopColor="transparent"/>
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
    </svg>
  )
}
function Room() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute inset-0" style={{background:'#0c0907'}}/>
      <div className="absolute inset-x-0 top-0" style={{height:'85%',background:'radial-gradient(ellipse 80% 70% at 50% -8%, rgba(190,120,18,0.5) 0%, rgba(130,75,10,0.22) 38%, transparent 70%)'}}/>
      <div className="absolute top-0 bottom-0 left-0" style={{width:'28%',background:'radial-gradient(ellipse at 0% 42%, rgba(160,90,12,0.32) 0%, transparent 65%)'}}/>
      <div className="absolute top-0 bottom-0 right-0" style={{width:'28%',background:'radial-gradient(ellipse at 100% 42%, rgba(160,90,12,0.32) 0%, transparent 65%)'}}/>
      <div className="absolute inset-0" style={{background:'linear-gradient(90deg, rgba(0,0,0,0.6) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.6) 100%)'}}/>
      <div className="absolute inset-x-0 top-0" style={{height:'30%',background:'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, transparent 100%)'}}/>
      <div className="absolute inset-x-0 bottom-0" style={{height:'22%',background:'linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent 100%)'}}/>
      <div className="absolute inset-0 opacity-[0.06]" style={{backgroundImage:'repeating-linear-gradient(90deg, transparent 0px, transparent 90px, rgba(220,160,60,0.5) 90px, rgba(220,160,60,0.5) 91px)'}}/>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{background:'rgba(255,230,120,0.95)',boxShadow:'0 0 20px 10px rgba(220,170,30,0.55), 0 0 60px 30px rgba(180,110,10,0.3)'}}/>
      <div className="absolute top-1/3 left-10 w-2 h-2 rounded-full" style={{background:'rgba(255,210,100,0.8)',boxShadow:'0 0 15px 8px rgba(200,140,20,0.45)'}}/>
      <div className="absolute top-1/3 right-10 w-2 h-2 rounded-full" style={{background:'rgba(255,210,100,0.8)',boxShadow:'0 0 15px 8px rgba(200,140,20,0.45)'}}/>
    </div>
  )
}

// ─── Hand History Modal ───────────────────────────────────────────────────────
function computeStepState(record: HandHistoryRecord, stepIdx: number): {
  players: Array<HandHistoryRecord['players'][number] & { stack: number }>
  board: (Card|null)[]
  pot: number
  currentPhase: Phase
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

  const bets: Record<number, number> = {}
  players.forEach(p => { bets[p.idx] = 0 })

  for (let i = 0; i <= stepIdx && i < record.actions.length; i++) {
    const a = record.actions[i]
    if (a.seatIdx === -1) {
      // Phase event
      currentPhase = a.phase
      if (a.phase === 'flop') {
        board = [record.board[0], record.board[1], record.board[2], null, null]
      } else if (a.phase === 'turn') {
        board = [record.board[0], record.board[1], record.board[2], record.board[3], null]
      } else if (a.phase === 'river' || a.phase === 'showdown') {
        board = [...record.board]
      }
    } else {
      currentPhase = a.phase
      const p = players.find(x => x.idx === a.seatIdx)
      if (p) {
        if (a.actionType === 'FOLD') {
          p.isFolded = true
        } else if (a.actionType === 'CALL' || a.actionType === 'BET' ||
                   a.actionType === 'RAISE' || a.actionType === 'ALL-IN' ||
                   a.actionType === 'SB' || a.actionType === 'BB') {
          const added = a.amount - (bets[p.idx] ?? 0)
          p.stack -= Math.max(0, added)
          bets[p.idx] = a.amount
          pot = a.potAfter
        } else if (a.actionType === 'CHECK') {
          // no stack change
        }
      }
    }
  }

  return { players, board, pot, currentPhase }
}

function HandHistoryModal({ records, onClose }: {
  records: HandHistoryRecord[]
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<number|null>(records.length > 0 ? records[records.length-1].id : null)
  const [stepIdx, setStepIdx] = useState<number>(0)
  const logRef = useRef<HTMLDivElement>(null)

  const record = records.find(r => r.id === selectedId) ?? null

  useEffect(() => {
    if (record) setStepIdx(record.actions.length - 1)
  }, [selectedId, record])

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
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-lg">
            ✕
          </button>
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
              <div className="relative flex-1 min-h-0" style={{minHeight:380}}>
                {/* Table SVG bg */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div style={{width:'100%',maxWidth:720,opacity:0.75}}>
                    <TableSVG/>
                  </div>
                </div>

                {/* Players */}
                {record.players.map((pl, i) => {
                  const pos = getPlayerPos(i)
                  const stepPl = stepState.players.find(sp => sp.idx === pl.idx)
                  const isFolded = stepPl?.isFolded ?? false
                  const stack = stepPl?.stack ?? pl.startStack
                  const isWinner = isEnd && pl.isWinner
                  const showCards = pl.isHero || isEnd

                  return (
                    <div key={pl.idx}
                      className={`absolute flex flex-col items-center transition-all duration-300 ${isFolded?'opacity-30 grayscale':''}`}
                      style={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                      }}>
                      {/* Cards */}
                      {(pl.holeCards[0] || pl.holeCards[1]) && (
                        <div className="flex gap-0.5 mb-1">
                          {[0,1].map(ci => {
                            const card = pl.holeCards[ci as 0|1]
                            if (!card) return null
                            if (showCards && card) {
                              return <PlayingCard key={ci} rank={card.rank} suit={card.suit as Suit} w={34} h={48}/>
                            }
                            return <FaceDown key={ci} w={28} h={40}/>
                          })}
                        </div>
                      )}
                      {/* Name badge */}
                      <div className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold whitespace-nowrap
                        ${pl.isHero?'border-[#00d4ff]/50 bg-[#00d4ff]/10 text-[#00d4ff]'
                        :isWinner?'border-[#c9a227]/60 bg-[#c9a227]/10 text-[#c9a227]'
                        :'border-white/10 bg-black/40 text-white/70'}`}>
                        {pl.isHero ? 'Vous' : pl.name}
                      </div>
                      <div className="text-[10px] font-bold text-emerald-300/90 font-mono mt-0.5">${stack}</div>
                      {isWinner && <div className="text-base">🏆</div>}
                    </div>
                  )
                })}

                {/* Board cards */}
                <div className="absolute left-1/2 -translate-x-1/2" style={{top:'42%',transform:'translate(-50%,-50%)'}}>
                  <div className="flex gap-1.5 items-center">
                    {stepState.board.map((card, i) => (
                      <div key={i}>
                        {card
                          ? <PlayingCard rank={card.rank} suit={card.suit as Suit} w={46} h={64}/>
                          : <EmptySlot w={46} h={64}/>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pot */}
                <div className="absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-1.5 bg-black/65 border border-[#c9a227]/30 rounded-lg px-3 py-1">
                    <span className="text-[10px] text-white/45 uppercase tracking-wide">Pot</span>
                    <span className="text-sm font-bold text-[#c9a227] font-mono">${stepState.pot}</span>
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
  const slots = cfg.slots ?? Array.from({length: numPlayers - 1}, () => ({type:'bot', level:3}))
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
  const [showLog, setShowLog] = useState(false)
  const [sitOut, setSitOut] = useState(false)
  const [rebuyAmt, setRebuyAmt] = useState(stackBB * bbAmt)
  // Pre-action ("check box") queued while waiting for the hero's turn.
  const [preAction, setPreActionState] = useState<'none' | 'fold' | 'checkcall'>('none')
  const preActionRef = useRef<'none' | 'fold' | 'checkcall'>('none')
  function setPreAction(v: 'none' | 'fold' | 'checkcall') { preActionRef.current = v; setPreActionState(v) }

  const gsRef = useRef<GState>(gs)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextHandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dealTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const sitOutRef = useRef(false)
  const chipIdRef = useRef(0)
  const currentHandActionsRef = useRef<HistoryAction[]>([])
  const handStartStacksRef = useRef<Record<number, number>>({})
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => { gsRef.current = gs }, [gs])

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
      })),
      board: finalGs.community,
      actions: [...currentHandActionsRef.current],
      finalPot: finalGs.pot,
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
    if (n < 2) return { sbIdx: dealerIdx, bbIdx: dealerIdx }
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

      if (isHero) {
        name = displayName
        level = 0
      } else {
        const slotIdx = i < selectedSeat ? i : i - 1
        const slot = slots[slotIdx] ?? { type: 'bot', level: 3 }
        level = slot.level ?? 3
        const pool = botNames[level as keyof typeof botNames] ?? botNames[3]
        const available = pool.filter(n => !usedNames.has(n))
        name = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : `Bot ${i + 1}`
        usedNames.add(name)
      }

      return {
        idx: i, name, isHero, stack, level,
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
    return prepared.map((s, i) => ({
      ...s,
      isDealer: i === dealerIdx,
      isSB: i === sbIdx,
      isBB: i === bbIdx,
      position: positions[i] ?? `S${i+1}`,
      holeCards: [null, null],
      bet: 0, totalBet: 0,
      isFolded: s.isSittingOut, isAllIn: false,
      isActive: false, lastAction: null,
      cardsFaceUp: s.isHero && !s.isSittingOut,
      handStrength: undefined, handScore: undefined, isWinner: undefined,
    }))
  }

  // ─── Bot AI ──────────────────────────────────────────────────────────────
  function decideBotAction(seat: Seat, state: GState): { action: string; amount: number } {
    const lvl = seat.level
    const c1 = seat.holeCards[0], c2 = seat.holeCards[1]
    if (!c1 || !c2) return { action: 'FOLD', amount: 0 }

    const pStrength = preflopStrength(c1, c2)
    const posBonus = POS_BONUS[seat.position] ?? 0.75
    const toCall = state.currentBet - seat.bet
    const potOdds = state.pot > 0 ? toCall / (state.pot + toCall) : 0
    const eff = pStrength * posBonus
    const board = state.community.filter(Boolean) as Card[]
    const postStrength = board.length >= 3
      ? bestHand([...(seat.holeCards.filter(Boolean) as Card[]), ...board]).score / (15**5 * 9)
      : eff / 10
    const strength = board.length >= 3 ? postStrength : eff / 10

    const rand = Math.random()

    // Sizing helpers — all return a TARGET total bet ("raise to") in chips,
    // rounded to the big blind, never below the legal minimum, never above
    // the bot's all-in cap. executeAction re-clamps as a final safety net.
    const minTo = state.currentBet + state.minRaise
    const allInTo = seat.bet + seat.stack
    const roundBB = (x: number) => Math.max(bbAmt, Math.round(x / bbAmt) * bbAmt)
    const betTo = (frac: number) => Math.min(allInTo, roundBB(state.pot * frac))
    const raiseTo = (frac: number) =>
      Math.min(allInTo, Math.max(minTo, state.currentBet + roundBB((state.pot + toCall) * frac)))

    if (lvl <= 1) {
      // Level 1 — loose passive fish
      if (toCall === 0) return rand < 0.15 ? { action: 'BET', amount: betTo(0.5) } : { action: 'CHECK', amount: 0 }
      if (strength > 0.6) return rand < 0.3 ? { action: 'RAISE', amount: raiseTo(0.7) } : { action: 'CALL', amount: toCall }
      if (strength > 0.3 || rand < 0.55) return { action: 'CALL', amount: toCall }
      return { action: 'FOLD', amount: 0 }
    }

    if (lvl === 2) {
      // Level 2 — recreational calling station
      if (toCall === 0) return rand < 0.2 ? { action: 'BET', amount: betTo(0.6) } : { action: 'CHECK', amount: 0 }
      if (strength > 0.7) return { action: 'RAISE', amount: raiseTo(0.7) }
      if (strength > potOdds + 0.05 || rand < 0.4) return { action: 'CALL', amount: toCall }
      return { action: 'FOLD', amount: 0 }
    }

    if (lvl === 3) {
      // Level 3 — solid TAG
      if (toCall === 0) {
        if (strength > 0.65) return { action: 'BET', amount: betTo(0.65) }
        return { action: 'CHECK', amount: 0 }
      }
      if (strength > 0.75) return { action: 'RAISE', amount: raiseTo(0.6 + rand * 0.4) }
      if (strength > potOdds + 0.1) return { action: 'CALL', amount: toCall }
      if (rand < 0.08) return { action: 'RAISE', amount: raiseTo(0.7) } // bluff
      return { action: 'FOLD', amount: 0 }
    }

    if (lvl === 4) {
      // Level 4 — advanced aggressive
      if (toCall === 0) {
        if (strength > 0.55 || rand < 0.28) return { action: 'BET', amount: betTo(0.5 + rand * 0.5) }
        return { action: 'CHECK', amount: 0 }
      }
      if (strength > 0.7) return { action: 'RAISE', amount: raiseTo(0.7 + rand * 0.3) }
      if (strength > potOdds || rand < 0.18) return { action: 'CALL', amount: toCall }
      if (rand < 0.12) return { action: 'RAISE', amount: raiseTo(0.85) } // bluff/semi-bluff
      return { action: 'FOLD', amount: 0 }
    }

    // Level 5 — GTO-ish
    if (toCall === 0) {
      const betFreq = 0.4 + strength * 0.5
      if (rand < betFreq) return { action: 'BET', amount: betTo(0.33 + rand * 0.67) }
      return { action: 'CHECK', amount: 0 }
    }
    const raiseFreq = strength > 0.7 ? 0.55 : 0.15
    if (rand < raiseFreq) return { action: 'RAISE', amount: raiseTo(0.5 + rand * 0.5) }
    const callFreq = strength > potOdds ? 0.75 + strength * 0.2 : 0.2
    if (rand < callFreq) return { action: 'CALL', amount: toCall }
    return { action: 'FOLD', amount: 0 }
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
    const aggressive = stateAfter.currentBet > prev.currentBet
    if (!aggressive) return stateAfter.actQueue.slice(1)
    const seats = stateAfter.seats
    const active = seats
      .filter(s => !s.isFolded && !s.isAllIn && !s.isEliminated && s.stack > 0 && s.idx !== actedIdx)
      .map(s => s.idx)
    const sorted: number[] = []
    for (let i = 1; i <= seats.length; i++) {
      const idx = (actedIdx + i) % seats.length
      if (active.includes(idx)) sorted.push(idx)
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
      setTimeout(() => showdown(gsRef.current), 650)
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
    setTimeout(() => {
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

    // Nobody can act (everyone all-in) → run the rest of the board out.
    if (queue.length === 0) {
      if (state.phase === 'river') setTimeout(() => showdown(state), 400)
      else {
        const nextPhase: Phase =
          state.phase === 'preflop' ? 'flop' :
          state.phase === 'flop' ? 'turn' :
          state.phase === 'turn' ? 'river' : 'showdown'
        dealCommunity(state, nextPhase)
      }
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

    // Reveal all hole cards
    const seatsRevealed = state.seats.map(s => ({
      ...s,
      cardsFaceUp: !s.isFolded,
      isActive: false,
    }))

    // Compute hand strengths
    const board = state.community.filter(Boolean) as Card[]
    const evaluated = seatsRevealed.map(s => {
      if (s.isFolded || !s.holeCards[0] || !s.holeCards[1]) return { ...s }
      const allCards = [...(s.holeCards.filter(Boolean) as Card[]), ...board]
      const { score, name } = bestHand(allCards)
      return { ...s, handScore: score, handStrength: name }
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

    const finalSeats = evaluated.map(s => ({
      ...s,
      stack: s.stack + (payouts[s.idx] ?? 0),
      isWinner: winnerSet.has(s.idx),
      isEliminated: s.stack + (payouts[s.idx] ?? 0) === 0 && !s.isHero,
    }))

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
    if (state.paused) return

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

    // Check if only one player left
    const activePlayers = state.seats.filter(s => !s.isFolded && !s.isEliminated)
    if (activePlayers.length === 1) {
      foldWin(activePlayers[0].idx, { ...state, actQueue: [] })
      return
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
      const { action, amount } = decideBotAction(botSeat, cur)
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
    pot += sbPost

    const bbPost = Math.min(bbAmt, bbSeat.stack)
    bbSeat.stack -= bbPost; bbSeat.bet = bbPost; bbSeat.totalBet += bbPost
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

    setGs(newState); gsRef.current = newState
    scheduleAutoNext(newState, 400)
  }

  // ─── Bot style label ─────────────────────────────────────────────────────
  function botStyle(level: number): string {
    return ['','Fish','Récréatif','TAG','Avancé','GTO'][level] ?? 'Bot'
  }

  // ─── Derived state ───────────────────────────────────────────────────────
  const hero = gs.seats.find(s => s.isHero)
  const isHeroTurn = hero?.isActive ?? false
  const heroBusted = !!hero && hero.stack <= 0
  const heroOut = !!hero && hero.isSittingOut          // actually dealt out this hand
  const sitOutPending = sitOut && !heroOut             // queued for the next hand
  const isShowdown = gs.phase === 'showdown'
  // Hero is live in the current hand (has cards, not folded/out) — used to show
  // the pre-action check boxes while waiting for other players.
  const heroInHand = !!hero && !hero.isFolded && !hero.isSittingOut && !heroBusted
    && (hero.holeCards[0] !== null || hero.holeCards[1] !== null)
    && gs.phase !== 'idle' && gs.phase !== 'dealing' && gs.phase !== 'showdown'
  const preCanCheck = !!hero && gs.currentBet <= hero.bet          // no bet to call → check
  const preCallAmt = hero ? Math.min(gs.currentBet - hero.bet, hero.stack) : 0
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

  // Decision clock: when the hero's time runs out, auto-act. Facing a bet that
  // must be called/raised → auto-fold and sit out next hand. Otherwise (a free
  // check is available) → auto-check and the hand continues normally.
  useEffect(() => {
    if (!isHeroTurn || gs.paused) return
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
  }, [isHeroTurn, gs.paused, gs.handNum, gs.currentBet])

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
        <button onClick={() => navigate('/training')}
          className="app-drag-none flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={15}/>
          <span className="text-[10px] uppercase tracking-widest font-bold">Quitter</span>
        </button>
        <div className="h-4 w-px bg-white/10"/>
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

        {/* History button */}
        {handHistory.length > 0 && (
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
        <Room/>

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
        <div ref={tableRef} className="absolute inset-0 flex items-center justify-center p-2">
          <div className="relative w-full h-full" style={{maxWidth:1240,maxHeight:700}}>

            {/* Table SVG */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{padding:'18px 28px'}}>
              <div style={{width:'100%',maxWidth:1120}}>
                <TableSVG/>
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

            {/* Pot display (collected pot only — live bets are shown in front of players) */}
            {gs.phase !== 'idle' && collectedPot > 0 && (
              <div className="absolute left-1/2 -translate-x-1/2" style={{top:`${POT_POS.y}%`,transform:'translate(-50%,-50%)'}}>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/70 border border-[#c9a227]/30 backdrop-blur-sm">
                  <ChipStack amount={collectedPot} sz={20} maxVisible={6}/>
                  <div className="flex flex-col leading-none">
                    <span className="text-[7px] text-white/40 uppercase tracking-widest">Pot</span>
                    <span className="text-[12px] font-bold text-[#c9a227] font-mono">${collectedPot.toLocaleString()}</span>
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
                  onRebuy={seat.isEliminated ? () => rebuyPlayer(seat.idx) : undefined}
                />
              )
            })}

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

          {/* Action buttons */}
          <div className="flex items-center gap-3 px-4 py-3">
            {heroBusted ? (
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
                  Fold
                </motion.button>

                {/* Check / Call */}
                {canCheck ? (
                  <motion.button whileTap={{scale:0.95}}
                    onClick={() => heroAction('CHECK')}
                    className="flex-1 py-2.5 rounded-xl border border-sky-700/40 bg-sky-900/20 text-sky-400 font-bold text-sm uppercase tracking-widest hover:bg-sky-900/35 transition-all">
                    Check
                  </motion.button>
                ) : (
                  <motion.button whileTap={{scale:0.95}}
                    onClick={() => heroAction('CALL', callAmt)}
                    className="flex-1 py-2.5 rounded-xl border border-emerald-700/40 bg-emerald-900/20 text-emerald-400 font-bold text-sm uppercase tracking-widest hover:bg-emerald-900/35 transition-all">
                    Call ${callAmt.toLocaleString()}
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
                        {[0.33, 0.5, 0.75, 1, 1.5].map(mult => {
                          const base = gs.currentBet + Math.round((gs.pot + callAmt) * mult / bbAmt) * bbAmt
                          const amt = clampRaise(base)
                          if (amt >= heroMaxTo && mult > 0.33) return null
                          return (
                            <button key={mult} onClick={() => setHeroBetAmt(amt)}
                              className="px-1.5 py-0.5 rounded text-[7px] font-bold bg-white/5 border border-white/10 text-white/40 hover:text-[#c9a227] hover:border-[#c9a227]/30 transition-all">
                              {mult >= 1 ? `${mult}P` : `${Math.round(mult*100)}%`}
                            </button>
                          )
                        })}
                        <button onClick={() => setHeroBetAmt(heroMaxTo)}
                          className="px-1.5 py-0.5 rounded text-[7px] font-bold bg-purple-900/20 border border-purple-700/30 text-purple-400 hover:bg-purple-900/30 transition-all">
                          Max
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
                    All-in
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
                <span className="text-[7px] text-white/25 italic">{botStyle(s.level)}</span>
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

      {/* ── HAND HISTORY MODAL ── */}
      <AnimatePresence>
        {historyOpen && handHistory.length > 0 && (
          <HandHistoryModal records={handHistory} onClose={() => setHistoryOpen(false)}/>
        )}
      </AnimatePresence>

    </div>
  )
}
