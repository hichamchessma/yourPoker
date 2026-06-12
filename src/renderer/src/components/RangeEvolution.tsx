import { useState, useEffect, useRef } from 'react'
import { RotateCcw, ChevronLeft, ChevronRight, Play, Pause, X } from 'lucide-react'
import RangeHeatmap from './RangeHeatmap'
import { explainHandStep, handCombos, type RangeView, type ActionCtx, type ActCat } from '../lib/rangeEstimator'

// One frame of the "film": the range as it stood right after a given action, plus
// the teaching labels AND the raw action context (so a clicked cell can be explained
// action-by-action). The grid animates (cells fade to grey, the surviving value
// hands brighten) as `step` advances through the history.
export type RangeStep = {
  view: RangeView; move: string; effect: string; caption: string
  ctx?: ActionCtx; observed?: ActCat   // absent on step 0 ("départ")
}

const EMPTY: RangeStep = { view: { cells: {}, totalCombos: 0, pctOfHands: 0 }, move: '—', effect: '', caption: '' }

function colorVerdict(intensity: number): { label: string; color: string } {
  if (intensity < 0.04) return { label: 'GRISÉE — éliminée de la range', color: '#9aa3ad' }
  if (intensity > 0.55) return { label: 'JAUNE VIF — cœur de range', color: '#e8c547' }
  return { label: 'OR PÂLE — encore là, mais réduite (jouée en mixte)', color: '#c9a227' }
}

export default function RangeEvolution({ history, name, width = 462, onClose, pinned }: {
  history: RangeStep[]
  name: string
  width?: number
  onClose?: () => void
  pinned?: boolean
}) {
  const steps = history && history.length ? history : []
  const last = Math.max(0, steps.length - 1)
  const multi = steps.length > 1
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(multi)
  const [selKey, setSelKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // Auto-play the film once, from the start of the hand to now.
  useEffect(() => {
    if (!playing || !multi) return
    if (step >= last) { setPlaying(false); return }
    timer.current = setTimeout(() => setStep(s => Math.min(last, s + 1)), step === 0 ? 720 : 840)
    return () => clearTimeout(timer.current)
  }, [playing, step, last, multi])

  // Escape: deselect a cell first, otherwise close the popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (selKey) setSelKey(null); else onClose?.() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selKey, onClose])

  const cur = steps[Math.min(step, last)] ?? EMPTY
  const s = width / 300
  const f = (px: number) => Math.round(px * s)
  const goto = (i: number) => { setPlaying(false); setStep(Math.max(0, Math.min(last, i))) }

  return (
    <div style={{ width, maxHeight: '94vh', overflowY: 'auto' }} className="rounded-xl">
      <div className="relative">
        <RangeHeatmap view={cur.view} move={cur.move} effect={cur.effect} name={name} width={width}
          onCellClick={setSelKey} selectedKey={selKey} />
        {pinned && (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-[#c9a227]/20 border border-[#c9a227]/40 text-[#c9a227] font-bold"
            style={{ fontSize: f(8.5), padding: `${f(2)}px ${f(6)}px` }}>📌 épinglé</span>
        )}
        {onClose && (
          <button onClick={onClose} title="Fermer (Échap)"
            className="absolute top-1.5 right-1.5 flex items-center justify-center rounded-md bg-black/40 border border-white/15 text-white/60 hover:text-white hover:bg-black/60 transition-all"
            style={{ width: f(20), height: f(20) }}><X size={f(12)} /></button>
        )}
      </div>

      {multi && (
        <div className="rounded-xl border border-[#c9a227]/30" style={{ background: 'rgba(7,13,26,0.97)', marginTop: f(5), padding: f(8) }}>
          <div className="flex items-center justify-between" style={{ marginBottom: f(6) }}>
            <span className="text-[#c9a227]/90 font-bold truncate" style={{ fontSize: f(9.5) }}>▸ {cur.caption || 'Évolution de la range'}</span>
            <span className="text-white/40 shrink-0" style={{ fontSize: f(8.5), marginLeft: f(6) }}>{step + 1}/{steps.length}</span>
          </div>

          <div className="flex items-center" style={{ gap: f(3), marginBottom: f(7) }}>
            {steps.map((st, i) => (
              <button key={i} onClick={() => goto(i)} title={st.caption}
                className="flex-1 rounded-full transition-all hover:opacity-100"
                style={{ height: f(5), opacity: i <= step ? 1 : 0.55, background: i <= step ? 'rgba(201,162,39,0.9)' : 'rgba(255,255,255,0.12)' }} />
            ))}
          </div>

          <div className="flex items-center justify-center" style={{ gap: f(6) }}>
            <Ctl f={f} onClick={() => goto(step - 1)} disabled={step <= 0}><ChevronLeft size={f(13)} /></Ctl>
            <Ctl f={f} onClick={() => { if (step >= last) { setStep(0); setPlaying(true) } else setPlaying(p => !p) }} title={playing ? 'Pause' : 'Lecture'}>
              {playing ? <Pause size={f(13)} /> : <Play size={f(13)} />}
            </Ctl>
            <Ctl f={f} onClick={() => goto(step + 1)} disabled={step >= last}><ChevronRight size={f(13)} /></Ctl>
            <Ctl f={f} onClick={() => { setStep(0); setPlaying(true) }} title="Rejouer le film depuis le début"><RotateCcw size={f(12)} /></Ctl>
          </div>

          <p className="text-center text-white/30" style={{ fontSize: f(7.5), marginTop: f(6) }}>
            {pinned
              ? '📌 épinglé — ✕ ou Échap pour fermer · clique une case pour le POURQUOI'
              : '⏸ clic ou Espace pour épingler · clique une case pour le POURQUOI'}
          </p>
        </div>
      )}

      {/* Per-hand explanation, rebuilt from the action history up to the current step */}
      {selKey && <HandExplain selKey={selKey} steps={steps} step={step} f={f} onClear={() => setSelKey(null)} />}
    </div>
  )
}

function HandExplain({ selKey, steps, step, f, onClear }: {
  selKey: string; steps: RangeStep[]; step: number; f: (px: number) => number; onClear: () => void
}) {
  const intensity = steps[Math.min(step, steps.length - 1)]?.view.cells[selKey] ?? 0
  const verdict = colorVerdict(intensity)
  // Trace: replay each of this seat's actions up to the current step on THIS hand.
  let survive = 1
  const lines: { caption: string; reason: string; prob: number }[] = []
  for (let i = 1; i <= step; i++) {
    const st = steps[i]
    if (!st?.ctx || !st.observed) continue
    const { prob, reason } = explainHandStep(selKey, st.observed, st.ctx)
    survive *= prob
    lines.push({ caption: st.caption, reason, prob })
  }
  const combos = handCombos(selKey)

  return (
    <div className="rounded-xl border" style={{ marginTop: f(5), padding: f(9), background: 'rgba(10,14,24,0.98)', borderColor: 'rgba(255,255,255,0.12)' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: f(6) }}>
        <span className="font-black text-white" style={{ fontSize: f(13) }}>Pourquoi <span style={{ color: '#e8c547' }}>{selKey}</span> ?</span>
        <button onClick={onClear} className="text-white/40 hover:text-white" style={{ fontSize: f(11) }}>✕</button>
      </div>
      <div className="rounded-lg" style={{ padding: `${f(4)}px ${f(7)}px`, marginBottom: f(7), background: 'rgba(255,255,255,0.04)' }}>
        <span style={{ fontSize: f(10.5), fontWeight: 800, color: verdict.color }}>{verdict.label}</span>
        <div className="text-white/45" style={{ fontSize: f(8.5), marginTop: f(1) }}>
          Départ : {combos} combos · survie estimée ≈ {Math.round(survive * 100)}% de ses combos
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="text-white/55" style={{ fontSize: f(10) }}>Aucune action de ce joueur pour l'instant : range de départ complète. Avance le film ▶ pour voir l'effet de chaque action sur {selKey}.</p>
      ) : (
        <div className="space-y-1.5">
          {lines.map((l, i) => {
            const col = l.prob >= 0.66 ? '#34d399' : l.prob <= 0.12 ? '#f0796b' : '#e8c547'
            const tag = l.prob >= 0.66 ? 'gardée' : l.prob <= 0.12 ? 'éliminée' : 'réduite'
            return (
              <div key={i} className="flex items-start gap-1.5">
                <span className="shrink-0 rounded font-bold uppercase tracking-wide" style={{ fontSize: f(8), padding: `${f(1)}px ${f(4)}px`, color: '#0a0a12', background: col, marginTop: f(1) }}>{tag}</span>
                <p className="text-white/80 leading-snug" style={{ fontSize: f(10.5) }}>
                  <b className="text-white/60">{l.caption} :</b> {l.reason} <span style={{ color: col }}>(×{l.prob.toFixed(2)})</span>
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Ctl({ children, onClick, disabled, title, f }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; f: (px: number) => number
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="flex items-center justify-center rounded-lg border border-[#c9a227]/30 bg-[#c9a227]/10 text-[#c9a227] disabled:opacity-25 enabled:hover:bg-[#c9a227]/20 transition-all"
      style={{ width: f(30), height: f(25) }}>
      {children}
    </button>
  )
}
