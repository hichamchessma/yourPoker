import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Bell, Search, ChevronDown, Play, Trophy, Target,
  Zap, Star, BarChart2, Users, BookOpen, LogOut,
  TrendingUp, Clock, ChevronRight, Send, Wallet, DollarSign
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import WindowControls from '../components/layout/WindowControls'


function KingCard({ rotation, glow }: { rotation: number; glow: string }) {
  return (
    <svg width="160" height="220" viewBox="0 0 160 220" style={{ transform: `rotate(${rotation}deg)`, filter: `drop-shadow(0 12px 40px ${glow}) drop-shadow(0 0 20px ${glow})` }}>
      <defs>
        <linearGradient id="kg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#162338" />
          <stop offset="100%" stopColor="#0a1520" />
        </linearGradient>
        <linearGradient id="kgold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0d060" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>
      </defs>
      {/* Card body */}
      <rect x="3" y="3" width="154" height="214" rx="12" fill="url(#kg1)" />
      {/* Gold border with glow */}
      <rect x="3" y="3" width="154" height="214" rx="12" fill="none" stroke="url(#kgold)" strokeWidth="2.5" />
      {/* Inner decorative border */}
      <rect x="10" y="10" width="140" height="200" rx="9" fill="none" stroke="rgba(201,162,39,0.25)" strokeWidth="1" />
      {/* Corner ornaments TL */}
      <text x="14" y="34" fill="url(#kgold)" fontSize="24" fontWeight="bold" fontFamily="Georgia,serif">K</text>
      <text x="16" y="52" fill="url(#kgold)" fontSize="18" fontFamily="Georgia,serif">♠</text>
      {/* Corner ornaments BR (rotated) */}
      <text x="146" y="192" textAnchor="middle" fill="url(#kgold)" fontSize="24" fontWeight="bold" fontFamily="Georgia,serif" transform="rotate(180 138 185)">K</text>
      <text x="144" y="210" textAnchor="middle" fill="url(#kgold)" fontSize="18" fontFamily="Georgia,serif" transform="rotate(180 138 202)">♠</text>
      {/* Decorative crown */}
      <g transform="translate(80,88)">
        <polygon points="-28,-20 -20,8 -28,8 28,8 20,8 28,-20 14,-8 0,-22 -14,-8" fill="none" stroke="url(#kgold)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="-28" cy="-20" r="3" fill="url(#kgold)" />
        <circle cx="0" cy="-22" r="3" fill="url(#kgold)" />
        <circle cx="28" cy="-20" r="3" fill="url(#kgold)" />
        <rect x="-20" y="8" width="40" height="6" rx="2" fill="url(#kgold)" opacity="0.6" />
      </g>
      {/* Center spade */}
      <text x="80" y="148" textAnchor="middle" fill="url(#kgold)" fontSize="52" fontFamily="Georgia,serif">♠</text>
      {/* Decorative lines */}
      <line x1="25" y1="65" x2="135" y2="65" stroke="rgba(201,162,39,0.15)" strokeWidth="0.5" />
      <line x1="25" y1="160" x2="135" y2="160" stroke="rgba(201,162,39,0.15)" strokeWidth="0.5" />
      {/* Shine overlay */}
      <rect x="10" y="10" width="140" height="90" rx="9" fill="white" opacity="0.03" />
    </svg>
  )
}

function AceCard({ rotation, glow }: { rotation: number; glow: string }) {
  return (
    <svg width="160" height="220" viewBox="0 0 160 220" style={{ transform: `rotate(${rotation}deg)`, filter: `drop-shadow(0 12px 40px ${glow}) drop-shadow(0 0 20px ${glow})` }}>
      <defs>
        <linearGradient id="ag1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0e2035" />
          <stop offset="100%" stopColor="#091525" />
        </linearGradient>
        <linearGradient id="ateal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#66eeff" />
          <stop offset="100%" stopColor="#00d4ff" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="154" height="214" rx="12" fill="url(#ag1)" />
      <rect x="3" y="3" width="154" height="214" rx="12" fill="none" stroke="url(#ateal)" strokeWidth="2.5" />
      <rect x="10" y="10" width="140" height="200" rx="9" fill="none" stroke="rgba(0,212,255,0.25)" strokeWidth="1" />
      {/* TL */}
      <text x="14" y="34" fill="url(#ateal)" fontSize="24" fontWeight="bold" fontFamily="Georgia,serif">A</text>
      <text x="16" y="52" fill="url(#ateal)" fontSize="18" fontFamily="Georgia,serif">♠</text>
      {/* BR */}
      <text x="146" y="192" textAnchor="middle" fill="url(#ateal)" fontSize="24" fontWeight="bold" fontFamily="Georgia,serif" transform="rotate(180 138 185)">A</text>
      <text x="144" y="210" textAnchor="middle" fill="url(#ateal)" fontSize="18" fontFamily="Georgia,serif" transform="rotate(180 138 202)">♠</text>
      {/* Giant center spade */}
      <text x="80" y="145" textAnchor="middle" fill="url(#ateal)" fontSize="90" fontFamily="Georgia,serif">♠</text>
      {/* Decorative lines */}
      <line x1="25" y1="65" x2="135" y2="65" stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />
      <line x1="25" y1="168" x2="135" y2="168" stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />
      <rect x="10" y="10" width="140" height="90" rx="9" fill="white" opacity="0.03" />
    </svg>
  )
}

function ChipStack() {
  const cfgs = {
    teal:  { grad: 'url(#csTeal)',  sideBot: '#003a4a', sideMid: '#006688', inner: '#00688a', dark: '#003344', text: '#00d4ff' },
    gold:  { grad: 'url(#csGold)',  sideBot: '#4a3204', sideMid: '#8B6810', inner: '#8B6810', dark: '#1a2840', text: '#e8c840' },
    red:   { grad: 'url(#csRed)',   sideBot: '#4a0808', sideMid: '#8a1010', inner: '#8a1a1a', dark: '#180808', text: '#ff5555' },
    green: { grad: 'url(#csGrn)',   sideBot: '#084208', sideMid: '#1a6010', inner: '#1a7020', dark: '#071507', text: '#44ee44' },
  } as const

  const rx = 40, ry = 10, sideH = 9, spacing = 13, baseY = 128

  const piles: { cx: number; chips: (keyof typeof cfgs)[]; glowColor: string }[] = [
    { cx: 62,  chips: ['red', 'red', 'gold'],              glowColor: '#dd2222' },
    { cx: 155, chips: ['teal', 'teal', 'green', 'gold', 'gold'], glowColor: '#00c8ee' },
    { cx: 248, chips: ['green', 'red', 'teal', 'gold'],    glowColor: '#22cc44' },
  ]

  return (
    <svg width="310" height="158" viewBox="0 0 310 158">
      <defs>
        <radialGradient id="csGold" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#f5e070" /><stop offset="55%" stopColor="#c9a227" /><stop offset="100%" stopColor="#7a5508" />
        </radialGradient>
        <radialGradient id="csTeal" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#88f4ff" /><stop offset="55%" stopColor="#00c8ee" /><stop offset="100%" stopColor="#005577" />
        </radialGradient>
        <radialGradient id="csRed" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ff9999" /><stop offset="55%" stopColor="#dd2222" /><stop offset="100%" stopColor="#660808" />
        </radialGradient>
        <radialGradient id="csGrn" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#99ffaa" /><stop offset="55%" stopColor="#22cc44" /><stop offset="100%" stopColor="#086620" />
        </radialGradient>
        <filter id="csGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7"/>
        </filter>
        <filter id="csGlowTop" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Per-pile ground glow */}
      {piles.map((p) => (
        <ellipse key={p.cx} cx={p.cx} cy={baseY + sideH + 12} rx={rx + 18} ry={11} fill={p.glowColor} opacity="0.4" filter="url(#csGlow)" />
      ))}

      {/* Chips — bottom to top per pile */}
      {piles.map((pile) =>
        pile.chips.map((color, i) => {
          const faceY = baseY - i * spacing
          const c = cfgs[color]
          const isTop = i === pile.chips.length - 1
          return (
            <g key={`${pile.cx}-${i}`}>
              <ellipse cx={pile.cx} cy={faceY + sideH} rx={rx} ry={ry} fill={c.sideBot} />
              <ellipse cx={pile.cx} cy={faceY} rx={rx} ry={ry} fill={c.sideMid} />
              {Array.from({length: 8}).map((_, ni) => {
                const a = ni * 45 * Math.PI / 180
                return (
                  <rect key={ni}
                    x={pile.cx + 36 * Math.cos(a) - 3.5} y={faceY + 9 * Math.sin(a) - 2.5}
                    width="7" height="5" rx="1.5" fill={c.sideBot} opacity="0.95"
                    transform={`rotate(${ni * 45} ${pile.cx + 36 * Math.cos(a)} ${faceY + 9 * Math.sin(a)})`}
                  />
                )
              })}
              <ellipse cx={pile.cx} cy={faceY} rx={rx} ry={ry + 0.5}
                fill={c.grad} filter={isTop ? 'url(#csGlowTop)' : undefined} />
              <ellipse cx={pile.cx} cy={faceY} rx={rx * 0.76} ry={ry * 0.76} fill={c.inner} />
              <ellipse cx={pile.cx} cy={faceY} rx={rx * 0.70} ry={ry * 0.70} fill={c.grad} opacity={0.75} />
              <ellipse cx={pile.cx} cy={faceY} rx={rx * 0.42} ry={ry * 0.42} fill={c.dark} />
              <text x={pile.cx} y={faceY + ry * 0.32} textAnchor="middle" fill={c.text} fontSize="9" fontFamily="serif">♠</text>
              <ellipse cx={pile.cx - 14} cy={faceY - ry * 0.45} rx="8" ry="3"
                fill="white" opacity={0.18} transform={`rotate(-22 ${pile.cx - 14} ${faceY - ry * 0.45})`} />
            </g>
          )
        })
      )}
    </svg>
  )
}

// ── Skill bar ──────────────────────────────────────────────────────────
function SkillBar({ label, value, color = '#00d4ff' }: { label: string; value: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-white/50 uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}88, ${color})` }}
        />
      </div>
    </div>
  )
}

// ── Tournament row ──────────────────────────────────────────────────────
function TournamentRow({ rank, name, sub, prize, color }: { rank: number; name: string; sub: string; prize: string; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group">
      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: color + '22', color }}>
        {rank}
      </div>
      <div className="w-7 h-7 rounded-full bg-poker-blue flex items-center justify-center flex-shrink-0">
        <Trophy size={12} className="text-poker-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/80 truncate">{name}</p>
        <p className="text-[10px] text-white/30 truncate">{sub}</p>
      </div>
      <span className="text-[10px] font-bold text-poker-gold flex-shrink-0">{prize}</span>
    </div>
  )
}

export default function LobbyPage(): JSX.Element {
  const { user } = useAuthStore()
  const [searchVal, setSearchVal] = useState('')
  const [joinInput, setJoinInput] = useState('')

  // Play-money balance (persisted locally). Real-money play is UI-only for now.
  const [balance, setBalance] = useState<number>(() => {
    const saved = Number(localStorage.getItem('pokerBalance'))
    return Number.isFinite(saved) && saved > 0 ? saved : 10000
  })
  const [rechargeAmt, setRechargeAmt] = useState(5000)
  const [realMoneyNote, setRealMoneyNote] = useState(false)
  useEffect(() => { localStorage.setItem('pokerBalance', String(balance)) }, [balance])

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Joueur'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null

  return (
    <div className="flex flex-col h-full bg-poker-darker overflow-hidden">

      {/* ── TOP HEADER ── */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-poker-border flex-shrink-0 relative" style={{ background: 'rgba(6,11,20,0.95)' }}>
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-full bg-poker-gold/20 border border-poker-gold/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-poker-gold">
              <path d="M12 2C8 6 4 8 4 12c0 2.5 1.5 4 3.5 4 .8 0 1.5-.2 2.1-.6L9 17H7v2h10v-2h-2l-.6-1.6c.6.4 1.3.6 2.1.6 2 0 3.5-1.5 3.5-4 0-4-4-6-8-10z" />
            </svg>
          </div>
          <div>
            <span className="font-display font-bold text-white text-sm tracking-wider uppercase">Poker Elite </span>
            <span className="font-display font-bold text-poker-teal text-sm tracking-wider uppercase">Coach</span>
          </div>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder="Recherche au global"
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            className="w-full bg-white/5 border border-white/8 rounded-lg pl-9 pr-4 py-2 text-xs text-white/70 placeholder-white/25 focus:outline-none focus:border-poker-teal/40 transition-colors"
          />
        </div>

        <div className="flex-1" />

        {/* Bell */}
        <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
          <Bell size={18} className="text-white/50" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/10 cursor-pointer group">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-poker-gold/30 flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-poker-gold/20 flex items-center justify-center">
                <span className="text-poker-gold font-bold text-sm">{displayName[0].toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-white/90 leading-tight">{displayName}</p>
            <div className="flex items-center gap-1">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-poker-gold/20 text-poker-gold font-bold uppercase tracking-wide">PRO+</span>
            </div>
          </div>
          <ChevronDown size={14} className="text-white/30 group-hover:text-white/60 transition-colors" />
        </div>

        <WindowControls />
      </header>

      {/* ── CONTENT ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── CENTER ── */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4 min-w-0">

          {/* Hero */}
          <div className="flex-1 relative rounded-2xl overflow-hidden min-h-0" style={{ background: 'radial-gradient(ellipse at 50% 35%, #0d2a4a 0%, #071020 50%, #04080e 100%)' }}>
            {/* ── ENHANCED BACKGROUND ── */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 350" preserveAspectRatio="xMidYMid slice">
              <defs>
                <filter id="lGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="nGlow" x="-120%" y="-120%" width="340%" height="340%">
                  <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <radialGradient id="bgCenter" cx="50%" cy="52%" r="55%">
                  <stop offset="0%" stopColor="#0e3a6a" stopOpacity="0.85"/>
                  <stop offset="55%" stopColor="#071828" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="transparent" stopOpacity="0"/>
                </radialGradient>
              </defs>

              {/* Central atmosphere */}
              <ellipse cx="300" cy="182" rx="230" ry="155" fill="url(#bgCenter)"/>

              {/* ── LEFT TEAL ARCS (émanent de la carte gauche) ── */}
              <path id="lp1" d="M 238,125 C 185,85 118,50 32,16" stroke="#00d4ff" strokeWidth="1.4" fill="none" strokeDasharray="5 9" opacity="0.55" filter="url(#lGlow)"/>
              <circle r="3" fill="#66eeff" filter="url(#nGlow)"><animateMotion dur="3.2s" repeatCount="indefinite" href="#lp1"/></circle>

              <path id="lp2" d="M 225,160 L 148,160 L 148,112 L 72,92 L 14,82" stroke="#00d4ff" strokeWidth="1.1" fill="none" strokeDasharray="4 8" opacity="0.5" filter="url(#lGlow)"/>
              <circle cx="148" cy="112" r="4.5" fill="#00d4ff" opacity="0.85" filter="url(#nGlow)"/>
              <circle cx="148" cy="160" r="2.5" fill="#00d4ff" opacity="0.6"/>
              <circle r="2.5" fill="#88f4ff" filter="url(#nGlow)"><animateMotion dur="4s" repeatCount="indefinite" begin="0.9s" href="#lp2"/></circle>

              <path id="lp3" d="M 232,192 C 170,222 105,260 24,292" stroke="#00d4ff" strokeWidth="1.1" fill="none" strokeDasharray="5 10" opacity="0.42" filter="url(#lGlow)"/>
              <circle r="2.5" fill="#00d4ff" filter="url(#nGlow)"><animateMotion dur="4.8s" repeatCount="indefinite" begin="1.6s" href="#lp3"/></circle>

              <path id="lp4" d="M 220,205 L 145,205 L 145,252 L 58,272 L 6,266" stroke="#00d4ff" strokeWidth="0.8" fill="none" strokeDasharray="3 9" opacity="0.32"/>
              <circle cx="145" cy="252" r="3.5" fill="#00d4ff" opacity="0.75" filter="url(#nGlow)"/>
              <rect x="55" y="269" width="6" height="6" rx="1.5" fill="#00d4ff" opacity="0.65" filter="url(#nGlow)"/>

              {/* Labels left */}
              <text x="74" y="87" fill="#00d4ff" fontSize="7" opacity="0.5" fontFamily="monospace">EVx:+0.74</text>
              <text x="150" y="108" fill="#00d4ff" fontSize="7" opacity="0.55" fontFamily="monospace">+EV</text>
              <text x="28" y="108" fill="#00d4ff" fontSize="7" opacity="0.35" fontFamily="monospace">POT</text>

              {/* Suits left */}
              <text x="14" y="52" fill="#00d4ff" fontSize="28" opacity="0.55" fontFamily="serif" filter="url(#lGlow)">♥</text>
              <text x="5"  y="278" fill="#00d4ff" fontSize="22" opacity="0.38" fontFamily="serif">♣</text>
              <text x="22" y="310" fill="#00d4ff" fontSize="16" opacity="0.25" fontFamily="serif">♦</text>

              {/* ── RIGHT GOLD ARCS (émanent de la carte droite) ── */}
              <path id="rp1" d="M 362,125 C 415,85 482,50 568,16" stroke="#c9a227" strokeWidth="1.4" fill="none" strokeDasharray="5 9" opacity="0.5" filter="url(#lGlow)"/>
              <circle r="3" fill="#f0d060" filter="url(#nGlow)"><animateMotion dur="3.2s" repeatCount="indefinite" begin="0.5s" href="#rp1"/></circle>

              <path id="rp2" d="M 375,160 L 452,160 L 452,112 L 528,92 L 586,82" stroke="#c9a227" strokeWidth="1.1" fill="none" strokeDasharray="4 8" opacity="0.45" filter="url(#lGlow)"/>
              <circle cx="452" cy="112" r="4.5" fill="#c9a227" opacity="0.85" filter="url(#nGlow)"/>
              <circle cx="452" cy="160" r="2.5" fill="#c9a227" opacity="0.6"/>
              <circle r="2.5" fill="#f0d060" filter="url(#nGlow)"><animateMotion dur="4s" repeatCount="indefinite" begin="1.4s" href="#rp2"/></circle>

              <path id="rp3" d="M 368,192 C 430,222 495,260 576,292" stroke="#c9a227" strokeWidth="1.1" fill="none" strokeDasharray="5 10" opacity="0.38" filter="url(#lGlow)"/>
              <circle r="2.5" fill="#c9a227" filter="url(#nGlow)"><animateMotion dur="4.8s" repeatCount="indefinite" begin="2.2s" href="#rp3"/></circle>

              <path id="rp4" d="M 380,205 L 455,205 L 455,252 L 542,272 L 594,266" stroke="#c9a227" strokeWidth="0.8" fill="none" strokeDasharray="3 9" opacity="0.28"/>
              <circle cx="455" cy="252" r="3.5" fill="#c9a227" opacity="0.75" filter="url(#nGlow)"/>
              <rect x="539" y="269" width="6" height="6" rx="1.5" fill="#c9a227" opacity="0.65" filter="url(#nGlow)"/>

              {/* Labels right */}
              <text x="496" y="87" fill="#c9a227" fontSize="7" opacity="0.45" fontFamily="monospace">KA:88%</text>
              <text x="454" y="108" fill="#c9a227" fontSize="7" opacity="0.5" fontFamily="monospace">RAISE</text>
              <text x="540" y="108" fill="#c9a227" fontSize="7" opacity="0.32" fontFamily="monospace">3BET</text>

              {/* Suits right */}
              <text x="558" y="52" fill="#c9a227" fontSize="28" opacity="0.5" fontFamily="serif" filter="url(#lGlow)">♠</text>
              <text x="568" y="278" fill="#c9a227" fontSize="22" opacity="0.35" fontFamily="serif">♦</text>
              <text x="558" y="310" fill="#c9a227" fontSize="16" opacity="0.22" fontFamily="serif">♣</text>

              {/* ── CENTER PULSE ── */}
              <circle cx="300" cy="175" r="7" fill="none" stroke="#00d4ff" strokeWidth="0.8" opacity="0.35">
                <animate attributeName="r" values="6;12;6" dur="3s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.35;0.08;0.35" dur="3s" repeatCount="indefinite"/>
              </circle>
              <circle cx="300" cy="175" r="3" fill="#00d4ff" opacity="0.5" filter="url(#nGlow)">
                <animate attributeName="opacity" values="0.3;0.9;0.3" dur="2s" repeatCount="indefinite"/>
              </circle>

              {/* Ambient dashed rings */}
              <circle cx="300" cy="175" r="100" fill="none" stroke="#00d4ff" strokeWidth="0.3" strokeDasharray="2 16" opacity="0.15"/>
              <circle cx="300" cy="175" r="190" fill="none" stroke="#00d4ff" strokeWidth="0.2" strokeDasharray="1 20" opacity="0.08"/>
            </svg>
            {/* Top glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-40 opacity-40" style={{ background: 'radial-gradient(ellipse at 50% 0%, #1a5080 0%, transparent 70%)' }} />

            {/* Cards + chips composition */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative" style={{ width: 400, height: 300 }}>
                {/* A card — behind, tilted left */}
                <motion.div className="absolute" style={{ left: 55, top: 15, zIndex: 1 }}
                  animate={{ y: [-8, 8, -8] }}
                  transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
                  <AceCard rotation={-14} glow="rgba(0,212,255,0.6)" />
                </motion.div>
                {/* K card — in front, tilted right */}
                <motion.div className="absolute" style={{ right: 55, top: 15, zIndex: 2 }}
                  animate={{ y: [8, -8, 8] }}
                  transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}>
                  <KingCard rotation={13} glow="rgba(201,162,39,0.6)" />
                </motion.div>
                {/* 3 chip piles — spread across cards */}
                <motion.div className="absolute" style={{ bottom: 4, left: '50%', transform: 'translateX(-50%)', zIndex: 3 }}
                  animate={{ y: [-5, 5, -5] }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}>
                  <ChipStack />
                </motion.div>
              </div>
            </div>
          </div>

          {/* Bottom 3 cards */}
          <div className="grid grid-cols-3 gap-3 flex-shrink-0">

            {/* Live session */}
            <div className="glass-card p-0 overflow-hidden">
              <div className="relative bg-poker-navy h-24 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-poker-blue to-poker-darker" />
                <div className="relative z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 border border-white/20 cursor-pointer hover:bg-white/20 transition-colors">
                  <Play size={16} className="text-white fill-white ml-0.5" />
                </div>
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 rounded px-1.5 py-0.5">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  <span className="text-[9px] font-bold text-white uppercase">Direct</span>
                </div>
              </div>
              <div className="p-3">
                <p className="text-[10px] text-poker-teal uppercase tracking-wider font-semibold mb-0.5">Sessions en direct</p>
                <p className="text-xs font-bold text-white/90">Défenses de Big Blind</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full w-1/3 bg-poker-teal rounded-full" />
                  </div>
                  <span className="text-[9px] text-white/30">12:34</span>
                </div>
              </div>
            </div>

            {/* Weekly challenge */}
            <div className="glass-card p-4">
              <p className="text-[10px] text-poker-gold uppercase tracking-wider font-semibold mb-3">Défis de la semaine</p>
              <div className="space-y-1 mb-3">
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/40">Progression</span>
                  <span className="text-poker-gold font-bold">88%</span>
                </div>
                <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: '88%' }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, #a07d10, #e8c547)' }}
                  />
                </div>
              </div>
              <div className="flex justify-center gap-4 mt-3">
                {[
                  { icon: <Target size={14} />, label: '3/5' },
                  { icon: <Trophy size={14} />, label: '2 pts' },
                  { icon: <Zap size={14} />, label: 'x2' }
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-8 h-8 rounded-lg bg-poker-gold/10 border border-poker-gold/20 flex items-center justify-center text-poker-gold">
                      {item.icon}
                    </div>
                    <span className="text-[9px] text-white/40">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tournament feed */}
            <div className="glass-card p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-white/60 uppercase tracking-wider font-semibold">Tournament Feed</p>
                <ChevronRight size={12} className="text-white/30" />
              </div>
              <div className="flex-1 space-y-0.5">
                <TournamentRow rank={1} name="Tournament 1" sub="3 tournements" prize="20k" color="#c9a227" />
                <TournamentRow rank={2} name="Coocche" sub="Maintenant requis" prize="40k" color="#00d4ff" />
                <TournamentRow rank={3} name="Tournament 2" sub="3 tournements" prize="80k" color="#a855f7" />
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                <input
                  value={joinInput}
                  onChange={e => setJoinInput(e.target.value)}
                  placeholder="Rejoier un tournement..."
                  className="flex-1 bg-transparent text-[10px] text-white/50 placeholder-white/20 focus:outline-none"
                />
                <button className="w-6 h-6 rounded bg-poker-teal/20 flex items-center justify-center hover:bg-poker-teal/30 transition-colors">
                  <Send size={10} className="text-poker-teal" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <aside className="w-64 flex-shrink-0 border-l border-poker-border flex flex-col gap-3 p-3 overflow-y-auto" style={{ background: 'rgba(6,11,20,0.6)' }}>

          {/* Balance / Solde */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded bg-poker-gold/20 flex items-center justify-center">
                <Wallet size={11} className="text-poker-gold" />
              </div>
              <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">Solde</p>
              <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded bg-poker-teal/15 text-poker-teal font-bold uppercase tracking-wide">Fictif</span>
            </div>

            <div className="mb-3">
              <p className="text-2xl font-bold text-poker-gold font-mono leading-none">{balance.toLocaleString()}</p>
              <p className="text-[9px] text-white/30 uppercase tracking-wide mt-1">jetons d'entraînement</p>
            </div>

            {/* Recharge */}
            <div className="flex items-center gap-1 mb-2">
              <div className="flex items-center flex-1 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                <span className="pl-2 text-[11px] text-white/30 font-mono">+</span>
                <input
                  type="number"
                  value={rechargeAmt}
                  min={0}
                  step={1000}
                  onChange={e => setRechargeAmt(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-transparent text-[12px] font-bold text-white/80 font-mono px-1 py-1.5 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <button
                onClick={() => rechargeAmt > 0 && setBalance(b => b + rechargeAmt)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg,#c9a227,#8B6810)', color: '#0a0a0a' }}>
                Recharger
              </button>
            </div>
            <div className="flex gap-1 mb-3">
              {[5000, 25000, 100000].map(a => (
                <button key={a} onClick={() => setBalance(b => b + a)}
                  className="flex-1 px-2 py-1 rounded text-[9px] font-bold bg-white/5 border border-white/10 text-white/45 hover:text-poker-gold hover:border-poker-gold/30 transition-all">
                  +{a / 1000}k
                </button>
              ))}
            </div>

            {/* Real-money play (UI only) */}
            <button
              onClick={() => setRealMoneyNote(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-600/40 bg-emerald-900/15 text-emerald-300/90 text-[10px] font-bold uppercase tracking-wide hover:bg-emerald-900/30 transition-all">
              <DollarSign size={12} /> Jouer en argent réel
            </button>
            {realMoneyNote && (
              <p className="text-[9px] text-white/40 mt-2 text-center leading-relaxed">
                Le mode argent réel arrive bientôt — paiements et retraits sécurisés.
              </p>
            )}
          </div>

          {/* Profile Overview */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full overflow-hidden border border-poker-gold/30 flex-shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-poker-gold/20 flex items-center justify-center">
                    <span className="text-poker-gold font-bold text-xs">{displayName[0].toUpperCase()}</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">Profil Overview</p>
                <p className="text-[9px] text-white/30">Skill progress</p>
              </div>
            </div>
            <div className="space-y-2">
              <SkillBar label="Décision" value={98} color="#00d4ff" />
              <SkillBar label="Stolen" value={20} color="#c9a227" />
              <SkillBar label="Mise" value={20} color="#00d4ff" />
              <SkillBar label="Découvrez" value={18} color="#c9a227" />
              <SkillBar label="Précognitive" value={9} color="#a855f7" />
            </div>
          </div>

          {/* Vos Favoris */}
          <div className="glass-card p-4">
            <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider mb-3">Vos Favoris</p>
            <div className="space-y-1">
              {[
                { icon: <Star size={13} />, label: 'Vos favoris' },
                { icon: <Users size={13} />, label: 'Vos Profil' },
                { icon: <BarChart2 size={13} />, label: 'Classement' },
                { icon: <BookOpen size={13} />, label: 'Vos outils' },
              ].map((item, i) => (
                <button key={i} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors text-left group">
                  <span className="text-white/30 group-hover:text-poker-teal transition-colors">{item.icon}</span>
                  <span className="text-[11px] font-medium">{item.label}</span>
                </button>
              ))}
              <div className="h-px bg-white/8 my-1" />
              <button className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors text-left group">
                <LogOut size={13} />
                <span className="text-[11px] font-medium">Déconnexion</span>
              </button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="glass-card p-4">
            <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider mb-3">Cette semaine</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: <Clock size={13} />, label: 'Heures', value: '4.5h' },
                { icon: <TrendingUp size={13} />, label: 'Progrès', value: '+12%' },
                { icon: <Trophy size={13} />, label: 'Victoires', value: '7' },
                { icon: <Target size={13} />, label: 'Défis', value: '3/5' },
              ].map((s, i) => (
                <div key={i} className="bg-white/3 rounded-lg p-2 flex flex-col gap-1">
                  <span className="text-white/30">{s.icon}</span>
                  <span className="text-[9px] text-white/30 uppercase tracking-wide">{s.label}</span>
                  <span className="text-sm font-bold text-white/80">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

        </aside>
      </div>
    </div>
  )
}
