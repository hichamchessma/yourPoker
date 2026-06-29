import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useLiveSession } from '../store/liveSessionStore'
import { useDevice } from '../lib/useDevice'
import { ResumeSessionModal } from '../components/SessionDialogs'
import RotateGate from '../components/RotateGate'

// ── Types ──────────────────────────────────────────────────────────
type SlotType = 'bot' | 'human' | 'empty'
interface Slot { type: SlotType; level: number }

const BOT_LEVELS = [
  { level: 1, nameKey: 'train.botAmateur', color: '#22cc44', descKey: 'train.descAmateur' },
  { level: 2, nameKey: 'train.botPro',     color: '#f0d060', descKey: 'train.descPro' },
  { level: 3, nameKey: 'train.botExpert',  color: '#ff4444', descKey: 'train.descExpert' },
]

const POS_LABELS: Record<number, string[]> = {
  2: ['BTN/SB','BB'],
  3: ['BTN','SB','BB'],
  4: ['BTN','SB','BB','UTG'],
  5: ['BTN','SB','BB','UTG','CO'],
  6: ['BTN','SB','BB','UTG','HJ','CO'],
  7: ['BTN','SB','BB','UTG','UTG+1','HJ','CO'],
  8: ['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO'],
  9: ['BTN','SB','BB','UTG','UTG+1','MP','MP+1','HJ','CO'],
}

const PRESETS = [
  { id: 'cash',   icon: '💵', nameKey: 'train.presetCashName',   players: 6, stack: 100, sb: 1,  bb: 2,  bots: [2,2,2,2,2] },
  { id: 'ft',     icon: '🏆', nameKey: 'train.presetFtName',     players: 9, stack: 50,  sb: 5,  bb: 10, bots: [2,2,2,3,3,2,2,3] },
  { id: 'hu',     icon: '⚔️', nameKey: 'train.presetHuName',     players: 2, stack: 200, sb: 1,  bb: 2,  bots: [3] },
  { id: 'battle', icon: '🔥', nameKey: 'train.presetBattleName', players: 6, stack: 50,  sb: 2,  bb: 4,  bots: [3,3,3,3,3] },
  { id: 'school', icon: '🎓', nameKey: 'train.presetSchoolName', players: 6, stack: 100, sb: 1,  bb: 2,  bots: [1,1,2,2,3] },
  { id: 'wild',   icon: '🤠', nameKey: 'train.presetWildName',   players: 9, stack: 30,  sb: 1,  bb: 2,  bots: [1,1,2,2,3,3,1,2] },
]
// Currency-specific quick blind levels (€ shares the $ levels). First entry = the default.
const BLIND_LEVELS: Record<string, { sb: number; bb: number }[]> = {
  DH: [{ sb: 25, bb: 50 }, { sb: 50, bb: 100 }],
  $: [{ sb: 1, bb: 3 }, { sb: 2, bb: 4 }, { sb: 5, bb: 5 }, { sb: 5, bb: 10 }],
}
const blindLevelsFor = (cur: string) => BLIND_LEVELS[cur] ?? BLIND_LEVELS.$

// ── SVG geometry helpers ───────────────────────────────────────────
const SVG_W = 300, SVG_H = 226, CX = 150, CY = 106, RX = 128, RY = 90

function seatXY(i: number, n: number) {
  const a = (i * 2 * Math.PI / n) + Math.PI / 2
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) }
}
function seatPct(i: number, n: number) {
  const { x, y } = seatXY(i, n)
  return { xPct: (x / SVG_W) * 100, yPct: (y / SVG_H) * 100 }
}
function chipPct(i: number, n: number, bias = 0.46) {
  const { x, y } = seatXY(i, n)
  return {
    xPct: ((x + (CX - x) * bias) / SVG_W) * 100,
    yPct: ((y + (CY - y) * bias) / SVG_H) * 100,
  }
}

// ── Blind Chip (SB / BB) ──────────────────────────────────────────
function BlindChip({ label, value, color, onInc, onDec }: {
  label: string; value: number; color: string; onInc: () => void; onDec: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 select-none" onClick={e => e.stopPropagation()}>
      <button
        onPointerDown={e => { e.stopPropagation(); onInc() }}
        className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{ background: color + '33', border: `1px solid ${color}88` }}
      >
        <Plus size={8} style={{ color }} />
      </button>
      <div
        className="rounded-full w-11 h-11 flex flex-col items-center justify-center shadow-xl cursor-default"
        style={{
          background: `radial-gradient(circle at 35% 35%, ${color}44, ${color}11)`,
          border: `2px solid ${color}cc`,
          boxShadow: `0 0 14px ${color}66, inset 0 1px 2px rgba(255,255,255,0.15)`,
        }}
      >
        <span className="text-[6px] font-black uppercase tracking-widest leading-none" style={{ color }}>{label}</span>
        <span className="text-[11px] font-bold text-white leading-tight">{value}</span>
      </div>
      <button
        onPointerDown={e => { e.stopPropagation(); onDec() }}
        className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{ background: color + '22', border: `1px solid ${color}55` }}
      >
        <Minus size={8} style={{ color }} />
      </button>
    </div>
  )
}

// ── Seat Config Popup ─────────────────────────────────────────────
function SeatPopup({ slot, posLabel, onUpdate, onClose, above }: {
  slot: Slot; posLabel: string; onUpdate: (u: Partial<Slot>) => void; onClose: () => void; above: boolean
}) {
  const { t } = useTranslation()
  const botCfg = BOT_LEVELS[slot.level - 1]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.82, y: above ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.82 }}
      transition={{ duration: 0.13, ease: 'easeOut' }}
      className="absolute z-50 min-w-[150px] rounded-xl p-3 shadow-2xl"
      style={{
        background: 'rgba(8, 14, 26, 0.97)',
        border: '1px solid rgba(255,255,255,0.13)',
        backdropFilter: 'blur(12px)',
        transform: above
          ? 'translate(-50%, calc(-100% - 10px))'
          : 'translate(-50%, 10px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-black text-white/50 uppercase tracking-widest">{posLabel}</span>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors"><X size={11}/></button>
      </div>

      {/* Type selector */}
      <div className="flex gap-1 mb-2">
        {(['bot','human','empty'] as SlotType[]).map(st => (
          <button key={st} onClick={() => onUpdate({ type: st })}
            className={`flex-1 px-1 py-1 rounded text-[8px] font-bold uppercase tracking-wide transition-all ${
              slot.type === st
                ? st === 'bot'   ? 'bg-poker-gold/25 text-poker-gold border border-poker-gold/50'
                  : st === 'human' ? 'bg-blue-500/25 text-blue-300 border border-blue-500/50'
                  : 'bg-white/10 text-white/50 border border-white/25'
                : 'text-white/30 hover:text-white/60 border border-transparent bg-white/3'
            }`}>
            {st === 'bot' ? t('train.typeBot') : st === 'human' ? t('train.typeHuman') : t('train.typeEmpty')}
          </button>
        ))}
      </div>

      {/* Bot level */}
      {slot.type === 'bot' && (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[8px] text-white/30 uppercase mr-0.5">{t('train.level')}</span>
          {BOT_LEVELS.map(b => (
            <button key={b.level} onClick={() => onUpdate({ level: b.level })}
              className="w-6 h-6 rounded text-[9px] font-bold transition-all"
              style={{
                background: slot.level === b.level ? b.color + '30' : 'rgba(255,255,255,0.05)',
                color: b.color,
                border: `1px solid ${slot.level === b.level ? b.color : 'transparent'}`,
                boxShadow: slot.level === b.level ? `0 0 8px ${b.color}66` : 'none',
              }}>
              {b.level}
            </button>
          ))}
          {botCfg && (
            <span className="text-[8px] font-semibold ml-0.5" style={{ color: botCfg.color }}>{t(botCfg.nameKey)}</span>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────
export default function TrainingSetupPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Joueur'
  const { reduceFx } = useDevice()

  const savedSession = useLiveSession(s => s.cash)
  const clearResumable = useLiveSession(s => s.clearResumable)
  const [showResume, setShowResume] = useState(!!savedSession)
  const resumeSession = () => {
    if (savedSession) navigate('/game', { state: { ...savedSession.cfg, resume: savedSession } })
  }

  // ── Config state ──
  const [numPlayers, setNumPlayers] = useState(6)
  const [selectedSeat, setSelectedSeat] = useState(0)
  const [stackBB, setStackBB] = useState(50)   // default 50 BB (adjustable after)
  const [sb, setSb] = useState(1)
  const [bb, setBb] = useState(3)              // default $ level 1/3
  const [ante, setAnte] = useState(0)
  const [currency, setCurrency] = useState('$')
  // BB is the editable money value of one big blind; SB tracks at half (min 1).
  const setBigBlind = (v: number) => { const b = Math.max(1, Math.round(v)); setBb(b); setSb(Math.max(1, Math.round(b / 2))) }
  // Switch currency → snap blinds to that currency's default level (first preset).
  const pickCurrency = (sym: string) => { setCurrency(sym); const lv = blindLevelsFor(sym)[0]; setSb(lv.sb); setBb(lv.bb) }
  const fmt = (n: number) => currency === 'DH' ? `${Math.round(n).toLocaleString()} DH` : `${currency}${Math.round(n).toLocaleString()}`
  const [decisionTimer, setDecisionTimer] = useState(30)
  const [gameVariant, setGameVariant] = useState<'NLH'|'PLO'|'PLO5'>('NLH')
  const [gameSpeed, setGameSpeed] = useState<'slow'|'normal'|'fast'>('normal')
  const [anonymousMode, setAnonymousMode] = useState(false)
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: 8 }, (_, i) => ({ type: i < 5 ? 'bot' : 'empty', level: 2 } as Slot))
  )
  const [activeSeat, setActiveSeat] = useState<number | null>(null)
  // Exact pixel size of the felt, computed to fit (contain) the 300:226 SVG in the
  // available area. Sizing the box with width:100% + maxHeight:100% + aspect-ratio
  // all at once breaks the ratio on short (landscape-phone) viewports — the SVG
  // letterboxes while the % HTML overlays (SB/BB chips, popups) keep using the
  // distorted box, so they drift off the seats. A measured box keeps them locked.
  const [box, setBox] = useState({ w: 0, h: 0 })

  const stackChips = stackBB * bb
  const safeSelectedSeat = Math.min(selectedSeat, numPlayers - 1)
  const labels = POS_LABELS[numPlayers] ?? POS_LABELS[6]
  const myPosition = labels[safeSelectedSeat] ?? 'BTN'

  const sbSeatIdx = numPlayers === 2 ? 0 : 1
  const bbSeatIdx = numPlayers === 2 ? 1 : 2

  useEffect(() => {
    setSelectedSeat(s => Math.min(s, numPlayers - 1))
    setActiveSeat(null)
  }, [numPlayers])

  const updateSlot = (idx: number, update: Partial<Slot>) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...update } : s))

  const getSlotForSeat = (seatIdx: number): Slot => {
    const slotIdx = seatIdx < safeSelectedSeat ? seatIdx : seatIdx - 1
    return slots[slotIdx] ?? { type: 'empty', level: 1 }
  }

  const handleSlotUpdate = (seatIdx: number, update: Partial<Slot>) => {
    const slotIdx = seatIdx < safeSelectedSeat ? seatIdx : seatIdx - 1
    if (slotIdx >= 0) updateSlot(slotIdx, update)
  }

  const applyPreset = (p: typeof PRESETS[0]) => {
    setNumPlayers(p.players)
    setSelectedSeat(0)
    setStackBB(p.stack)
    setSb(p.sb)
    setBb(p.bb)
    setActiveSeat(null)
    setSlots(prev => prev.map((_s, i) => {
      const lvl = p.bots[i]
      return lvl !== undefined ? { type: 'bot', level: lvl } : { type: 'empty', level: 3 }
    }))
  }

  const activeCount = useMemo(() => {
    let c = 1
    for (let i = 0; i < numPlayers - 1; i++) if (slots[i]?.type !== 'empty') c++
    return c
  }, [slots, numPlayers])

  // click outside popup
  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setActiveSeat(null)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  // Fit the felt to the available area at the exact 300:226 ratio (contain).
  useEffect(() => {
    const el = tableRef.current
    if (!el) return
    const ratio = SVG_W / SVG_H
    const measure = () => {
      const cw = el.clientWidth, ch = el.clientHeight
      if (cw <= 0 || ch <= 0) return
      let w = cw, h = cw / ratio
      if (h > ch) { h = ch; w = ch * ratio }
      setBox({ w: Math.round(w), h: Math.round(h) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scale the HTML blind chips so they track the felt's size (they're fixed-px
  // overlays otherwise, and dwarf a small mobile table).
  const chipScale = box.w ? Math.max(0.62, Math.min(1, box.w / 672)) : 1

  const handleConfirm = () => {
    navigate('/game', {
      state: { numPlayers, selectedSeat: safeSelectedSeat, stackBB, sb, bb, ante, decisionTimer, gameVariant, gameSpeed, anonymousMode, slots, displayName, currency }
    })
  }

  return (
    <div className="relative flex flex-col h-full bg-poker-darker overflow-hidden">
      <RotateGate onQuit={() => navigate('/lobby')} />
      <ResumeSessionModal
        open={showResume && !!savedSession}
        label={savedSession?.label ?? ''}
        onResume={resumeSession}
        onNew={() => { clearResumable('cash'); setShowResume(false) }}
      />

      {/* ── Backdrop ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div className="absolute inset-0"
          initial={{ scale: 1.05 }}
          animate={reduceFx ? { scale: 1.08 } : { scale: [1.05, 1.14, 1.05], x: ['0%', '-1.8%', '0%'], y: ['0%', '-1.3%', '0%'] }}
          transition={reduceFx ? { duration: 0.4 } : { duration: 48, repeat: Infinity, ease: 'easeInOut' }}
          style={{ backgroundImage: 'url(/assets/cashgame-bg.webp)', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5, filter: 'saturate(0.95) brightness(0.85)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,10,18,0.65) 0%, rgba(5,8,15,0.80) 50%, rgba(4,6,12,0.92) 100%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(115% 95% at 50% 25%, transparent 38%, rgba(0,0,0,0.65) 100%)' }} />
        <motion.div className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ top: '-26%', width: '72%', height: '58%', background: 'radial-gradient(circle, rgba(0,212,255,0.14), transparent 68%)', filter: 'blur(74px)' }}
          animate={reduceFx ? { opacity: 0.10 } : { opacity: [0.06, 0.16, 0.06], scale: [1, 1.07, 1] }} transition={reduceFx ? { duration: 0.4 } : { duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      {/* ── CONTENT ── */}
      <div className="relative z-10 flex flex-col h-full p-2 md:p-3 gap-1.5 md:gap-2 overflow-hidden">

        {/* Title */}
        <div className="flex-shrink-0 text-center">
          <h1 className="font-display font-bold text-base md:text-xl tracking-[0.22em] uppercase" style={{ color: '#c9a227', textShadow: '0 0 32px rgba(201,162,39,0.45)' }}>
            {t('train.title')}
          </h1>
          <p className="hidden md:block text-white/25 text-[9px] tracking-wider uppercase">{t('train.subtitle')}</p>
        </div>

        {/* Quick presets — top strip */}
        <div className="flex-shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-[8px] font-bold text-poker-gold/55 uppercase tracking-widest mr-0.5 flex-shrink-0">{t('train.quickSetup')}</span>
          {PRESETS.map(p => (
            <motion.button key={p.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => applyPreset(p)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/3 border border-white/8 hover:border-poker-gold/35 hover:bg-poker-gold/6 transition-all flex-shrink-0">
              <span className="text-xs">{p.icon}</span>
              <span className="text-[8px] font-bold text-white/55">{t(p.nameKey)}</span>
            </motion.button>
          ))}
        </div>

        {/* Main row — always 3 columns (landscape is forced on phones via RotateGate) */}
        <div className="flex-1 flex gap-2 md:gap-3 min-h-0">

          {/* ── LEFT PANEL ── */}
          <div className="w-36 md:w-44 flex-shrink-0 flex flex-col gap-1.5 md:gap-2 overflow-y-auto md:overflow-hidden">

            {/* Number of players */}
            <div className="glass-card p-3 flex-shrink-0">
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-2">{t('train.numPlayers')}</p>
              <div className="grid grid-cols-4 gap-1">
                {[2,3,4,5,6,7,8,9].map(n => (
                  <motion.button key={n} whileTap={{ scale: 0.92 }}
                    onClick={() => setNumPlayers(n)}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      numPlayers === n
                        ? 'bg-poker-gold/25 text-poker-gold border border-poker-gold/55'
                        : 'bg-white/4 text-white/40 border border-white/8 hover:border-white/22'
                    }`}>{n}</motion.button>
                ))}
              </div>
              <p className="text-[8px] text-white/28 mt-1.5 text-center">
                {numPlayers === 2 ? t('train.headsUp') : numPlayers <= 3 ? t('train.shortHanded') : numPlayers <= 6 ? t('train.sixMax') : t('train.fullRing')}
              </p>
            </div>

            {/* Seat selector */}
            <div className="glass-card p-3 flex-shrink-0">
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-2">{t('train.seatSelect')}</p>
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: numPlayers }, (_, i) => (
                  <motion.button key={i} whileTap={{ scale: 0.92 }}
                    onClick={() => { setSelectedSeat(i); setActiveSeat(null) }}
                    className={`py-1 rounded-lg border text-center transition-all ${
                      safeSelectedSeat === i
                        ? 'bg-poker-teal/22 border-poker-teal text-poker-teal'
                        : 'bg-white/3 border-white/8 text-white/38 hover:border-white/22'
                    }`}>
                    <div className="text-[9px] font-bold">{labels[i] ?? `S${i+1}`}</div>
                  </motion.button>
                ))}
              </div>
              <p className="text-[8px] text-white/25 mt-1.5 text-center">{t('train.orClickTable')}</p>
            </div>

            {/* Bot reset */}
            <div className="glass-card p-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest">{t('train.configOpp', { count: numPlayers - 1 })}</p>
                <button onClick={() => setSlots(prev => prev.map((s, i) => i < numPlayers - 1 ? { ...s, type: 'bot', level: 2 } : { type: 'empty', level: 2 }))}
                  className="flex items-center gap-1 text-[8px] text-white/28 hover:text-white/55 transition-colors">
                  <RotateCcw size={9}/> {t('train.reset')}
                </button>
              </div>
              <div className="space-y-1">
                {BOT_LEVELS.map(b => (
                  <div key={b.level} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                      style={{ background: b.color + '22', color: b.color, border: `1px solid ${b.color}55` }}>{b.level}</span>
                    <span className="text-[8px] font-semibold" style={{ color: b.color }}>{t(b.nameKey)}</span>
                    <span className="text-[7px] text-white/25 ml-auto">{t(b.descKey)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="glass-card p-3 md:flex-1 md:overflow-hidden">
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-2">{t('train.setupSummary')}</p>
              <div className="space-y-1.5">
                {[
                  { label: t('train.sumPlayers'), val: `${numPlayers}` },
                  { label: 'Pos',                 val: myPosition },
                  { label: 'Stack',               val: `${fmt(stackChips)} (${stackBB}BB)` },
                  { label: 'Blinds',              val: `${fmt(sb)} / ${fmt(bb)}${ante > 0 ? ` / ${fmt(ante)}` : ''}` },
                  { label: t('train.sumActive'),  val: `${activeCount} / ${numPlayers}` },
                  { label: t('train.sumSettings'),val: `${gameVariant} · ${decisionTimer}s` },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between gap-1">
                    <span className="text-[8px] text-white/28 uppercase tracking-wide truncate">{r.label}</span>
                    <span className="text-[9px] font-bold text-white/65 text-right flex-shrink-0">{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── CENTER: TABLE + CONFIRM ── */}
          <div className="flex-1 flex flex-col items-center justify-center gap-2 md:gap-3 min-h-0">

            {/* Table wrapper */}
            <div ref={tableRef} className="relative w-full max-w-2xl flex-1 min-h-0 flex items-center justify-center">
              <div className="relative" style={box.w
                ? { width: box.w, height: box.h }
                : { width: '100%', aspectRatio: '300 / 226', maxHeight: '100%' }}>

                {/* SVG Table */}
                <svg viewBox="0 0 300 226" className="w-full h-full drop-shadow-2xl">
                  <defs>
                    <radialGradient id="felt2" cx="50%" cy="42%" r="58%">
                      <stop offset="0%" stopColor="#0e5530"/>
                      <stop offset="65%" stopColor="#083d20"/>
                      <stop offset="100%" stopColor="#041a0e"/>
                    </radialGradient>
                    <radialGradient id="feltShine2" cx="40%" cy="30%" r="55%">
                      <stop offset="0%" stopColor="white" stopOpacity="0.06"/>
                      <stop offset="100%" stopColor="white" stopOpacity="0"/>
                    </radialGradient>
                    <radialGradient id="rimGold2" cx="50%" cy="25%" r="65%">
                      <stop offset="0%" stopColor="#e8c840"/>
                      <stop offset="55%" stopColor="#c9a227"/>
                      <stop offset="100%" stopColor="#7a5508"/>
                    </radialGradient>
                    <filter id="tShadow2" x="-20%" y="-20%" width="140%" height="160%">
                      <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#000" floodOpacity="0.7"/>
                    </filter>
                    <filter id="sGlow2" x="-80%" y="-80%" width="260%" height="260%">
                      <feGaussianBlur stdDeviation="5" result="b"/>
                      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>

                  {/* Shadow */}
                  <ellipse cx={CX} cy={CY+14} rx={118} ry={52} fill="black" opacity="0.55"/>
                  {/* Outer wood rim */}
                  <ellipse cx={CX} cy={CY} rx={120} ry={76} fill="#3a2408"/>
                  {/* Gold rim */}
                  <ellipse cx={CX} cy={CY} rx={116} ry={72} fill="url(#rimGold2)" filter="url(#tShadow2)"/>
                  {/* Inner rail */}
                  <ellipse cx={CX} cy={CY} rx={109} ry={65} fill="#1a0e04"/>
                  {/* Felt */}
                  <ellipse cx={CX} cy={CY} rx={105} ry={62} fill="url(#felt2)"/>
                  <ellipse cx={CX} cy={CY} rx={105} ry={62} fill="url(#feltShine2)"/>
                  {/* Inner ring decoration */}
                  <ellipse cx={CX} cy={CY} rx={90} ry={50} fill="none" stroke="rgba(201,162,39,0.18)" strokeWidth="0.8"/>
                  {/* Center */}
                  <text x={CX} y={CY-6}  textAnchor="middle" fill="rgba(201,162,39,0.12)" fontSize="32" fontFamily="serif">♠</text>
                  <text x={CX} y={CY+14} textAnchor="middle" fill="rgba(201,162,39,0.08)" fontSize="9" fontFamily="monospace" letterSpacing="3">YOURPOKER</text>

                  {/* Seats */}
                  {Array.from({ length: numPlayers }, (_, i) => {
                    const { x, y } = seatXY(i, numPlayers)
                    const isPlayer = i === safeSelectedSeat
                    const slot = isPlayer ? { type: 'bot' as SlotType, level: 1 } : getSlotForSeat(i)
                    const isEmpty = !isPlayer && slot.type === 'empty'
                    const botColor = slot.type === 'bot' ? (BOT_LEVELS[slot.level - 1]?.color ?? '#f0d060') : '#44aaff'
                    const borderColor = isPlayer ? '#00d4ff' : isEmpty ? 'rgba(255,255,255,0.14)' : botColor
                    const fillColor   = isPlayer ? 'rgba(0,212,255,0.22)' : isEmpty ? 'rgba(255,255,255,0.04)' : 'rgba(10,20,35,0.82)'
                    const isActive    = activeSeat === i
                    const lbl         = labels[i] ?? `S${i+1}`

                    return (
                      <g key={i} style={{ cursor: isPlayer ? 'default' : 'pointer' }}
                        onClick={e => {
                          e.stopPropagation()
                          if (!isPlayer) setActiveSeat(activeSeat === i ? null : i)
                        }}
                      >
                        {isActive && <circle cx={x} cy={y} r={24} fill="rgba(255,255,255,0.06)" filter="url(#sGlow2)"/>}
                        {isPlayer && <circle cx={x} cy={y} r={22} fill="rgba(0,212,255,0.10)" filter="url(#sGlow2)"/>}
                        <circle cx={x} cy={y} r={17}
                          fill={fillColor}
                          stroke={isActive ? 'white' : borderColor}
                          strokeWidth={isPlayer ? 2.2 : isActive ? 2 : 1.5}/>
                        {isPlayer && (
                          <text x={x} y={y+5} textAnchor="middle" fill="#00d4ff" fontSize="11" fontWeight="bold">YOU</text>
                        )}
                        {!isPlayer && slot.type === 'bot' && (
                          <>
                            <circle cx={x} cy={y} r={9} fill="rgba(0,0,0,0.35)"/>
                            <text x={x} y={y-2} textAnchor="middle" fill={botColor} fontSize="7" fontWeight="bold">BOT</text>
                            <text x={x} y={y+7} textAnchor="middle" fill={botColor} fontSize="8" fontWeight="bold">{slot.level}</text>
                          </>
                        )}
                        {!isPlayer && slot.type === 'human' && (
                          <text x={x} y={y+5} textAnchor="middle" fill="#44aaff" fontSize="11">👤</text>
                        )}
                        {isEmpty && (
                          <text x={x} y={y+4} textAnchor="middle" fill="rgba(255,255,255,0.20)" fontSize="14">+</text>
                        )}
                        <text x={x} y={y+30} textAnchor="middle"
                          fill={isPlayer ? '#00d4ff' : 'rgba(255,255,255,0.32)'}
                          fontSize="7" fontFamily="monospace">{lbl}</text>
                      </g>
                    )
                  })}
                </svg>

                {/* ── SB Chip ── */}
                {(() => {
                  const { xPct, yPct } = chipPct(sbSeatIdx, numPlayers)
                  return (
                    <div className="absolute pointer-events-auto" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: `translate(-50%, -50%) scale(${chipScale})`, zIndex: 15 }}>
                      <BlindChip label="SB" value={sb} color="#55bbff"
                        onInc={() => setSb(v => +(v + 0.5).toFixed(1))}
                        onDec={() => setSb(v => Math.max(0.5, +(v - 0.5).toFixed(1)))}/>
                    </div>
                  )
                })()}

                {/* ── BB Chip ── */}
                {(() => {
                  const { xPct, yPct } = chipPct(bbSeatIdx, numPlayers)
                  return (
                    <div className="absolute pointer-events-auto" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: `translate(-50%, -50%) scale(${chipScale})`, zIndex: 15 }}>
                      <BlindChip label="BB" value={bb} color="#c9a227"
                        onInc={() => setBb(v => v + 1)}
                        onDec={() => setBb(v => Math.max(1, v - 1))}/>
                    </div>
                  )
                })()}

                {/* ── Seat config popup ── */}
                <AnimatePresence>
                  {activeSeat !== null && activeSeat !== safeSelectedSeat && (() => {
                    const { xPct, yPct } = seatPct(activeSeat, numPlayers)
                    const slot = getSlotForSeat(activeSeat)
                    const above = yPct > 50
                    return (
                      <div key={activeSeat} className="absolute pointer-events-auto" style={{ left: `${xPct}%`, top: `${yPct}%`, zIndex: 30 }}>
                        <SeatPopup
                          slot={slot}
                          posLabel={labels[activeSeat] ?? `S${activeSeat+1}`}
                          above={above}
                          onUpdate={update => handleSlotUpdate(activeSeat, update)}
                          onClose={() => setActiveSeat(null)}
                        />
                      </div>
                    )
                  })()}
                </AnimatePresence>

                {/* Hint */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-3 pb-1">
                  <span className="text-[9px] text-white/22 uppercase tracking-wide">{t('train.clickSeat')}</span>
                  <span className="text-[9px] font-bold text-poker-teal">{myPosition}</span>
                </div>
              </div>
            </div>

            {/* ── CONFIRM & START ── */}
            <motion.button
              whileHover={{ scale: 1.025, boxShadow: '0 0 55px rgba(201,162,39,0.65)' }}
              whileTap={{ scale: 0.975 }}
              onClick={handleConfirm}
              className="flex-shrink-0 w-full max-w-2xl py-2.5 md:py-4 rounded-2xl font-display font-bold text-base md:text-lg tracking-[0.35em] uppercase text-poker-darker transition-all"
              style={{
                background: 'linear-gradient(135deg, #f5e070 0%, #c9a227 50%, #8B6810 100%)',
                boxShadow: '0 0 30px rgba(201,162,39,0.45), 0 4px 24px rgba(0,0,0,0.5)',
              }}>
              {t('train.confirm')}
            </motion.button>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="w-40 md:w-52 flex-shrink-0 flex flex-col gap-1.5 md:gap-2 overflow-y-auto md:overflow-hidden">

            {/* Currency + Big-blind value + Stack */}
            <div className="glass-card p-3 flex-shrink-0">
              {/* Currency */}
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-1.5">{t('train.currency')}</p>
              <div className="grid grid-cols-3 gap-1 mb-3">
                {[{ sym: '$', name: 'USD' }, { sym: '€', name: 'EUR' }, { sym: 'DH', name: 'MAD' }].map(c => (
                  <motion.button key={c.sym} whileTap={{ scale: 0.92 }} onClick={() => pickCurrency(c.sym)}
                    className={`py-1.5 rounded-lg border text-center text-[10px] font-black transition-all ${
                      currency === c.sym ? 'bg-poker-gold/25 border-poker-gold text-poker-gold' : 'bg-white/4 border-white/8 text-white/40 hover:border-white/22'
                    }`}>{c.sym} <span className="text-[7px] font-bold opacity-60">{c.name}</span></motion.button>
                ))}
              </div>

              {/* Blind level — currency-specific quick presets (still adjustable below) */}
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-1.5">{t('train.blindLevel')}</p>
              <div className="flex gap-1 mb-3">
                {blindLevelsFor(currency).map(lv => {
                  const active = sb === lv.sb && bb === lv.bb
                  return (
                    <motion.button key={`${lv.sb}/${lv.bb}`} whileTap={{ scale: 0.92 }} onClick={() => { setSb(lv.sb); setBb(lv.bb) }}
                      className={`flex-1 py-1.5 rounded-lg border text-center text-[10px] font-black transition-all ${
                        active ? 'bg-poker-gold/25 border-poker-gold text-poker-gold' : 'bg-white/4 border-white/8 text-white/40 hover:border-white/22'
                      }`}>{lv.sb}/{lv.bb}</motion.button>
                  )
                })}
              </div>

              {/* Big-blind value — makes "1 BB" explicit */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest">{t('train.bbValue')}</p>
                  <p className="text-[9px] text-white/40 mt-0.5">{t('train.oneBbIs', { v: fmt(bb) })} · SB {fmt(sb)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setBigBlind(bb - (bb > 10 ? 5 : 1))} className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Minus size={10} className="text-white/55"/></button>
                  <input type="number" min={1} value={bb} onChange={e => setBigBlind(+e.target.value || 1)}
                    className="w-14 bg-white/5 border border-white/10 rounded-lg py-1 text-center text-sm font-bold text-poker-gold focus:border-poker-gold/60 outline-none"/>
                  <button onClick={() => setBigBlind(bb + (bb >= 10 ? 5 : 1))} className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Plus size={10} className="text-white/55"/></button>
                </div>
              </div>

              {/* Stack in BB — quick presets + FREE input (no cap) */}
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-1.5">{t('train.stackInit')}</p>
              <div className="grid grid-cols-5 gap-1 mb-2">
                {[20,50,100,200,500].map(cnt => (
                  <motion.button key={cnt} whileTap={{ scale: 0.92 }} onClick={() => setStackBB(cnt)}
                    className={`py-1 rounded-lg border text-center text-[8px] font-bold transition-all ${
                      stackBB === cnt ? 'bg-poker-gold/25 border-poker-gold text-poker-gold' : 'bg-white/4 border-white/8 text-white/38 hover:border-white/22'
                    }`}>{cnt}BB</motion.button>
                ))}
              </div>
              <div className="bg-white/4 rounded-xl p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1">
                    <input type="number" min={1} value={stackBB} onChange={e => setStackBB(Math.max(1, Math.round(+e.target.value || 1)))}
                      className="w-16 bg-transparent text-base font-bold text-white outline-none border-b border-white/15 focus:border-poker-gold/60"/>
                    <span className="text-[9px] font-bold text-white/45">BB</span>
                  </div>
                  <p className="text-[8px] text-white/38 mt-0.5 truncate">= {fmt(stackChips)}</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setStackBB(n => n + 10)} className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Plus size={10} className="text-white/55"/></button>
                  <button onClick={() => setStackBB(n => Math.max(1, n - 10))}  className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Minus size={10} className="text-white/55"/></button>
                </div>
              </div>
            </div>

            {/* Ante */}
            <div className="glass-card p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest">{t('train.ante')}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setAnte(v => Math.max(0, +(v - 0.5).toFixed(1)))} className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Minus size={9} className="text-white/55"/></button>
                  <span className="text-sm font-bold text-poker-gold w-8 text-center">{ante}</span>
                  <button onClick={() => setAnte(v => +(v + 0.5).toFixed(1))} className="w-6 h-6 rounded bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors"><Plus size={9} className="text-white/55"/></button>
                </div>
              </div>
            </div>

            {/* Settings */}
            <div className="glass-card p-3 md:flex-1 md:overflow-auto">
              <p className="text-[8px] font-bold text-white/45 uppercase tracking-widest mb-3">{t('train.tabSettings')}</p>

              {/* Timer */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[8px] text-white/38">{t('train.decisionTimer')}</p>
                  <span className="text-xs font-bold text-poker-gold">{decisionTimer}s</span>
                </div>
                <input type="range" min="5" max="120" step="5" value={decisionTimer}
                  onChange={e => setDecisionTimer(+e.target.value)}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ background: `linear-gradient(to right, #c9a227 ${((decisionTimer-5)/115)*100}%, rgba(255,255,255,0.10) 0%)` }}/>
                <div className="flex justify-between text-[7px] text-white/22 mt-0.5"><span>5s</span><span>60s</span><span>120s</span></div>
              </div>

              {/* Variant */}
              <div className="mb-3">
                <p className="text-[8px] text-white/38 mb-1.5">{t('train.gameVariant')}</p>
                <div className="flex gap-1">
                  {(['NLH','PLO','PLO5'] as const).map(v => (
                    <button key={v} onClick={() => setGameVariant(v)}
                      className={`flex-1 py-1.5 rounded-lg border text-[8px] font-bold transition-all ${
                        gameVariant === v ? 'bg-poker-gold/22 border-poker-gold text-poker-gold' : 'bg-white/4 border-white/8 text-white/38 hover:border-white/22'
                      }`}>{v}</button>
                  ))}
                </div>
              </div>

              {/* Speed */}
              <div className="mb-3">
                <p className="text-[8px] text-white/38 mb-1.5">{t('train.gameSpeed')}</p>
                <div className="flex gap-1">
                  {(['slow','normal','fast'] as const).map(v => (
                    <button key={v} onClick={() => setGameSpeed(v)}
                      className={`flex-1 py-1.5 rounded-lg border text-[8px] font-bold transition-all ${
                        gameSpeed === v ? 'bg-poker-teal/22 border-poker-teal text-poker-teal' : 'bg-white/4 border-white/8 text-white/38 hover:border-white/22'
                      }`}>
                      {v === 'slow' ? t('train.speedSlow') : v === 'normal' ? t('train.speedNormal') : t('train.speedFast')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Anonymous mode */}
              <div className="flex items-center justify-between bg-white/3 border border-white/8 rounded-xl p-2.5">
                <div>
                  <p className="text-[8px] font-semibold text-white/65">{t('train.anonMode')}</p>
                  <p className="text-[7px] text-white/28">{t('train.anonSub')}</p>
                </div>
                <button onClick={() => setAnonymousMode(v => !v)}
                  className="relative flex-shrink-0 transition-colors"
                  style={{ height: '22px', width: '40px', borderRadius: '11px', background: anonymousMode ? '#00c4a8' : 'rgba(255,255,255,0.10)' }}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-md ${anonymousMode ? 'left-5' : 'left-0.5'}`}/>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
