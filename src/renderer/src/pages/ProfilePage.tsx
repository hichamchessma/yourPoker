import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, Trophy, Target, Clock, Flame, Award, Crown, Zap, Shield,
  Spade, ChevronUp, Star, BookMarked, Sparkles,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'

// ── seeded RNG so a player's "career" numbers are stable across visits ─────────
function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')

const TIERS = [
  { name: 'Amateur', color: '#9aa4b2', min: 0 },
  { name: 'Régulier', color: '#22c55e', min: 1200 },
  { name: 'Grinder', color: '#38bdf8', min: 1500 },
  { name: 'Requin', color: '#c9a227', min: 1800 },
  { name: 'Crusher', color: '#e0457b', min: 2100 },
]
const SKILLS = ['Préflop', 'Postflop', 'Tournoi', 'Agressivité', 'Discipline', 'Bluff']

export default function ProfilePage() {
  const { user } = useAuthStore()
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Joueur'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
  const email = user?.email || 'joueur@poker.elite'

  const data = useMemo(() => {
    const rng = mulberry32(hashStr(email))
    const r = (lo: number, hi: number) => lo + rng() * (hi - lo)
    const rating = Math.round(r(1150, 2250))
    const tier = [...TIERS].reverse().find(t => rating >= t.min) ?? TIERS[0]
    const hands = Math.round(r(8000, 90000))
    const winrate = +(r(1.5, 9)).toFixed(1)            // bb/100
    const profit = Math.round((hands / 100) * winrate * r(0.8, 2.2))
    const mtt = Math.round(r(40, 600))
    const itm = +(r(11, 24)).toFixed(0)
    const roi = +(r(-5, 65)).toFixed(0)
    const hours = Math.round(r(120, 2200))
    const biggest = Math.round(r(300, 12000))
    const level = Math.min(50, Math.round(r(8, 47)))
    const xp = Math.round(r(15, 95))
    const streak = Math.round(r(0, 9))
    const skills = SKILLS.map(() => Math.round(r(52, 94)))
    // profit curve (cumulative, upward-biased random walk)
    const pts: number[] = []; let acc = 0
    for (let i = 0; i < 24; i++) { acc += r(-1, 1.8); pts.push(acc) }
    const cashHands = Math.round(hands * r(0.55, 0.8))
    return { rating, tier, hands, winrate, profit, mtt, itm, roi, hours, biggest, level, xp, streak, skills, pts, cashHands, mttHands: hands - cashHands }
  }, [email])

  // local signals (real)
  const savedScenarios = (() => { try { return JSON.parse(localStorage.getItem('yourpoker_scenarios') || '[]').length } catch { return 0 } })()
  const customRanges = !!localStorage.getItem('yourpoker_handtrainer_ranges')

  const achievements = [
    { icon: <Trophy size={18} />, name: 'Premier MTT gagné', got: data.mtt > 60 },
    { icon: <Flame size={18} />, name: '10k mains jouées', got: data.hands >= 10000 },
    { icon: <Crown size={18} />, name: 'Table finale', got: data.mtt > 120 },
    { icon: <Target size={18} />, name: 'Ranges maîtrisées', got: customRanges },
    { icon: <Shield size={18} />, name: 'Discipline ICM', got: data.skills[4] > 75 },
    { icon: <Zap size={18} />, name: 'Bluff parfait', got: data.skills[5] > 80 },
    { icon: <BookMarked size={18} />, name: 'Scénariste', got: savedScenarios > 0 },
    { icon: <Star size={18} />, name: 'Crusher', got: data.rating >= 2100 },
  ]

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'radial-gradient(130% 100% at 50% -10%, #14223a 0%, #0a1120 45%, #060912 100%)' }}>
      {/* spade watermark */}
      <Spade size={420} className="fixed -right-24 -bottom-24 text-white/[0.015] pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* ── HERO HEADER ── */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl border border-[#c9a227]/20 overflow-hidden mb-5"
          style={{ background: 'linear-gradient(120deg, rgba(201,162,39,0.08), rgba(0,212,255,0.05) 60%, transparent)' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 15% 0%, rgba(201,162,39,0.16), transparent 70%)' }} />
          <div className="relative flex flex-col md:flex-row items-center gap-6 p-6">
            {/* avatar with tier ring */}
            <div className="relative shrink-0">
              <div className="w-28 h-28 rounded-full p-[3px]" style={{ background: `conic-gradient(${data.tier.color}, #00d4ff, ${data.tier.color})` }}>
                <div className="w-full h-full rounded-full overflow-hidden bg-[#0a1120] flex items-center justify-center">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-4xl font-black text-[#c9a227]">{displayName[0].toUpperCase()}</span>}
                </div>
              </div>
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border"
                style={{ background: '#0a1120', color: data.tier.color, borderColor: data.tier.color }}>{data.tier.name}</span>
            </div>

            {/* identity */}
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2.5">
                <h1 className="text-2xl font-black text-white tracking-wide">{displayName}</h1>
                {data.streak > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/15 border border-orange-500/40 text-orange-400">
                    <Flame size={11} /> {data.streak}j
                  </span>
                )}
              </div>
              <p className="text-[12px] text-white/40 mt-0.5">{email}</p>
              <div className="flex items-center justify-center md:justify-start gap-3 mt-3">
                <span className="flex items-center gap-1.5 text-[12px] text-white/60"><Sparkles size={13} className="text-[#c9a227]" /> Rating <b className="text-[#c9a227] font-mono">{data.rating}</b></span>
                <span className="h-3 w-px bg-white/15" />
                <span className="text-[12px] text-white/60">Niveau <b className="text-[#00d4ff] font-mono">{data.level}</b></span>
              </div>
              {/* XP bar */}
              <div className="mt-2.5 max-w-sm mx-auto md:mx-0">
                <div className="flex items-center justify-between text-[9px] text-white/35 uppercase tracking-widest mb-1"><span>XP niveau {data.level}</span><span>{data.xp}%</span></div>
                <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${data.xp}%` }} transition={{ delay: 0.2, duration: 0.8 }}
                    className="h-full rounded-full" style={{ background: 'linear-gradient(90deg,#c9a227,#f0d060)' }} />
                </div>
              </div>
            </div>

            {/* headline profit */}
            <div className="shrink-0 text-center px-5 py-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06]">
              <p className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Profit total</p>
              <p className={`text-3xl font-black font-mono ${data.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.profit >= 0 ? '+' : ''}${fmt(data.profit)}</p>
              <p className="text-[10px] text-white/35 mt-0.5">{data.winrate} bb/100</p>
            </div>
          </div>
        </motion.div>

        {/* ── KPI ROW ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <Kpi icon={<Spade size={15} />} label="Mains jouées" value={fmt(data.hands)} />
          <Kpi icon={<TrendingUp size={15} />} label="Win rate" value={`${data.winrate} bb/100`} accent={data.winrate > 0 ? '#4ade80' : '#f87171'} />
          <Kpi icon={<Trophy size={15} />} label="MTT joués" value={fmt(data.mtt)} />
          <Kpi icon={<Crown size={15} />} label="ITM" value={`${data.itm}%`} />
          <Kpi icon={<ChevronUp size={15} />} label="ROI tournois" value={`${data.roi > 0 ? '+' : ''}${data.roi}%`} accent={data.roi >= 0 ? '#4ade80' : '#f87171'} />
          <Kpi icon={<Clock size={15} />} label="Heures jouées" value={fmt(data.hours)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
          {/* ── PROFIT CHART ── */}
          <Panel title="Évolution du profit" icon={<TrendingUp size={14} />}>
            <ProfitChart pts={data.pts} />
            <div className="flex items-center justify-between mt-2 text-[10px] text-white/40">
              <span>Plus gros gain : <b className="text-emerald-400">+${fmt(data.biggest)}</b></span>
              <span>Sur {fmt(data.hands)} mains</span>
            </div>
          </Panel>

          {/* ── SKILLS RADAR ── */}
          <Panel title="Profil de compétences" icon={<Target size={14} />}>
            <Radar values={data.skills} />
          </Panel>
        </div>

        {/* ── FORMAT SPLIT ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 my-5">
          <FormatCard title="Cash Game" accent="#00d4ff" rows={[
            ['Mains', fmt(data.cashHands)], ['Win rate', `${data.winrate} bb/100`], ['Profit', `+$${fmt(Math.round(data.profit * 0.55))}`],
          ]} />
          <FormatCard title="Tournois (MTT)" accent="#c9a227" rows={[
            ['Tournois', fmt(data.mtt)], ['ITM', `${data.itm}%`], ['ROI', `${data.roi > 0 ? '+' : ''}${data.roi}%`],
          ]} />
        </div>

        {/* ── ACHIEVEMENTS ── */}
        <Panel title="Succès" icon={<Award size={14} />}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
            {achievements.map((a, i) => (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                className={`flex items-center gap-2.5 rounded-xl border p-3 ${a.got ? 'border-[#c9a227]/40 bg-[#c9a227]/[0.07]' : 'border-white/8 bg-white/[0.02] opacity-45'}`}>
                <span className={a.got ? 'text-[#c9a227]' : 'text-white/30'}>{a.icon}</span>
                <span className={`text-[11px] font-bold ${a.got ? 'text-white/80' : 'text-white/40'}`}>{a.name}</span>
              </motion.div>
            ))}
          </div>
        </Panel>

        <div className="h-4" />
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────
function Kpi({ icon, label, value, accent = '#ffffff' }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-white/40 mb-1.5">{icon}<span className="text-[9px] uppercase tracking-widest font-bold">{label}</span></div>
      <p className="text-lg font-black font-mono" style={{ color: accent }}>{value}</p>
    </div>
  )
}
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3"><span className="text-[#c9a227]/80">{icon}</span><span className="text-[11px] font-bold text-white/55 uppercase tracking-widest">{title}</span></div>
      {children}
    </motion.div>
  )
}
function FormatCard({ title, accent, rows }: { title: string; accent: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: accent + '33', background: accent + '0a' }}>
      <h3 className="text-sm font-black uppercase tracking-widest mb-3" style={{ color: accent }}>{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-white/35 font-bold">{k}</p>
            <p className="text-[14px] font-black text-white/85 font-mono mt-0.5">{v}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfitChart({ pts }: { pts: number[] }) {
  const W = 560, H = 150, pad = 6
  const min = Math.min(...pts, 0), max = Math.max(...pts, 0.1)
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2)
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="pf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" /><stop offset="100%" stopColor="#4ade80" stopOpacity="0" /></linearGradient>
      </defs>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
      <motion.path initial={{ opacity: 0 }} animate={{ opacity: 1 }} d={area} fill="url(#pf)" />
      <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} d={line} fill="none" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill="#4ade80" />
    </svg>
  )
}

function Radar({ values }: { values: number[] }) {
  const C = 110, R = 86, n = values.length
  const pt = (i: number, rad: number) => { const a = (i / n) * 2 * Math.PI - Math.PI / 2; return [C + rad * Math.cos(a), C + rad * Math.sin(a)] }
  const poly = values.map((v, i) => pt(i, (v / 100) * R).join(',')).join(' ')
  const rings = [0.25, 0.5, 0.75, 1]
  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[260px] mx-auto" style={{ display: 'block' }}>
      {rings.map((f, k) => (
        <polygon key={k} points={values.map((_, i) => pt(i, f * R).join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      {values.map((_, i) => { const [ex, ey] = pt(i, R); return <line key={i} x1={C} y1={C} x2={ex} y2={ey} stroke="rgba(255,255,255,0.06)" /> })}
      <motion.polygon initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: 'center' }}
        points={poly} fill="rgba(201,162,39,0.22)" stroke="#c9a227" strokeWidth="2" />
      {values.map((v, i) => {
        const [lx, ly] = pt(i, R + 16)
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="rgba(255,255,255,0.6)">
            {SKILLS[i]} <tspan fill="#c9a227">{v}</tspan>
          </text>
        )
      })}
    </svg>
  )
}
