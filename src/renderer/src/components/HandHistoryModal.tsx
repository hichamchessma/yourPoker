// -----------------------------------------------------------------------------
// Hand-history replay: the list of hands, a mini table that re-enacts the action
// step by step, the action log, Range Vision on hover and the coach's verdict on
// any hero decision. Shared by the live table, the History page and the simulation
// report -- it lives here instead of inside GamePage so those surfaces don't have
// to load the game engine just to show a replay.
// -----------------------------------------------------------------------------
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { PlayingCard, FaceDown, EmptySlot, ChipStack, FlyingStack, DealerButtonToken, TableSVG } from './tableVisuals'
import RangeHeatmap from './RangeHeatmap'
import RotateGate from './RotateGate'
import EquityReasoningBlock from './EquityReasoning'
import { useDevice } from '../lib/useDevice'
import { money, curSymbol, curIsSuffix } from '../lib/money'
import { rangeView } from '../lib/rangeEstimator'
import { handKeyFromCards } from '../lib/preflopRanges'
import { betOffset } from '../lib/tableGeometry'
import { computeStepState, reconstructRanges, playerLastMeta, critiqueHeroMove } from '../lib/handCritique'
import type { Suit, HandHistoryRecord, MoveCritique } from '../lib/handTypes'

// winner's stack as the pot chips land on their seat, like a real poker client.
function CountUp({ from, to, dur = 800, delay = 450 }: { from: number; to: number; dur?: number; delay?: number }): JSX.Element {
  const [v, setV] = useState(from)
  useEffect(() => {
    if (from === to) { setV(to); return }
    setV(from)
    let raf = 0; const t0 = performance.now() + delay
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / dur))
      setV(Math.round(from + (to - from) * ease(t)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, dur, delay])
  return <>{v.toLocaleString()}</>
}

export default function HandHistoryModal({ records, onClose, onRevive, initialId, initialStep, titleKey }: {
  records: HandHistoryRecord[]
  onClose: () => void
  onRevive?: (record: HandHistoryRecord, stepIdx: number) => void
  initialId?: number          // open directly on this hand (defaults to the most recent)
  initialStep?: number        // jump straight to this action step (e.g. a flagged move from the perf report)
  titleKey?: string           // override the panel title (e.g. the sim report)
}) {
  const { t } = useTranslation()
  const { isPhone } = useDevice()
  const [selectedId, setSelectedId] = useState<number|null>(initialId ?? (records.length > 0 ? records[records.length-1].id : null))
  const [stepIdx, setStepIdx] = useState<number>(initialStep ?? 0)
  const [critique, setCritique] = useState<MoveCritique | null>(null)
  // Pin a specific opening step (a flagged spot to review): honoured once, then normal.
  const initStepRef = useRef<number | undefined>(initialStep)
  // Auto-replay: on open, the last hand plays from the start (0.5s/step); at the end
  // it waits 5s then loops. ANY manual navigation flips this off (see stopAuto).
  const [autoPlay, setAutoPlay] = useState(initialStep == null)
  const autoPlayRef = useRef(autoPlay)
  useEffect(() => { autoPlayRef.current = autoPlay }, [autoPlay])
  const stopAuto = () => setAutoPlay(false)
  const logRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  // Keep the selected hand visible in the left list when navigating with ↑/↓.
  useEffect(() => { selectedRowRef.current?.scrollIntoView({ block: 'nearest' }) }, [selectedId])

  const record = records.find(r => r.id === selectedId) ?? null

  // On (re)selecting a hand: auto-replay starts at the very first step; otherwise jump
  // straight to the final result (the previous behaviour).
  useEffect(() => {
    if (initStepRef.current != null) { setStepIdx(initStepRef.current); initStepRef.current = undefined; return }
    if (record) setStepIdx(autoPlayRef.current ? 0 : record.actions.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Auto-replay driver: advance one step every 0.5s; once at the end, pause 5s then
  // loop back to the start. Cancelled the instant autoPlay turns off.
  useEffect(() => {
    if (!autoPlay || !record) return
    const last = record.actions.length - 1
    const t = setTimeout(() => setStepIdx(i => (i >= last ? 0 : i + 1)), stepIdx >= last ? 5000 : 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, stepIdx, selectedId])
  // Clear the critique whenever we move to another step / hand.
  useEffect(() => { setCritique(null) }, [stepIdx, selectedId])

  // Keyboard: ← step back, → step forward, Space = judge the current move,
  // Esc = close the replay. (stepIdx is in deps so the handler isn't stale.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!record) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); stopAuto(); setStepIdx(i => Math.max(0, i - 1)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stopAuto(); setStepIdx(i => Math.min(record.actions.length - 1, i + 1)) }
      // ↑ / ↓ jump between HANDS in the left list (it's shown most-recent-first), with
      // wrap-around: ↓ past the bottom → first, ↑ past the top → last.
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); stopAuto()
        const order = [...records].reverse() // visual top→bottom order
        const cur = order.findIndex(r => r.id === record.id)
        if (cur >= 0 && order.length > 1) {
          const n = e.key === 'ArrowUp'
            ? (cur <= 0 ? order.length - 1 : cur - 1)
            : (cur >= order.length - 1 ? 0 : cur + 1)
          setSelectedId(order[n].id)
        }
      }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault() // never scroll the page
        stopAuto()
        const a = record.actions[stepIdx]
        if (a && a.seatIdx >= 0 && a.isHero && a.actionType !== 'SB' && a.actionType !== 'BB')
          setCritique(c => (c ? null : critiqueHeroMove(record, stepIdx)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [record, stepIdx, onClose])

  // Range Vision in the replay — hover a player to see their estimated range.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverXY, setHoverXY] = useState<{ x: number; y: number } | null>(null)
  const stepRanges = useMemo(() => (record ? reconstructRanges(record, stepIdx) : {}), [record?.id, stepIdx])
  // Reference range = each player's range at the END of pre-flop (their plausible
  // starting range). Lets the heatmap tell apart hands ABANDONED in-hand (were in the
  // pre-flop range, the line cut them) from hands OUT from the start (never in range).
  const startRanges = useMemo(() => {
    if (!record) return {}
    const flop = record.actions.findIndex(a => a.seatIdx === -1 && a.phase === 'flop')
    return reconstructRanges(record, flop >= 0 ? flop : record.actions.length - 1)
  }, [record?.id])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [stepIdx, selectedId])

  if (!record) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.85)'}}>
        <div className="bg-[#070d1a] border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-white/60 mb-4">{t('sess.noHistory')}</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/15">{t('sess.closeBtn')}</button>
        </div>
      </div>
    )
  }

  const isEnd = stepIdx >= record.actions.length - 1
  const stepState = computeStepState(record, stepIdx)

  // Position players around mini ellipse (hero at bottom)
  const CX = 50, CY = 46, RX = 38, RY = 30
  const heroIdx = record.players.findIndex(p => p.isHero)
  const n = record.players.length

  function getPlayerPos(playerArrayIdx: number): {x:number; y:number} {
    const offset = heroIdx >= 0 ? playerArrayIdx - heroIdx : playerArrayIdx
    const angle = (offset / n) * 2 * Math.PI + Math.PI / 2
    return {
      x: CX + RX * Math.cos(angle),
      y: CY + RY * Math.sin(angle),
    }
  }

  // Action log entries up to stepIdx
  const visibleActions = record.actions.slice(0, stepIdx + 1)

  return (
    <div className={`fixed inset-0 z-[110] flex items-center justify-center ${isPhone?'p-0':'p-3'}`} style={{background:'rgba(0,0,0,0.9)'}}>
      <RotateGate onQuit={onClose} />
      <motion.div initial={{opacity:0,scale:0.94,y:16}} animate={{opacity:1,scale:1,y:0}}
        className={`w-full flex flex-col border border-white/10 overflow-hidden ${isPhone?'h-full rounded-none':'max-w-[1480px] h-[94vh] rounded-2xl'}`}
        style={{background:'#070d1a'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white/70 uppercase tracking-widest">{t(titleKey ?? 'sess.handHistory')}</span>
            <span className="text-sm text-[#c9a227] font-bold">{records.length} main{records.length>1?'s':''}</span>
            <span className="text-[10px] text-[#c9a227]/70 hidden md:inline">👁 survole un joueur → sa range</span>
            <span className="text-[10px] text-white/30 hidden lg:inline">{t('sess.replayHint')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Revive: re-create THIS exact spot as a playable sandbox. Opponents'
                cards are re-drawn from the range their line implies at this step. */}
            {onRevive && (
              <button onClick={() => onRevive(record, stepIdx)}
                title={t('sess.reviveTip')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl font-black uppercase tracking-[0.18em] text-[11px] transition-all hover:scale-[1.03]"
                style={{ background: 'linear-gradient(135deg,#a78bff,#6d4ed6,#3c2a72)', color: '#0a0716', boxShadow: '0 0 22px rgba(140,110,255,0.45)' }}>
                ⚡ Revive situation
              </button>
            )}
            <button onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-lg">
              ✕
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 ${isPhone?'flex flex-col overflow-y-auto':'flex'}`}>

          {/* Hand list — left column on desktop, horizontal scroll strip on phone.
              `relative z-20` keeps it above any player badge that the table area
              positions near its edge, so every hand row stays clickable. */}
          <div className={`relative z-20 ${isPhone
            ? 'flex-shrink-0 flex overflow-x-auto border-b border-white/8'
            : 'w-52 flex-shrink-0 border-r border-white/8 overflow-y-auto'}`}>
            {[...records].reverse().map(r => {
              const profit = r.heroProfit
              return (
                <button key={r.id} ref={r.id === selectedId ? selectedRowRef : undefined} onClick={() => { stopAuto(); setSelectedId(r.id) }}
                  className={`text-left transition-all ${isPhone
                    ? `flex-shrink-0 px-3 py-2 border-r border-white/8 ${r.id===selectedId?'bg-[#c9a227]/15 border-b-2 border-b-[#c9a227]':''}`
                    : `w-full px-4 py-3 border-b border-white/5 ${r.id===selectedId?'bg-[#c9a227]/10 border-l-2 border-l-[#c9a227]':'hover:bg-white/5'}`}`}>
                  <div className="text-[13px] font-bold text-white/80">Main #{r.handNum}</div>
                  <div className={`text-xs font-mono font-bold ${profit>0?'text-emerald-400':profit<0?'text-red-400':'text-white/30'}`}>
                    {profit>0?'+':''}{profit} BB
                  </div>
                  <div className="text-[10px] text-white/30">{r.date.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})}</div>
                </button>
              )
            })}
          </div>

          {/* Main content — table + action log side-by-side on desktop, stacked on phone */}
          <div className={`flex-1 min-w-0 min-h-0 ${isPhone?'flex flex-col':'flex'}`}>

            {/* Mini table view */}
            <div className={`relative flex-1 flex flex-col min-w-0 gap-3 ${isPhone?'p-3':'p-5'}`}>
              <div className="text-xs font-bold text-white/50 uppercase tracking-widest">
                Main #{record.handNum} — {record.date.toLocaleDateString('fr')} {record.date.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})}
              </div>

              {/* Table area */}
              <div className="relative flex-1 min-h-0" style={{minHeight:isPhone?190:360}}>
                {/* Table SVG bg — decorative, never intercept pointer events */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div style={{width:'100%',maxWidth:900,opacity:0.78}}>
                    <TableSVG/>
                  </div>
                </div>

                {/* Players */}
                {record.players.map((pl, i) => {
                  const pos = getPlayerPos(i)
                  const stepPl = stepState.players.find(sp => sp.idx === pl.idx)
                  const isFolded = stepPl?.isFolded ?? false
                  // At the final step show the real end stack (includes winnings);
                  // mid-replay show the reconstructed committed stack.
                  const stack = isEnd ? pl.endStack : (stepPl?.stack ?? pl.startStack)
                  const isWinner = isEnd && pl.isWinner
                  const showCards = pl.isHero || isEnd

                  const inHand = !isFolded && (pl.holeCards[0] !== null || pl.holeCards[1] !== null)
                  return (
                    <div key={pl.idx}
                      className={`absolute flex flex-col items-center transition-all duration-300 ${isFolded?'opacity-30 grayscale':''} ${inHand?'cursor-help':''}`}
                      style={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                      }}
                      onMouseEnter={!isPhone && inHand ? (e) => { setHoverIdx(pl.idx); setHoverXY({ x: e.clientX, y: e.clientY }) } : undefined}
                      onMouseLeave={!isPhone && inHand ? () => { setHoverIdx(null); setHoverXY(null) } : undefined}
                      onClick={isPhone && inHand ? (e) => { e.stopPropagation(); setHoverIdx(h => h===pl.idx?null:pl.idx); setHoverXY({ x: e.clientX, y: e.clientY }) } : undefined}>
                      {/* Cards */}
                      {(pl.holeCards[0] || pl.holeCards[1]) && (
                        <div className="flex gap-0.5 mb-1">
                          {[0,1].map(ci => {
                            const card = pl.holeCards[ci as 0|1]
                            if (!card) return null
                            if (showCards && card) {
                              return <PlayingCard key={ci} rank={card.rank} suit={card.suit as Suit} w={isPhone?34:54} h={isPhone?48:76}/>
                            }
                            return <FaceDown key={ci} w={isPhone?28:46} h={isPhone?40:64}/>
                          })}
                        </div>
                      )}
                      {/* Name badge */}
                      <div className={`px-2.5 py-0.5 rounded-lg border text-[12.5px] font-bold whitespace-nowrap flex items-center gap-1.5
                        ${pl.isHero?'border-[#00d4ff]/50 bg-[#00d4ff]/10 text-[#00d4ff]'
                        :isWinner?'border-[#c9a227]/60 bg-[#c9a227]/10 text-[#c9a227]'
                        :'border-white/10 bg-black/40 text-white/70'}`}>
                        {pl.isHero ? t('sess.youShort') : pl.name}
                        {pl.position && <span className="text-[8px] font-black px-1 rounded bg-[#c9a227]/15 text-[#c9a227]/90 border border-[#c9a227]/25 uppercase tracking-wider">{pl.position}</span>}
                      </div>
                      <div className="text-[12px] font-bold text-emerald-300/90 font-mono mt-0.5">
                        {isEnd && isWinner
                          ? <>{!curIsSuffix() && curSymbol()}<CountUp from={stepPl?.stack ?? pl.startStack} to={pl.endStack} />{curIsSuffix() && ` ${curSymbol()}`}</>
                          : money(stack)}
                      </div>
                      {isWinner && <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 14 }} className="text-lg">🏆</motion.div>}
                    </div>
                  )
                })}

                {/* Dealer button — show the BTN so the position is clear in the replay too */}
                {(() => {
                  const di = record.players.findIndex(p => p.position === 'BTN' || p.position === 'BTN/SB')
                  if (di < 0) return null
                  const dp = getPlayerPos(di)
                  const ox = dp.x < 50 ? 5 : -5
                  const oy = dp.y < 46 ? 4 : -4
                  return (
                    <div className="absolute pointer-events-none" style={{ left: `${dp.x + ox}%`, top: `${dp.y + oy}%`, transform: 'translate(-50%,-50%)', zIndex: 14 }}>
                      <DealerButtonToken size={isPhone ? 16 : 24}/>
                    </div>
                  )
                })()}

                {/* Live bets in front of players (re-enacted street by street). Hidden
                    at the end — the chips have been swept into the pot → winner. */}
                {!isEnd && record.players.map((pl, i) => {
                  const amt = stepState.streetBets[pl.idx] ?? 0
                  if (amt <= 0) return null
                  const pos = getPlayerPos(i)
                  const off = betOffset(pos.x, pos.y)
                  return (
                    <div key={`bet-${pl.idx}`} className="absolute pointer-events-none flex flex-col items-center gap-0.5"
                      style={{ left: `${pos.x + off.x}%`, top: `${pos.y + off.y}%`, transform: 'translate(-50%,-50%)', zIndex: 12 }}>
                      <ChipStack amount={amt} sz={16} maxVisible={5}/>
                      <span className="text-[10px] font-mono text-[#c9a227] font-bold bg-black/55 px-1 rounded">${amt}</span>
                    </div>
                  )
                })}

                {/* Board cards */}
                <div className="absolute left-1/2 -translate-x-1/2" style={{top:'41%',transform:'translate(-50%,-50%)'}}>
                  <div className="flex gap-1.5 items-center">
                    {stepState.board.map((card, i) => (
                      <div key={i}>
                        {card
                          ? <PlayingCard rank={card.rank} suit={card.suit as Suit} w={isPhone?38:48} h={isPhone?54:68}/>
                          : <EmptySlot w={isPhone?38:48} h={isPhone?54:68}/>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pot — hidden once the hand ends (the chips sweep to the winner instead) */}
                {!isEnd && (
                  <div className="absolute left-1/2 top-[59%] -translate-x-1/2 -translate-y-1/2">
                    <div className="flex items-center gap-2 bg-black/65 border border-[#c9a227]/30 rounded-lg px-4 py-1.5">
                      <span className="text-[11px] text-white/45 uppercase tracking-wide">Pot</span>
                      <span className="text-base font-bold text-[#c9a227] font-mono">{money(stepState.pot)}</span>
                    </div>
                  </div>
                )}

                {/* End of hand: sweep the pot chips to the winner(s), like the live table */}
                {isEnd && record.players.some(p => p.isWinner) && (() => {
                  const winners = record.players.map((pl, i) => ({ pl, i })).filter(w => w.pl.isWinner)
                  const share = Math.max(1, Math.round(record.finalPot / winners.length))
                  return winners.map(w => {
                    const to = getPlayerPos(w.i)
                    return (
                      <motion.div key={`win-${w.pl.idx}`} className="absolute pointer-events-none"
                        initial={{ left: '50%', top: '59%', opacity: 0, scale: 0.45 }}
                        animate={{ left: `${to.x}%`, top: `${to.y}%`, opacity: [0, 1, 1, 0], scale: [0.45, 1.05, 1, 0.7] }}
                        transition={{ duration: 0.95, delay: 0.2, ease: [0.4, 0, 0.2, 1], times: [0, 0.2, 0.8, 1] }}
                        style={{ transform: 'translate(-50%,-50%)', zIndex: 30, filter: 'drop-shadow(0 4px 10px rgba(201,162,39,0.5))' }}>
                        <FlyingStack amount={share} sz={20} />
                      </motion.div>
                    )
                  })
                })()}

                {/* End-of-hand result — FLOATS in the felt's bottom-left corner so it
                    never reflows the layout: the table stays static when the hand ends,
                    and the won board/cards stay fully visible behind it. */}
                {isEnd && (
                  <div className="absolute bottom-1.5 left-1.5 z-30 rounded-xl border border-[#c9a227]/25 bg-[#070d1a]/90 backdrop-blur px-3 py-2 shadow-xl shadow-black/50 flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[8px] text-white/40 uppercase tracking-wide">Gagnant</span>
                      <span className="text-[11.5px] font-bold text-[#c9a227]">{record.winnerNames.join(', ')}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[8px] text-white/40 uppercase tracking-wide">Pot</span>
                      <span className="text-[11.5px] font-bold text-white/70">{money(record.finalPot)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[8px] text-white/40 uppercase tracking-wide">{t('sess.yourResult')}</span>
                      <span className={`text-[11.5px] font-bold ${record.heroProfit>0?'text-emerald-400':record.heroProfit<0?'text-red-400':'text-white/50'}`}>
                        {record.heroProfit>0?'+':''}{record.heroProfit} BB
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Step controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Auto-replay toggle: relance le coup depuis le début / stoppe */}
                <button onClick={() => { if (autoPlay) setAutoPlay(false); else { setStepIdx(0); setAutoPlay(true) } }}
                  title={autoPlay ? t('sess.replayStop') : t('sess.replayStart')}
                  className="px-3 py-1.5 rounded border text-sm font-bold transition-all"
                  style={autoPlay
                    ? { background: 'rgba(201,162,39,0.18)', borderColor: 'rgba(201,162,39,0.6)', color: '#f0d98a' }
                    : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                  {autoPlay ? '⏸ Replay' : '↻ Replay'}
                </button>
                <button onClick={() => { stopAuto(); setStepIdx(0) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>|◀</button>
                <button onClick={() => { stopAuto(); setStepIdx(s => Math.max(0, s-1)) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={stepIdx===0}>◀</button>
                <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden cursor-pointer"
                  onClick={e => {
                    stopAuto()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = (e.clientX - rect.left) / rect.width
                    setStepIdx(Math.round(ratio * (record.actions.length - 1)))
                  }}>
                  <div className="h-full bg-[#c9a227] rounded-full transition-all"
                    style={{width:`${record.actions.length>1?(stepIdx/(record.actions.length-1))*100:100}%`}}/>
                </div>
                <button onClick={() => { stopAuto(); setStepIdx(s => Math.min(record.actions.length-1, s+1)) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={isEnd}>▶</button>
                <button onClick={() => { stopAuto(); setStepIdx(record.actions.length-1) }}
                  className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 disabled:opacity-30"
                  disabled={isEnd}>▶|</button>
                <span className="text-xs text-white/40 font-mono">{stepIdx+1}/{record.actions.length}</span>
              </div>

              {/* Coach verdict — FLOATS over the table column (absolute) so it never
                  reflows the layout: the table no longer jumps when you judge a move.
                  Trigger = a small corner button; the verdict = a centred overlay card
                  shown in full (its own scroll only if the reasoning is very long). */}
              {(() => {
                const a = record.actions[stepIdx]
                if (!a || a.seatIdx < 0 || !a.isHero || a.actionType === 'SB' || a.actionType === 'BB') return null
                if (!critique) {
                  return (
                    <button onClick={() => { stopAuto(); setCritique(critiqueHeroMove(record, stepIdx)) }}
                      className="absolute top-1 right-1 z-30 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#c9a227]/45 bg-[#070d1a]/90 backdrop-blur text-[#c9a227] font-bold text-[11px] uppercase tracking-widest hover:bg-[#c9a227]/20 transition-all shadow-xl shadow-black/50">
                      👁 {t('sess.judgeMove')}
                    </button>
                  )
                }
                const vc = critique.verdict === 'good' ? '#34d399' : critique.verdict === 'mistake' ? '#f87171' : '#e8c547'
                return (
                  <div className="absolute inset-0 z-40 flex items-center justify-center p-3" onClick={() => setCritique(null)}>
                    <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" />
                    <div onClick={e => e.stopPropagation()}
                      className="relative w-full max-w-[560px] max-h-full overflow-y-auto rounded-2xl border p-4 shadow-2xl shadow-black/60"
                      style={{
                        background: critique.verdict === 'good' ? 'rgba(8,22,15,0.98)' : critique.verdict === 'mistake' ? 'rgba(26,10,10,0.98)' : 'rgba(22,18,8,0.98)',
                        borderColor: critique.verdict === 'good' ? 'rgba(31,157,94,0.55)' : critique.verdict === 'mistake' ? 'rgba(192,57,49,0.55)' : 'rgba(201,162,39,0.45)',
                      }}>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{critique.verdict === 'good' ? '✅' : critique.verdict === 'mistake' ? '❌' : '⚠️'}</span>
                          <span className="text-sm font-black uppercase tracking-wide" style={{ color: vc }}>{critique.headline}</span>
                        </div>
                        <button onClick={() => setCritique(null)} className="text-white/45 hover:text-white text-base leading-none">✕</button>
                      </div>
                      {critique.reasoning && <EquityReasoningBlock r={critique.reasoning} />}
                      <div className="space-y-1.5">
                        {critique.lines.map((l, i) => (
                          <p key={i} className="text-[12.5px] text-white/85 leading-relaxed flex gap-1.5">
                            <span className="mt-0.5" style={{ color: '#c9a227' }}>▸</span>{l}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Action log — right column on desktop, full-width block on phone */}
            <div className={isPhone
              ? 'w-full flex-shrink-0 border-t border-white/8 flex flex-col max-h-[34vh]'
              : 'w-72 flex-shrink-0 border-l border-white/8 flex flex-col min-h-0'}>
              <div className="px-4 py-3 border-b border-white/8 flex-shrink-0">
                <span className="text-xs font-bold text-white/50 uppercase tracking-widest">{t('sess.actionLog')}</span>
              </div>
              <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-1">
                {visibleActions.map((a, i) => {
                  const isCurrentStep = i === stepIdx
                  if (a.seatIdx === -1) {
                    // Phase divider
                    return (
                      <div key={i} className={`text-center py-1.5 ${isCurrentStep?'text-[#c9a227]':'text-white/30'}`}>
                        <span className="text-[10px] font-bold uppercase tracking-widest border-t border-b border-current px-2">
                          — {t('phase.' + a.phase)} —
                        </span>
                      </div>
                    )
                  }
                  const pl = record.players.find(p => p.idx === a.seatIdx)
                  const isHero = pl?.isHero ?? false
                  return (
                    <div key={i} onClick={() => setStepIdx(i)}
                      className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-[12px] flex items-center gap-2
                        ${isCurrentStep?'bg-[#c9a227]/15 border border-[#c9a227]/30':'hover:bg-white/5 border border-transparent'}`}>
                      <span className={`font-bold truncate max-w-[90px] ${isHero?'text-[#00d4ff]':'text-white/70'}`}>
                        {pl?.name ?? `Seat${a.seatIdx}`}
                      </span>
                      <span className={`font-bold uppercase
                        ${a.actionType==='FOLD'?'text-red-400/70'
                        :a.actionType==='RAISE'||a.actionType==='BET'||a.actionType==='ALL-IN'?'text-yellow-300'
                        :a.actionType==='CHECK'?'text-sky-400'
                        :'text-emerald-400'}`}>
                        {a.actionType}
                      </span>
                      {a.amount > 0 && <span className="text-white/50 font-mono">{money(a.amount)}</span>}
                      <span className="ml-auto text-white/25 font-mono text-[10px]">pot {money(a.potAfter)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      </motion.div>

      {/* Range Vision popup in the replay (fixed + clamped to the viewport) */}
      {hoverIdx !== null && hoverXY && stepRanges[hoverIdx] && (() => {
        const pl = record.players.find(p => p.idx === hoverIdx)
        if (!pl) return null
        const view = rangeView(stepRanges[hoverIdx])
        const meta = playerLastMeta(record, hoverIdx, stepIdx)
        const heroKey = pl.isHero && pl.holeCards[0] && pl.holeCards[1] ? handKeyFromCards(pl.holeCards[0], pl.holeCards[1]) : null
        const W = 312, H = 372
        let x = hoverXY.x + 18, y = hoverXY.y - H / 2
        if (x + W > window.innerWidth - 8) x = hoverXY.x - W - 18
        if (x < 8) x = 8
        if (y + H > window.innerHeight - 8) y = window.innerHeight - H - 8
        if (y < 8) y = 8
        return (
          <div className="fixed z-[60] pointer-events-none"
            style={isPhone ? { left: '50%', top: '50%', transform: 'translate(-50%,-50%) scale(0.72)', transformOrigin: 'center' } : { left: x, top: y }}>
            <RangeHeatmap view={view} startView={startRanges[hoverIdx] ? rangeView(startRanges[hoverIdx]) : undefined} move={meta.move} effect={meta.effect}
              name={pl.isHero ? t('sess.youRepRange') : pl.name} heroKey={heroKey}/>
          </div>
        )
      })()}
    </div>
  )
}
