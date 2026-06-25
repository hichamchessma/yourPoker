import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { X, Play, TrendingUp, TrendingDown, Minus, Target, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { SessionEval, Street, LeakKind } from '../pages/GamePage'

const GRADE_COLOR: Record<SessionEval['grade'], string> = {
  S: '#f0c060', A: '#34d399', B: '#2dd4bf', C: '#f59e0b', D: '#f87171',
}
const STREET_KEY: Record<Street, string> = {
  preflop: 'crit.phasePreflop', flop: 'crit.phaseFlop', turn: 'crit.phaseTurn', river: 'crit.phaseRiver',
}
const LEAK_KEY: Record<LeakKind, string> = {
  'pf-loose': 'perf.leakPfLoose', overcall: 'perf.leakOvercall', passive: 'perf.leakPassive',
  overfold: 'perf.leakOverfold', overaggro: 'perf.leakOveraggro',
  'sizing-big': 'perf.leakSizingBig', 'sizing-small': 'perf.leakSizingSmall',
}
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

export default function PerfReportModal({ ev, trend, onClose, onReviewHand }: {
  ev: SessionEval
  trend: { avg: number | null; prevCount: number }
  onClose: () => void
  onReviewHand: (handId: number, actionIdx: number) => void
}) {
  const { t } = useTranslation()
  const color = GRADE_COLOR[ev.grade]
  const verdict = t(`perf.verdict${ev.grade}`)
  const delta = trend.avg != null ? ev.score - trend.avg : null

  // Score ring geometry
  const R = 52, C = 2 * Math.PI * R
  const fill = Math.max(0, Math.min(1, ev.score / 100))

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] flex items-center justify-center p-3" style={{ background: 'rgba(4,3,8,0.88)' }}
      onClick={onClose}>
      <motion.div initial={{ scale: 0.94, y: 18 }} animate={{ scale: 1, y: 0 }} onClick={e => e.stopPropagation()}
        className="relative w-full max-w-[680px] max-h-[92vh] overflow-y-auto rounded-2xl border"
        style={{ background: 'linear-gradient(180deg,#15110a 0%,#0c0a12 60%,#080711 100%)', borderColor: `${color}55`, boxShadow: `0 0 70px ${color}33` }}>

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10"
          style={{ background: 'rgba(12,9,18,0.92)', backdropFilter: 'blur(6px)' }}>
          <div className="flex items-center gap-2.5">
            <Target size={18} style={{ color }} />
            <div>
              <h2 className="text-[13px] font-black uppercase tracking-[0.2em]" style={{ color }}>{t('perf.title')}</h2>
              <p className="text-[10px] text-white/40">{t('perf.decisionsAnalyzed', { n: ev.decisions })}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors"><X size={20} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Score ring + verdict */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
              <svg width="132" height="132" className="-rotate-90">
                <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                <motion.circle cx="66" cy="66" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - fill) }}
                  transition={{ duration: 0.9, ease: 'easeOut' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[34px] font-black leading-none" style={{ color }}>{ev.score}</span>
                <span className="text-[9px] text-white/35 uppercase tracking-widest mt-0.5">{t('perf.aligned')}</span>
              </div>
              <div className="absolute -top-1 -right-1 w-9 h-9 rounded-full flex items-center justify-center text-[16px] font-black border-2"
                style={{ background: '#0c0a12', borderColor: color, color }}>{ev.grade}</div>
            </div>
            <div className="min-w-0">
              <p className="text-[14px] text-white/85 font-bold leading-snug">{verdict}</p>
              {ev.worstStreet && (
                <p className="text-[11px] text-amber-300/80 mt-1.5 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {t('perf.weakSpot', { street: t(STREET_KEY[ev.worstStreet]) })}
                </p>
              )}
              {ev.leaks.length === 0 && <p className="text-[11px] text-emerald-300/80 mt-1.5">{t('perf.noLeaks')}</p>}
              {/* Trend */}
              <div className="mt-2.5 flex items-center gap-2 text-[11px]">
                {delta == null ? (
                  <span className="text-white/35">{t('perf.trendNew')}</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-white/45">
                    {t('perf.trendAvg', { avg: trend.avg })}
                    <span className={`flex items-center gap-0.5 font-bold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-white/50'}`}>
                      {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tally */}
          <div className="grid grid-cols-3 gap-2.5">
            <Tally label={t('perf.tallyGood')} value={ev.good} color="#34d399" />
            <Tally label={t('perf.tallyOk')} value={ev.ok} color="#f59e0b" />
            <Tally label={t('perf.tallyMistake')} value={ev.mistake} color="#f87171" />
          </div>

          {/* Per-street accuracy */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 mb-2.5">{t('perf.byStreet')}</h3>
            <div className="space-y-2">
              {STREETS.map(s => {
                const st = ev.streets[s]
                const pctv = Math.round(st.acc * 100)
                const bar = st.n === 0 ? 'rgba(255,255,255,0.12)' : pctv >= 75 ? '#34d399' : pctv >= 55 ? '#f59e0b' : '#f87171'
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-16 text-[11px] text-white/55 font-semibold">{t(STREET_KEY[s])}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                      {st.n > 0 && <motion.div className="h-full rounded-full" style={{ background: bar }}
                        initial={{ width: 0 }} animate={{ width: `${pctv}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />}
                    </div>
                    <span className="w-14 text-right text-[11px] font-mono" style={{ color: st.n === 0 ? 'rgba(255,255,255,0.25)' : bar }}>
                      {st.n === 0 ? '—' : `${pctv}%`}
                    </span>
                    <span className="w-10 text-right text-[9px] text-white/30">{st.n > 0 ? t('perf.nDec', { n: st.n }) : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Leaks */}
          {ev.leaks.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 mb-2.5">{t('perf.leaksTitle')}</h3>
              <div className="flex flex-wrap gap-2">
                {ev.leaks.map(l => (
                  <span key={l.kind} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border"
                    style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.25)', color: '#fca5a5' }}>
                    <AlertTriangle size={11} /> {t(LEAK_KEY[l.kind])}
                    <span className="px-1.5 rounded bg-black/40 text-[10px] font-mono text-white/70">×{l.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Spots to review */}
          {ev.topMistakes.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 mb-2.5">{t('perf.reviewTitle')}</h3>
              <div className="space-y-2">
                {ev.topMistakes.map((m, i) => (
                  <button key={i} onClick={() => onReviewHand(m.handId, m.actionIdx)}
                    className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 transition-all text-left">
                    <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: m.verdict === 'mistake' ? 'rgba(248,113,113,0.15)' : 'rgba(245,158,11,0.15)' }}>
                      {m.verdict === 'mistake' ? <AlertTriangle size={13} className="text-red-400" /> : <CheckCircle2 size={13} className="text-amber-400" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-white/85 font-semibold truncate">{m.headline}</p>
                      <p className="text-[10px] text-white/40">{t('perf.handN', { n: m.handNum })} · {t(STREET_KEY[m.phase])}</p>
                    </div>
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/40 group-hover:text-[#f0c060] transition-colors">
                      <Play size={11} /> {t('perf.review')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Tally({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] py-2.5 px-3 text-center">
      <div className="text-[22px] font-black leading-none" style={{ color }}>{value}</div>
      <div className="text-[9px] text-white/40 uppercase tracking-widest mt-1">{label}</div>
    </div>
  )
}
