import type { TrainerSpot, TrainerSeat } from '../lib/spotTrainer'

interface Card { rank: string; suit: string }
const RED = (s: string) => s === '♥' || s === '♦'

function FaceCard({ c, big }: { c: Card; big?: boolean }) {
  return (
    <div className={`rounded-md bg-white flex flex-col items-center justify-center shadow-md ${big ? 'w-12 h-16' : 'w-9 h-12'}`}
      style={{ color: RED(c.suit) ? '#d32f2f' : '#15171c', border: '1px solid rgba(0,0,0,0.25)' }}>
      <span className={`font-black leading-none ${big ? 'text-2xl' : 'text-lg'}`}>{c.rank}</span>
      <span className={`leading-none ${big ? 'text-xl' : 'text-base'}`}>{c.suit}</span>
    </div>
  )
}
function BackCard() {
  return <div className="w-7 h-10 rounded-md shadow" style={{ background: 'repeating-linear-gradient(45deg,#3b4a6b,#3b4a6b 3px,#2c3a57 3px,#2c3a57 6px)', border: '1px solid rgba(255,255,255,0.12)' }} />
}

function ChipStack({ amount, bb }: { amount: number; bb: number }) {
  if (amount <= 0) return null
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(201,162,39,0.4)' }}>
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'radial-gradient(circle,#e8c547,#a8801c)' }} />
      <span className="text-[9px] font-bold text-[#f0d98a] font-mono">{Math.round(amount / bb * 10) / 10}bb</span>
    </div>
  )
}

function SeatChip({ seat, bb }: { seat: TrainerSeat; bb: number }) {
  return (
    <div className={`flex flex-col items-center gap-1 ${seat.isHero ? 'scale-110' : ''}`}>
      <div className="flex items-center gap-1">
        {seat.isHero && seat.holeShown
          ? seat.holeShown.map((c, i) => <FaceCard key={i} c={c} big />)
          : <><BackCard /><BackCard /></>}
      </div>
      <div className="px-2 py-0.5 rounded-md text-center" style={{ background: seat.isHero ? 'rgba(0,229,255,0.14)' : 'rgba(255,255,255,0.05)', border: `1px solid ${seat.isHero ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.1)'}` }}>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold ${seat.isHero ? 'text-[#5fe6ff]' : 'text-white/70'}`}>{seat.name}</span>
          <span className="text-[8px] font-black px-1 py-px rounded bg-[#c9a227]/20 text-[#e8c547] uppercase">{seat.pos}</span>
        </div>
        <div className="text-[8px] text-white/40 font-mono">{seat.stackBB}bb</div>
      </div>
      <ChipStack amount={seat.committed} bb={bb} />
    </div>
  )
}

// Static "spot under the microscope" — felt, flop, pot, hero face-up, villains
// face-down with their committed chips. Echoes the training-room look, frozen.
export default function SpotTable({ spot }: { spot: TrainerSpot }) {
  const villains = spot.seats.filter(s => !s.isHero)
  const hero = spot.seats.find(s => s.isHero)!
  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: 300, background: 'radial-gradient(120% 90% at 50% 35%, #0c2230 0%, #08161f 60%, #050b12 100%)' }}>
      {/* felt ellipse */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
        style={{ width: '78%', height: '64%', background: 'radial-gradient(120% 120% at 50% 30%, #12545a 0%, #0c3a43 55%, #06262d 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.55), 0 0 0 6px rgba(201,162,39,0.18)' }} />

      {/* villains row (top) */}
      <div className="absolute top-3 left-0 right-0 flex items-start justify-center gap-16 px-6">
        {villains.map((s, i) => <SeatChip key={i} seat={s} bb={spot.bb} />)}
      </div>

      {/* board + pot (center) */}
      <div className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5">
          {spot.board.map((c, i) => <FaceCard key={i} c={c} big />)}
        </div>
        <div className="px-3 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(201,162,39,0.35)' }}>
          <span className="text-[9px] text-white/40 uppercase tracking-widest mr-1.5">Pot</span>
          <span className="text-sm font-black text-[#f0d98a] font-mono">{Math.round(spot.pot / spot.bb * 10) / 10}bb</span>
        </div>
      </div>

      {/* hero (bottom) */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
        <SeatChip seat={hero} bb={spot.bb} />
      </div>
    </div>
  )
}
