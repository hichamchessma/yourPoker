import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, Star, Zap, Crown, Shield, RotateCcw } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import WindowControls from '../components/layout/WindowControls'
import { Bell, Search, ChevronDown } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────
type SlotType = 'bot' | 'human' | 'empty'
interface Slot { type: SlotType; level: number }

const BOT_LEVELS = [
  { level: 1, name: 'Amateur', color: '#22cc44', desc: 'Récréatif : appelle trop, passif, bluffe rarement' },
  { level: 2, name: 'Pro',     color: '#f0d060', desc: 'Solide & agressif : value-bet, c-bet, respecte les ranges' },
  { level: 3, name: 'Expert',  color: '#ff4444', desc: 'Très agressif, bluffs équilibrés, redoutable' },
]

const POS_LABELS: Record<number, string[]> = {
  2: ['BTN/SB','BB'],
  3: ['BTN','SB','BB'],
  4: ['BTN','SB','BB','UTG'],
  5: ['BTN','SB','BB','UTG','CO'],
  6: ['BTN','SB','BB','UTG','HJ','CO'],
  7: ['BTN','SB','BB','UTG','UTG+1','HJ','CO'],
  8: ['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO'],
  9: ['BTN','SB','BB','UTG','UTG+1','MP','MP+1','HJ','CO'],
}

const PRESETS = [
  { icon: '💵', name: 'Cash Game',       players: 6, stack: 100, sb: 1,  bb: 2,  bots: [2,2,2,2,2], desc: 'Setup 6-max standard' },
  { icon: '🏆', name: 'Final Table',     players: 9, stack: 50,  sb: 5,  bb: 10, bots: [2,2,2,3,3,2,2,3], desc: '9 joueurs tournoi' },
  { icon: '⚔️', name: 'Heads-Up',        players: 2, stack: 200, sb: 1,  bb: 2,  bots: [3], desc: 'Duel vs Expert' },
  { icon: '🔥', name: 'Battle Zone',     players: 6, stack: 50,  sb: 2,  bb: 4,  bots: [3,3,3,3,3], desc: 'Défi ultime vs Experts' },
  { icon: '🎓', name: 'École du Poker',  players: 6, stack: 100, sb: 1,  bb: 2,  bots: [1,1,2,2,3], desc: 'Bots mixtes pour s\'exercer' },
  { icon: '🤠', name: 'Wild West',       players: 9, stack: 30,  sb: 1,  bb: 2,  bots: [1,1,2,2,3,3,1,2], desc: 'Tables chaotiques' },
]

// ── Poker Table SVG ───────────────────────────────────────────────
function PokerTable({
  numPlayers, selectedSeat, slots, onSeatClick
}: {
  numPlayers: number
  selectedSeat: number
  slots: Slot[]
  onSeatClick: (i: number) => void
}) {
  const cx = 150, cy = 106
  const seatRx = 128, seatRy = 90

  const positions = Array.from({ length: numPlayers }, (_, i) => {
    const angle = (i * 2 * Math.PI / numPlayers) + Math.PI / 2
    return { x: cx + seatRx * Math.cos(angle), y: cy + seatRy * Math.sin(angle) }
  })

  const labels = POS_LABELS[numPlayers] || POS_LABELS[6]

  return (
    <svg viewBox="0 0 300 226" className="w-full h-full drop-shadow-2xl">
      <defs>
        <radialGradient id="felt" cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor="#0e5530"/>
          <stop offset="65%" stopColor="#083d20"/>
          <stop offset="100%" stopColor="#041a0e"/>
        </radialGradient>
        <radialGradient id="feltShine" cx="40%" cy="30%" r="55%">
          <stop offset="0%" stopColor="white" stopOpacity="0.06"/>
          <stop offset="100%" stopColor="white" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="rimGold" cx="50%" cy="25%" r="65%">
          <stop offset="0%" stopColor="#e8c840"/>
          <stop offset="55%" stopColor="#c9a227"/>
          <stop offset="100%" stopColor="#7a5508"/>
        </radialGradient>
        <filter id="tShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#000" floodOpacity="0.7"/>
        </filter>
        <filter id="sGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Shadow */}
      <ellipse cx={cx} cy={cy+14} rx={118} ry={52} fill="black" opacity="0.55"/>

      {/* Outer wood rim */}
      <ellipse cx={cx} cy={cy} rx={120} ry={76} fill="#3a2408"/>
      {/* Gold rim */}
      <ellipse cx={cx} cy={cy} rx={116} ry={72} fill="url(#rimGold)" filter="url(#tShadow)"/>
      {/* Inner rail */}
      <ellipse cx={cx} cy={cy} rx={109} ry={65} fill="#1a0e04"/>
      {/* Felt */}
      <ellipse cx={cx} cy={cy} rx={105} ry={62} fill="url(#felt)"/>
      <ellipse cx={cx} cy={cy} rx={105} ry={62} fill="url(#feltShine)"/>
      {/* Inner ring decoration */}
      <ellipse cx={cx} cy={cy} rx={90} ry={50} fill="none" stroke="rgba(201,162,39,0.18)" strokeWidth="0.8"/>
      {/* Center logo */}
      <text x={cx} y={cy-6} textAnchor="middle" fill="rgba(201,162,39,0.12)" fontSize="32" fontFamily="serif">♠</text>
      <text x={cx} y={cy+14} textAnchor="middle" fill="rgba(201,162,39,0.08)" fontSize="9" fontFamily="monospace" letterSpacing="3">POKER ELITE</text>

      {/* Seats */}
      {positions.map((pos, i) => {
        const isPlayer = i === selectedSeat
        const slotIdx = i < selectedSeat ? i : i - 1
        const slot: Slot = isPlayer ? { type: 'bot', level: 1 } : (slots[slotIdx] ?? { type: 'empty', level: 1 })
        const isEmpty = !isPlayer && slot.type === 'empty'
        const botColor = slot.type === 'bot' ? (BOT_LEVELS[slot.level - 1]?.color ?? '#f0d060') : '#44aaff'
        const borderColor = isPlayer ? '#00d4ff' : isEmpty ? 'rgba(255,255,255,0.12)' : botColor
        const fillColor = isPlayer ? 'rgba(0,212,255,0.22)' : isEmpty ? 'rgba(255,255,255,0.04)' : 'rgba(10,20,35,0.8)'
        const lbl = labels[i] ?? `S${i + 1}`

        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={() => onSeatClick(i)}>
            {isPlayer && <circle cx={pos.x} cy={pos.y} r={22} fill="rgba(0,212,255,0.1)" filter="url(#sGlow)"/>}
            <circle cx={pos.x} cy={pos.y} r={17} fill={fillColor} stroke={borderColor} strokeWidth={isPlayer ? 2.2 : 1.5}/>
            {isPlayer && (
              <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#00d4ff" fontSize="12" fontWeight="bold">YOU</text>
            )}
            {!isPlayer && slot.type === 'bot' && (
              <>
                <circle cx={pos.x} cy={pos.y} r={9} fill="rgba(0,0,0,0.35)"/>
                <text x={pos.x} y={pos.y - 2} textAnchor="middle" fill={botColor} fontSize="7" fontWeight="bold">BOT</text>
                <text x={pos.x} y={pos.y + 7} textAnchor="middle" fill={botColor} fontSize="8" fontWeight="bold">{slot.level}</text>
              </>
            )}
            {!isPlayer && slot.type === 'human' && (
              <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#44aaff" fontSize="11">👤</text>
            )}
            {isEmpty && (
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize="14">+</text>
            )}
            <text x={pos.x} y={pos.y + 30} textAnchor="middle" fill={isPlayer ? '#00d4ff' : 'rgba(255,255,255,0.35)'} fontSize="7" fontFamily="monospace">{lbl}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Main Page ──────────────────────────────────────────────────────
export default function TrainingSetupPage(): JSX.Element {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Joueur'
  const avatarUrl = user?.user_metadata?.avatar_url || null

  const [activeTab, setActiveTab] = useState(0)
  const [numPlayers, setNumPlayers] = useState(6)
  const [selectedSeat, setSelectedSeat] = useState(0)
  const [stackBB, setStackBB] = useState(100)
  const [sb, setSb] = useState(1)
  const [bb, setBb] = useState(2)
  const [ante, setAnte] = useState(0)
  const [decisionTimer, setDecisionTimer] = useState(30)
  const [gameVariant, setGameVariant] = useState<'NLH'|'PLO'|'PLO5'>('NLH')
  const [gameSpeed, setGameSpeed] = useState<'slow'|'normal'|'fast'>('normal')
  const [anonymousMode, setAnonymousMode] = useState(false)
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: 8 }, (_, i) => ({ type: i < 5 ? 'bot' : 'empty', level: 2 } as Slot))
  )

  const stackChips = stackBB * bb

  // Bug fix: clamp selectedSeat whenever numPlayers decreases
  useEffect(() => {
    setSelectedSeat(s => Math.min(s, numPlayers - 1))
  }, [numPlayers])

  const updateSlot = (idx: number, update: Partial<Slot>) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...update } : s))

  const applyPreset = (p: typeof PRESETS[0]) => {
    setNumPlayers(p.players)
    setSelectedSeat(0) // Bug fix: reset seat on preset change
    setStackBB(p.stack)
    setSb(p.sb)
    setBb(p.bb)
    setSlots(prev => prev.map((_s, i) => {
      const lvl = p.bots[i]
      if (lvl !== undefined) return { type: 'bot', level: lvl }
      return { type: 'empty', level: 3 }
    }))
  }

  const activeCount = useMemo(() => {
    let c = 1
    for (let i = 0; i < numPlayers - 1; i++) if (slots[i]?.type !== 'empty') c++
    return c
  }, [slots, numPlayers])

  const labels = POS_LABELS[numPlayers] ?? POS_LABELS[6]
  // Bug fix: clamp index defensively in case selectedSeat is briefly stale
  const safeSelectedSeat = Math.min(selectedSeat, numPlayers - 1)
  const myPosition = labels[safeSelectedSeat] ?? 'BTN'

  const TABS = ['JOUEURS', 'STACK & BLINDES', 'OPPOSANTS & BOT', 'RÉGLAGES']

  return (
    <div className="flex flex-col h-full bg-poker-darker overflow-hidden">

      {/* ── HEADER ── */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-poker-border flex-shrink-0 relative" style={{ background: 'rgba(6,11,20,0.95)' }}>
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-full bg-poker-gold/20 border border-poker-gold/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-poker-gold"><path d="M12 2C8 6 4 8 4 12c0 2.5 1.5 4 3.5 4 .8 0 1.5-.2 2.1-.6L9 17H7v2h10v-2h-2l-.6-1.6c.6.4 1.3.6 2.1.6 2 0 3.5-1.5 3.5-4 0-4-4-6-8-10z"/></svg>
          </div>
          <div>
            <span className="font-display font-bold text-white text-sm tracking-wider uppercase">Poker Elite </span>
            <span className="font-display font-bold text-poker-teal text-sm tracking-wider uppercase">Coach</span>
          </div>
        </div>
        <div className="flex-1 max-w-sm relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"/>
          <input placeholder="Recherche au global" className="w-full bg-white/5 border border-white/8 rounded-lg pl-9 pr-4 py-2 text-xs text-white/70 placeholder-white/25 focus:outline-none focus:border-poker-teal/40"/>
        </div>
        <div className="flex-1"/>
        <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
          <Bell size={18} className="text-white/50"/>
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"/>
        </button>
        <div className="flex items-center gap-2 pl-2 border-l border-white/10 cursor-pointer">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-poker-gold/30 flex-shrink-0">
            {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover"/> : (
              <div className="w-full h-full bg-poker-gold/20 flex items-center justify-center">
                <span className="text-poker-gold font-bold text-sm">{displayName[0].toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-white/90 leading-tight">{displayName}</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-poker-gold/20 text-poker-gold font-bold uppercase tracking-wide">PRO+</span>
          </div>
          <ChevronDown size={14} className="text-white/30"/>
        </div>
        <WindowControls/>
      </header>

      {/* ── CONTENT ── */}
      <div className="flex-1 flex overflow-hidden p-4 gap-4 min-h-0">

        {/* ── LEFT: TABLE + PRESETS ── */}
        <div className="w-[300px] flex-shrink-0 flex flex-col gap-3 min-h-0">

          {/* Table */}
          <div className="flex-1 glass-card overflow-hidden relative flex flex-col min-h-0">
            <div className="p-3 border-b border-white/5 flex-shrink-0">
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest text-center">Aperçu de votre table</p>
            </div>
            <div className="flex-1 p-2 min-h-0">
              <PokerTable
                numPlayers={numPlayers}
                selectedSeat={safeSelectedSeat}
                slots={slots}
                onSeatClick={setSelectedSeat}
              />
            </div>
            <div className="p-2 border-t border-white/5 flex items-center justify-between flex-shrink-0">
              <span className="text-[10px] text-white/30 uppercase tracking-wide">Cliquez un siège pour vous placer</span>
              <span className="text-[10px] font-bold text-poker-teal">{myPosition}</span>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="glass-card p-3 flex-shrink-0">
            <p className="text-[10px] font-bold text-poker-gold/70 uppercase tracking-widest mb-2">⚡ Quick Setup</p>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map(p => (
                <motion.button key={p.name} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  onClick={() => applyPreset(p)}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/3 border border-white/8 hover:border-poker-gold/30 hover:bg-poker-gold/5 transition-all">
                  <span className="text-base">{p.icon}</span>
                  <span className="text-[9px] font-bold text-white/60 leading-tight text-center">{p.name}</span>
                </motion.button>
              ))}
            </div>
          </div>
        </div>

        {/* ── CENTER: CONFIG ── */}
        <div className="flex-1 flex flex-col min-w-0 gap-3">

          {/* Title */}
          <div className="text-center flex-shrink-0">
            <h1 className="font-display font-bold text-xl tracking-[0.2em] uppercase" style={{ color: '#c9a227', textShadow: '0 0 30px rgba(201,162,39,0.4)' }}>
              Créer Votre Table de Rêve
            </h1>
            <p className="text-white/30 text-[10px] mt-0.5 tracking-wider uppercase">Configurez chaque détail pour une session sur mesure</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 bg-white/4 rounded-xl p-1 flex-shrink-0">
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setActiveTab(i)}
                className={`flex-1 py-2 px-2 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
                  activeTab === i
                    ? 'bg-poker-gold/20 text-poker-gold border border-poker-gold/30'
                    : 'text-white/35 hover:text-white/60'
                }`}>{t}</button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 glass-card overflow-y-auto min-h-0">
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="p-4 h-full">

                {/* TAB 0 — JOUEURS */}
                {activeTab === 0 && (
                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-3">Nombre de joueurs</p>
                      <div className="flex items-center gap-3">
                        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setNumPlayers(n => Math.max(2, n - 1))}
                          className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                          <Minus size={14} className="text-white/60"/>
                        </motion.button>
                        <div className="flex-1 flex gap-2">
                          {[2,3,4,5,6,7,8,9].map(n => (
                            <motion.button key={n} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
                              onClick={() => setNumPlayers(n)}
                              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                                numPlayers === n
                                  ? 'bg-poker-gold/25 text-poker-gold border border-poker-gold/50'
                                  : 'bg-white/4 text-white/40 border border-white/8 hover:border-white/20'
                              }`}>{n}</motion.button>
                          ))}
                        </div>
                        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setNumPlayers(n => Math.min(9, n + 1))}
                          className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                          <Plus size={14} className="text-white/60"/>
                        </motion.button>
                      </div>
                      <div className="mt-2 text-center">
                        <span className="text-[10px] text-white/30">{numPlayers === 2 ? 'Heads-Up' : numPlayers <= 3 ? 'Short-Handed' : numPlayers <= 6 ? '6-Max' : 'Full Ring'}</span>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-3">Sélection de siège</p>
                      <div className="grid grid-cols-5 gap-2">
                        {Array.from({ length: numPlayers }, (_, i) => {
                          const lbl = (POS_LABELS[numPlayers] || POS_LABELS[6])[i]
                          return (
                            <motion.button key={i} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                              onClick={() => setSelectedSeat(i)}
                              className={`p-2 rounded-lg border text-center transition-all ${
                                safeSelectedSeat === i
                                  ? 'bg-poker-teal/20 border-poker-teal text-poker-teal'
                                  : 'bg-white/4 border-white/10 text-white/40 hover:border-white/25'
                              }`}>
                              <div className="text-xs font-bold">{i + 1}</div>
                              <div className="text-[9px] mt-0.5">{lbl}</div>
                            </motion.button>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-white/30 mt-3 text-center">Ou cliquez directement sur la table à gauche</p>
                    </div>

                    <div className="bg-poker-teal/8 border border-poker-teal/20 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-poker-teal/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-poker-teal text-sm">📍</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-poker-teal">Votre position : {myPosition}</p>
                        <p className="text-[10px] text-white/40 mt-0.5">Siège {safeSelectedSeat + 1} sur {numPlayers} joueurs</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 1 — STACK & BLINDES */}
                {activeTab === 1 && (
                  <div className="space-y-5">
                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-3">Stack initial</p>
                      <div className="grid grid-cols-5 gap-2 mb-3">
                        {[20, 50, 100, 200, 500].map(bb_cnt => (
                          <motion.button key={bb_cnt} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                            onClick={() => setStackBB(bb_cnt)}
                            className={`py-2 rounded-lg border text-center text-xs font-bold transition-all ${
                              stackBB === bb_cnt
                                ? 'bg-poker-gold/25 border-poker-gold text-poker-gold'
                                : 'bg-white/4 border-white/10 text-white/40 hover:border-white/25'
                            }`}>
                            {bb_cnt}BB
                          </motion.button>
                        ))}
                      </div>
                      <div className="bg-white/4 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <p className="text-xl font-bold text-white">{stackChips.toLocaleString()}</p>
                          <p className="text-[10px] text-white/40">chips ({stackBB} BB)</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setStackBB(n => Math.min(500, n + 10))}
                            className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
                            <Plus size={14} className="text-white/60"/>
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setStackBB(n => Math.max(10, n - 10))}
                            className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
                            <Minus size={14} className="text-white/60"/>
                          </motion.button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Small Blind', val: sb, set: setSb, step: 0.5 },
                        { label: 'Big Blind', val: bb, set: setBb, step: 1 },
                        { label: 'Ante', val: ante, set: setAnte, step: 0.5 },
                      ].map(({ label, val, set, step }) => (
                        <div key={label} className="bg-white/4 rounded-xl p-3">
                          <p className="text-[9px] text-white/40 uppercase tracking-wide mb-2">{label}</p>
                          <div className="flex items-center justify-between gap-1">
                            <button onClick={() => set((v: number) => Math.max(0, +(v - step).toFixed(1)))}
                              className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
                              <Minus size={10} className="text-white/60"/>
                            </button>
                            <span className="text-sm font-bold text-poker-gold">{val}</span>
                            <button onClick={() => set((v: number) => +(v + step).toFixed(1))}
                              className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
                              <Plus size={10} className="text-white/60"/>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="bg-poker-gold/6 border border-poker-gold/15 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
                      <div><p className="text-[9px] text-white/35 uppercase tracking-wide">Stack</p><p className="text-sm font-bold text-poker-gold">{stackChips.toLocaleString()}</p></div>
                      <div><p className="text-[9px] text-white/35 uppercase tracking-wide">BB</p><p className="text-sm font-bold text-white/70">{bb}</p></div>
                      <div><p className="text-[9px] text-white/35 uppercase tracking-wide">Ratio</p><p className="text-sm font-bold text-white/70">{stackBB} BB</p></div>
                    </div>
                  </div>
                )}

                {/* TAB 2 — OPPOSANTS & BOT */}
                {activeTab === 2 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">
                        Configurez {numPlayers - 1} adversaire{numPlayers > 2 ? 's' : ''}
                      </p>
                      <button onClick={() => setSlots(prev => prev.map((s, i) => i < numPlayers - 1 ? { ...s, type: 'bot', level: 2 } : { type: 'empty', level: 2 }))}
                        className="flex items-center gap-1 text-[9px] text-white/30 hover:text-white/60 transition-colors">
                        <RotateCcw size={10}/> Reset
                      </button>
                    </div>

                    {Array.from({ length: numPlayers - 1 }, (_, i) => {
                      const slot = slots[i] ?? { type: 'empty', level: 3 }
                      const seatIdx = i < safeSelectedSeat ? i : i + 1
                      const posLbl = (POS_LABELS[numPlayers] || POS_LABELS[6])[seatIdx] || `S${seatIdx + 1}`
                      const botCfg = BOT_LEVELS[slot.level - 1]

                      return (
                        <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                            style={{ borderColor: slot.type === 'empty' ? 'rgba(255,255,255,0.12)' : slot.type === 'bot' ? botCfg?.color : '#44aaff', color: slot.type === 'empty' ? 'rgba(255,255,255,0.2)' : slot.type === 'bot' ? botCfg?.color : '#44aaff', background: 'rgba(0,0,0,0.3)' }}>
                            {posLbl}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex gap-1.5 mb-1.5">
                              {(['bot','human','empty'] as SlotType[]).map(t => (
                                <button key={t} onClick={() => updateSlot(i, { type: t })}
                                  className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-all ${
                                    slot.type === t
                                      ? t === 'bot' ? 'bg-poker-gold/25 text-poker-gold border border-poker-gold/40'
                                        : t === 'human' ? 'bg-blue-500/25 text-blue-300 border border-blue-500/40'
                                        : 'bg-white/10 text-white/50 border border-white/20'
                                      : 'text-white/25 hover:text-white/50 border border-transparent'
                                  }`}>
                                  {t === 'bot' ? '🤖 Bot' : t === 'human' ? '👤 Humain' : '— Vide'}
                                </button>
                              ))}
                            </div>
                            {slot.type === 'bot' && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-white/30">Niveau:</span>
                                {BOT_LEVELS.map(b => (
                                  <button key={b.level} onClick={() => updateSlot(i, { level: b.level })}
                                    className="w-5 h-5 rounded text-[9px] font-bold transition-all"
                                    style={{ background: slot.level === b.level ? b.color + '33' : 'rgba(255,255,255,0.05)', color: b.color, border: `1px solid ${slot.level === b.level ? b.color : 'transparent'}` }}>
                                    {b.level}
                                  </button>
                                ))}
                                <span className="text-[9px] ml-1" style={{ color: botCfg?.color }}>{botCfg?.name}</span>
                              </div>
                            )}
                            {slot.type === 'bot' && (
                              <p className="text-[9px] text-white/25 mt-0.5">{botCfg?.desc}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* TAB 3 — RÉGLAGES */}
                {activeTab === 3 && (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Timer de décision</p>
                        <span className="text-sm font-bold text-poker-gold">{decisionTimer}s</span>
                      </div>
                      <input type="range" min="5" max="120" step="5" value={decisionTimer} onChange={e => setDecisionTimer(+e.target.value)}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, #c9a227 ${((decisionTimer-5)/115)*100}%, rgba(255,255,255,0.1) 0%)` }}/>
                      <div className="flex justify-between text-[9px] text-white/25 mt-1"><span>5s</span><span>60s</span><span>120s</span></div>
                    </div>

                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-3">Variante de jeu</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['NLH','PLO','PLO5'] as const).map(v => (
                          <motion.button key={v} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                            onClick={() => setGameVariant(v)}
                            className={`py-3 rounded-xl border text-center transition-all ${
                              gameVariant === v ? 'bg-poker-gold/20 border-poker-gold text-poker-gold' : 'bg-white/4 border-white/10 text-white/40 hover:border-white/25'
                            }`}>
                            <p className="text-xs font-bold">{v}</p>
                            <p className="text-[9px] mt-0.5 opacity-60">{v === 'NLH' ? 'No Limit Hold\'em' : v === 'PLO' ? 'Pot Limit Omaha' : 'PLO 5 cartes'}</p>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-3">Vitesse de jeu</p>
                      <div className="grid grid-cols-3 gap-2">
                        {([['slow','🐢 Lente'],['normal','🎯 Normale'],['fast','⚡ Rapide']] as const).map(([v, lbl]) => (
                          <motion.button key={v} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                            onClick={() => setGameSpeed(v)}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all ${
                              gameSpeed === v ? 'bg-poker-teal/20 border-poker-teal text-poker-teal' : 'bg-white/4 border-white/10 text-white/40 hover:border-white/25'
                            }`}>{lbl}</motion.button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {[
                        { key: 'anon', label: 'Mode anonyme', sub: 'Les bots ne voient pas votre pseudo', val: anonymousMode, set: () => setAnonymousMode(v => !v) },
                      ].map(opt => (
                        <div key={opt.key} className="flex items-center justify-between bg-white/3 border border-white/8 rounded-xl p-3">
                          <div>
                            <p className="text-xs font-semibold text-white/70">{opt.label}</p>
                            <p className="text-[10px] text-white/30">{opt.sub}</p>
                          </div>
                          <button onClick={opt.set}
                            className={`w-10 h-5.5 rounded-full transition-all relative ${opt.val ? 'bg-poker-teal' : 'bg-white/10'}`}
                            style={{ height: '22px', width: '40px' }}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${opt.val ? 'left-5' : 'left-0.5'}`}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
          </div>

          {/* Confirm Button */}
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 0 40px rgba(201,162,39,0.5)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/game', { state: { numPlayers, selectedSeat, stackBB, sb, bb, ante, decisionTimer, gameVariant, gameSpeed, anonymousMode, slots, displayName } })}
            className="flex-shrink-0 py-4 rounded-2xl font-display font-bold text-base tracking-[0.3em] uppercase text-poker-darker transition-all"
            style={{ background: 'linear-gradient(135deg, #f0d060, #c9a227, #8B6810)', boxShadow: '0 0 25px rgba(201,162,39,0.35)' }}>
            ✦ Confirmer & Commencer ✦
          </motion.button>
        </div>

        {/* ── RIGHT: SUMMARY PANEL ── */}
        <aside className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">

          {/* Coach's Corner */}
          <div className="glass-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Star size={11} className="text-poker-gold"/>
              <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider">Coach's Corner</p>
            </div>
            <div className="space-y-1.5">
              {[
                `Position ${myPosition}: ${myPosition === 'BTN' ? 'Meilleure position, jouez large' : myPosition === 'BB' ? 'Position difficile, soyez sélectif' : 'Position moyenne, jouez TAG'}`,
                `${stackBB} BB = ${stackBB >= 100 ? 'Stack profond, jeu de post-flop' : stackBB >= 50 ? 'Stack standard' : 'Short stack, push/fold'}`,
                `${gameVariant === 'NLH' ? 'Hold\'em: maîtrisez le range contre les bots' : 'Omaha: les draws sont plus fréquents'}`,
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-poker-gold mt-0.5 flex-shrink-0 text-[10px]">+</span>
                  <p className="text-[10px] text-white/40 leading-relaxed">{tip}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recommandations */}
          <div className="glass-card p-3">
            <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider mb-2">Recommandations de Setup</p>
            <div className="space-y-1.5">
              {[
                { icon: <Crown size={10}/>, text: `Hicham Amor f order Coach Lvl 1-5` },
                { icon: <Shield size={10}/>, text: 'Essayez la position BTN pour commencer' },
                { icon: <Zap size={10}/>, text: 'Bot niv 3 recommandé pour progresser' },
                { icon: <Star size={10}/>, text: 'Hand Recalls: 17 décisions à revoir' },
              ].map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-white/35">
                  <span className="text-poker-gold mt-0.5 flex-shrink-0">{r.icon}</span>
                  <p className="text-[10px] leading-relaxed">{r.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Résumé du Setup */}
          <div className="glass-card p-3">
            <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider mb-3">Résumé du Setup</p>
            <div className="space-y-2">
              {[
                { label: 'STACK X INITIAL', val: `${stackChips.toLocaleString()}` },
                { label: 'NOMBRE DE JOUEURS', val: `${numPlayers} Joueurs` },
                { label: 'ACTIFS', val: `${activeCount} / ${numPlayers}` },
                { label: 'VOTRE PLACE', val: `${myPosition} (Siège ${safeSelectedSeat + 1})` },
                { label: 'STACK', val: `${stackChips.toLocaleString()} (${stackBB}BB)` },
                { label: 'RÉGLAGES', val: `${gameVariant} · ${decisionTimer}s` },
                { label: 'ANTE', val: ante > 0 ? `${ante}` : 'Aucun' },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <span className="text-[9px] text-white/30 uppercase tracking-wide leading-tight">{row.label}</span>
                  <span className="text-[10px] font-bold text-white/70 text-right">{row.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bot Legend */}
          <div className="glass-card p-3">
            <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider mb-2">Niveaux de Bot</p>
            <div className="space-y-1">
              {BOT_LEVELS.map(b => (
                <div key={b.level} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                    style={{ background: b.color + '22', color: b.color, border: `1px solid ${b.color}55` }}>
                    {b.level}
                  </span>
                  <span className="text-[9px] font-semibold" style={{ color: b.color }}>{b.name}</span>
                </div>
              ))}
            </div>
          </div>

        </aside>
      </div>
    </div>
  )
}
