import PlayerAvatar, { avatarForSeat } from './PlayerAvatar'
import { PlayingCard, FaceDown, EmptySlot, ChipStack, DealerButtonToken, TableSVG, Room } from './tableVisuals'
import type { TrainerSpot, TrainerSeat } from '../lib/spotTrainer'

// Static "spot under the microscope" rendered on the EXACT live cash-game table
// (golden felt, player pods, casino chips, PNG cards). Only the seats that exist in
// the spot are shown, evenly spaced around the oval with the hero at the bottom.
export default function SpotTable({ spot }: { spot: TrainerSpot }) {
  const n = spot.seats.length
  // Hero (index 0) sits at the bottom; the others fan out around the upper arc.
  // Seats hug the felt rail (rx/ry just inside the container edge).
  const posOf = (i: number) => {
    const angle = (i / n) * 2 * Math.PI + Math.PI / 2
    const rx = 41, ry = 36, cx = 50, cy = 47
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  }
  const btnSeatIdx = spot.seats.findIndex(s => s.pos === 'BTN' || s.pos === 'BTN/SB')
  const bbU = (chips: number) => Math.round(chips / spot.bb * 10) / 10

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-white/10"
      style={{ aspectRatio: '1.92', minHeight: 380, maxHeight: 540 }}>
      <Room variant="default" />

      {/* felt — kept a touch smaller than the frame so the pods sit on the rail */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ padding: '34px 30px' }}>
        <div style={{ width: '100%', maxWidth: 880 }}><TableSVG variant="default" /></div>
      </div>

      {/* board + pot (center) */}
      <div className="absolute left-1/2" style={{ top: '40%', transform: 'translate(-50%,-50%)' }}>
        <div className="flex gap-2 items-end justify-center">
          {[0, 1, 2, 3, 4].map(i => {
            const c = spot.board[i]
            return c ? <PlayingCard key={i} rank={c.rank} suit={c.suit} w={54} h={76} />
              : <EmptySlot key={i} w={54} h={76} />
          })}
        </div>
        <div className="mt-2.5 mx-auto w-fit px-3.5 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(201,162,39,0.4)' }}>
          <span className="text-[9px] text-white/40 uppercase tracking-widest mr-1.5">Pot</span>
          <span className="text-[14px] font-black text-[#f0d98a] font-mono">{bbU(spot.pot)}bb</span>
        </div>
      </div>

      {/* seats */}
      {spot.seats.map((seat, i) => {
        const p = posOf(i)
        return <SeatPod key={i} seat={seat} idx={i} x={p.x} y={p.y} />
      })}

      {/* committed bet chips — clearly between the seat and the pot (not on the pod) */}
      {spot.seats.map((seat, i) => {
        if (seat.committed <= 0) return null
        const p = posOf(i)
        const bx = p.x + (50 - p.x) * 0.40
        const by = p.y + (47 - p.y) * 0.44
        return (
          <div key={`bet-${i}`} className="absolute flex flex-col items-center gap-0.5 pointer-events-none"
            style={{ left: `${bx}%`, top: `${by}%`, transform: 'translate(-50%,-50%)', zIndex: 14 }}>
            <ChipStack amount={seat.committed} sz={16} maxVisible={4} />
            <span className="text-[8px] font-mono text-[#f0d98a] font-bold bg-black/60 px-1 rounded">{bbU(seat.committed)}bb</span>
          </div>
        )
      })}

      {/* dealer button near the BTN seat (if shown) */}
      {btnSeatIdx >= 0 && (() => {
        const p = posOf(btnSeatIdx)
        const ox = p.x < 50 ? 8 : -8, oy = p.y < 50 ? 7 : -7
        return (
          <div className="absolute pointer-events-none" style={{ left: `${p.x + ox}%`, top: `${p.y + oy}%`, transform: 'translate(-50%,-50%)', zIndex: 15 }}>
            <DealerButtonToken size={28} />
          </div>
        )
      })()}
    </div>
  )
}

function SeatPod({ seat, idx, x, y }: { seat: TrainerSeat; idx: number; x: number; y: number }) {
  const cards = seat.holeShown
  const top = y < 50
  return (
    <div className="absolute flex flex-col items-center gap-0.5" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', zIndex: seat.isHero ? 20 : 8 }}>
      {/* For TOP seats the pod goes above the cards (cards point into the felt); for the
          hero/bottom the cards sit above the pod — same as the live table. */}
      {top && <Pod seat={seat} idx={idx} />}
      <div className="flex">
        {cards
          ? <>
              <PlayingCard rank={cards[0].rank} suit={cards[0].suit} w={44} h={62} />
              <div style={{ marginLeft: -15 }}><PlayingCard rank={cards[1].rank} suit={cards[1].suit} w={44} h={62} /></div>
            </>
          : <><FaceDown w={32} h={45} /><div style={{ marginLeft: -13 }}><FaceDown w={32} h={45} /></div></>}
      </div>
      {!top && <Pod seat={seat} idx={idx} />}
    </div>
  )
}

function Pod({ seat, idx }: { seat: TrainerSeat; idx: number }) {
  return (
    <div className="relative rounded-xl border backdrop-blur-md overflow-hidden min-w-[104px]"
      style={{
        background: 'rgba(4,10,24,0.94)',
        borderColor: seat.isHero ? 'rgba(0,212,255,0.55)' : 'rgba(255,255,255,0.1)',
        boxShadow: seat.isHero ? '0 0 18px rgba(0,212,255,0.26)' : 'none',
      }}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <div className="shrink-0 rounded-full" style={{ boxShadow: seat.isHero ? '0 0 0 2px rgba(0,212,255,0.6)' : '0 0 0 1px rgba(255,255,255,0.12)' }}>
          <PlayerAvatar spec={avatarForSeat(2, idx, seat.isHero, seat.isHero)} size={32} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-[10px] font-bold truncate" style={{ color: seat.isHero ? '#5fe6ff' : '#fff' }}>{seat.name}</p>
            <span className="text-[7px] font-bold px-1 rounded text-[#c9a227] bg-[#c9a227]/12 border border-[#c9a227]/25 shrink-0">{seat.pos}</span>
          </div>
          <p className="text-[8px] text-emerald-300/80 font-mono">{seat.stackBB}bb</p>
        </div>
      </div>
    </div>
  )
}
