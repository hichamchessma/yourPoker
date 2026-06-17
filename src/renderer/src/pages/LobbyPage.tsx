import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Target, GraduationCap, Medal, FlaskConical, SlidersHorizontal, History,
  Wallet, TrendingUp, Trophy, Spade, ArrowRight, Crown
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { computePlayerStats } from '../lib/playerStats'
import { getRoster, playersOnline } from '../lib/leaderboard'
import { useIsPro } from '../lib/entitlements'
import WindowControls from '../components/layout/WindowControls'
import SoundToggle from '../components/SoundToggle'
import LanguageSwitcher from '../components/LanguageSwitcher'


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

// ── Feature shortcut card (navigates to a trainer) ──────────────────────
function ShortcutCard({ icon, title, desc, accent, onClick }: { icon: React.ReactNode; title: string; desc: string; accent: string; onClick: () => void }) {
  return (
    <motion.button onClick={onClick}
      whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="group relative text-left rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 overflow-hidden transition-colors"
      style={{ ['--accent' as string]: accent }}>
      {/* accent glow on hover */}
      <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(120% 80% at 0% 0%, ${accent}22, transparent 60%)`, boxShadow: `inset 0 0 0 1px ${accent}55` }} />
      <div className="relative flex items-center gap-2.5 mb-1.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform" style={{ background: accent + '1f', color: accent }}>{icon}</span>
        <span className="text-[12px] font-bold text-white/85 group-hover:text-white transition-colors">{title}</span>
        <ArrowRight size={13} className="ml-auto text-white/20 group-hover:text-[color:var(--accent)] group-hover:translate-x-0.5 transition-all" />
      </div>
      <p className="relative text-[10.5px] text-white/40 leading-snug">{desc}</p>
    </motion.button>
  )
}

// ── Real stat tile ──────────────────────────────────────────────────────
function StatTile({ icon, label, value, accent = '#ffffff' }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white/[0.03] rounded-lg p-2.5 flex flex-col gap-1">
      <span className="text-white/30">{icon}</span>
      <span className="text-[9px] text-white/35 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-black font-mono" style={{ color: accent }}>{value}</span>
    </div>
  )
}

export default function LobbyPage(): JSX.Element {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isPro = useIsPro()
  const stats = useMemo(() => computePlayerStats(4), [])

  // Play-money balance (persisted locally).
  const [balance, setBalance] = useState<number>(() => {
    const saved = Number(localStorage.getItem('pokerBalance'))
    return Number.isFinite(saved) && saved > 0 ? saved : 10000
  })
  const [rechargeAmt, setRechargeAmt] = useState(5000)
  useEffect(() => { localStorage.setItem('pokerBalance', String(balance)) }, [balance])

  // Lively community signals
  const topPlayers = useMemo(() => getRoster().slice(0, 3), [])
  const [online, setOnline] = useState(() => playersOnline())
  useEffect(() => { const t = setInterval(() => setOnline(playersOnline()), 4000); return () => clearInterval(t) }, [])

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
            <span className="font-display font-bold text-white text-sm tracking-wider uppercase">Your</span>
            <span className="font-display font-bold text-poker-teal text-sm tracking-wider uppercase">Poker</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Players online — social proof */}
        <div className="hidden sm:flex items-center gap-2 mr-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span>
          <span className="text-[11px] text-white/70">{t('lobby.online', { count: online.toLocaleString() })}</span>
        </div>

        <LanguageSwitcher />
        <SoundToggle />

        {/* User — click to open profile */}
        <button onClick={() => navigate('/profile')}
          className="flex items-center gap-2 pl-2 border-l border-white/10 group">
          <div className="relative flex-shrink-0">
            {isPro && (
              <motion.div initial={{ y: 2, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                <Crown size={13} className="text-[#f0d060] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" fill="#f0d060" />
              </motion.div>
            )}
            <div className={`w-8 h-8 rounded-full overflow-hidden ${isPro ? 'border-2 border-[#c9a227]' : 'border border-poker-gold/30'}`}
              style={isPro ? { boxShadow: '0 0 10px rgba(201,162,39,0.55)' } : undefined}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-poker-gold/20 flex items-center justify-center">
                  <span className="text-poker-gold font-bold text-sm">{displayName[0].toUpperCase()}</span>
                </div>
              )}
            </div>
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-bold text-white/90 leading-tight group-hover:text-white transition-colors flex items-center gap-1">
              {displayName}
              {isPro && <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded text-[#1a1206]" style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)' }}>Pro</span>}
            </p>
            <p className="text-[9px] text-white/35 group-hover:text-poker-teal transition-colors">{t('lobby.viewProfile')}</p>
          </div>
        </button>

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

          {/* Quick-launch shortcuts to the trainers */}
          <div className="flex-shrink-0">
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold mb-2 px-1">{t('lobby.launchTraining')}</p>
            <div className="grid grid-cols-3 gap-3">
              <ShortcutCard icon={<Target size={16} />} title={t('lobby.scHandTrainer')} accent="#00d4ff"
                desc={t('lobby.scHandTrainerD')} onClick={() => navigate('/handtrainer')} />
              <ShortcutCard icon={<GraduationCap size={16} />} title={t('lobby.scCash')} accent="#22c55e"
                desc={t('lobby.scCashD')} onClick={() => navigate('/training')} />
              <ShortcutCard icon={<Medal size={16} />} title={t('lobby.scTournament')} accent="#c9a227"
                desc={t('lobby.scTournamentD')} onClick={() => navigate('/tournament')} />
              <ShortcutCard icon={<FlaskConical size={16} />} title={t('lobby.scSim')} accent="#a855f7"
                desc={t('lobby.scSimD')} onClick={() => navigate('/simulation')} />
              <ShortcutCard icon={<SlidersHorizontal size={16} />} title={t('lobby.scScenario')} accent="#e0457b"
                desc={t('lobby.scScenarioD')} onClick={() => navigate('/setup')} />
              <ShortcutCard icon={<History size={16} />} title={t('lobby.scHistory')} accent="#9aa4b2"
                desc={t('lobby.scHistoryD')} onClick={() => navigate('/history')} />
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
              <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{t('lobby.balance')}</p>
              <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded bg-poker-teal/15 text-poker-teal font-bold uppercase tracking-wide">{t('lobby.fictive')}</span>
            </div>

            <div className="mb-3">
              <p className="text-2xl font-bold text-poker-gold font-mono leading-none">{balance.toLocaleString()}</p>
              <p className="text-[9px] text-white/30 uppercase tracking-wide mt-1">{t('lobby.balanceUnit')}</p>
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
                {t('lobby.recharge')}
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

          </div>

          {/* Top classement — social proof + CTA */}
          <button onClick={() => navigate('/leaderboard')} className="glass-card p-4 text-left hover:bg-white/[0.04] transition-colors group">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={13} className="text-[#c9a227]" />
              <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{t('nav.leaderboard')}</p>
              <ArrowRight size={13} className="ml-auto text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="space-y-1.5">
              {topPlayers.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="font-mono font-black text-[11px] w-4" style={{ color: i === 0 ? '#f0d060' : i === 1 ? '#c0c8d4' : '#cd8a54' }}>{i + 1}</span>
                  <span className="text-[11px] text-white/75 truncate flex-1">{p.flag} {p.name}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: p.tierColor }}>{p.rating}</span>
                </div>
              ))}
            </div>
          </button>

          {/* Tes stats — real, derived from history */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{t('lobby.yourStats')}</p>
              <button onClick={() => navigate('/profile')} className="ml-auto text-[9px] text-poker-teal hover:text-poker-gold transition-colors uppercase tracking-wide font-bold">{t('lobby.profileLink')} →</button>
            </div>
            {stats.hasData ? (
              <div className="grid grid-cols-2 gap-2">
                <StatTile icon={<Spade size={13} />} label={t('lobby.statSessions')} value={String(stats.totalSessions)} />
                <StatTile icon={<TrendingUp size={13} />} label={t('lobby.statHands')} value={String(stats.totalHands)} />
                <StatTile icon={<Crown size={13} />} label={t('lobby.statItm')} value={stats.tourPlayed ? `${stats.tourItmPct}%` : '—'} accent="#c9a227" />
                <StatTile icon={<Trophy size={13} />} label={t('lobby.statNetCash')} value={`${stats.cashNetBB > 0 ? '+' : ''}${stats.cashNetBB} BB`} accent={stats.cashNetBB >= 0 ? '#4ade80' : '#f87171'} />
              </div>
            ) : (
              <p className="text-[10.5px] text-white/35 leading-relaxed text-center py-2">
                {t('lobby.noStats')}
              </p>
            )}
          </div>

          {/* Dernières sessions — real recent history */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{t('lobby.recentSessions')}</p>
              {stats.recent.length > 0 && (
                <button onClick={() => navigate('/history')} className="ml-auto text-[9px] text-poker-teal hover:text-poker-gold transition-colors uppercase tracking-wide font-bold">{t('lobby.seeAll')} →</button>
              )}
            </div>
            {stats.recent.length > 0 ? (
              <div className="space-y-1.5">
                {stats.recent.map(s => (
                  <button key={s.id} onClick={() => navigate('/history')}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left group">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: s.kind === 'tournament' ? '#c9a2271f' : '#00d4ff1f', color: s.kind === 'tournament' ? '#c9a227' : '#00d4ff' }}>
                      {s.kind === 'tournament' ? <Medal size={12} /> : <GraduationCap size={12} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] font-semibold text-white/80 truncate group-hover:text-white transition-colors">{s.title}</span>
                      <span className="block text-[9px] text-white/35 truncate">{s.subtitle}</span>
                    </span>
                    <span className={`text-[11px] font-black font-mono flex-shrink-0 ${s.resultBB > 0 ? 'text-emerald-400' : s.resultBB < 0 ? 'text-red-400' : 'text-white/40'}`}>
                      {s.resultBB > 0 ? '+' : ''}{s.kind === 'tournament' ? `$${Math.abs(s.resultBB).toLocaleString()}` : `${s.resultBB}BB`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10.5px] text-white/35 leading-relaxed text-center py-2">
                {t('lobby.noSessions')}
              </p>
            )}
          </div>

        </aside>
      </div>
    </div>
  )
}
