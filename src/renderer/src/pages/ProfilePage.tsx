import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Trophy, Target, Flame, Award, Crown, Shield,
  Spade, Star, BookMarked, Sparkles, GraduationCap, Medal,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { loadSessions } from '../lib/historyStore'
import { computePlayerStats } from '../lib/playerStats'
import { useIsPro } from '../lib/entitlements'

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')

// Tier derived from REAL recorded volume (highlight hands), not an invented rating.
const TIERS = [
  { name: 'Débutant', color: '#9aa4b2', min: 0 },
  { name: 'Apprenti', color: '#22c55e', min: 200 },
  { name: 'Régulier', color: '#38bdf8', min: 1000 },
  { name: 'Grinder', color: '#c9a227', min: 4000 },
  { name: 'Requin', color: '#e0457b', min: 12000 },
]

export default function ProfilePage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Joueur'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
  const email = user?.email || 'joueur@poker.elite'

  const isPro = useIsPro()
  const stats = useMemo(() => computePlayerStats(6), [])
  const tier = [...TIERS].reverse().find(t => stats.totalHands >= t.min) ?? TIERS[0]
  const ringColor = isPro ? '#f0d060' : tier.color

  // Real cumulative profit curve (cash BB if any, otherwise tournament $), chronological.
  const { curve, curveLabel } = useMemo(() => {
    const cash = [...loadSessions('cash')].reverse()
    const tour = [...loadSessions('tournament')].reverse()
    if (cash.length > 0) {
      let acc = 0; const pts = cash.map(s => (acc += s.resultBB))
      return { curve: [0, ...pts], curveLabel: 'Profit cash cumulé (BB)' }
    }
    if (tour.length > 0) {
      let acc = 0; const pts = tour.map(s => (acc += s.resultBB))
      return { curve: [0, ...pts], curveLabel: 'Résultat tournois cumulé ($)' }
    }
    return { curve: [] as number[], curveLabel: 'Profit cumulé' }
  }, [])

  const savedScenarios = (() => { try { return JSON.parse(localStorage.getItem('yourpoker_scenarios') || '[]').length } catch { return 0 } })()
  const customRanges = !!localStorage.getItem('yourpoker_handtrainer_ranges')

  const achievements = [
    { icon: <GraduationCap size={18} />, name: 'Première session', got: stats.totalSessions >= 1 },
    { icon: <Flame size={18} />, name: '500 mains jouées', got: stats.totalHands >= 500 },
    { icon: <Medal size={18} />, name: 'Premier tournoi', got: stats.tourPlayed >= 1 },
    { icon: <Crown size={18} />, name: 'Dans les places payées', got: stats.tourItmPct > 0 },
    { icon: <Trophy size={18} />, name: 'Cash gagnant', got: stats.cashNetBB > 0 },
    { icon: <Target size={18} />, name: 'Ranges personnalisées', got: customRanges },
    { icon: <BookMarked size={18} />, name: 'Scénariste', got: savedScenarios > 0 },
    { icon: <Shield size={18} />, name: 'Grinder (4k mains)', got: stats.totalHands >= 4000 },
  ]

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'radial-gradient(130% 100% at 50% -10%, #14223a 0%, #0a1120 45%, #060912 100%)' }}>
      <Spade size={420} className="fixed -right-24 -bottom-24 text-white/[0.015] pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* ── HERO HEADER ── */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl border border-[#c9a227]/20 overflow-hidden mb-5"
          style={{ background: 'linear-gradient(120deg, rgba(201,162,39,0.08), rgba(0,212,255,0.05) 60%, transparent)' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 15% 0%, rgba(201,162,39,0.16), transparent 70%)' }} />
          <div className="relative flex flex-col md:flex-row items-center gap-6 p-6">
            {/* avatar with tier (or gold Pro) ring */}
            <div className="relative shrink-0">
              {isPro && (
                <motion.div initial={{ y: 6, opacity: 0, scale: 0.7 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                  <Crown size={30} className="text-[#f0d060] drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" fill="#f0d060" />
                </motion.div>
              )}
              <div className="w-28 h-28 rounded-full p-[3px]"
                style={{ background: isPro ? 'conic-gradient(#f0d060,#c9a227,#fff3c0,#c9a227,#f0d060)' : `conic-gradient(${tier.color}, #00d4ff, ${tier.color})`, boxShadow: isPro ? '0 0 22px rgba(201,162,39,0.55)' : undefined }}>
                <div className="w-full h-full rounded-full overflow-hidden bg-[#0a1120] flex items-center justify-center">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-4xl font-black text-[#c9a227]">{displayName[0].toUpperCase()}</span>}
                </div>
              </div>
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border"
                style={{ background: '#0a1120', color: ringColor, borderColor: ringColor }}>{tier.name}</span>
            </div>

            {/* identity */}
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2.5">
                <h1 className="text-2xl font-black text-white tracking-wide">{displayName}</h1>
                {isPro && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest text-[#1a1206]" style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)' }}>
                    <Crown size={11} fill="#1a1206" /> Pro
                  </span>
                )}
              </div>
              <p className="text-[12px] text-white/40 mt-0.5">{email}</p>
              <div className="flex items-center justify-center md:justify-start gap-3 mt-3">
                <span className="flex items-center gap-1.5 text-[12px] text-white/60"><Sparkles size={13} className="text-[#c9a227]" /> Palier <b className="text-[#c9a227]">{tier.name}</b></span>
                <span className="h-3 w-px bg-white/15" />
                <span className="text-[12px] text-white/60">{fmt(stats.totalHands)} mains jouées</span>
              </div>
            </div>

            {/* headline — real cash net */}
            <div className="shrink-0 text-center px-5 py-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06]">
              <p className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Net cash</p>
              <p className={`text-3xl font-black font-mono ${stats.cashNetBB >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{stats.cashNetBB >= 0 ? '+' : ''}{fmt(stats.cashNetBB)} <span className="text-base">BB</span></p>
              <p className="text-[10px] text-white/35 mt-0.5">sur {stats.cashPlayed} session{stats.cashPlayed > 1 ? 's' : ''}</p>
            </div>
          </div>
        </motion.div>

        {!stats.hasData && (
          <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center">
            <p className="text-sm text-white/55">Tu n'as pas encore de session enregistrée.</p>
            <p className="text-[12px] text-white/35 mt-1">Joue un tournoi ou une session cash — tes vraies stats s'afficheront ici.</p>
            <button onClick={() => navigate('/lobby')} className="mt-3 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide bg-[#c9a227]/15 border border-[#c9a227]/40 text-[#c9a227] hover:bg-[#c9a227]/25 transition-all">Aller au lobby</button>
          </div>
        )}

        {/* ── KPI ROW (real) ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <Kpi icon={<Spade size={15} />} label="Mains jouées" value={fmt(stats.totalHands)} />
          <Kpi icon={<GraduationCap size={15} />} label="Sessions" value={fmt(stats.totalSessions)} />
          <Kpi icon={<Medal size={15} />} label="Tournois" value={fmt(stats.tourPlayed)} />
          <Kpi icon={<Crown size={15} />} label="ITM tournois" value={stats.tourPlayed ? `${stats.tourItmPct}%` : '—'} accent="#c9a227" />
          <Kpi icon={<TrendingUp size={15} />} label="Net cash" value={`${stats.cashNetBB >= 0 ? '+' : ''}${fmt(stats.cashNetBB)} BB`} accent={stats.cashNetBB >= 0 ? '#4ade80' : '#f87171'} />
          <Kpi icon={<Trophy size={15} />} label="Net tournois" value={`${stats.tourNet >= 0 ? '+' : ''}$${fmt(stats.tourNet)}`} accent={stats.tourNet >= 0 ? '#4ade80' : '#f87171'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
          {/* ── PROFIT CHART (real) ── */}
          <Panel title={curveLabel} icon={<TrendingUp size={14} />}>
            {curve.length > 1 ? (
              <>
                <ProfitChart pts={curve} />
                <div className="flex items-center justify-between mt-2 text-[10px] text-white/40">
                  <span>Meilleure session : <b className="text-emerald-400">+{fmt(Math.max(stats.bestCashBB, 0))} BB</b></span>
                  <span>Sur {fmt(stats.totalHands)} mains</span>
                </div>
              </>
            ) : (
              <div className="h-[150px] flex items-center justify-center text-[12px] text-white/30">Pas encore assez de sessions pour tracer une courbe.</div>
            )}
          </Panel>

          {/* ── RECENT SESSIONS (real) ── */}
          <Panel title="Dernières sessions" icon={<Star size={14} />}>
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
              <div className="h-[120px] flex items-center justify-center text-[12px] text-white/30">Aucune session terminée pour l'instant.</div>
            )}
          </Panel>
        </div>

        {/* ── FORMAT SPLIT (real) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 my-5">
          <FormatCard title="Cash Game" accent="#00d4ff" rows={[
            ['Sessions', fmt(stats.cashPlayed)], ['Net', `${stats.cashNetBB >= 0 ? '+' : ''}${fmt(stats.cashNetBB)} BB`], ['Meilleure', `+${fmt(Math.max(stats.bestCashBB, 0))} BB`],
          ]} />
          <FormatCard title="Tournois (MTT)" accent="#c9a227" rows={[
            ['Tournois', fmt(stats.tourPlayed)], ['ITM', stats.tourPlayed ? `${stats.tourItmPct}%` : '—'], ['Net', `${stats.tourNet >= 0 ? '+' : ''}$${fmt(stats.tourNet)}`],
          ]} />
        </div>

        {/* ── ACHIEVEMENTS (real thresholds) ── */}
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
  const up = pts[pts.length - 1] >= 0
  const col = up ? '#4ade80' : '#f87171'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="pf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.35" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient>
      </defs>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
      <motion.path initial={{ opacity: 0 }} animate={{ opacity: 1 }} d={area} fill="url(#pf)" />
      <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} d={line} fill="none" stroke={col} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill={col} />
    </svg>
  )
}
