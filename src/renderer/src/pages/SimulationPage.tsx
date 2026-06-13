import { useState, useRef, useEffect } from 'react'
import { FlaskConical, Play, Square, Trophy, TrendingUp, TrendingDown, Coins, Users, Layers } from 'lucide-react'
import { playTournament, playMTT, type BlindLevel, type TourConfig, type MTTConfig, type SimSeat } from '../lib/simEngine'
import { makeSimDecider } from '../lib/simDeciders'
import { fieldRemaining, placesPaid, payoutTable, prizeForPlace } from '../lib/tournament'

function genLevels(startStack: number): BlindLevel[] {
  const lv: BlindLevel[] = []
  let bb = Math.max(2, Math.round(startStack / 75 / 5) * 5 || 2)
  for (let i = 0; i < 24; i++) { lv.push({ sb: Math.max(1, Math.round(bb / 2)), bb, ante: i >= 2 ? Math.max(1, Math.round(bb / 8)) : 0 }); bb = Math.max(bb + 5, Math.round((bb * 1.4) / 5) * 5) }
  return lv
}
type Curve = 'standard' | 'topheavy' | 'flat'
type Mode = 'sng' | 'mtt'

interface Stats { done: number; wins: number; cashes: number; ft: number; profit: number; hands: number; places: number[]; field: number }
const blank = (field: number): Stats => ({ done: 0, wins: 0, cashes: 0, ft: 0, profit: 0, hands: 0, places: [], field })

export default function SimulationPage(): JSX.Element {
  const [mode, setMode] = useState<Mode>('mtt')
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
  const payTable = payoutTable(pool, paid, curve)
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
  useEffect(() => {
    if (running) return
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
    const s = blank(field), b = blank(field)
    const baseN = Math.max(20, Math.round(tours / 4)) // smaller "average player" baseline for comparison
    const total = tours + baseN
    let done = 0
    const tick = async () => { setProgress(done / total); setStats({ ...s, places: [...s.places] }); setBase({ ...b, places: [...b.places] }); await new Promise(r => setTimeout(r, 0)) }
    for (let t = 0; t < tours; t++) { if (cancelRef.current) break; const r = runOne('coach'); accumulate(s, r.place, r.hands); done++; if (t % 8 === 7) await tick() }
    for (let t = 0; t < baseN; t++) { if (cancelRef.current) break; const r = runOne('bot'); accumulate(b, r.place, r.hands); done++; if (t % 8 === 7) await tick() }
    setProgress(1); setStats({ ...s, places: [...s.places] }); setBase({ ...b, places: [...b.places] })
    setRunning(false)
  }

  const pct = (n: number, d: number) => (d > 0 ? (100 * n / d).toFixed(1) : '0.0')
  const roi = (st: Stats) => st.done > 0 ? (100 * st.profit / (st.done * buyin)) : 0
  const med = (st: Stats) => { const arr: number[] = []; st.places.forEach((c, p) => { for (let i = 0; i < c; i++) arr.push(p) }); arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)] ?? 0 }
  const estTotal = estMs != null ? (estMs * tours * 1.25) : null // +25% for the baseline batch
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
    <div className="h-full overflow-y-auto px-8 py-7 text-white">
      <div className="flex items-center gap-3 mb-1">
        <FlaskConical className="text-[#c9a227]" size={26} />
        <h1 className="text-2xl font-black tracking-tight">Simulation — banc de test du coach</h1>
      </div>
      <p className="text-white/45 text-sm mb-5 max-w-3xl">Le coach joue des tournois avec <b>exactement les mêmes décisions que l'autopilote</b>, contre des bots. On le compare à un <b>joueur moyen</b> (un bot à sa place) pour mesurer son edge — places, ITM, ROI.</p>

      {/* Mode */}
      <div className="flex gap-2 mb-4">
        {([['sng', 'Single-table (SNG)', <Users size={15} />], ['mtt', 'Multi-tables (MTT)', <Layers size={15} />]] as const).map(([m, lbl, ic]) => (
          <button key={m} disabled={running} onClick={() => setMode(m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${mode === m ? 'bg-[#c9a227]/15 border border-[#c9a227]/50 text-[#c9a227]' : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'}`}>
            {ic} {lbl}
          </button>
        ))}
      </div>

      {/* Config */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold mb-4">Configuration{mode === 'mtt' ? ` · field de ${field} joueurs` : ''}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Num label="Nb de tournois" value={tours} set={setTours} min={10} max={20000} step={50} suffix="plus = stats fiables" />
          {mode === 'mtt' && <Num label="Nb de tables" value={numTables} set={setNumTables} min={2} max={200} suffix={`field = ${numTables}×${seats} = ${field}`} />}
          <Num label="Joueurs / table" value={seats} set={setSeats} min={2} max={9} suffix={mode === 'mtt' ? '' : 'coach + (n−1) bots'} />
          <Num label="Stack de départ" value={startStack} set={setStartStack} min={500} max={100000} step={500} suffix="jetons" />
          <Num label="Mains / niveau" value={handsPerLevel} set={setHandsPerLevel} min={3} max={40} suffix="bas = turbo" />
          <Num label="Buy-in" value={buyin} set={setBuyin} min={1} max={100000} step={10} />
          {mode === 'mtt' && <Num label="% payés (ITM)" value={paidPct} set={setPaidPct} min={1} max={50} suffix={`${paid} places payées`} />}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{mode === 'mtt' ? 'Courbe de gains' : 'Structure de gains'}</span>
            <select value={mode === 'mtt' ? curve : 'standard'} disabled={running} onChange={e => setCurve(e.target.value as Curve)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              {mode === 'mtt' ? (<>
                <option value="standard" className="bg-[#0a0e1a]">Standard</option>
                <option value="topheavy" className="bg-[#0a0e1a]">Top-heavy (gros 1er)</option>
                <option value="flat" className="bg-[#0a0e1a]">Plate (peu d'écart)</option>
              </>) : (<option value="standard" className="bg-[#0a0e1a]">Top 1/3 (65/35)</option>)}
            </select>
            <span className="text-[9px] text-white/30">pool {pool} · 1er gagne {prizeFor(1)}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">Niveau des bots</span>
            <select value={botTier} disabled={running} onChange={e => setBotTier(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              <option value={1} className="bg-[#0a0e1a]">Amateur</option>
              <option value={2} className="bg-[#0a0e1a]">Pro (TAG solide)</option>
              <option value={3} className="bg-[#0a0e1a]">Expert</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {!running ? (
            <button onClick={run} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-sm transition-all hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#e8c547,#c9a227)', color: '#0a0716' }}>
              <Play size={16} /> Lancer
            </button>
          ) : (
            <button onClick={() => { cancelRef.current = true }} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold uppercase tracking-widest text-sm bg-red-900/30 border border-red-700/40 text-red-300 hover:bg-red-900/50">
              <Square size={16} /> Arrêter
            </button>
          )}
          {!running && (
            <span className="text-[12px] text-white/50">
              ⏱ Temps estimé : {calibrating || estTotal == null ? <span className="text-white/30">calcul…</span> : <b className="text-[#c9a227]">≈ {fmtTime(estTotal)}</b>}
              <span className="text-white/25"> pour {tours} tournois (+ baseline)</span>
            </span>
          )}
          {running && (
            <div className="flex-1 min-w-[200px]">
              <div className="h-2 rounded-full bg-white/8 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#c9a227,#e8c547)' }} /></div>
              <span className="text-[10px] text-white/40">{stats?.done ?? 0} / {tours} tournois — en cours…</span>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {stats && stats.done > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat icon={<Coins size={18} />} label="Profit net" value={`${stats.profit >= 0 ? '+' : ''}${Math.round(stats.profit).toLocaleString('fr')}`} sub={`${stats.done} tournois · buy-in ${buyin}`} good={stats.profit >= 0} big />
            <Stat icon={roi(stats) >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />} label="ROI" value={`${roi(stats) >= 0 ? '+' : ''}${roi(stats).toFixed(0)}%`} sub={base ? `joueur moyen : ${roi(base).toFixed(0)}%` : ''} good={base ? roi(stats) > roi(base) : roi(stats) >= 0} big />
            <Stat icon={<Trophy size={18} />} label="ITM (payé)" value={`${pct(stats.cashes, stats.done)}%`} sub={base ? `moyen : ${pct(base.cashes, base.done)}% · neutre ${(100 * paid / field).toFixed(0)}%` : `neutre ${(100 * paid / field).toFixed(0)}%`} good={base ? stats.cashes / stats.done > base.cashes / base.done : undefined} />
            <Stat icon={<Trophy size={18} />} label={mode === 'mtt' ? 'Place médiane' : 'Victoires'} value={mode === 'mtt' ? `${med(stats)} / ${field}` : `${pct(stats.wins, stats.done)}%`} sub={base ? (mode === 'mtt' ? `joueur moyen : ${med(base)}` : `moyen : ${pct(base.wins, base.done)}%`) : ''} good={base ? (mode === 'mtt' ? med(stats) < med(base) : stats.wins / stats.done > base.wins / base.done) : undefined} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold">Répartition des places{mode === 'mtt' ? ' (par tranche du field)' : ''}</p>
              <span className="text-[10px] text-white/35">{(stats.hands / stats.done).toFixed(0)} mains/tournoi · victoires {stats.wins} · tables finales {pct(stats.ft, stats.done)}%</span>
            </div>
            <PlaceChart stats={stats} field={field} buckets={mode === 'mtt' ? 10 : field} paid={paid} seats={seats} />
            <p className="text-[10px] text-white/30 mt-2">Doré = dans les places payées. {mode === 'mtt' ? 'Plus la masse penche à GAUCHE (places hautes), mieux c\'est.' : 'P1 = victoire.'}</p>
          </div>

          {base && base.done > 0 && (
            <p className="text-[12px] text-white/40">
              <b className="text-white/70">Verdict :</b> le coach fait un ROI de <span className={roi(stats) > roi(base) ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{roi(stats) >= 0 ? '+' : ''}{roi(stats).toFixed(0)}%</span> contre <span className="text-white/60 font-bold">{roi(base).toFixed(0)}%</span> pour un joueur moyen à sa place →
              {roi(stats) > roi(base) ? <span className="text-emerald-400 font-bold"> il bat clairement le field de {(roi(stats) - roi(base)).toFixed(0)} points de ROI.</span> : <span className="text-red-400"> pas d'edge mesurable sur cet échantillon.</span>}
              <span className="text-white/30"> (Note : le modèle multi-tables a un biais négatif absolu — c'est l'ÉCART coach vs joueur moyen qui est significatif, pas le chiffre brut.)</span>
            </p>
          )}
        </div>
      )}
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

function Stat({ icon, label, value, sub, good, big }: { icon: React.ReactNode; label: string; value: string; sub?: string; good?: boolean; big?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white/40 mb-1">{icon}<span className="text-[10px] uppercase tracking-widest font-bold">{label}</span></div>
      <div className={`font-black ${big ? 'text-2xl' : 'text-xl'}`} style={{ color: good === undefined ? '#fff' : good ? '#34d399' : '#f0796b' }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30">{sub}</div>}
    </div>
  )
}
