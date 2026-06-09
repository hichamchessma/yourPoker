import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Sliders, Play, Check, RotateCcw, ChevronLeft, Trophy } from 'lucide-react'
import WindowControls from '../components/layout/WindowControls'
import { GRID_RANKS, cellKey, handKeyFromCards, buildRangeMap } from '../lib/preflopRanges'

// ── Types ─────────────────────────────────────────────────────────────────────
type TScenario = 'open' | 'vsopen'
type TAction = 'open' | 'call' | '3bet' | 'fold'
type RangeMap = Record<string, TAction>           // handKey -> action
type Custom = Record<TScenario, Record<string, RangeMap>> // scenario -> position -> map

const POSITIONS = ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB']
const OPENERS = ['UTG', 'HJ', 'CO']
const SUITS = ['♠', '♥', '♦', '♣']
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const RED = (s: string) => s === '♥' || s === '♦'
const STORE_KEY = 'yourpoker_handtrainer_ranges'

const ACT: Record<TAction, { label: string; color: string; fg: string }> = {
  open: { label: 'OPEN', color: '#c9a227', fg: '#1a1206' },
  call: { label: 'CALL', color: '#16a34a', fg: '#fff' },
  '3bet': { label: '3-BET', color: '#dc2626', fg: '#fff' },
  fold: { label: 'FOLD', color: '#27313f', fg: '#9aa4b2' },
}
const SCEN_LABEL: Record<TScenario, string> = { open: 'Ouverture (RFI)', vsopen: 'Face à une relance' }

// Standard action for a (scenario, position, hand) from the app's reference charts.
function standardAction(scenario: TScenario, position: string, key: string, openerPos = 'CO'): TAction {
  if (scenario === 'open') {
    const a = buildRangeMap('rfi', position).get(key)
    return a === 'raise' ? 'open' : 'fold'
  }
  const a = buildRangeMap('vsopen', position, undefined, { vsOpenerPos: openerPos, raiseToBB: 2.5, effBB: 100 }).get(key)
  return a === '3bet' ? '3bet' : a === 'call' ? 'call' : 'fold'
}
function standardMap(scenario: TScenario, position: string): RangeMap {
  const m: RangeMap = {}
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const k = cellKey(i, j); m[k] = standardAction(scenario, position, k) }
  return m
}

interface Card { rank: string; suit: string }
interface Question { scenario: TScenario; position: string; openerPos: string; c1: Card; c2: Card; key: string; correct: TAction }

export default function HandTrainerPage() {
  const [screen, setScreen] = useState<'landing' | 'setup' | 'editor' | 'quiz' | 'result'>('landing')
  const [mode, setMode] = useState<'standard' | 'custom'>('standard')
  const [numHands, setNumHands] = useState(20)
  const [scenFilter, setScenFilter] = useState<'open' | 'vsopen' | 'mixed'>('mixed')
  const [custom, setCustom] = useState<Custom | null>(null)

  // quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [qi, setQi] = useState(0)
  const [score, setScore] = useState(0)
  const [picked, setPicked] = useState<TAction | null>(null)
  const wrongsRef = useRef<Question[]>([])

  function actionFor(scenario: TScenario, position: string, key: string, openerPos: string): TAction {
    if (mode === 'custom' && custom) return custom[scenario]?.[position]?.[key] ?? standardAction(scenario, position, key, openerPos)
    return standardAction(scenario, position, key, openerPos)
  }

  function buildQuestions(): Question[] {
    const qs: Question[] = []
    for (let n = 0; n < numHands; n++) {
      const scenario: TScenario = scenFilter === 'mixed' ? (Math.random() < 0.5 ? 'open' : 'vsopen') : scenFilter
      const position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)]
      const openerPos = OPENERS[Math.floor(Math.random() * OPENERS.length)]
      // random distinct cards
      const a = { rank: RANKS[Math.floor(Math.random() * 13)], suit: SUITS[Math.floor(Math.random() * 4)] }
      let b: Card
      do { b = { rank: RANKS[Math.floor(Math.random() * 13)], suit: SUITS[Math.floor(Math.random() * 4)] } } while (b.rank === a.rank && b.suit === a.suit)
      const key = handKeyFromCards(a, b)
      qs.push({ scenario, position, openerPos, c1: a, c2: b, key, correct: actionFor(scenario, position, key, openerPos) })
    }
    return qs
  }

  function startQuiz() {
    const qs = buildQuestions()
    setQuestions(qs); setQi(0); setScore(0); setPicked(null); wrongsRef.current = []
    setScreen('quiz')
  }

  function answer(a: TAction) {
    if (picked) return
    const q = questions[qi]
    setPicked(a)
    if (a === q.correct) setScore(s => s + 1)
    else wrongsRef.current.push(q)
    setTimeout(() => {
      if (qi + 1 >= questions.length) setScreen('result')
      else { setQi(qi + 1); setPicked(null) }
    }, 850)
  }

  // ── Editor: lazily seed standard ranges for all (scenario, position) ──────────
  function openEditor() {
    let seed: Custom
    try { seed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { seed = null as unknown as Custom }
    if (!seed) {
      seed = { open: {}, vsopen: {} }
      for (const p of POSITIONS) { seed.open[p] = standardMap('open', p); seed.vsopen[p] = standardMap('vsopen', p) }
    }
    setCustom(seed); setMode('custom'); setScreen('editor')
  }

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #0d1530 0%, #080b18 60%, #05070f 100%)' }}>
      <div className="app-drag flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          {screen !== 'landing' && (
            <button onClick={() => setScreen(screen === 'quiz' || screen === 'result' ? (mode === 'custom' ? 'setup' : 'setup') : 'landing')}
              className="app-drag-none text-white/40 hover:text-white/80"><ChevronLeft size={18} /></button>
          )}
          <Target className="text-[#00d4ff]" size={22} />
          <div>
            <h1 className="text-lg font-black text-[#00d4ff] uppercase tracking-[0.2em]">Hand Trainer</h1>
            <p className="text-[10px] text-white/35 uppercase tracking-widest">Entraîne tes ranges préflop — décision instantanée</p>
          </div>
        </div>
        <div className="app-drag-none"><WindowControls /></div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
        <AnimatePresence mode="wait">
          {/* ── LANDING ── */}
          {screen === 'landing' && (
            <motion.div key="landing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="w-full max-w-3xl mt-10">
              <p className="text-center text-white/50 mb-6 text-sm">Comment veux-tu t'entraîner ?</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <OptionCard icon={<Target size={28} />} title="Ranges standard"
                  desc="Entraîne-toi sur les ranges de référence déjà intégrées dans l'app."
                  onClick={() => { setMode('standard'); setScreen('setup') }} accent="#00d4ff" />
                <OptionCard icon={<Sliders size={28} />} title="Personnaliser mes ranges"
                  desc="Édite tes propres ranges par position (vert/rouge/jaune/gris), puis entraîne-toi dessus."
                  onClick={openEditor} accent="#c9a227" />
              </div>
            </motion.div>
          )}

          {/* ── SETUP ── */}
          {screen === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="w-full max-w-md mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="text-[#00d4ff] font-black uppercase tracking-widest text-sm mb-1">Réglages de l'exercice</h2>
              <p className="text-[10px] text-white/35 mb-5">{mode === 'custom' ? 'Tes ranges personnalisées' : 'Ranges standard'}</p>

              <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Nombre de mains</label>
              <div className="flex items-center gap-3 mt-2 mb-5">
                <input type="range" min={5} max={50} step={5} value={numHands} onChange={e => setNumHands(+e.target.value)} className="flex-1 accent-[#00d4ff]" />
                <span className="text-lg font-black text-[#00d4ff] font-mono w-10 text-right">{numHands}</span>
              </div>

              <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Type de spots</label>
              <div className="flex gap-1.5 mt-2 mb-6">
                {([['mixed', 'Mixte'], ['open', 'Ouverture'], ['vsopen', 'Face à relance']] as const).map(([id, lbl]) => (
                  <button key={id} onClick={() => setScenFilter(id)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all ${scenFilter === id ? 'bg-[#00d4ff] text-black border-[#00d4ff]' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>{lbl}</button>
                ))}
              </div>

              <button onClick={startQuiz}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>
                <Play size={16} /> Commencer l'entraînement
              </button>
              {mode === 'custom' && (
                <button onClick={() => setScreen('editor')} className="w-full mt-2 py-2 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest">← Modifier mes ranges</button>
              )}
            </motion.div>
          )}

          {/* ── EDITOR ── */}
          {screen === 'editor' && custom && (
            <RangeEditor key="editor" custom={custom} setCustom={setCustom}
              onValidate={() => { localStorage.setItem(STORE_KEY, JSON.stringify(custom)); setScreen('setup') }} />
          )}

          {/* ── QUIZ ── */}
          {screen === 'quiz' && questions[qi] && (() => {
            const q = questions[qi]
            const aggLabel = q.scenario === 'open' ? 'OPEN' : '3-BET'
            const aggAct: TAction = q.scenario === 'open' ? 'open' : '3bet'
            const reveal = picked !== null
            const btn = (act: TAction, label: string) => {
              const isCorrect = act === q.correct
              const isPicked = picked === act
              let style: React.CSSProperties = { borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }
              if (reveal && isCorrect) style = { borderColor: '#16a34a', background: 'rgba(22,163,74,0.22)', color: '#4ade80' }
              else if (reveal && isPicked && !isCorrect) style = { borderColor: '#dc2626', background: 'rgba(220,38,38,0.2)', color: '#f87171' }
              return (
                <button key={act} disabled={reveal} onClick={() => answer(act)}
                  className="flex-1 py-4 rounded-xl text-sm font-black uppercase tracking-widest border transition-all disabled:cursor-default enabled:hover:scale-[1.03]"
                  style={style}>{label}{reveal && isCorrect && ' ✓'}{reveal && isPicked && !isCorrect && ' ✗'}</button>
              )
            }
            return (
              <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-lg mt-6">
                {/* progress */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] text-white/45 font-bold uppercase tracking-widest">Main {qi + 1} / {questions.length}</span>
                  <span className="text-[11px] font-bold"><span className="text-emerald-400">{score}</span><span className="text-white/30"> bonnes</span></span>
                </div>
                <div className="h-1 rounded-full bg-white/8 overflow-hidden mb-6">
                  <div className="h-full bg-[#00d4ff] transition-all" style={{ width: `${(qi / questions.length) * 100}%` }} />
                </div>

                {/* spot */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center mb-5">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                    Position <span className="text-[#c9a227] font-bold">{q.position}</span> — {q.scenario === 'open' ? 'personne n\'a ouvert' : `face à l'ouverture de ${q.openerPos}`}
                  </p>
                  <div className="flex items-center justify-center gap-3 my-4">
                    {[q.c1, q.c2].map((c, i) => (
                      <div key={i} className="w-20 h-28 rounded-xl bg-white flex flex-col items-center justify-center shadow-lg" style={{ color: RED(c.suit) ? '#d32f2f' : '#1a1a1a' }}>
                        <span className="font-black text-4xl leading-none">{c.rank}</span>
                        <span className="text-3xl leading-none">{c.suit}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/30 font-mono">{q.key}</p>
                </div>

                {/* actions */}
                <div className="flex gap-3">
                  {btn('fold', 'FOLD')}
                  {btn('call', 'CALL')}
                  {btn(aggAct, aggLabel)}
                </div>
                {reveal && picked !== q.correct && (
                  <p className="text-center text-[11px] text-white/50 mt-3">Bonne réponse : <span className="font-bold" style={{ color: ACT[q.correct].color }}>{ACT[q.correct].label}</span></p>
                )}
              </motion.div>
            )
          })()}

          {/* ── RESULT ── */}
          {screen === 'result' && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <Trophy size={40} className="mx-auto text-[#c9a227] mb-2" />
              <h2 className="text-white/80 font-black uppercase tracking-widest text-sm">Résultat</h2>
              <p className="text-5xl font-black text-[#00d4ff] font-mono my-3">{score}<span className="text-white/30 text-2xl">/{questions.length}</span></p>
              <p className="text-sm font-bold mb-4" style={{ color: score / questions.length >= 0.8 ? '#4ade80' : score / questions.length >= 0.6 ? '#fbbf24' : '#f87171' }}>
                {Math.round((score / questions.length) * 100)}% — {score / questions.length >= 0.8 ? 'Excellent 🔥' : score / questions.length >= 0.6 ? 'Pas mal, continue' : 'À retravailler'}
              </p>
              {wrongsRef.current.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 mb-4 text-left max-h-[160px] overflow-y-auto">
                  <p className="text-[9px] uppercase tracking-widest text-white/40 font-bold mb-1.5">Erreurs ({wrongsRef.current.length})</p>
                  {wrongsRef.current.map((q, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] py-0.5">
                      <span className="text-white/55 font-mono">{q.key} <span className="text-white/30">{q.position} · {q.scenario === 'open' ? 'open' : 'vs ' + q.openerPos}</span></span>
                      <span className="font-bold" style={{ color: ACT[q.correct].color }}>{ACT[q.correct].label}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={startQuiz} className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest" style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>Rejouer</button>
                <button onClick={() => setScreen('setup')} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest border border-white/15 bg-white/5 text-white/60 hover:bg-white/10">Réglages</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Landing option card ───────────────────────────────────────────────────────
function OptionCard({ icon, title, desc, onClick, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick}
      className="text-left rounded-2xl border p-6 transition-all hover:scale-[1.02] hover:bg-white/[0.04]"
      style={{ borderColor: accent + '40', background: accent + '0d' }}>
      <span style={{ color: accent }}>{icon}</span>
      <h3 className="text-white font-black uppercase tracking-wide mt-3 text-sm" style={{ color: accent }}>{title}</h3>
      <p className="text-white/45 text-[12px] mt-1.5 leading-relaxed">{desc}</p>
      <div className="mt-4 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>Choisir <Play size={11} /></div>
    </button>
  )
}

// ── Range editor (paint cells with a brush) ──────────────────────────────────
function RangeEditor({ custom, setCustom, onValidate }: { custom: Custom; setCustom: (c: Custom) => void; onValidate: () => void }) {
  const [scenario, setScenario] = useState<TScenario>('open')
  const [position, setPosition] = useState('BTN')
  const [brush, setBrush] = useState<TAction>('open')
  const painting = useRef(false)
  const map = custom[scenario][position] ?? {}
  const actions: TAction[] = scenario === 'open' ? ['open', 'fold'] : ['3bet', 'call', 'fold']

  function paint(key: string) {
    const next: Custom = { ...custom, [scenario]: { ...custom[scenario], [position]: { ...custom[scenario][position], [key]: brush } } }
    setCustom(next)
  }
  function resetPos() {
    const next: Custom = { ...custom, [scenario]: { ...custom[scenario], [position]: standardMap(scenario, position) } }
    setCustom(next)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-3xl"
      onMouseUp={() => (painting.current = false)} onMouseLeave={() => (painting.current = false)}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* scenario */}
        <div className="flex gap-1">
          {(['open', 'vsopen'] as TScenario[]).map(s => (
            <button key={s} onClick={() => setScenario(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border ${scenario === s ? 'bg-[#00d4ff] text-black border-[#00d4ff]' : 'bg-white/5 text-white/50 border-white/10'}`}>{SCEN_LABEL[s]}</button>
          ))}
        </div>
        <div className="h-5 w-px bg-white/10" />
        {/* position */}
        <div className="flex gap-1 flex-wrap">
          {POSITIONS.map(p => (
            <button key={p} onClick={() => setPosition(p)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border ${position === p ? 'bg-[#c9a227] text-black border-[#c9a227]' : 'bg-white/5 text-white/50 border-white/10'}`}>{p}</button>
          ))}
        </div>
      </div>

      {/* brush palette */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Pinceau :</span>
        {actions.map(a => (
          <button key={a} onClick={() => setBrush(a)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all"
            style={brush === a ? { background: ACT[a].color, color: ACT[a].fg, borderColor: ACT[a].color, boxShadow: `0 0 12px ${ACT[a].color}66` } : { background: ACT[a].color + '22', color: ACT[a].color, borderColor: ACT[a].color + '55' }}>
            {ACT[a].label}
          </button>
        ))}
        <button onClick={resetPos} className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-white/10 bg-white/5 text-white/50 hover:bg-white/10"><RotateCcw size={11} /> Réinit. {position}</button>
      </div>

      {/* grid */}
      <div className="mx-auto" style={{ width: 'min(100%, 560px)' }} onMouseDown={() => (painting.current = true)}>
        <div className="grid select-none" style={{ gridTemplateColumns: 'repeat(13, 1fr)', gap: 2 }}>
          {GRID_RANKS.map((_, i) => GRID_RANKS.map((__, j) => {
            const k = cellKey(i, j)
            const a = map[k] ?? 'fold'
            const c = ACT[a]
            return (
              <div key={`${i}-${j}`} title={`${k} — ${c.label}`}
                onMouseDown={() => paint(k)} onMouseEnter={() => { if (painting.current) paint(k) }}
                className="relative flex items-center justify-center rounded-[3px] cursor-pointer"
                style={{ aspectRatio: '1', fontSize: 9, fontWeight: 700, background: c.color, color: c.fg }}>
                {k.replace('s', '').replace('o', '')}
                {k.endsWith('s') && <span style={{ fontSize: 6, opacity: 0.7, marginLeft: 1 }}>s</span>}
                {k.endsWith('o') && <span style={{ fontSize: 6, opacity: 0.55, marginLeft: 1 }}>o</span>}
              </div>
            )
          }))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 my-3 flex-wrap">
        {actions.map(a => (
          <div key={a} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: ACT[a].color }} /><span className="text-[10px] text-white/55 font-bold uppercase tracking-wide">{ACT[a].label}</span></div>
        ))}
      </div>

      <div className="flex justify-center mt-4">
        <button onClick={onValidate} className="flex items-center gap-2 px-8 py-2.5 rounded-xl font-black uppercase tracking-[0.18em] text-sm" style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>
          <Check size={16} /> Valider mes ranges
        </button>
      </div>
    </motion.div>
  )
}
