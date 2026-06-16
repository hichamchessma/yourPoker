import { useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Play, ChevronLeft, Trophy, Check, Timer } from 'lucide-react'
import { generateDecisionSpot, decisionReveal, DECISION_LABEL, type SpotContext, type DecisionSpot } from '../lib/spotTrainer'
import type { AdviceAction } from '../lib/postflopAdvisor'
import SpotTable from './SpotTable'

const ACCENT = '#f0a830' // amber — distinct from the teal "Lecture de spot"
const ACTION_COLOR: Record<AdviceAction, string> = {
  FOLD: '#c0392b', CALL: '#1f9d5e', RAISE: '#c9a227', BET: '#c9a227', CHECK: '#3aa0d8',
}
const TARGETS: AdviceAction[] = ['FOLD', 'CALL', 'RAISE', 'BET', 'CHECK']
const CHRONO_SECS = 8

export default function DecisionTrainer({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'setup' | 'quiz' | 'result'>('setup')
  const [context, setContext] = useState<SpotContext>('cash')
  const [chrono, setChrono] = useState(true)
  const [numHands, setNumHands] = useState(10)

  const [spot, setSpot] = useState<DecisionSpot | null>(null)
  const [picked, setPicked] = useState<AdviceAction | null>(null)
  const [handNo, setHandNo] = useState(0)
  const [secsLeft, setSecsLeft] = useState(CHRONO_SECS)

  const scoreRef = useRef({ correct: 0, total: 0 })
  const kindRef = useRef<Record<AdviceAction, { c: number; t: number }>>({ FOLD: { c: 0, t: 0 }, CALL: { c: 0, t: 0 }, RAISE: { c: 0, t: 0 }, BET: { c: 0, t: 0 }, CHECK: { c: 0, t: 0 } })
  const bagRef = useRef<AdviceAction[]>([])
  const nextSpotRef = useRef<DecisionSpot | null>(null)
  const explainRef = useRef<HTMLDivElement>(null)

  function nextTarget(): AdviceAction {
    if (bagRef.current.length === 0) bagRef.current = [...TARGETS].sort(() => Math.random() - 0.5)
    return bagRef.current.pop()!
  }
  function prefetch(ctx: SpotContext) { setTimeout(() => { nextSpotRef.current = generateDecisionSpot(ctx, nextTarget()) }, 30) }
  function takeSpot(ctx: SpotContext): DecisionSpot {
    const s = nextSpotRef.current ?? generateDecisionSpot(ctx, nextTarget())
    nextSpotRef.current = null; prefetch(ctx); return s
  }

  function start() {
    scoreRef.current = { correct: 0, total: 0 }
    kindRef.current = { FOLD: { c: 0, t: 0 }, CALL: { c: 0, t: 0 }, RAISE: { c: 0, t: 0 }, BET: { c: 0, t: 0 }, CHECK: { c: 0, t: 0 } }
    bagRef.current = []; nextSpotRef.current = null
    const s = takeSpot(context)
    setSpot(s); setPicked(null); setHandNo(0); setSecsLeft(CHRONO_SECS); setPhase('quiz')
  }

  function answer(a: AdviceAction | null) {
    if (picked || !spot) return
    setPicked(a ?? ('—' as AdviceAction))
    const ok = a === spot.correct
    scoreRef.current.total++; if (ok) scoreRef.current.correct++
    const ks = kindRef.current[spot.correct]; ks.t++; if (ok) ks.c++
    setTimeout(() => explainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60)
  }

  function next() {
    if (!spot) return
    if (handNo + 1 >= numHands) { setPhase('result'); return }
    const s = takeSpot(context)
    setSpot(s); setPicked(null); setHandNo(h => h + 1); setSecsLeft(CHRONO_SECS)
  }

  // Chrono: count down while the question is live; on 0, auto-reveal (no answer = wrong).
  useEffect(() => {
    if (phase !== 'quiz' || !chrono || picked) return
    if (secsLeft <= 0) { answer(null); return }
    const t = setTimeout(() => setSecsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chrono, picked, secsLeft])

  // ── SETUP ──
  if (phase === 'setup') {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md mt-4 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-6">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest mb-4"><ChevronLeft size={13} /> {t('decision.back')}</button>
        <h2 className="font-black uppercase tracking-widest text-sm mb-1" style={{ color: ACCENT }}>{t('decision.title')}</h2>
        <p className="text-[11px] text-white/40 mb-5 leading-relaxed">{t('decision.intro')}</p>

        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('decision.context')}</label>
        <div className="grid grid-cols-2 gap-2 mt-2 mb-4">
          {([['cash', t('decision.cash')], ['mtt', t('decision.mtt')]] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setContext(id)} className="rounded-xl border p-3 text-left transition-all"
              style={context === id ? { borderColor: ACCENT, background: ACCENT + '1a' } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[12px] font-black" style={{ color: context === id ? ACCENT : 'rgba(255,255,255,0.7)' }}>{lbl}</p>
            </button>
          ))}
        </div>

        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('decision.mode')}</label>
        <div className="grid grid-cols-2 gap-2 mt-2 mb-4">
          {([['chrono', true, t('decision.reflex')], ['calme', false, t('decision.calm')]] as const).map(([id, val, lbl]) => (
            <button key={id} onClick={() => setChrono(val)} className="rounded-xl border p-3 text-left transition-all flex items-center gap-2"
              style={chrono === val ? { borderColor: ACCENT, background: ACCENT + '1a' } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
              {val && <Timer size={14} style={{ color: chrono === val ? ACCENT : '#888' }} />}
              <p className="text-[11px] font-black" style={{ color: chrono === val ? ACCENT : 'rgba(255,255,255,0.7)' }}>{lbl}</p>
            </button>
          ))}
        </div>

        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('decision.numHands')}</label>
        <div className="flex items-center gap-3 mt-2 mb-6">
          <input type="range" min={5} max={25} step={5} value={numHands} onChange={e => setNumHands(+e.target.value)} className="flex-1" style={{ accentColor: ACCENT }} />
          <span className="text-lg font-black font-mono w-8 text-right" style={{ color: ACCENT }}>{numHands}</span>
        </div>

        <button onClick={start} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
          style={{ background: `linear-gradient(135deg,${ACCENT},#c9781a)`, color: '#2a1604' }}>
          <Play size={16} /> {t('decision.start')}
        </button>
      </motion.div>
    )
  }

  // ── RESULT ──
  if (phase === 'result') {
    const { correct, total } = scoreRef.current
    const ratio = total ? correct / total : 0
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <Trophy size={38} className="mx-auto mb-2" style={{ color: ACCENT }} />
        <h2 className="text-white/80 font-black uppercase tracking-widest text-sm">{t('decision.result')}</h2>
        <p className="text-5xl font-black font-mono my-3" style={{ color: ACCENT }}>{correct}<span className="text-white/30 text-2xl">/{total}</span></p>
        <p className="text-sm font-bold mb-5" style={{ color: ratio >= 0.8 ? '#4ade80' : ratio >= 0.6 ? '#fbbf24' : '#f87171' }}>
          {Math.round(ratio * 100)}% — {ratio >= 0.8 ? t('decision.sharp') : ratio >= 0.6 ? t('decision.coming') : t('decision.rework')}
        </p>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 mb-5 space-y-2">
          {TARGETS.map(k => {
            const s = kindRef.current[k]; if (s.t === 0) return null; const r = s.c / s.t
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[10px] w-14 text-left font-bold uppercase tracking-wide" style={{ color: ACTION_COLOR[k] }}>{DECISION_LABEL[k]}</span>
                <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: r >= 0.7 ? '#34d399' : r >= 0.5 ? '#fbbf24' : '#f87171' }} /></div>
                <span className="text-[10px] font-mono text-white/45 w-10 text-right">{s.c}/{s.t}</span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3">
          <button onClick={start} className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest" style={{ background: `linear-gradient(135deg,${ACCENT},#c9781a)`, color: '#2a1604' }}>{t('decision.replay')}</button>
          <button onClick={() => setPhase('setup')} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest border border-white/15 bg-white/5 text-white/60 hover:bg-white/10">{t('decision.settings')}</button>
        </div>
      </motion.div>
    )
  }

  // ── QUIZ ──
  if (!spot) return null
  const reveal = picked !== null
  const rev = reveal ? decisionReveal(spot) : null
  const bbU = (chips: number) => Math.round(chips / spot.bb * 10) / 10
  const prompt = spot.facingBet
    ? t('decision.promptBet', { bb: bbU(spot.toCall), pct: Math.round(spot.betFrac * 100) })
    : t('decision.promptCheck')

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-4xl mt-4">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest"><ChevronLeft size={13} /> {t('decision.quit')}</button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide" style={{ background: ACCENT + '22', color: ACCENT }}>{spot.context === 'mtt' ? t('decision.tournament') : t('decision.cash')}</span>
          {chrono && !reveal && <span className="text-[11px] font-black font-mono px-2 py-0.5 rounded" style={{ background: secsLeft <= 3 ? 'rgba(220,38,38,0.2)' : 'rgba(255,255,255,0.06)', color: secsLeft <= 3 ? '#f87171' : '#fff' }}>⏱ {secsLeft}s</span>}
          <span className="text-[11px] text-white/45 font-bold uppercase tracking-widest">{t('decision.hand', { n: handNo + 1, total: numHands })}</span>
          <span className="text-[11px] font-bold"><span style={{ color: ACCENT }}>{scoreRef.current.correct}</span><span className="text-white/30">/{scoreRef.current.total}</span></span>
        </div>
      </div>

      <SpotTable spot={spot} />

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mt-3">
        <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: ACCENT }}>{t('decision.goodTitle')}</p>
        <p className="text-[13px] text-white/85 font-semibold mb-3 leading-snug">{spot.story} <span style={{ color: ACCENT }}>{prompt}</span></p>

        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${spot.options.length}, 1fr)` }}>
          {spot.options.map(o => {
            const isCorrect = o === spot.correct
            const isPicked = picked === o
            let style: React.CSSProperties = { borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)' }
            if (reveal && isCorrect) style = { borderColor: '#16a34a', background: 'rgba(22,163,74,0.22)', color: '#86efac' }
            else if (reveal && isPicked && !isCorrect) style = { borderColor: '#dc2626', background: 'rgba(220,38,38,0.2)', color: '#fca5a5' }
            return (
              <button key={o} disabled={reveal} onClick={() => answer(o)}
                className="py-3.5 rounded-xl text-sm font-black uppercase tracking-widest border transition-all disabled:cursor-default enabled:hover:scale-[1.03]"
                style={style}>{DECISION_LABEL[o]}{reveal && isCorrect && ' ✓'}{reveal && isPicked && !isCorrect && ' ✗'}</button>
            )
          })}
        </div>

        {reveal && rev && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div ref={explainRef} className="mt-3 p-3.5 rounded-xl border"
              style={{ borderColor: (picked === spot.correct ? '#16a34a' : '#fbbf24') + '55', background: (picked === spot.correct ? '#16a34a' : '#fbbf24') + '12' }}>
              <p className="text-[11px] uppercase tracking-widest font-black mb-1.5" style={{ color: picked === spot.correct ? '#4ade80' : '#fbbf24' }}>
                {picked === spot.correct ? t('decision.revealGood') : picked === ('—' as AdviceAction) ? t('decision.revealTimeout') : t('decision.revealMove')} : <span style={{ color: ACCENT }}>{rev.correctLabel}</span> ({spot.advice.sizingText})
              </p>
              <p className="text-[12.5px] text-white/85 leading-relaxed mb-1.5">{rev.lesson}</p>
              <p className="text-[11.5px] leading-relaxed mb-1.5" style={{ color: '#cbe9d8' }}><b style={{ color: '#34d399' }}>{t('decision.twoQ')}</b> {rev.twoQuestions}</p>
              {rev.sizingTell && <p className="text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(240,168,48,0.10)', color: 'rgba(255,255,255,0.8)' }}>{rev.sizingTell}</p>}
              <p className="text-[10px] text-white/45 mt-1.5">{t('decision.equityBucket', { eq: Math.round(rev.equity * 100), bucket: rev.bucket })}</p>
            </div>
            <button onClick={next} className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl font-black uppercase tracking-[0.18em] text-[12px]"
              style={{ background: `linear-gradient(135deg,${ACCENT},#c9781a)`, color: '#2a1604' }}>
              {handNo + 1 < numHands ? <>{t('decision.nextHand')}</> : <><Check size={14} /> {t('decision.seeResult')}</>}
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
