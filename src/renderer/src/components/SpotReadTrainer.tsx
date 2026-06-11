import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronLeft, Trophy, Check } from 'lucide-react'
import { generateSpot, buildQuestions, type SpotContext, type TrainerSpot, type SpotQuestion, type QKind } from '../lib/spotTrainer'
import type { HandBucket } from '../lib/postflopAdvisor'
import SpotTable from './SpotTable'

const ACCENT = '#2dd4bf'
const KIND_LABEL: Record<QKind, string> = { texture: 'Texture', rangehit: 'Range', equity: 'Équité', bucket: 'Seau' }
const KIND_ORDER: QKind[] = ['texture', 'rangehit', 'equity', 'bucket']

export default function SpotReadTrainer({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<'setup' | 'quiz' | 'result'>('setup')
  const [context, setContext] = useState<SpotContext>('cash')
  const [numHands, setNumHands] = useState(8)

  const [spot, setSpot] = useState<TrainerSpot | null>(null)
  const [questions, setQuestions] = useState<SpotQuestion[]>([])
  const [qi, setQi] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [handNo, setHandNo] = useState(0)

  const scoreRef = useRef({ correct: 0, total: 0 })
  const kindRef = useRef<Record<QKind, { c: number; t: number }>>({ texture: { c: 0, t: 0 }, rangehit: { c: 0, t: 0 }, equity: { c: 0, t: 0 }, bucket: { c: 0, t: 0 } })
  const bagRef = useRef<HandBucket[]>([])
  const nextSpotRef = useRef<TrainerSpot | null>(null)

  function nextTarget(): HandBucket {
    if (bagRef.current.length === 0) bagRef.current = (['value', 'bluffcatch', 'draw', 'air'] as HandBucket[]).sort(() => Math.random() - 0.5)
    return bagRef.current.pop()!
  }
  function prefetch(ctx: SpotContext) { setTimeout(() => { nextSpotRef.current = generateSpot(ctx, nextTarget()) }, 30) }
  function takeSpot(ctx: SpotContext): TrainerSpot {
    const s = nextSpotRef.current ?? generateSpot(ctx, nextTarget())
    nextSpotRef.current = null; prefetch(ctx); return s
  }

  function start() {
    scoreRef.current = { correct: 0, total: 0 }
    kindRef.current = { texture: { c: 0, t: 0 }, rangehit: { c: 0, t: 0 }, equity: { c: 0, t: 0 }, bucket: { c: 0, t: 0 } }
    bagRef.current = []; nextSpotRef.current = null
    const s = takeSpot(context)
    setSpot(s); setQuestions(buildQuestions(s)); setQi(0); setPicked(null); setHandNo(0); setPhase('quiz')
  }

  function answer(id: string) {
    if (picked) return
    setPicked(id)
    const q = questions[qi]
    const ok = !!q.options.find(o => o.id === id)?.correct
    scoreRef.current.total++; if (ok) scoreRef.current.correct++
    const ks = kindRef.current[q.kind]; ks.t++; if (ok) ks.c++
  }

  function next() {
    setPicked(null)
    if (qi + 1 < questions.length) { setQi(qi + 1); return }
    if (handNo + 1 >= numHands) { setPhase('result'); return }
    const s = takeSpot(context)
    setSpot(s); setQuestions(buildQuestions(s)); setQi(0); setHandNo(h => h + 1)
  }

  // ── SETUP ──
  if (phase === 'setup') {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest mb-4"><ChevronLeft size={13} /> Retour</button>
        <h2 className="font-black uppercase tracking-widest text-sm mb-1" style={{ color: ACCENT }}>Lecture de spot</h2>
        <p className="text-[11px] text-white/40 mb-5 leading-relaxed">Diagnostique chaque main comme un pro : <b className="text-white/60">texture → range → équité → seau</b>. 4 questions par situation.</p>

        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Contexte de jeu</label>
        <div className="grid grid-cols-2 gap-2 mt-2 mb-5">
          {([['cash', 'Cash 100bb', 'Profondeur fixe, sans ICM'], ['mtt', 'Tournoi MTT', 'Tapis variés 25-60bb']] as const).map(([id, lbl, sub]) => (
            <button key={id} onClick={() => setContext(id)}
              className="rounded-xl border p-3 text-left transition-all"
              style={context === id ? { borderColor: ACCENT, background: ACCENT + '1a' } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[12px] font-black" style={{ color: context === id ? ACCENT : 'rgba(255,255,255,0.7)' }}>{lbl}</p>
              <p className="text-[9px] text-white/35 mt-0.5">{sub}</p>
            </button>
          ))}
        </div>

        <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Nombre de mains</label>
        <div className="flex items-center gap-3 mt-2 mb-6">
          <input type="range" min={4} max={20} step={2} value={numHands} onChange={e => setNumHands(+e.target.value)} className="flex-1" style={{ accentColor: ACCENT }} />
          <span className="text-lg font-black font-mono w-8 text-right" style={{ color: ACCENT }}>{numHands}</span>
        </div>

        <button onClick={start} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
          style={{ background: `linear-gradient(135deg,${ACCENT},#0d9488)`, color: '#042a25' }}>
          <Play size={16} /> Commencer
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
        <h2 className="text-white/80 font-black uppercase tracking-widest text-sm">Résultat — Lecture de spot</h2>
        <p className="text-5xl font-black font-mono my-3" style={{ color: ACCENT }}>{correct}<span className="text-white/30 text-2xl">/{total}</span></p>
        <p className="text-sm font-bold mb-5" style={{ color: ratio >= 0.8 ? '#4ade80' : ratio >= 0.6 ? '#fbbf24' : '#f87171' }}>
          {Math.round(ratio * 100)}% — {ratio >= 0.8 ? 'Lecture solide 🔥' : ratio >= 0.6 ? 'Ça progresse' : 'À retravailler'}
        </p>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 mb-5 space-y-2">
          {KIND_ORDER.map(k => {
            const s = kindRef.current[k]; const r = s.t ? s.c / s.t : 0
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[10px] text-white/50 w-16 text-left font-bold uppercase tracking-wide">{KIND_LABEL[k]}</span>
                <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: r >= 0.7 ? '#34d399' : r >= 0.5 ? '#fbbf24' : '#f87171' }} />
                </div>
                <span className="text-[10px] font-mono text-white/45 w-10 text-right">{s.c}/{s.t}</span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3">
          <button onClick={start} className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest" style={{ background: `linear-gradient(135deg,${ACCENT},#0d9488)`, color: '#042a25' }}>Rejouer</button>
          <button onClick={() => setPhase('setup')} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest border border-white/15 bg-white/5 text-white/60 hover:bg-white/10">Réglages</button>
        </div>
      </motion.div>
    )
  }

  // ── QUIZ ──
  if (!spot || !questions[qi]) return null
  const q = questions[qi]
  const reveal = picked !== null
  const correctOpt = q.options.find(o => o.correct)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-2xl mt-4">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest"><ChevronLeft size={13} /> Quitter</button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide" style={{ background: ACCENT + '22', color: ACCENT }}>{spot.context === 'mtt' ? 'Tournoi' : 'Cash 100bb'}</span>
          <span className="text-[11px] text-white/45 font-bold uppercase tracking-widest">Main {handNo + 1}/{numHands}</span>
          <span className="text-[11px] font-bold"><span style={{ color: ACCENT }}>{scoreRef.current.correct}</span><span className="text-white/30">/{scoreRef.current.total}</span></span>
        </div>
      </div>

      <SpotTable spot={spot} />

      {/* step indicator */}
      <div className="flex items-center gap-1.5 mt-3 mb-2">
        {questions.map((qq, i) => (
          <div key={i} className="flex-1 flex items-center gap-1.5">
            <div className="h-1 flex-1 rounded-full" style={{ background: i < qi ? ACCENT : i === qi ? ACCENT + '99' : 'rgba(255,255,255,0.1)' }} />
            <span className="text-[8px] uppercase tracking-wide font-bold" style={{ color: i === qi ? ACCENT : 'rgba(255,255,255,0.3)' }}>{KIND_LABEL[qq.kind]}</span>
          </div>
        ))}
      </div>

      {/* question */}
      <AnimatePresence mode="wait">
        <motion.div key={`${handNo}-${qi}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mt-1">
          <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: ACCENT }}>{q.title}</p>
          <p className="text-[13px] text-white/85 font-semibold mb-3 leading-snug">{q.prompt}</p>
          <div className="grid grid-cols-1 gap-2">
            {q.options.map(o => {
              const isCorrect = o.correct
              const isPicked = picked === o.id
              let style: React.CSSProperties = { borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)' }
              if (reveal && isCorrect) style = { borderColor: '#16a34a', background: 'rgba(22,163,74,0.2)', color: '#86efac' }
              else if (reveal && isPicked && !isCorrect) style = { borderColor: '#dc2626', background: 'rgba(220,38,38,0.18)', color: '#fca5a5' }
              return (
                <button key={o.id} disabled={reveal} onClick={() => answer(o.id)}
                  className="text-left px-4 py-2.5 rounded-xl text-[12.5px] font-bold border transition-all disabled:cursor-default enabled:hover:scale-[1.01] enabled:hover:border-white/25"
                  style={style}>
                  {o.label}{reveal && isCorrect && ' ✓'}{reveal && isPicked && !isCorrect && ' ✗'}
                </button>
              )
            })}
          </div>

          {reveal && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
              <div className="mt-3 p-3 rounded-xl border" style={{ borderColor: ACCENT + '33', background: ACCENT + '0f' }}>
                <p className="text-[11.5px] text-white/80 leading-relaxed">
                  <span className="font-bold" style={{ color: picked === correctOpt?.id ? '#4ade80' : '#fbbf24' }}>{picked === correctOpt?.id ? '✅ Bien vu. ' : '💡 '}</span>
                  {q.explain}
                </p>
              </div>
              <button onClick={next} className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl font-black uppercase tracking-[0.18em] text-[12px]"
                style={{ background: `linear-gradient(135deg,${ACCENT},#0d9488)`, color: '#042a25' }}>
                {qi + 1 < questions.length ? <>Question suivante</> : handNo + 1 < numHands ? <>Main suivante</> : <><Check size={14} /> Voir le résultat</>}
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
