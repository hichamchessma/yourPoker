import { GRID_RANKS, cellKey } from '../lib/preflopRanges'
import type { RangeView } from '../lib/rangeEstimator'

// Heat colour: out-of-range → dark; in-range → dark-gold → bright-gold by frequency.
function heat(intensity: number): { bg: string; fg: string } {
  if (intensity < 0.04) return { bg: 'rgba(255,255,255,0.03)', fg: 'rgba(255,255,255,0.18)' }
  const a = 0.18 + intensity * 0.82
  return { bg: `rgba(201,162,39,${a})`, fg: intensity > 0.55 ? '#1a1206' : '#e9d9a8' }
}

export default function RangeHeatmap({
  view, move, effect, name, heroKey, style,
}: {
  view: RangeView
  move: string
  effect: string
  name: string
  heroKey?: string | null
  style?: React.CSSProperties
}) {
  return (
    <div className="pointer-events-none rounded-xl border border-[#c9a227]/40 shadow-2xl p-2.5"
      style={{ background: 'rgba(7,13,26,0.97)', width: 300, ...style }}>
      {/* Header: who + last move + consequence + range width */}
      <div className="mb-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-white/85 truncate">{name}</span>
          <span className="text-[10px] font-bold text-[#c9a227]">{Math.round(view.pctOfHands)}% des mains</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#c9a227]/20 text-[#c9a227] uppercase tracking-wide">{move}</span>
          <span className="text-[8.5px] text-white/55 leading-tight">{effect}</span>
        </div>
      </div>

      {/* 13×13 heatmap */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(13, 1fr)', gap: 1 }}>
        {GRID_RANKS.map((_, i) =>
          GRID_RANKS.map((__, j) => {
            const key = cellKey(i, j)
            const intensity = view.cells[key] ?? 0
            const c = heat(intensity)
            const isHero = !!heroKey && key === heroKey
            return (
              <div key={`${i}-${j}`}
                className="relative flex items-center justify-center rounded-[2px] select-none"
                style={{
                  aspectRatio: '1', fontSize: 7, fontWeight: 700, background: c.bg, color: c.fg,
                  outline: isHero ? '2px solid #00e5ff' : 'none', outlineOffset: isHero ? '-1px' : 0,
                  boxShadow: isHero ? '0 0 8px rgba(0,229,255,0.85)' : 'none', zIndex: isHero ? 2 : 1,
                }}>
                {key.replace('s', '').replace('o', '')}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between mt-1.5 text-[7.5px] text-white/30">
        <span>● faible → ● forte fréquence</span>
        <span>range estimée (IA)</span>
      </div>
    </div>
  )
}
