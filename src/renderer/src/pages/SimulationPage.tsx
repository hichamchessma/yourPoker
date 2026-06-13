import { useState, useRef } from 'react'
import { FlaskConical, Play, Square, Trophy, TrendingUp, TrendingDown, Coins } from 'lucide-react'
import { playTournament, type BlindLevel, type TourConfig } from '../lib/simEngine'
import { makeSimDecider } from '../lib/simDeciders'

// Blind schedule scaled to the starting stack (≈75bb start, ~+40%/level, antes from L3).
function genLevels(startStack: number): BlindLevel[] {
  const lv: BlindLevel[] = []
  let bb = Math.max(2, Math.round(startStack / 75 / 5) * 5 || 2)
  for (let i = 0; i < 18; i++) {
    lv.push({ sb: Math.max(1, Math.round(bb / 2)), bb, ante: i >= 2 ? Math.max(1, Math.round(bb / 8)) : 0 })
    bb = Math.max(bb + 5, Math.round((bb * 1.4) / 5) * 5)
  }
  return lv
}

type Payout = 'wta' | 'top2' | 'top3'
function payoutFractions(p: Payout): number[] {
  return p === 'wta' ? [1] : p === 'top2' ? [0.65, 0.35] : [0.5, 0.3, 0.2]
}

interface Stats {
  done: number
  wins: number
  places: number[]      // index = place (1-based), count
  cashes: number
  profit: number
  hands: number
}

export default function SimulationPage(): JSX.Element {
  const [seats, setSeats] = useState(6)
  const [tours, setTours] = useState(500)
  const [startStack, setStartStack] = useState(5000)
  const [handsPerLevel, setHandsPerLevel] = useState(8)
  const [buyin, setBuyin] = useState(100)
  const [payout, setPayout] = useState<Payout>('top2')
  const [botTier, setBotTier] = useState(2)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const cancelRef = useRef(false)

  const pool = seats * buyin
  const fracs = payoutFractions(payout)
  const payForPlace = (place: number) => (place <= fracs.length ? fracs[place - 1] * pool : 0)

  async function run() {
    cancelRef.current = false
    setRunning(true); setProgress(0)
    const levels = genLevels(startStack)
    const s: Stats = { done: 0, wins: 0, places: new Array(seats + 1).fill(0), cashes: 0, profit: 0, hands: 0 }
    const cfg: TourConfig = {
      players: Array.from({ length: seats }, (_, i): { kind: 'coach' | 'bot'; tier: number } => ({ kind: i === 0 ? 'coach' : 'bot', tier: botTier })),
      startStack, levels, handsPerLevel, maxHands: 8000,
    }
    const chunk = 15
    for (let t = 0; t < tours; t++) {
      if (cancelRef.current) break
      const res = playTournament(cfg, makeSimDecider)
      s.done++; s.hands += res.hands
      s.places[res.coachPlace] = (s.places[res.coachPlace] ?? 0) + 1
      if (res.coachPlace === 1) s.wins++
      const pay = payForPlace(res.coachPlace)
      if (pay > 0) s.cashes++
      s.profit += pay - buyin
      if (t % chunk === chunk - 1 || t === tours - 1) {
        setProgress((t + 1) / tours)
        setStats({ ...s, places: [...s.places] })
        await new Promise(r => setTimeout(r, 0)) // yield to the UI
      }
    }
    setRunning(false)
  }

  const pct = (n: number, d: number) => (d > 0 ? (100 * n / d).toFixed(1) : '0.0')
  const neutralWin = (100 / seats).toFixed(1)
  const neutralITM = (100 * fracs.length / seats).toFixed(1)
  const roi = stats && stats.done > 0 ? (100 * stats.profit / (stats.done * buyin)) : 0

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
      <p className="text-white/45 text-sm mb-6 max-w-3xl">Le coach (siège 1) joue des tournois <b>single-table</b> contre des bots, avec <b>exactement les mêmes décisions</b> que l'autopilote (charts préflop + moteur d'équité postflop). On mesure s'il est <b>rentable</b> : places payées cumulées − buy-ins.</p>

      {/* Config */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-6">
        <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold mb-4">Configuration</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Num label="Nb de tournois" value={tours} set={setTours} min={10} max={20000} step={50} suffix="plus = stats plus fiables (mais plus long)" />
          <Num label="Joueurs / table" value={seats} set={setSeats} min={2} max={9} suffix="coach + (n−1) bots" />
          <Num label="Stack de départ" value={startStack} set={setStartStack} min={500} max={100000} step={500} suffix="jetons" />
          <Num label="Mains / niveau" value={handsPerLevel} set={setHandsPerLevel} min={3} max={30} suffix="bas = blindes montent vite (turbo)" />
          <Num label="Buy-in" value={buyin} set={setBuyin} min={1} max={100000} step={10} suffix="coût par tournoi" />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">Structure de gains</span>
            <select value={payout} disabled={running} onChange={e => setPayout(e.target.value as Payout)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              <option value="wta" className="bg-[#0a0e1a]">Winner-take-all (1 payé)</option>
              <option value="top2" className="bg-[#0a0e1a]">Top 2 (65% / 35%)</option>
              <option value="top3" className="bg-[#0a0e1a]">Top 3 (50 / 30 / 20)</option>
            </select>
            <span className="text-[9px] text-white/30">prize pool = {seats} × {buyin} = {pool}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-white/40 font-bold">Niveau des bots</span>
            <select value={botTier} disabled={running} onChange={e => setBotTier(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none disabled:opacity-50">
              <option value={1} className="bg-[#0a0e1a]">Amateur (loose-passive)</option>
              <option value={2} className="bg-[#0a0e1a]">Pro (TAG solide)</option>
              <option value={3} className="bg-[#0a0e1a]">Expert (agressif équilibré)</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-5">
          {!running ? (
            <button onClick={run} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-sm transition-all hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#e8c547,#c9a227)', color: '#0a0716' }}>
              <Play size={16} /> Lancer la simulation
            </button>
          ) : (
            <button onClick={() => { cancelRef.current = true }} className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold uppercase tracking-widest text-sm bg-red-900/30 border border-red-700/40 text-red-300 hover:bg-red-900/50 transition-all">
              <Square size={16} /> Arrêter
            </button>
          )}
          {(running || stats) && (
            <div className="flex-1">
              <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#c9a227,#e8c547)' }} />
              </div>
              <span className="text-[10px] text-white/40">{stats?.done ?? 0} / {tours} tournois{running ? ' — en cours…' : ' — terminé'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {stats && stats.done > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat icon={<Coins size={18} />} label="Profit net" value={`${stats.profit >= 0 ? '+' : ''}${Math.round(stats.profit).toLocaleString('fr')}`} sub={`sur ${stats.done} tournois`} good={stats.profit >= 0} big />
            <Stat icon={roi >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />} label="ROI" value={`${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`} sub="(profit ÷ buy-ins)" good={roi >= 0} big />
            <Stat icon={<Trophy size={18} />} label="Victoires" value={`${pct(stats.wins, stats.done)}%`} sub={`neutre ${neutralWin}%`} good={stats.wins / stats.done > 1 / seats} />
            <Stat icon={<Trophy size={18} />} label="ITM (payé)" value={`${pct(stats.cashes, stats.done)}%`} sub={`neutre ${neutralITM}%`} good={stats.cashes / stats.done > fracs.length / seats} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold">Répartition des places du coach</p>
              <span className="text-[10px] text-white/35">{(stats.hands / stats.done).toFixed(0)} mains / tournoi · place moyenne {(stats.places.reduce((a, c, i) => a + c * i, 0) / stats.done).toFixed(2)}</span>
            </div>
            <div className="flex items-end gap-2 h-40">
              {stats.places.slice(1).map((count, i) => {
                const place = i + 1
                const maxC = Math.max(1, ...stats.places.slice(1))
                const paid = place <= fracs.length
                return (
                  <div key={place} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                    <span className="text-[10px] text-white/50">{count}</span>
                    <div className="w-full rounded-t-md transition-all" style={{ height: `${(count / maxC) * 100}%`, minHeight: count > 0 ? 3 : 0, background: paid ? 'linear-gradient(180deg,#e8c547,#c9a227)' : 'rgba(255,255,255,0.14)' }} />
                    <span className={`text-[10px] font-bold ${place === 1 ? 'text-[#e8c547]' : paid ? 'text-[#c9a227]/80' : 'text-white/40'}`}>{place}{place === 1 ? 'er' : 'e'}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-white/30 mt-2">Barres dorées = places payées. Plus le coach se concentre sur les premières places (dorées), plus il est rentable.</p>
          </div>

          <p className="text-[11px] text-white/35">
            Verdict : {stats.profit >= 0
              ? <span className="text-emerald-400 font-bold">le coach est RENTABLE sur cet échantillon (ROI {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%)</span>
              : <span className="text-red-400 font-bold">le coach est PERDANT sur cet échantillon (ROI {roi.toFixed(1)}%)</span>}
            {' '}— augmente le nombre de tournois pour réduire la variance.
          </p>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, sub, good, big }: { icon: React.ReactNode; label: string; value: string; sub: string; good?: boolean; big?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white/40 mb-1">{icon}<span className="text-[10px] uppercase tracking-widest font-bold">{label}</span></div>
      <div className={`font-black ${big ? 'text-2xl' : 'text-xl'}`} style={{ color: good === undefined ? '#fff' : good ? '#34d399' : '#f0796b' }}>{value}</div>
      <div className="text-[10px] text-white/30">{sub}</div>
    </div>
  )
}
