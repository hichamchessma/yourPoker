import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Sliders, Play, Check, RotateCcw, ChevronLeft, Trophy, ScanEye, Zap, ArrowRight, Lock } from 'lucide-react'
import WindowControls from '../components/layout/WindowControls'
import { GRID_RANKS, cellKey, handKeyFromCards, buildRangeMap } from '../lib/preflopRanges'
import SpotReadTrainer from '../components/SpotReadTrainer'
import DecisionTrainer from '../components/DecisionTrainer'

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
const SCEN_LABEL: Record<TScenario, string> = { open: 'htr.scenOpen', vsopen: 'htr.scenVsopen' }

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
  const { t } = useTranslation()
  const [screen, setScreen] = useState<'landing' | 'setup' | 'editor' | 'quiz' | 'result' | 'spotread' | 'decision'>('landing')
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
    const oi = (p: string) => POSITIONS.indexOf(p) // preflop action order (UTG=0 … BB=6)
    for (let n = 0; n < numHands; n++) {
      const scenario: TScenario = scenFilter === 'mixed' ? (Math.random() < 0.5 ? 'open' : 'vsopen') : scenFilter
      let position: string, openerPos: string
      if (scenario === 'vsopen') {
        // The opener MUST act before the hero (you can't face an open from a seat that
        // acts after you, nor from your own seat). Pick the opener, then a hero seat
        // strictly later in the action order.
        openerPos = OPENERS[Math.floor(Math.random() * OPENERS.length)]
        const later = POSITIONS.filter(p => oi(p) > oi(openerPos))
        position = later[Math.floor(Math.random() * later.length)]
      } else {
        position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)]
        openerPos = OPENERS[Math.floor(Math.random() * OPENERS.length)]
      }
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
    // No auto-advance: the range is revealed → let the player STUDY it, then click Suivant.
  }
  function next() {
    if (qi + 1 >= questions.length) setScreen('result')
    else { setQi(qi + 1); setPicked(null) }
  }

  // Full action map (13×13) for the current spot — built ONCE (not 169 chart lookups).
  function buildSpotMap(q: Question): Record<string, TAction> {
    const m: Record<string, TAction> = {}
    if (mode === 'custom' && custom) {
      const cm = custom[q.scenario]?.[q.position]
      for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const k = cellKey(i, j); m[k] = cm?.[k] ?? standardAction(q.scenario, q.position, k, q.openerPos) }
      return m
    }
    const full = q.scenario === 'open'
      ? buildRangeMap('rfi', q.position)
      : buildRangeMap('vsopen', q.position, undefined, { vsOpenerPos: q.openerPos, raiseToBB: 2.5, effBB: 100 })
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const k = cellKey(i, j); const a = full.get(k)
      m[k] = q.scenario === 'open' ? (a === 'raise' ? 'open' : 'fold') : (a === '3bet' ? '3bet' : a === 'call' ? 'call' : 'fold')
    }
    return m
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
    <div className="relative h-full w-full flex flex-col overflow-hidden" style={{ background: '#05070f' }}>
      {/* ── Premium animated background (the training photo) ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Slow Ken-Burns drift on the photo */}
        <motion.div className="absolute inset-0"
          initial={{ scale: 1.06 }}
          animate={{ scale: [1.06, 1.15, 1.06], x: ['0%', '-2.5%', '0%'], y: ['0%', '-1.8%', '0%'] }}
          transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}
          style={{ backgroundImage: 'url(/assets/backgroundPokerTraining.png)', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'saturate(1.08) contrast(1.03)' }} />
        {/* Readability gradient (darker where the content sits) */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,10,22,0.50) 0%, rgba(6,10,22,0.74) 48%, rgba(4,6,14,0.92) 100%)' }} />
        {/* Brand radial + vignette for depth */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(115% 95% at 50% 30%, transparent 40%, rgba(0,0,0,0.6) 100%)' }} />
        {/* Pulsing teal glow at the top — alive & stimulating */}
        <motion.div className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ top: '-28%', width: '70%', height: '60%', background: 'radial-gradient(circle, rgba(0,212,255,0.30), transparent 68%)', filter: 'blur(70px)' }}
          animate={{ opacity: [0.10, 0.24, 0.10], scale: [1, 1.08, 1] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
        {/* Faint gold counter-glow bottom-right */}
        <motion.div className="absolute rounded-full" style={{ right: '-12%', bottom: '-18%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(201,162,39,0.18), transparent 70%)', filter: 'blur(80px)' }}
          animate={{ opacity: [0.08, 0.18, 0.08] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
      </div>

      <div className="relative z-10 app-drag flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          {screen !== 'landing' && (
            <button onClick={() => setScreen(screen === 'quiz' || screen === 'result' ? (mode === 'custom' ? 'setup' : 'setup') : 'landing')}
              className="app-drag-none text-white/40 hover:text-white/80"><ChevronLeft size={18} /></button>
          )}
          <Target className="text-[#00d4ff]" size={22} />
          <div>
            <h1 className="text-lg font-black text-[#00d4ff] uppercase tracking-[0.2em]">Hand Trainer</h1>
            <p className="text-[10px] text-white/35 uppercase tracking-widest">{t('trainer.subtitle')}</p>
          </div>
        </div>
        <div className="app-drag-none"><WindowControls /></div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto p-6 flex items-start justify-center">
        <AnimatePresence mode="wait">
          {/* ── LANDING ── */}
          {screen === 'landing' && (
            <motion.div key="landing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="w-full max-w-6xl mt-10">
              <p className="text-center text-white/50 mb-6 text-sm">{t('trainer.howTrain')}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <OptionCard icon={<Target size={28} />} title={t('trainer.standard')}
                  desc={t('trainer.standardD')}
                  onClick={() => { setMode('standard'); setScreen('setup') }} accent="#00d4ff" />
                <OptionCard icon={<Sliders size={28} />} title={t('trainer.custom')}
                  desc={t('trainer.customD')}
                  onClick={openEditor} accent="#c9a227" />
                <OptionCard icon={<ScanEye size={28} />} title={t('trainer.spotRead')}
                  desc={t('trainer.spotReadD')}
                  onClick={() => setScreen('spotread')} accent="#2dd4bf" />
                <OptionCard icon={<Zap size={28} />} title={t('trainer.decision')}
                  desc={t('trainer.decisionD')}
                  onClick={() => setScreen('decision')} accent="#f0a830" />
              </div>
            </motion.div>
          )}

          {/* ── SPOT READING (postflop concept trainer) ── */}
          {screen === 'spotread' && (
            <SpotReadTrainer key="spotread" onBack={() => setScreen('landing')} />
          )}

          {/* ── DECISION trainer ("Le bon coup") ── */}
          {screen === 'decision' && (
            <DecisionTrainer key="decision" onBack={() => setScreen('landing')} />
          )}

          {/* ── SETUP ── */}
          {screen === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="w-full max-w-md mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="text-[#00d4ff] font-black uppercase tracking-widest text-sm mb-1">{t('htr.settings')}</h2>
              <p className="text-[10px] text-white/35 mb-5">{mode === 'custom' ? t('htr.customRanges') : t('htr.standardRanges')}</p>

              <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('htr.numHands')}</label>
              <div className="flex items-center gap-3 mt-2 mb-5">
                <input type="range" min={5} max={50} step={5} value={numHands} onChange={e => setNumHands(+e.target.value)} className="flex-1 accent-[#00d4ff]" />
                <span className="text-lg font-black text-[#00d4ff] font-mono w-10 text-right">{numHands}</span>
              </div>

              <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('htr.spotType')}</label>
              <div className="flex gap-1.5 mt-2 mb-6">
                {([['mixed', t('htr.filterMixed')], ['open', t('htr.filterOpen')], ['vsopen', t('htr.filterVsopen')]] as const).map(([id, lbl]) => (
                  <button key={id} onClick={() => setScenFilter(id)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all ${scenFilter === id ? 'bg-[#00d4ff] text-black border-[#00d4ff]' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>{lbl}</button>
                ))}
              </div>

              <button onClick={startQuiz}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>
                <Play size={16} /> {t('htr.start')}
              </button>
              {mode === 'custom' && (
                <button onClick={() => setScreen('editor')} className="w-full mt-2 py-2 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest">{t('htr.editRanges')}</button>
              )}
            </motion.div>
          )}

          {/* ── EDITOR ── */}
          {screen === 'editor' && custom && (
            <RangeEditor key="editor" custom={custom} setCustom={setCustom}
              onValidate={() => { localStorage.setItem(STORE_KEY, JSON.stringify(custom)); setScreen('setup') }} />
          )}

          {/* ── QUIZ ── */}
          {screen === 'quiz' && questions[qi] && (
            <QuizScreen key="quiz" q={questions[qi]} qi={qi} total={questions.length} score={score}
              picked={picked} onAnswer={answer} onNext={next} buildSpotMap={buildSpotMap} />
          )}

          {/* ── RESULT ── */}
          {screen === 'result' && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <Trophy size={40} className="mx-auto text-[#c9a227] mb-2" />
              <h2 className="text-white/80 font-black uppercase tracking-widest text-sm">{t('htr.result')}</h2>
              <p className="text-5xl font-black text-[#00d4ff] font-mono my-3">{score}<span className="text-white/30 text-2xl">/{questions.length}</span></p>
              <p className="text-sm font-bold mb-4" style={{ color: score / questions.length >= 0.8 ? '#4ade80' : score / questions.length >= 0.6 ? '#fbbf24' : '#f87171' }}>
                {Math.round((score / questions.length) * 100)}% — {score / questions.length >= 0.8 ? t('htr.gradeExcellent') : score / questions.length >= 0.6 ? t('htr.gradeGood') : t('htr.gradeBad')}
              </p>
              {wrongsRef.current.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 mb-4 text-left max-h-[160px] overflow-y-auto">
                  <p className="text-[9px] uppercase tracking-widest text-white/40 font-bold mb-1.5">{t('htr.errors', { n: wrongsRef.current.length })}</p>
                  {wrongsRef.current.map((q, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] py-0.5">
                      <span className="text-white/55 font-mono">{q.key} <span className="text-white/30">{q.position} · {q.scenario === 'open' ? 'open' : 'vs ' + q.openerPos}</span></span>
                      <span className="font-bold" style={{ color: ACT[q.correct].color }}>{ACT[q.correct].label}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={startQuiz} className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest" style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>{t('htr.replay')}</button>
                <button onClick={() => setScreen('setup')} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest border border-white/15 bg-white/5 text-white/60 hover:bg-white/10">{t('htr.settingsBtn')}</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Quiz screen: question on the left, MYSTERY range grid on the right ─────────
function QuizScreen({ q, qi, total, score, picked, onAnswer, onNext, buildSpotMap }: {
  q: Question; qi: number; total: number; score: number; picked: TAction | null
  onAnswer: (a: TAction) => void; onNext: () => void; buildSpotMap: (q: Question) => Record<string, TAction>
}) {
  const { t } = useTranslation()
  const reveal = picked !== null
  const spotMap = useMemo(() => buildSpotMap(q), [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const aggLabel = q.scenario === 'open' ? 'OPEN' : '3-BET'
  const aggAct: TAction = q.scenario === 'open' ? 'open' : '3bet'
  const isLast = qi + 1 >= total

  const btn = (act: TAction, label: string) => {
    const isCorrect = act === q.correct
    const isPicked = picked === act
    let style: React.CSSProperties = { borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }
    if (reveal && isCorrect) style = { borderColor: '#16a34a', background: 'rgba(22,163,74,0.22)', color: '#4ade80' }
    else if (reveal && isPicked && !isCorrect) style = { borderColor: '#dc2626', background: 'rgba(220,38,38,0.2)', color: '#f87171' }
    return (
      <button key={act} disabled={reveal} onClick={() => onAnswer(act)}
        className="flex-1 py-4 rounded-xl text-sm font-black uppercase tracking-widest border transition-all disabled:cursor-default enabled:hover:scale-[1.03]"
        style={style}>{label}{reveal && isCorrect && ' ✓'}{reveal && isPicked && !isCorrect && ' ✗'}</button>
    )
  }

  return (
    <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative w-full max-w-5xl mt-3">
      <QuizBackground reveal={reveal} correct={reveal ? picked === q.correct : null} />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_minmax(290px,380px)] gap-6 items-start">
        {/* ── LEFT : question ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-white/45 font-bold uppercase tracking-widest">{t('htr.handN', { n: qi + 1, total })}</span>
            <span className="text-[11px] font-bold"><span className="text-emerald-400">{score}</span><span className="text-white/30">{t('htr.correctSuffix')}</span></span>
          </div>
          <div className="h-1 rounded-full bg-white/8 overflow-hidden mb-5">
            <div className="h-full bg-[#00d4ff] transition-all" style={{ width: `${(qi / total) * 100}%` }} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 text-center mb-5">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
              {t('htr.posLabel')} <span className="text-[#c9a227] font-bold">{q.position}</span> — {q.scenario === 'open' ? t('htr.noOpen') : t('htr.vsOpenFrom', { pos: q.openerPos })}
            </p>
            <div className="flex items-center justify-center gap-3 my-4">
              {[q.c1, q.c2].map((c, i) => (
                <motion.div key={i} initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ delay: i * 0.08 }}
                  className="w-20 h-28 rounded-xl bg-white flex flex-col items-center justify-center shadow-lg" style={{ color: RED(c.suit) ? '#d32f2f' : '#1a1a1a' }}>
                  <span className="font-black text-4xl leading-none">{c.rank}</span>
                  <span className="text-3xl leading-none">{c.suit}</span>
                </motion.div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 font-mono">{q.key}</p>
          </div>

          <div className="flex gap-3">
            {btn('fold', 'FOLD')}
            {btn('call', 'CALL')}
            {btn(aggAct, aggLabel)}
          </div>

          <AnimatePresence>
            {reveal && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                {picked !== q.correct && (
                  <p className="text-center text-[11px] text-white/50 mb-3">{t('htr.correctAnswer')} <span className="font-bold" style={{ color: ACT[q.correct].color }}>{ACT[q.correct].label}</span></p>
                )}
                <button onClick={onNext}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black uppercase tracking-[0.18em] text-sm transition-all hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)', color: '#04121a' }}>
                  {isLast ? t('htr.seeResult') : t('htr.nextHand')} <ArrowRight size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── RIGHT : mystery range grid ── */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            {reveal ? <Target size={13} className="text-[#ff2d55]" /> : <Lock size={13} className="text-white/40" />}
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: reveal ? '#ff7a96' : 'rgba(255,255,255,0.45)' }}>
              {reveal ? t('htr.rangeCorrect') : t('htr.rangeMystery')}
            </p>
          </div>
          <RangeGrid map={spotMap} highlight={q.key} revealed={reveal} />
          <AnimatePresence>
            {reveal && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-3 mt-3 flex-wrap">
                {(q.scenario === 'open' ? ['open', 'fold'] : ['3bet', 'call', 'fold'] as TAction[]).map(a => (
                  <div key={a} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ACT[a as TAction].color }} /><span className="text-[9px] text-white/55 font-bold uppercase tracking-wide">{ACT[a as TAction].label}</span></div>
                ))}
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: '#ff2d55', boxShadow: '0 0 6px #ff2d55' }} /><span className="text-[9px] text-[#ff7a96] font-bold uppercase tracking-wide">{t('htr.yourHandTag')}</span></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// 13×13 range grid: dark "mystery" until revealed, then each cell wipes in (diagonal
// stagger) with the played hand ringed in red laser.
function RangeGrid({ map, highlight, revealed }: { map: Record<string, TAction>; highlight: string; revealed: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="relative mx-auto" style={{ width: 'min(100%, 360px)' }}>
      <div className="grid select-none rounded-lg overflow-hidden" style={{ gridTemplateColumns: 'repeat(13,1fr)', gap: 2 }}>
        {GRID_RANKS.map((_, i) => GRID_RANKS.map((__, j) => {
          const k = cellKey(i, j)
          const a = map[k] ?? 'fold'
          const c = ACT[a]
          const isHi = k === highlight
          return (
            <div key={`${i}-${j}`} className="relative flex items-center justify-center rounded-[2px]"
              style={{
                aspectRatio: '1', fontSize: 7.5, fontWeight: 800,
                background: revealed ? c.color : '#0b1322',
                color: revealed ? c.fg : 'transparent',
                transition: 'background 350ms ease, color 350ms ease',
                transitionDelay: revealed ? `${(i + j) * 14}ms` : '0ms',
                zIndex: isHi ? 2 : 1,
              }}>
              {revealed && k.replace('s', '').replace('o', '')}
              {isHi && revealed && (
                <motion.span className="absolute -inset-[2px] rounded-[3px] pointer-events-none"
                  initial={{ opacity: 0, scale: 1.4 }}
                  animate={{ opacity: [0, 1, 0.95], scale: [1.4, 1, 1], boxShadow: ['0 0 0px #ff2d55', '0 0 16px 4px #ff2d55', '0 0 10px 2px #ff2d55'] }}
                  transition={{ duration: 0.6, delay: 0.45 }}
                  style={{ border: '2px solid #ff2d55' }} />
              )}
            </div>
          )
        }))}
      </div>

      {/* mystery overlay before reveal */}
      <AnimatePresence>
        {!revealed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-lg backdrop-blur-[2px]"
            style={{ background: 'rgba(8,12,24,0.5)' }}>
            <div className="text-center">
              <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="text-2xl mb-1">🔒</motion.div>
              <p className="text-[9px] uppercase tracking-widest text-white/55 font-bold">{t('htr.rangeHidden')}</p>
              <p className="text-[8px] text-white/30">{t('htr.answerToReveal')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* red laser sweep on reveal */}
      <AnimatePresence>
        {revealed && (
          <motion.div key="sweep" className="pointer-events-none absolute inset-y-0 w-14"
            initial={{ left: '-20%', opacity: 0 }} animate={{ left: '110%', opacity: [0, 0.8, 0] }}
            transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,45,85,0.55), transparent)', filter: 'blur(4px)' }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// Animated, stimulating background for the quiz (pulsing glows + a faint moving grid).
function QuizBackground({ reveal, correct }: { reveal: boolean; correct: boolean | null }) {
  const tint = correct === null ? '#00d4ff' : correct ? '#22c55e' : '#ff2d55'
  return (
    <div className="pointer-events-none absolute -inset-10 overflow-hidden">
      <motion.div className="absolute top-[-20%] left-[10%] w-[420px] h-[420px] rounded-full"
        animate={{ opacity: [0.12, 0.22, 0.12], scale: [1, 1.15, 1] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ background: `radial-gradient(circle, ${tint}, transparent 70%)`, transition: 'background 500ms' }} />
      <motion.div className="absolute bottom-[-25%] right-[5%] w-[480px] h-[480px] rounded-full"
        animate={{ opacity: [0.08, 0.18, 0.08], scale: [1.1, 1, 1.1] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        style={{ background: 'radial-gradient(circle, #c9a227, transparent 70%)' }} />
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      {reveal && (
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.12, 0] }} transition={{ duration: 0.6 }}
          style={{ background: `radial-gradient(60% 60% at 50% 50%, ${tint}, transparent 70%)` }} />
      )}
    </div>
  )
}

// ── Landing option card ───────────────────────────────────────────────────────
function OptionCard({ icon, title, desc, onClick, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; accent: string }) {
  const { t } = useTranslation()
  return (
    <button onClick={onClick}
      className="group relative text-left rounded-2xl border p-5 overflow-hidden transition-all duration-200 hover:-translate-y-1"
      style={{ borderColor: accent + '4d', background: 'rgba(9,13,24,0.74)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 12px 34px -14px rgba(0,0,0,0.75)' }}>
      {/* accent top line */}
      <span className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.75 }} />
      {/* accent wash, brighter on hover */}
      <span className="absolute inset-0 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-300" style={{ background: `radial-gradient(130% 85% at 50% -10%, ${accent}1f, transparent 62%)` }} />
      {/* glow ring on hover */}
      <span className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: `0 0 0 1px ${accent}99, 0 16px 44px -10px ${accent}55` }} />
      <div className="relative">
        <span className="inline-flex items-center justify-center rounded-xl mb-3 transition-transform duration-200 group-hover:scale-110"
          style={{ width: 48, height: 48, color: accent, background: accent + '1f', border: `1px solid ${accent}55` }}>{icon}</span>
        <h3 className="font-black uppercase tracking-wide text-sm" style={{ color: accent }}>{title}</h3>
        <p className="text-white/65 text-[12px] mt-1.5 leading-relaxed">{desc}</p>
        <div className="mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-transform duration-200 group-hover:translate-x-1" style={{ color: accent }}>{t('trainer.choose')} <Play size={11} /></div>
      </div>
    </button>
  )
}

// ── Range editor (paint cells with a brush) ──────────────────────────────────
function RangeEditor({ custom, setCustom, onValidate }: { custom: Custom; setCustom: (c: Custom) => void; onValidate: () => void }) {
  const { t } = useTranslation()
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
            <button key={s} onClick={() => setScenario(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border ${scenario === s ? 'bg-[#00d4ff] text-black border-[#00d4ff]' : 'bg-white/5 text-white/50 border-white/10'}`}>{t(SCEN_LABEL[s])}</button>
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
        <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{t('htr.brush')}</span>
        {actions.map(a => (
          <button key={a} onClick={() => setBrush(a)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all"
            style={brush === a ? { background: ACT[a].color, color: ACT[a].fg, borderColor: ACT[a].color, boxShadow: `0 0 12px ${ACT[a].color}66` } : { background: ACT[a].color + '22', color: ACT[a].color, borderColor: ACT[a].color + '55' }}>
            {ACT[a].label}
          </button>
        ))}
        <button onClick={resetPos} className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-white/10 bg-white/5 text-white/50 hover:bg-white/10"><RotateCcw size={11} /> {t('htr.resetPos', { pos: position })}</button>
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
          <Check size={16} /> {t('htr.validate')}
        </button>
      </div>
    </motion.div>
  )
}
