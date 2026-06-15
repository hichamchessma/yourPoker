import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Trophy, Search, Crown, Flame, TrendingUp, Users, Spade } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { getRoster, playersOnline, recentWins, heroRank, type RosterPlayer } from '../lib/leaderboard'
import { computePlayerStats } from '../lib/playerStats'

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR')

// Deterministic "online" flag per player, drifting slowly so dots feel alive.
function isOnline(id: number, bucket: number) { return ((id * 7 + bucket) % 5) < 2 }

export default function LeaderboardPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const heroName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Toi'

  const roster = useMemo(() => getRoster(), [])
  const stats = useMemo(() => computePlayerStats(), [])
  const heroRating = Math.round(1200 + Math.min(720, stats.totalHands * 2) + (stats.tourItmPct - 15) * 8 + (stats.cashNetBB > 0 ? 60 : 0))
  const hero = useMemo(() => heroRank(heroRating), [heroRating])

  const [online, setOnline] = useState(() => playersOnline())
  const [wins, setWins] = useState(() => recentWins(8))
  const [query, setQuery] = useState('')
  const bucket = Math.floor(Date.now() / 20000)

  useEffect(() => {
    const a = setInterval(() => setOnline(playersOnline()), 4000)
    const b = setInterval(() => setWins(recentWins(8)), 8000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  const list = useMemo(() => {
    if (!query.trim()) return roster.slice(0, 100)
    const q = query.trim().toLowerCase()
    return roster.filter(p => p.name.toLowerCase().includes(q)).slice(0, 100)
  }, [roster, query])

  const podium = roster.slice(0, 3)

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'radial-gradient(130% 100% at 50% -10%, #14223a 0%, #0a1120 45%, #060912 100%)' }}>
      <Spade size={420} className="fixed -right-24 -bottom-24 text-white/[0.015] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <Trophy className="text-[#c9a227]" size={24} />
          <h1 className="text-xl font-black text-[#c9a227] uppercase tracking-[0.2em]">{t('nav.leaderboard')}</h1>
          <span className="ml-auto flex items-center gap-2 text-[12px] text-white/55">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span>
            {t('lobby.online', { count: fmt(online) })}
          </span>
        </div>
        <p className="text-[11px] text-white/35 mb-4">{t('lb.ranked', { count: fmt(roster.length + 1) })}</p>

        {/* Recent wins ticker */}
        <div className="mb-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-6 px-4 py-2 whitespace-nowrap animate-[scroll_30s_linear_infinite] hover:[animation-play-state:paused]">
            {[...wins, ...wins].map((w, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-white/55">
                <Flame size={12} className="text-orange-400" /> {w.flag} <b className="text-white/80">{w.name}</b> {t('lb.winVerb')} <b className="text-emerald-400">+${fmt(w.amount)}</b> <span className="text-white/30">({w.kind === 'tournoi' ? t('lb.kindTournoi') : t('lb.kindCash')})</span>
              </span>
            ))}
          </div>
        </div>

        {/* Podium */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[1, 0, 2].map((idx, col) => {
            const p = podium[idx]; if (!p) return <div key={col} />
            const medal = idx === 0 ? '#f0d060' : idx === 1 ? '#c0c8d4' : '#cd8a54'
            const tall = idx === 0
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: col * 0.06 }}
                className={`rounded-2xl border p-4 text-center ${tall ? 'mt-0' : 'mt-5'}`}
                style={{ borderColor: medal + '55', background: `linear-gradient(180deg, ${medal}14, transparent)` }}>
                <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-2 text-lg font-black" style={{ background: medal + '22', color: medal, border: `2px solid ${medal}` }}>{idx + 1}</div>
                <p className="text-[13px] font-black text-white/90 truncate">{p.flag} {p.name}</p>
                <p className="text-[10px] uppercase tracking-widest font-bold mt-0.5" style={{ color: p.tierColor }}>{p.tier}</p>
                <p className="text-[15px] font-black font-mono mt-1" style={{ color: medal }}>{fmt(p.rating)}</p>
                <p className="text-[9px] text-white/35">{t('lb.podiumSub', { roi: p.roi, hands: fmt(p.hands) })}</p>
              </motion.div>
            )
          })}
        </div>

        {/* Your rank */}
        <div className="mb-4 rounded-2xl border border-[#c9a227]/40 bg-[#c9a227]/[0.07] p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#c9a227]/20 border border-[#c9a227]/50 flex items-center justify-center text-[#c9a227]"><Crown size={20} /></div>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{t('lb.yourRank')}</p>
            <p className="text-[15px] font-black text-white/90">{heroName}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black font-mono text-[#c9a227]">#{fmt(hero.rank)}</p>
            <p className="text-[10px] text-white/35">{t('lb.rankSub', { total: fmt(hero.total), rating: fmt(heroRating) })}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('lb.search')}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-xs text-white/70 placeholder-white/25 focus:outline-none focus:border-[#c9a227]/40" />
        </div>

        {/* Ranked list */}
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[48px_1fr_70px_70px_80px] gap-2 px-4 py-2 bg-white/[0.04] text-[9px] uppercase tracking-widest text-white/40 font-bold">
            <span>#</span><span>{t('lb.colPlayer')}</span><span className="text-right">{t('lb.colRating')}</span><span className="text-right">{t('lb.colItm')}</span><span className="text-right">{t('lb.colRoi')}</span>
          </div>
          <div className="divide-y divide-white/5">
            {list.map((p: RosterPlayer) => (
              <div key={p.id} className="grid grid-cols-[48px_1fr_70px_70px_80px] gap-2 px-4 py-2 items-center hover:bg-white/[0.03] transition-colors">
                <span className={`font-mono font-bold text-[12px] ${p.rank <= 3 ? 'text-[#c9a227]' : 'text-white/40'}`}>{p.rank}</span>
                <span className="flex items-center gap-2 min-w-0">
                  {isOnline(p.id, bucket) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title={t('lb.online')} />}
                  <span className="text-[12px] text-white/80 truncate">{p.flag} {p.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide flex-shrink-0" style={{ background: p.tierColor + '1f', color: p.tierColor }}>{p.tier}</span>
                </span>
                <span className="text-right font-mono text-[12px] text-white/70">{fmt(p.rating)}</span>
                <span className="text-right font-mono text-[12px] text-white/55">{p.itm}%</span>
                <span className={`text-right font-mono text-[12px] font-bold ${p.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{p.roi >= 0 ? '+' : ''}{p.roi}%</span>
              </div>
            ))}
            {list.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-white/30">{t('lb.noPlayer')}</div>}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-white/30">
          <span className="flex items-center gap-1"><Users size={11} /> {t('lb.players', { count: fmt(roster.length + 1) })}</span>
          <span className="flex items-center gap-1"><TrendingUp size={11} /> {t('lb.top100')}</span>
        </div>
        <div className="h-4" />
      </div>
    </div>
  )
}
