import { useState, useEffect, useRef } from 'react'
import { RotateCcw, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
import RangeHeatmap from './RangeHeatmap'
import type { RangeView } from '../lib/rangeEstimator'

// One frame of the "film": the range as it stood right after a given action, plus
// the teaching labels for that step. The grid animates (cells fade to grey, the
// surviving value hands brighten) as `step` advances through the history.
export type RangeStep = { view: RangeView; move: string; effect: string; caption: string }

const EMPTY: RangeStep = { view: { cells: {}, totalCombos: 0, pctOfHands: 0 }, move: '—', effect: '', caption: '' }

export default function RangeEvolution({ history, name, width = 462 }: {
  history: RangeStep[]
  name: string
  width?: number
}) {
  const steps = history && history.length ? history : []
  const last = Math.max(0, steps.length - 1)
  const multi = steps.length > 1
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(multi)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // Auto-play the film once, from the start of the hand to now (then it rests on
  // the current range; the user can replay/scrub manually).
  useEffect(() => {
    if (!playing || !multi) return
    if (step >= last) { setPlaying(false); return }
    timer.current = setTimeout(() => setStep(s => Math.min(last, s + 1)), step === 0 ? 720 : 840)
    return () => clearTimeout(timer.current)
  }, [playing, step, last, multi])

  const cur = steps[Math.min(step, last)] ?? EMPTY
  const s = width / 300
  const f = (px: number) => Math.round(px * s)
  const goto = (i: number) => { setPlaying(false); setStep(Math.max(0, Math.min(last, i))) }

  return (
    <div style={{ width }}>
      {/* The grid itself — its cells transition smoothly between steps (see RangeHeatmap). */}
      <RangeHeatmap view={cur.view} move={cur.move} effect={cur.effect} name={name} width={width} />

      {multi && (
        <div className="rounded-xl border border-[#c9a227]/30" style={{ background: 'rgba(7,13,26,0.97)', marginTop: f(5), padding: f(8) }}>
          {/* Per-step caption (synced with the grid) + position in the film */}
          <div className="flex items-center justify-between" style={{ marginBottom: f(6) }}>
            <span className="text-[#c9a227]/90 font-bold truncate" style={{ fontSize: f(9.5) }}>▸ {cur.caption || 'Évolution de la range'}</span>
            <span className="text-white/40 shrink-0" style={{ fontSize: f(8.5), marginLeft: f(6) }}>{step + 1}/{steps.length}</span>
          </div>

          {/* Timeline — one clickable pip per action, filled up to the current step */}
          <div className="flex items-center" style={{ gap: f(3), marginBottom: f(7) }}>
            {steps.map((st, i) => (
              <button key={i} onClick={() => goto(i)} title={st.caption}
                className="flex-1 rounded-full transition-all hover:opacity-100"
                style={{ height: f(5), opacity: i <= step ? 1 : 0.55, background: i <= step ? 'rgba(201,162,39,0.9)' : 'rgba(255,255,255,0.12)' }} />
            ))}
          </div>

          {/* Transport controls */}
          <div className="flex items-center justify-center" style={{ gap: f(6) }}>
            <Ctl f={f} onClick={() => goto(step - 1)} disabled={step <= 0}><ChevronLeft size={f(13)} /></Ctl>
            <Ctl f={f} onClick={() => { if (step >= last) { setStep(0); setPlaying(true) } else setPlaying(p => !p) }} title={playing ? 'Pause' : 'Lecture'}>
              {playing ? <Pause size={f(13)} /> : <Play size={f(13)} />}
            </Ctl>
            <Ctl f={f} onClick={() => goto(step + 1)} disabled={step >= last}><ChevronRight size={f(13)} /></Ctl>
            <Ctl f={f} onClick={() => { setStep(0); setPlaying(true) }} title="Rejouer le film depuis le début"><RotateCcw size={f(12)} /></Ctl>
          </div>

          <p className="text-center text-white/30" style={{ fontSize: f(7.5), marginTop: f(6) }}>
            ⏸ chrono en pause — observe comment sa range s'est resserrée
          </p>
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
