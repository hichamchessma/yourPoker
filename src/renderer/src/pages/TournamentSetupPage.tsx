import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Minus, Plus, Trophy, Users, Coins, Timer, Medal } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import WindowControls from '../components/layout/WindowControls'
import {
  type Speed, SPEED_LABEL, LEVEL_MINUTES_OPTIONS, blindStructure, placesPaid, payoutTable,
} from '../lib/tournament'

type Curve = 'standard' | 'topheavy' | 'flat'
const FIELD_PRESETS = [9, 27, 45, 90, 180, 500, 1000]
const BUYINS = [5, 20, 50, 100, 500]
const CURVES: { id: Curve; label: string }[] = [
  { id: 'standard', label: 'Standard' }, { id: 'topheavy', label: 'Top-heavy' }, { id: 'flat', label: 'Plate' },
]
const fmt = (n: number) => n.toLocaleString('fr-FR')

export default function TournamentSetupPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Hero'

  const [field, setField] = useState(180)
  const [tableSize, setTableSize] = useState(9)
  const [startBB, setStartBB] = useState(100)
  const [speed, setSpeed] = useState<Speed>('regular')
  const [levelMinutes, setLevelMinutes] = useState(5)
  const [antes, setAntes] = useState(true)
  const [buyIn, setBuyIn] = useState(20)
  const [paidPct, setPaidPct] = useState(15)
  const [curve, setCurve] = useState<Curve>('standard')
  const [reentry, setReentry] = useState(false)
  const [botLevel, setBotLevel] = useState(2)

  const levels = useMemo(() => blindStructure(speed, antes), [speed, antes])
  const nbTables = Math.ceil(field / tableSize)
  const prizePool = buyIn * field
  const places = placesPaid(field, paidPct)
  const payouts = useMemo(() => payoutTable(prizePool, places, curve), [prizePool, places, curve])
  const startChips = startBB * levels[0].bb

  function launch() {
    const slots = Array.from({ length: tableSize - 1 }, () => ({ type: 'bot', level: botLevel }))
    navigate('/game', {
      state: {
        numPlayers: tableSize, selectedSeat: 0, stackBB: startBB,
        sb: levels[0].sb, bb: levels[0].bb, ante: levels[0].ante, decisionTimer: 25,
        displayName, slots,
        tournament: { field, tableSize, startBB, speed, levelMinutes, antes, buyIn, paidPct, curve, reentry, botLevel },
      },
    })
  }

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #1a1206 0%, #0d0a06 60%, #060503 100%)' }}>
      <div className="app-drag flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Medal className="text-[#f0c060]" size={22} />
          <div>
            <h1 className="text-lg font-black text-[#f0c060] uppercase tracking-[0.2em]">Entraînement Tournoi — MTT</h1>
            <p className="text-[10px] text-white/35 uppercase tracking-widest">Configure ton tournoi multi-tables, puis lance-le</p>
          </div>
        </div>
        <div className="app-drag-none"><WindowControls /></div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5">
        {/* ── LEFT: parameters ── */}
        <div className="flex flex-col gap-4">
          {/* Field & tables */}
          <Card title="Le champ" icon={<Users size={14} />}>
            <Label>Nombre d'inscrits</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {FIELD_PRESETS.map(f => (
                <Chip key={f} active={field === f} onClick={() => setField(f)}>{f}</Chip>
              ))}
              <Stepper value={field} min={2} max={5000} step={field >= 100 ? 50 : 9} onChange={setField} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label>Joueurs / table</Label>
                <div className="flex gap-1.5 mt-1.5">
                  {[9, 6].map(s => <Chip key={s} active={tableSize === s} onClick={() => setTableSize(s)}>{s}-max</Chip>)}
                </div>
              </div>
              <Readout label="Nombre de tables" value={`${nbTables}`} />
            </div>
          </Card>

          {/* Stacks & structure */}
          <Card title="Tapis & structure" icon={<Timer size={14} />}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stack de départ (BB)</Label>
                <Stepper value={startBB} min={20} max={500} step={10} onChange={setStartBB} />
                <p className="text-[9px] text-white/30 mt-1">= {fmt(startChips)} jetons (blindes niv.1 {levels[0].sb}/{levels[0].bb})</p>
              </div>
              <div>
                <Label>Vitesse — raideur des sauts de blindes</Label>
                <div className="flex flex-col gap-1.5 mt-1.5">
                  {(['regular', 'turbo', 'hyper'] as Speed[]).map(s => (
                    <Chip key={s} active={speed === s} onClick={() => setSpeed(s)}>{SPEED_LABEL[s]} · ×{s === 'hyper' ? '1.85' : s === 'turbo' ? '1.6' : '1.4'}/niv.</Chip>
                  ))}
                </div>
                <div className="mt-2.5">
                  <Label>Durée d'un niveau (timer)</Label>
                  <div className="flex gap-1.5 mt-1.5">
                    {LEVEL_MINUTES_OPTIONS.map(m => (
                      <Chip key={m} active={levelMinutes === m} onClick={() => setLevelMinutes(m)}>{m} min</Chip>
                    ))}
                  </div>
                </div>
                <div className="mt-2.5">
                  <Label>Antes (big-blind ante)</Label>
                  <div className="flex gap-1.5 mt-1.5">
                    <Chip active={antes} onClick={() => setAntes(true)}>Activées</Chip>
                    <Chip active={!antes} onClick={() => setAntes(false)}>Désactivées</Chip>
                  </div>
                  <p className="text-[8.5px] text-white/30 mt-1">{antes ? `Ante = 1 BB (payée par la grosse blinde) dès le niveau 3.` : 'Aucune ante.'}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Prizes */}
          <Card title="Dotation" icon={<Coins size={14} />}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Buy-in</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {BUYINS.map(b => <Chip key={b} active={buyIn === b} onClick={() => setBuyIn(b)}>${b}</Chip>)}
                </div>
              </div>
              <div>
                <Label>Places payées (% du champ)</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input type="range" min={5} max={25} step={1} value={paidPct} onChange={e => setPaidPct(+e.target.value)} className="flex-1 accent-[#f0c060]" />
                  <span className="text-sm font-bold text-[#f0c060] font-mono w-10 text-right">{paidPct}%</span>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Label>Courbe de paiement</Label>
              <div className="flex gap-1.5 mt-1.5">
                {CURVES.map(c => <Chip key={c.id} active={curve === c.id} onClick={() => setCurve(c.id)}>{c.label}</Chip>)}
              </div>
            </div>
          </Card>

          {/* Format & bots */}
          <Card title="Format & adversaires">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Format</Label>
                <div className="flex gap-1.5 mt-1.5">
                  <Chip active={!reentry} onClick={() => setReentry(false)}>Freezeout</Chip>
                  <Chip active={reentry} onClick={() => setReentry(true)}>Re-entry</Chip>
                </div>
              </div>
              <div>
                <Label>Niveau des bots</Label>
                <div className="flex gap-1.5 mt-1.5">
                  {[{ l: 1, n: 'Amateur' }, { l: 2, n: 'Pro' }, { l: 3, n: 'Expert' }].map(b => (
                    <Chip key={b.l} active={botLevel === b.l} onClick={() => setBotLevel(b.l)}>{b.n}</Chip>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: recap ── */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[#f0c060]/25 bg-[#f0c060]/[0.04] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-[#f0c060]" />
              <span className="text-[11px] font-black text-[#f0c060] uppercase tracking-widest">Récapitulatif</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Big label="Prize pool" value={`$${fmt(prizePool)}`} />
              <Big label="Places payées" value={`${places}`} />
              <Big label="Tables" value={`${nbTables}`} />
              <Big label="Inscrits" value={`${fmt(field)}`} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
              <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Paiements (top)</span>
              <div className="mt-2 space-y-1 max-h-[150px] overflow-y-auto">
                {payouts.slice(0, 12).map(p => (
                  <div key={p.place} className="flex items-center justify-between text-[11px]">
                    <span className="text-white/55">{p.place === 1 ? '🥇 1er' : p.place === 2 ? '🥈 2e' : p.place === 3 ? '🥉 3e' : `${p.place}e`}</span>
                    <span className="font-mono font-bold text-emerald-300/90">${fmt(p.amount)}</span>
                  </div>
                ))}
                {places > 12 && <p className="text-[9px] text-white/25 text-center pt-1">… +{places - 12} autres places payées</p>}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <span className="text-[10px] uppercase tracking-widest text-white/45 font-bold">Structure de blindes</span>
            <div className="mt-2 space-y-0.5 max-h-[180px] overflow-y-auto pr-1">
              {levels.slice(0, 14).map((l, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] px-1 py-0.5 rounded hover:bg-white/5">
                  <span className="text-white/40">Niv. {i + 1}</span>
                  <span className="font-mono text-white/70">{fmt(l.sb)} / {fmt(l.bb)}{l.ante ? ` (ante ${fmt(l.ante)})` : ''}</span>
                </div>
              ))}
            </div>
            <p className="text-[8.5px] text-white/30 mt-1.5">Chaque palier dure <b className="text-white/50">{levelMinutes} min</b> (timer) ; la <b className="text-white/50">vitesse</b> règle l'ampleur de chaque saut (×{speed === 'hyper' ? '1.85' : speed === 'turbo' ? '1.6' : '1.4'}). Stack départ : {startBB} BB.</p>
          </div>
        </div>
      </div>

      <div className="border-t border-white/5 px-6 py-3 flex items-center">
        <p className="text-[10px] text-white/35">Tu démarres à une table {tableSize}-max ; le reste du champ ({fmt(field - tableSize)} joueurs) joue en parallèle.</p>
        <button onClick={launch}
          className="ml-auto flex items-center gap-2 px-8 py-2.5 rounded-xl font-black uppercase tracking-[0.2em] text-sm transition-all hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227,#8B6810)', color: '#0a0a0a' }}>
          <Play size={16} /> Lancer le tournoi
        </button>
      </div>
    </div>
  )
}

// ── tiny UI helpers ──────────────────────────────────────────────────────────
function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-2.5">
        {icon && <span className="text-[#f0c060]/80">{icon}</span>}
        <span className="text-[11px] font-bold text-[#f0c060] uppercase tracking-widest">{title}</span>
      </div>
      {children}
    </div>
  )
}
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{children}</span>
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${active ? 'bg-[#f0c060] text-black border-[#f0c060]' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
      {children}
    </button>
  )
}
function Stepper({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-1 mt-0 align-middle">
      <button onClick={() => onChange(Math.max(min, value - step))} className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white"><Minus size={12} /></button>
      <span className="text-[13px] font-black text-[#f0c060] font-mono min-w-[44px] text-center">{value.toLocaleString('fr-FR')}</span>
      <button onClick={() => onChange(Math.min(max, value + step))} className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white"><Plus size={12} /></button>
    </div>
  )
}
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
      <Label>{label}</Label>
      <p className="text-[18px] font-black text-[#f0c060] font-mono mt-0.5">{value}</p>
    </div>
  )
}
function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/30 p-2.5 text-center">
      <p className="text-[8.5px] uppercase tracking-widest text-white/40 font-bold">{label}</p>
      <p className="text-[18px] font-black text-[#f0c060] font-mono mt-0.5">{value}</p>
    </div>
  )
}
