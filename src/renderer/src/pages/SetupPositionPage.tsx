import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, Play, Save, Trash2, RotateCcw, X } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import WindowControls from '../components/layout/WindowControls'

// ── Types ──────────────────────────────────────────────────────────
interface Card { rank: string; suit: string }
type Street = 'preflop' | 'flop' | 'turn' | 'river'
type Discipline = 'tight' | 'normal' | 'loose'
interface Opp { level: number; discipline: Discipline; cards: [Card | null, Card | null] }
export interface ScenarioConfig {
  numPlayers: number
  heroPos: string
  stackBB: number
  sb: number; bb: number
  startStreet: Street
  heroCards: [Card | null, Card | null]
  board: (Card | null)[]   // length 5; only the first N are used per street
  potBB: number
  opponents: Opp[]
}
const emptyOpp = (): Opp => ({ level: 2, discipline: 'normal', cards: [null, null] })

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['♠', '♥', '♦', '♣']
const RED = (s: string) => s === '♥' || s === '♦'
const POS_LABELS: Record<number, string[]> = {
  2: ['BTN/SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO'],
}
const BOT_LEVELS = [
  { level: 1, name: 'Amateur', color: '#22cc44' },
  { level: 2, name: 'Pro', color: '#f0d060' },
  { level: 3, name: 'Expert', color: '#ff4444' },
]
const DISCIPLINES: { id: Discipline; label: string; hint: string; color: string }[] = [
  { id: 'tight', label: 'spos.discTight', hint: 'spos.discTightHint', color: '#22cc44' },
  { id: 'normal', label: 'spos.discNormal', hint: 'spos.discNormalHint', color: '#f0d060' },
  { id: 'loose', label: 'spos.discLoose', hint: 'spos.discLooseHint', color: '#ff4444' },
]
const STREETS: { id: Street; label: string; need: number }[] = [
  { id: 'preflop', label: 'spos.streetPreflop', need: 0 },
  { id: 'flop', label: 'spos.streetFlop', need: 3 },
  { id: 'turn', label: 'spos.streetTurn', need: 4 },
  { id: 'river', label: 'spos.streetRiver', need: 5 },
]
const STORE_KEY = 'yourpoker_scenarios'

// ── Card chip / picker ─────────────────────────────────────────────
function CardSlot({ card, onClick, size = 'md', label }: { card: Card | null; onClick: () => void; size?: 'sm' | 'md'; label?: string }) {
  const w = size === 'sm' ? 44 : 52, h = size === 'sm' ? 62 : 74
  return (
    <button onClick={onClick} className="relative shrink-0 transition-transform hover:scale-[1.06] active:scale-95"
      style={{ width: w, height: h }}>
      {card ? (
        <div className="w-full h-full rounded-lg bg-white flex flex-col items-center justify-center shadow-lg border border-black/10"
          style={{ color: RED(card.suit) ? '#d32f2f' : '#1a1a1a' }}>
          <span className="font-black leading-none" style={{ fontSize: size === 'sm' ? 18 : 22 }}>{card.rank}</span>
          <span className="leading-none" style={{ fontSize: size === 'sm' ? 16 : 20 }}>{card.suit}</span>
        </div>
      ) : (
        <div className="w-full h-full rounded-lg border-2 border-dashed border-[#c9a227]/40 bg-[#c9a227]/5 flex items-center justify-center text-[#c9a227]/50 hover:bg-[#c9a227]/10 hover:border-[#c9a227]/70">
          <Plus size={size === 'sm' ? 16 : 20} />
        </div>
      )}
      {label && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-widest text-white/35 font-bold">{label}</span>}
    </button>
  )
}

function CardPicker({ used, onPick, onClose }: { used: Set<string>; onPick: (c: Card) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="rounded-2xl border border-[#c9a227]/30 p-4" style={{ background: '#070d1a' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold text-[#c9a227] uppercase tracking-widest">{t('spos.pickCard')}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white"><X size={14} /></button>
        </div>
        <div className="space-y-1">
          {SUITS.map(suit => (
            <div key={suit} className="flex gap-1">
              {RANKS.map(rank => {
                const key = rank + suit
                const isUsed = used.has(key)
                return (
                  <button key={key} disabled={isUsed} onClick={() => { onPick({ rank, suit }); onClose() }}
                    className={`w-9 h-11 rounded-md flex flex-col items-center justify-center font-bold transition-all ${isUsed ? 'opacity-20 cursor-not-allowed bg-white/5' : 'bg-white hover:scale-110 hover:shadow-lg'}`}
                    style={{ color: isUsed ? '#888' : RED(suit) ? '#d32f2f' : '#1a1a1a' }}>
                    <span className="text-[13px] leading-none">{rank}</span>
                    <span className="text-[11px] leading-none">{suit}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Page ───────────────────────────────────────────────────────────
export default function SetupPositionPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Hero'

  const [numPlayers, setNumPlayers] = useState(6)
  const [heroPos, setHeroPos] = useState('BTN')
  const [stackBB, setStackBB] = useState(100)
  const [sb, setSb] = useState(1)
  const [bb, setBb] = useState(2)
  const [potBB, setPotBB] = useState(6)
  const [startStreet, setStartStreet] = useState<Street>('preflop')
  const [heroCards, setHeroCards] = useState<[Card | null, Card | null]>([null, null])
  const [board, setBoard] = useState<(Card | null)[]>([null, null, null, null, null])
  const [opponents, setOpponents] = useState<Opp[]>(Array.from({ length: 5 }, emptyOpp))
  const [playLive, setPlayLive] = useState(false)  // default: manual authoring mode
  const [picker, setPicker] = useState<{ target: 'hero' | 'board' | 'opp'; idx: number; slot: number } | null>(null)
  const [saved, setSaved] = useState<{ name: string; scenario: ScenarioConfig }[]>([])
  const [saveName, setSaveName] = useState('')
  const [error, setError] = useState('')

  // keep positions / opponents arrays in sync with player count
  useEffect(() => {
    const labels = POS_LABELS[numPlayers]
    if (!labels.includes(heroPos)) setHeroPos(labels[0])
    setOpponents(prev => {
      const n = numPlayers - 1
      if (prev.length === n) return prev
      if (prev.length < n) return [...prev, ...Array.from({ length: n - prev.length }, emptyOpp)]
      return prev.slice(0, n)
    })
  }, [numPlayers]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')) } catch { /* ignore */ } }, [])

  const need = STREETS.find(s => s.id === startStreet)!.need
  const usedSet = useMemo(() => {
    const s = new Set<string>()
    heroCards.forEach(c => c && s.add(c.rank + c.suit))
    board.forEach(c => c && s.add(c.rank + c.suit))
    opponents.forEach(o => o.cards.forEach(c => c && s.add(c.rank + c.suit)))
    return s
  }, [heroCards, board, opponents])

  function setCard(c: Card) {
    if (!picker) return
    if (picker.target === 'hero') setHeroCards(prev => { const n = [...prev] as [Card | null, Card | null]; n[picker.idx] = c; return n })
    else if (picker.target === 'board') setBoard(prev => { const n = [...prev]; n[picker.idx] = c; return n })
    else setOpponents(prev => prev.map((o, i) => i === picker.idx ? { ...o, cards: (picker.slot === 0 ? [c, o.cards[1]] : [o.cards[0], c]) as [Card | null, Card | null] } : o))
  }
  function clearCard(target: 'hero' | 'board', idx: number) {
    if (target === 'hero') setHeroCards(prev => { const n = [...prev] as [Card | null, Card | null]; n[idx] = null; return n })
    else setBoard(prev => { const n = [...prev]; n[idx] = null; return n })
  }
  function clearOppCard(oppIdx: number, slot: number) {
    setOpponents(prev => prev.map((o, i) => i === oppIdx ? { ...o, cards: (slot === 0 ? [null, o.cards[1]] : [o.cards[0], null]) as [Card | null, Card | null] } : o))
  }

  function buildScenario(): ScenarioConfig {
    return { numPlayers, heroPos, stackBB, sb, bb, startStreet, heroCards, board, potBB, opponents }
  }

  function validate(): string {
    if (!heroCards[0] || !heroCards[1]) return t('spos.valHand')
    for (let i = 0; i < need; i++) if (!board[i]) return t('spos.valBoard', { need, street: t(STREETS.find(s => s.id === startStreet)!.label) })
    return ''
  }

  function launch() {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    const scenario = buildScenario()
    localStorage.setItem(STORE_KEY + '_last', JSON.stringify(scenario))
    navigate('/game', {
      state: {
        numPlayers, selectedSeat: 0, stackBB, sb, bb, ante: 0, decisionTimer: 25,
        displayName, slots: opponents.map(o => ({ type: 'bot', level: o.level })),
        scenario, playLive,
      },
    })
  }

  function saveScenario() {
    const name = saveName.trim() || t('spos.defaultScenario', { n: saved.length + 1 })
    const next = [...saved.filter(s => s.name !== name), { name, scenario: buildScenario() }]
    setSaved(next); setSaveName('')
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  }
  function loadScenario(s: ScenarioConfig) {
    setNumPlayers(s.numPlayers); setHeroPos(s.heroPos); setStackBB(s.stackBB); setSb(s.sb); setBb(s.bb)
    setPotBB(s.potBB); setStartStreet(s.startStreet); setHeroCards(s.heroCards); setBoard(s.board)
    setOpponents(s.opponents.map(o => ({ ...emptyOpp(), ...o, cards: (o.cards ?? [null, null]) as [Card | null, Card | null] })))
  }
  function deleteScenario(name: string) {
    const next = saved.filter(s => s.name !== name)
    setSaved(next); localStorage.setItem(STORE_KEY, JSON.stringify(next))
  }

  function reset() {
    setHeroCards([null, null]); setBoard([null, null, null, null, null]); setError('')
  }

  // seat ring positions (hero fixed at bottom = index 0)
  const seatPos = (i: number) => {
    const angle = (i / numPlayers) * 2 * Math.PI + Math.PI / 2
    return { x: 50 + 38 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) }
  }
  const posOrder = POS_LABELS[numPlayers]
  // assign positions around the ring so hero (seat 0) gets heroPos
  const heroPosIdx = Math.max(0, posOrder.indexOf(heroPos))

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #0c1424 0%, #070b14 60%, #05080f 100%)' }}>
      {/* Header */}
      <div className="app-drag flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div>
          <h1 className="text-lg font-black text-[#c9a227] uppercase tracking-[0.2em]">{t('spos.header')}</h1>
          <p className="text-[10px] text-white/35 uppercase tracking-widest">{t('spos.headerSub')}</p>
        </div>
        <div className="app-drag-none"><WindowControls /></div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        {/* ── LEFT: table + street + board + hand ── */}
        <div className="flex flex-col gap-4">
          {/* Street stepper */}
          <div className="flex items-center gap-2">
            {STREETS.map((s, i) => {
              const active = startStreet === s.id
              const reachable = i === 0 || true
              return (
                <button key={s.id} disabled={!reachable} onClick={() => setStartStreet(s.id)}
                  className={`flex-1 py-2 rounded-xl border text-[11px] font-bold uppercase tracking-widest transition-all
                    ${active ? 'bg-[#c9a227]/20 border-[#c9a227]/70 text-[#c9a227] shadow-[0_0_14px_rgba(201,162,39,0.3)]' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}>
                  {t(s.label)}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-white/30 -mt-2">{t('spos.streetHint')}</p>

          {/* Table */}
          <div className="relative rounded-3xl border border-[#c9a227]/15 overflow-hidden" style={{ aspectRatio: '16/10', background: 'radial-gradient(80% 80% at 50% 45%, #0e5530 0%, #083d20 60%, #041a0e 100%)' }}>
            {/* felt rim */}
            <div className="absolute inset-6 rounded-[45%] border-2 border-[#c9a227]/20" />

            {/* seats */}
            {Array.from({ length: numPlayers }).map((_, i) => {
              const p = seatPos(i)
              const isHero = i === 0
              const posLabel = posOrder[(heroPosIdx + i) % numPlayers]
              const opp = isHero ? null : opponents[i - 1]
              const lv = opp ? BOT_LEVELS.find(b => b.level === opp.level)! : null
              return (
                <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <div className={`rounded-xl px-2.5 py-1 border backdrop-blur-sm ${isHero ? 'border-[#00d4ff]/60 bg-[#00d4ff]/10' : 'border-white/15 bg-black/50'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold ${isHero ? 'text-[#00d4ff]' : 'text-white/80'}`}>{isHero ? t('spos.you') : `Bot ${i}`}</span>
                      <span className="text-[8px] font-bold px-1 rounded text-[#c9a227] bg-[#c9a227]/15">{posLabel}</span>
                    </div>
                    {lv && <div className="text-[8px] font-bold" style={{ color: lv.color }}>{lv.name}</div>}
                  </div>
                </div>
              )
            })}

            {/* board zones (center) */}
            <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {[0, 1, 2, 3, 4].map(i => {
                const isFlop = i < 3, isTurn = i === 3, isRiver = i === 4
                const enabled = i < need
                const tag = isFlop ? 'FLOP' : isTurn ? 'TURN' : 'RIVER'
                if (!enabled) return (
                  <div key={i} className="rounded-lg border border-dashed border-white/10 flex items-center justify-center text-[7px] text-white/20 font-bold uppercase" style={{ width: 44, height: 62 }}>{tag} {isRiver || isTurn ? '' : i + 1}</div>
                )
                return (
                  <div key={i} className="relative">
                    {board[i] && <button onClick={() => clearCard('board', i)} className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center"><X size={9} /></button>}
                    <CardSlot card={board[i]} size="sm" onClick={() => setPicker({ target: 'board', idx: i, slot: 0 })} />
                  </div>
                )
              })}
            </div>

            {/* hero hand (bottom center) */}
            <div className="absolute left-1/2 bottom-3 -translate-x-1/2 flex flex-col items-center gap-1">
              <span className="text-[8px] uppercase tracking-widest text-[#00d4ff]/70 font-bold">{t('spos.myHand')}</span>
              <div className="flex gap-1.5">
                {[0, 1].map(i => (
                  <div key={i} className="relative">
                    {heroCards[i] && <button onClick={() => clearCard('hero', i)} className="absolute -top-1.5 -right-1.5 z-10 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center"><X size={9} /></button>}
                    <CardSlot card={heroCards[i]} onClick={() => setPicker({ target: 'hero', idx: i, slot: 0 })} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* players / stacks / blinds */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stepper label={t('spos.players')} value={numPlayers} min={2} max={9} onChange={setNumPlayers} />
            <Stepper label={t('spos.stack')} value={stackBB} min={10} max={500} step={5} onChange={setStackBB} />
            <Stepper label={t('spos.startPot')} value={potBB} min={0} max={500} step={1} onChange={setPotBB} disabled={startStreet === 'preflop'} />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{t('spos.blinds')}</span>
              <div className="flex items-center gap-1 mt-1">
                <input type="number" value={sb} onChange={e => setSb(Math.max(0, +e.target.value))} className="w-12 bg-black/40 border border-white/10 rounded px-1 py-1 text-[12px] text-white text-center" />
                <span className="text-white/30">/</span>
                <input type="number" value={bb} onChange={e => setBb(Math.max(1, +e.target.value))} className="w-12 bg-black/40 border border-white/10 rounded px-1 py-1 text-[12px] text-white text-center" />
              </div>
            </div>
          </div>

          {/* my position */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{t('spos.myPos')}</span>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {posOrder.map(p => (
                <button key={p} onClick={() => setHeroPos(p)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${heroPos === p ? 'bg-[#c9a227] text-black border-[#c9a227]' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: opponents + actions + save ── */}
        <div className="flex flex-col gap-4">
          {/* opponents */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <span className="text-[10px] uppercase tracking-widest text-[#c9a227] font-bold">{t('spos.opponents')}</span>
            <div className="mt-2 space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {opponents.map((o, i) => (
                <div key={i} className="rounded-lg border border-white/8 bg-black/30 p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-white/70">Bot {i + 1}</span>
                    <div className="flex gap-1">
                      {BOT_LEVELS.map(b => (
                        <button key={b.level} onClick={() => setOpponents(prev => prev.map((x, j) => j === i ? { ...x, level: b.level } : x))}
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold border transition-all"
                          style={o.level === b.level ? { background: b.color, color: '#0a0a0a', borderColor: b.color } : { borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.45)' }}>{b.name}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {DISCIPLINES.map(d => (
                      <button key={d.id} onClick={() => setOpponents(prev => prev.map((x, j) => j === i ? { ...x, discipline: d.id } : x))}
                        title={t(d.hint)}
                        className="flex-1 px-1 py-0.5 rounded text-[8px] font-bold border transition-all"
                        style={o.discipline === d.id ? { background: d.color + '22', color: d.color, borderColor: d.color + '88' } : { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>{t(d.label)}</button>
                    ))}
                  </div>
                  {/* Optional forced hole cards — leave empty for a random/range draw. */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[8px] uppercase tracking-widest text-white/35 font-bold">{t('spos.cards')}</span>
                    {[0, 1].map(slot => (
                      <div key={slot} className="relative">
                        {o.cards[slot] && <button onClick={() => clearOppCard(i, slot)} className="absolute -top-1 -right-1 z-10 w-3.5 h-3.5 rounded-full bg-red-600 text-white flex items-center justify-center"><X size={7} /></button>}
                        <CardSlot card={o.cards[slot]} size="sm" onClick={() => setPicker({ target: 'opp', idx: i, slot })} />
                      </div>
                    ))}
                    <span className="text-[8px] text-white/25 italic">{o.cards[0] || o.cards[1] ? t('spos.forced') : t('spos.random')}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[8.5px] text-white/30 mt-2 leading-relaxed">{t('spos.oppHint')}</p>
          </div>

          {/* save / load */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <span className="text-[10px] uppercase tracking-widest text-[#c9a227] font-bold">{t('spos.myScenarios')}</span>
            <div className="flex gap-1.5 mt-2">
              <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder={t('spos.scenarioName')}
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-white/25 outline-none focus:border-[#c9a227]/50" />
              <button onClick={saveScenario} className="px-2.5 rounded-lg bg-[#c9a227]/15 border border-[#c9a227]/40 text-[#c9a227] flex items-center gap-1 text-[10px] font-bold hover:bg-[#c9a227]/25"><Save size={12} /></button>
            </div>
            <div className="mt-2 space-y-1 max-h-[120px] overflow-y-auto">
              {saved.length === 0 && <p className="text-[10px] text-white/25 text-center py-2">{t('spos.noScenarios')}</p>}
              {saved.map(s => (
                <div key={s.name} className="flex items-center gap-1.5 rounded-lg bg-black/30 border border-white/8 px-2 py-1.5">
                  <button onClick={() => loadScenario(s.scenario)} className="flex-1 text-left text-[11px] text-white/70 hover:text-[#c9a227] truncate">{s.name}</button>
                  <span className="text-[8px] text-white/30">{s.scenario.startStreet} · {s.scenario.numPlayers}p</span>
                  <button onClick={() => deleteScenario(s.name)} className="text-white/30 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* in-room manual bet authoring */}
          <div className="rounded-2xl border border-[#c9a227]/20 bg-[#c9a227]/[0.04] p-3 text-center">
            <span className="text-[10px] uppercase tracking-widest text-[#c9a227] font-bold">{t('spos.betEditing')}</span>
            <p className="text-[9px] text-white/40 mt-1 leading-relaxed"><Trans i18nKey="spos.manualDesc" components={{ b: <b className="text-white/60" /> }} /></p>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-white/5 px-6 py-3 flex items-center gap-3">
        <button onClick={reset} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/50 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10"><RotateCcw size={13} /> {t('spos.resetCards')}</button>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 cursor-pointer" title={playLive ? t('spos.liveTip') : t('spos.manualTip')}>
          <input type="checkbox" checked={playLive} onChange={e => setPlayLive(e.target.checked)} className="accent-[#c9a227]" />
          <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{playLive ? t('spos.playLive') : t('spos.manualMode')}</span>
        </label>
        {error && <span className="text-[11px] text-red-400 font-bold">{error}</span>}
        <button onClick={launch}
          className="ml-auto flex items-center gap-2 px-8 py-2.5 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227,#8B6810)', color: '#0a0a0a' }}>
          <Play size={16} /> {t('spos.confirm')}
        </button>
      </div>

      <AnimatePresence>
        {picker && <CardPicker used={usedSet} onPick={setCard} onClose={() => setPicker(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ── Small stepper control ──────────────────────────────────────────
function Stepper({ label, value, min, max, step = 1, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-2.5 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{label}</span>
      <div className="flex items-center justify-between mt-1">
        <button disabled={disabled} onClick={() => onChange(Math.max(min, value - step))} className="w-6 h-6 rounded bg-white/8 border border-white/10 flex items-center justify-center text-white/60 hover:bg-white/15"><Minus size={12} /></button>
        <span className="text-[15px] font-black text-[#c9a227] font-mono">{value}</span>
        <button disabled={disabled} onClick={() => onChange(Math.min(max, value + step))} className="w-6 h-6 rounded bg-white/8 border border-white/10 flex items-center justify-center text-white/60 hover:bg-white/15"><Plus size={12} /></button>
      </div>
    </div>
  )
}
