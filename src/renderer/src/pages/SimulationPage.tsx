import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { FlaskConical, Play, Square, Trophy, TrendingUp, TrendingDown, Coins, Users, Layers, Eye, Search } from 'lucide-react'
import { playTournament, playMTT, type BlindLevel, type TourConfig, type MTTConfig, type SimSeat } from '../lib/simEngine'
import { makeSimDecider } from '../lib/simDeciders'
import { fieldRemaining, placesPaid, payoutTable, prizeForPlace } from '../lib/tournament'
import { simulateTournament, isInterestingHand, buildLevels, type SimTourResult } from '../lib/simReplay'
import { HandHistoryModal, type HandHistoryRecord } from './GamePage'

function genLevels(startStack: number): BlindLevel[] {
  const lv: BlindLevel[] = []
  let bb = Math.max(2, Math.round(startStack / 75 / 5) * 5 || 2)
  for (let i = 0; i < 24; i++) { lv.push({ sb: Math.max(1, Math.round(bb / 2)), bb, ante: i >= 2 ? Math.max(1, Math.round(bb / 8)) : 0 }); bb = Math.max(bb + 5, Math.round((bb * 1.4) / 5) * 5) }
  return lv
}
type Curve = 'standard' | 'topheavy' | 'flat'
type Mode = 'sng' | 'mtt' | 'watch'

interface Stats { done: number; wins: number; cashes: number; ft: number; profit: number; hands: number; places: number[]; field: number }
const blank = (field: number): Stats => ({ done: 0, wins: 0, cashes: 0, ft: 0, profit: 0, hands: 0, places: [], field })

export default function SimulationPage(): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('watch')
  const [tours, setTours] = useState(300)
  const [numTables, setNumTables] = useState(12)
  const [seats, setSeats] = useState(9)
  const [startStack, setStartStack] = useState(5000)
  const [handsPerLevel, setHandsPerLevel] = useState(10)
  const [buyin, setBuyin] = useState(100)
  const [curve, setCurve] = useState<Curve>('standard')
  const [paidPct, setPaidPct] = useState(15)
  const [botTier, setBotTier] = useState(2)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [base, setBase] = useState<Stats | null>(null)
  const [estMs, setEstMs] = useState<number | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const cancelRef = useRef(false)

  const field = mode === 'mtt' ? numTables * seats : seats
  const paid = placesPaid(field, paidPct)
  const pool = field * buyin
  const payTable = payoutTable(pool, paid, curve, field)
  const prizeFor = (place: number) => prizeForPlace(place, payTable)

  function runOne(coachKind: 'coach' | 'bot'): { place: number; hands: number } {
    const levels = genLevels(startStack)
    if (mode === 'mtt') {
      const cfg: MTTConfig = { tableSize: seats, numTables, startStack, levels, handsPerLevel, botTier, fieldShrink: fieldRemaining }
      return playMTT(cfg, (s: SimSeat[]) => { if (coachKind === 'bot') s[0].kind = 'bot'; return makeSimDecider(s) })
    }
    const cfg: TourConfig = { players: Array.from({ length: seats }, (_, i): { kind: 'coach' | 'bot'; tier: number } => ({ kind: i === 0 ? coachKind : 'bot', tier: botTier })), startStack, levels, handsPerLevel, maxHands: 8000 }
    const r = playTournament(cfg, makeSimDecider)
    return { place: r.coachPlace, hands: r.hands }
  }

  function accumulate(s: Stats, place: number, hands: number) {
    s.done++; s.hands += hands; s.places[place] = (s.places[place] ?? 0) + 1
    if (place === 1) s.wins++
    if (place <= seats) s.ft++
    const pay = prizeFor(place); if (pay > 0) s.cashes++
    s.profit += pay - buyin
  }

  // Time estimate: calibrate on config change (debounced) by timing a few real runs.
  // Skipped in 'watch' mode — it runs a single tournament on demand, no estimate needed.
  useEffect(() => {
    if (running || mode === 'watch') return
    let alive = true
    setCalibrating(true); setEstMs(null)
    const id = setTimeout(async () => {
      const K = mode === 'mtt' ? 4 : 6
      const t0 = performance.now()
      for (let i = 0; i < K; i++) { if (!alive) return; runOne('coach'); await new Promise(r => setTimeout(r, 0)) }
      if (!alive) return
      setEstMs((performance.now() - t0) / K)
      setCalibrating(false)
    }, 500)
    return () => { alive = false; clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, numTables, seats, startStack, handsPerLevel, botTier, running])

  async function run() {
    cancelRef.current = false; setRunning(true); setProgress(0)
    const baseN = Math.max(40, Math.round(tours / 4))
    const total = tours + baseN
    let done = 0
    const yieldUI = () => new Promise(r => setTimeout(r, 0))
    // 1) Baseline FIRST. In MTT, place is CALIBRATED from how long the player survived
    //    (more hands alive = deeper run = better place). The average-player baseline gets
    //    its places assigned by RANK over the full field → exactly uniform → median =
    //    field/2, ITM = % paid, ROI ≈ 0. The coach is then ranked against that same
    //    distribution, so its deeper survival gives a FAIR ABSOLUTE place / ROI.
    const baseRaw: { place: number; hands: number }[] = []
    for (let t = 0; t < baseN; t++) { if (cancelRef.current) break; baseRaw.push(runOne('bot')); done++; if (t % 8 === 7) { setProgress(done / total); await yieldUI() } }
    const N = baseRaw.length
    const baseAsc = baseRaw.map(r => r.hands).sort((a, b) => a - b)
    const countGreater = (h: number) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (baseAsc[m] <= h) lo = m + 1; else hi = m } return N - lo } // baseline runs that survived MORE
    const placeOf = (r: { place: number; hands: number }) => mode === 'mtt' ? Math.max(1, Math.min(field, Math.round(1 + (field - 1) * countGreater(r.hands) / Math.max(1, N)))) : r.place
    // Baseline stats: assign places by descending-survival RANK (best → 1, worst → field).
    const b = blank(field)
    if (mode === 'mtt') { [...baseRaw].sort((x, y) => y.hands - x.hands).forEach((r, j) => accumulate(b, Math.max(1, Math.min(field, Math.round(1 + (field - 1) * j / Math.max(1, N - 1)))), r.hands)) }
    else { for (const r of baseRaw) accumulate(b, r.place, r.hands) }
    // 2) Coach — ranked against the same baseline distribution.
    const s = blank(field)
    const tick = async () => { setProgress(done / total); setStats({ ...s, places: [...s.places] }); setBase({ ...b, places: [...b.places] }); await yieldUI() }
    for (let t = 0; t < tours; t++) { if (cancelRef.current) break; const r = runOne('coach'); accumulate(s, placeOf(r), r.hands); done++; if (t % 8 === 7) await tick() }
    setProgress(1); setStats({ ...s, places: [...s.places] }); setBase({ ...b, places: [...b.places] }); setRunning(false)
  }

  const pct = (n: number, d: number) => (d > 0 ? (100 * n / d).toFixed(1) : '0.0')
  const roi = (st: Stats) => st.done > 0 ? (100 * st.profit / (st.done * buyin)) : 0
  const med = (st: Stats) => { const arr: number[] = []; st.places.forEach((c, p) => { for (let i = 0; i < c; i++) arr.push(p) }); arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)] ?? 0 }
  const estTotal = estMs != null ? (estMs * (tours + Math.max(40, Math.round(tours / 4)))) : null // incl. the baseline batch
  const fmtTime = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60000).toFixed(1)} min`

  const Num = ({ label, value, set, min, max, step = 1, suffix }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={running}
        onChange={e => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#c9a227]/60 outline-none disabled:opacity-50" />
      {suffix && <span className="text-[9px] text-white/30">{suffix}</span>}
    </label>
  )

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-5 sm:py-7 text-white">
      <div className="flex items-center gap-3 mb-1">
        <FlaskConical className="text-[#c9a227]" size={26} />
        <h1 className="text-2xl font-black tracking-tight">{t('sim.title')}</h1>
      </div>
      <p className="text-white/45 text-sm mb-5 max-w-3xl">{t('sim.desc')}</p>

      {/* Mode */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([['watch', t('simw.mode'), <Eye size={15} />], ['sng', t('sim.modeSng'), <Users size={15} />], ['mtt', t('sim.modeMtt'), <Layers size={15} />]] as const).map(([m, lbl, ic]) => (
          <button key={m} disabled={running} onClick={() => setMode(m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${mode === m ? 'bg-[#c9a227]/15 border border-[#c9a227]/50 text-[#c9a227]' : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'}`}>
            {ic} {lbl}
          </button>
        ))}
      </div>

      {mode === 'watch' && <WatchMode t={t} />}

      {/* Config */}
      {mode !== 'watch' && (<>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold mb-4">{mode === 'mtt' ? t('sim.configField', { n: field }) : t('sim.config')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Num label={t('sim.numTours')} value={tours} set={setTours} min={10} max={20000} step={50} suffix={t('sim.suffixTours')} />
          {mode === 'mtt' && <Num label={t('sim.numTables')} value={numTables} set={setNumTables} min={2} max={200} suffix={`field = ${numTables}×${seats} = ${field}`} />}
          <Num label={t('sim.numSeats')} value={seats} set={setSeats} min={2} max={9} suffix={mode === 'mtt' ? '' : t('sim.suffixSeatsSng')} />
          <Num label={t('sim.numStack')} value={startStack} set={setStartStack} min={500} max={100000} step={500} suffix={t('sim.suffixChips')} />
          <Num label={t('sim.numHands')} value={handsPerLevel} set={setHandsPerLevel} min={3} max={40} suffix={t('sim.suffixTurbo')} />
          <Num label={t('sim.numBuyin')} value={buyin} set={setBuyin} min={1} max={100000} step={10} />
          {mode === 'mtt' && <Num label={t('sim.numPaid')} value={paidPct} set={setPaidPct} min={1} max={50} suffix={t('sim.suffixPaid', { n: paid })} />}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{mode === 'mtt' ? t('sim.curveLabel') : t('sim.structLabel')}</span>
            <select value={mode === 'mtt' ? curve : 'standard'} disabled={running} onChange={e => setCurve(e.target.value as Curve)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              {mode === 'mtt' ? (<>
                <option value="standard" className="bg-[#0a0e1a]">{t('sim.curveStandard')}</option>
                <option value="topheavy" className="bg-[#0a0e1a]">{t('sim.curveTopheavy')}</option>
                <option value="flat" className="bg-[#0a0e1a]">{t('sim.curveFlat')}</option>
              </>) : (<option value="standard" className="bg-[#0a0e1a]">{t('sim.structSng')}</option>)}
            </select>
            <span className="text-[9px] text-white/30">{t('sim.poolInfo', { pool, prize: prizeFor(1) })}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{t('sim.botLevel')}</span>
            <select value={botTier} disabled={running} onChange={e => setBotTier(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              <option value={1} className="bg-[#0a0e1a]">{t('sim.botAmateur')}</option>
              <option value={2} className="bg-[#0a0e1a]">{t('sim.botPro')}</option>
              <option value={3} className="bg-[#0a0e1a]">{t('sim.botExpert')}</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {!running ? (
            <button onClick={run} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-sm transition-all hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#e8c547,#c9a227)', color: '#0a0716' }}>
              <Play size={16} /> {t('sim.run')}
            </button>
          ) : (
            <button onClick={() => { cancelRef.current = true }} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold uppercase tracking-widest text-sm bg-red-900/30 border border-red-700/40 text-red-300 hover:bg-red-900/50">
              <Square size={16} /> {t('sim.stop')}
            </button>
          )}
          {!running && (
            <span className="text-[12px] text-white/50">
              {t('sim.estTime')} {calibrating || estTotal == null ? <span className="text-white/30">{t('sim.calc')}</span> : <b className="text-[#c9a227]">≈ {fmtTime(estTotal)}</b>}
              <span className="text-white/25"> {t('sim.estFor', { n: tours })}</span>
            </span>
          )}
          {running && (
            <div className="flex-1 min-w-[200px]">
              <div className="h-2 rounded-full bg-white/8 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#c9a227,#e8c547)' }} /></div>
              <span className="text-[10px] text-white/40">{t('sim.progress', { done: stats?.done ?? 0, total: tours })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {stats && stats.done > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat icon={<Coins size={18} />} label={t('sim.statProfit')} value={`${stats.profit >= 0 ? '+' : ''}${Math.round(stats.profit).toLocaleString()}`} sub={t('sim.profitSub', { n: stats.done, buyin })} good={stats.profit >= 0} big />
            <Stat icon={roi(stats) >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />} label={t('sim.statRoi')} value={`${roi(stats) >= 0 ? '+' : ''}${roi(stats).toFixed(0)}%`} sub={base ? t('sim.avgPlayer', { v: `${roi(base).toFixed(0)}%` }) : ''} good={base ? roi(stats) > roi(base) : roi(stats) >= 0} big />
            <Stat icon={<Trophy size={18} />} label={t('sim.statItm')} value={`${pct(stats.cashes, stats.done)}%`} sub={base ? t('sim.itmAvg', { v: pct(base.cashes, base.done), neutral: (100 * paid / field).toFixed(0) }) : t('sim.itmNeutral', { neutral: (100 * paid / field).toFixed(0) })} good={base ? stats.cashes / stats.done > base.cashes / base.done : undefined} />
            <Stat icon={<Trophy size={18} />} label={mode === 'mtt' ? t('sim.statMedian') : t('sim.statWins')} value={mode === 'mtt' ? `${med(stats)} / ${field}` : `${pct(stats.wins, stats.done)}%`} sub={base ? (mode === 'mtt' ? t('sim.avgPlayer', { v: med(base) }) : t('sim.avgPlayer', { v: `${pct(base.wins, base.done)}%` })) : ''} good={base ? (mode === 'mtt' ? med(stats) < med(base) : stats.wins / stats.done > base.wins / base.done) : undefined} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold">{mode === 'mtt' ? t('sim.placeDistMtt') : t('sim.placeDist')}</p>
              <span className="text-[10px] text-white/35">{t('sim.handsInfo', { h: (stats.hands / stats.done).toFixed(0), w: stats.wins, ft: pct(stats.ft, stats.done) })}</span>
            </div>
            <PlaceChart stats={stats} field={field} buckets={mode === 'mtt' ? 10 : field} paid={paid} seats={seats} />
            <p className="text-[10px] text-white/30 mt-2">{t('sim.legendGold')} {mode === 'mtt' ? t('sim.legendMtt') : t('sim.legendSng')}</p>
          </div>

          {base && base.done > 0 && (
            <p className="text-[12px] text-white/40">
              <b className="text-white/70">{t('sim.verdictLabel')}</b>{' '}
              {t('sim.verdictMid', { r: `${roi(stats) >= 0 ? '+' : ''}${roi(stats).toFixed(0)}`, base: roi(base).toFixed(0) })}
              {roi(stats) > roi(base) ? <span className="text-emerald-400 font-bold"> {t('sim.verdictBeat', { pts: (roi(stats) - roi(base)).toFixed(0) })}</span> : <span className="text-red-400"> {t('sim.verdictNoEdge')}</span>}
              {mode === 'mtt' && <span className="text-white/30"> {t('sim.calibNote', { n: (100 * paid / field).toFixed(0) })}</span>}
            </p>
          )}
        </div>
      )}
      </>)}
    </div>
  )
}

function PlaceChart({ stats, field, buckets, paid, seats }: { stats: Stats; field: number; buckets: number; paid: number; seats: number }) {
  const bars: { count: number; paid: boolean; label: string }[] = []
  if (buckets >= field) {
    for (let p = 1; p <= field; p++) bars.push({ count: stats.places[p] ?? 0, paid: p <= Math.max(paid, Math.ceil(seats / 3)), label: `${p}` })
  } else {
    const size = Math.ceil(field / buckets)
    for (let b = 0; b < buckets; b++) {
      const lo = b * size + 1, hi = Math.min(field, (b + 1) * size)
      let c = 0; for (let p = lo; p <= hi; p++) c += stats.places[p] ?? 0
      bars.push({ count: c, paid: lo <= paid, label: lo === hi ? `${lo}` : `${lo}-${hi}` })
    }
  }
  const maxC = Math.max(1, ...bars.map(b => b.count))
  return (
    <div className="flex items-end gap-1 h-40">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${b.label} : ${b.count}`}>
          <span className="text-[9px] text-white/45">{b.count || ''}</span>
          <div className="w-full rounded-t-md transition-all" style={{ height: `${(b.count / maxC) * 100}%`, minHeight: b.count > 0 ? 2 : 0, background: b.paid ? 'linear-gradient(180deg,#e8c547,#c9a227)' : 'rgba(255,255,255,0.13)' }} />
          <span className="text-[8px] text-white/35 truncate w-full text-center">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── "Watch 1 tournament" — coach vs your bots, full hand-by-hand report ──────────
function WNum({ label, value, set, min, max, step = 1, suffix }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#c9a227]/50" />
      {suffix && <span className="text-[9px] text-white/30">{suffix}</span>}
    </label>
  )
}
const SUIT_RED = (s: string) => s === '♥' || s === '♦'
function MiniCards({ cards }: { cards: ({ rank: string; suit: string } | null)[] }) {
  const shown = cards.filter(Boolean) as { rank: string; suit: string }[]
  if (shown.length === 0) return null
  return (
    <span className="inline-flex gap-0.5">
      {shown.map((c, i) => (
        <span key={i} className="inline-flex items-center justify-center rounded-[3px] bg-white font-black leading-none"
          style={{ width: 17, height: 22, fontSize: 10, color: SUIT_RED(c.suit) ? '#d11' : '#111', border: '1px solid rgba(0,0,0,0.25)' }}>
          {c.rank}{c.suit}
        </span>
      ))}
    </span>
  )
}

function WatchMode({ t }: { t: TFunction }) {
  const [seats, setSeats] = useState(6)
  const [numTables, setNumTables] = useState(1)
  const [startStack, setStartStack] = useState(5000)
  const [startBB, setStartBB] = useState(50)
  const [handsPerLevel, setHandsPerLevel] = useState(10)
  const [botTier, setBotTier] = useState(2)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<SimTourResult | null>(null)
  const [modal, setModal] = useState<{ records: HandHistoryRecord[]; id: number } | null>(null)
  const field = seats * numTables

  function run() {
    setBusy(true); setRes(null)
    setTimeout(() => {
      const levels = buildLevels(startBB)
      const players = Array.from({ length: seats }, (_, i): { kind: 'coach' | 'bot'; tier: number } => ({ kind: i === 0 ? 'coach' : 'bot', tier: botTier }))
      const r = simulateTournament({ players, startStack, levels, handsPerLevel, numTables, maxHands: 12000, coachName: t('simw.coach') })
      setRes(r); setBusy(false)
    }, 40)
  }

  const interesting = res ? res.records.filter(isInterestingHand) : []

  return (
    <>
      <p className="text-white/45 text-sm mb-4 max-w-3xl">{t('simw.desc')}</p>

      {/* Config */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold mb-4">{t('simw.config')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <WNum label={t('sim.numSeats')} value={seats} set={setSeats} min={2} max={9} suffix={`1 ${t('simw.coach')} + ${seats - 1} bots`} />
          <WNum label={t('simw.tables')} value={numTables} set={setNumTables} min={1} max={200} suffix={numTables > 1 ? t('simw.fieldSuffix', { n: field }) : t('sim.suffixSeatsSng')} />
          <WNum label={t('simw.startBB')} value={startBB} set={setStartBB} min={2} max={2000} step={5} suffix={t('simw.bbSuffix')} />
          <WNum label={t('sim.numStack')} value={startStack} set={setStartStack} min={500} max={100000} step={500} suffix={t('sim.suffixChips')} />
          <WNum label={t('sim.numHands')} value={handsPerLevel} set={setHandsPerLevel} min={3} max={40} suffix={t('sim.suffixTurbo')} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{t('sim.botLevel')}</span>
            <select value={botTier} disabled={busy} onChange={e => setBotTier(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              <option value={1} className="bg-[#0a0e1a]">{t('sim.botAmateur')}</option>
              <option value={2} className="bg-[#0a0e1a]">{t('sim.botPro')}</option>
              <option value={3} className="bg-[#0a0e1a]">{t('sim.botExpert')}</option>
            </select>
          </label>
        </div>
        <button onClick={run} disabled={busy} className="mt-5 flex items-center gap-2 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-sm transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#a78bff,#6d4ed6)', color: '#0a0716' }}>
          {busy ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> {t('simw.running')}</> : <><Play size={16} /> {res ? t('simw.rerun') : t('simw.run')}</>}
        </button>
      </div>

      {/* Report */}
      {res && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#a78bff]/30 p-5" style={{ background: 'linear-gradient(160deg, rgba(167,139,255,0.10), transparent)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Trophy className="text-[#c9a227]" size={22} />
              <h2 className="text-lg font-black">{res.place === 1 ? t('simw.winner') : t('simw.reportTitle')}</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat icon={<Trophy size={18} />} label={t('simw.statPlace')} value={`${res.place} / ${res.totalPlayers}`} good={res.place === 1 ? true : res.place <= Math.ceil(res.totalPlayers / 3) ? undefined : false} big />
              <Stat icon={<Coins size={18} />} label={t('simw.statProfit')} value={`${res.coachProfit >= 0 ? '+' : ''}${res.coachProfit.toLocaleString()}`} good={res.coachProfit >= 0} big />
              <Stat icon={<Layers size={18} />} label={t('simw.statHands')} value={`${res.hands}`} />
              <Stat icon={<Search size={18} />} label={t('simw.statAction')} value={`${interesting.length}`} />
            </div>
            {res.stackTimeline.length > 1 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">{t('simw.timeline')}</p>
                <Sparkline data={res.stackTimeline} start={startStack} />
              </div>
            )}
          </div>

          {/* Hands list */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#a78bff] font-bold">{t('simw.handsTitle')}</p>
            <p className="text-[11px] text-white/35 mb-3">{t('simw.handsSub', { n: interesting.length })}</p>
            {interesting.length === 0 ? (
              <p className="text-[12px] text-white/40 py-3 text-center">{t('simw.noHands')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {interesting.map(rec => {
                  const coach = rec.players.find(p => p.isHero)
                  const won = rec.heroProfit > 0
                  const board = rec.board.filter(Boolean)
                  return (
                    <button key={rec.id} onClick={() => setModal({ records: interesting, id: rec.id })}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left hover:border-[#a78bff]/50 hover:bg-[#a78bff]/[0.06] transition-all">
                      <span className="text-[10px] font-bold text-white/40 w-12 shrink-0">{t('simw.hand')} #{rec.handNum}</span>
                      <MiniCards cards={coach?.holeCards ?? []} />
                      <span className="text-white/20 text-[10px]">→</span>
                      {board.length ? <MiniCards cards={board} /> : <span className="text-[9px] text-white/30 italic">{t('simw.preflop')}</span>}
                      <span className="ml-auto text-[11px] font-black tabular-nums" style={{ color: won ? '#34d399' : rec.heroProfit < 0 ? '#f0796b' : 'rgba(255,255,255,0.4)' }}>
                        {won ? t('simw.won', { n: rec.heroProfit.toLocaleString() }) : t('simw.lost', { n: rec.heroProfit.toLocaleString() })}
                      </span>
                      <span className="text-[8px] text-white/30 shrink-0">{t('simw.pot')} {rec.finalPot.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {modal && <HandHistoryModal records={modal.records} initialId={modal.id} titleKey="simw.reportTitle" onClose={() => setModal(null)} />}
    </>
  )
}

function Sparkline({ data, start }: { data: number[]; start: number }) {
  const w = 600, h = 48
  const max = Math.max(start, ...data), min = Math.min(start, ...data, 0)
  const range = Math.max(1, max - min)
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  const y0 = h - ((start - min) / range) * h
  const end = data[data.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: 48 }}>
      <line x1={0} y1={y0} x2={w} y2={y0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 4" />
      <polyline points={pts} fill="none" stroke={end >= start ? '#34d399' : '#f0796b'} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Stat({ icon, label, value, sub, good, big }: { icon: React.ReactNode; label: string; value: string; sub?: string; good?: boolean; big?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white/40 mb-1">{icon}<span className="text-[10px] uppercase tracking-widest font-bold">{label}</span></div>
      <div className={`font-black ${big ? 'text-2xl' : 'text-xl'}`} style={{ color: good === undefined ? '#fff' : good ? '#34d399' : '#f0796b' }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30">{sub}</div>}
    </div>
  )
}
