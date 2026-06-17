import { useTranslation } from 'react-i18next'
import { GRID_RANKS, cellKey } from '../lib/preflopRanges'
import type { RangeView } from '../lib/rangeEstimator'

// Three tiers, told apart by colour:
//   • IN the current range  → dark-gold (rare) → bright-gold (frequent)
//   • ABANDONED in-hand     → dim red/maroon  (was plausible pre-flop, the line cut it)
//   • OUT from the start    → near-black       (never in their range)
// `start` = the cell's weight in the reference (end-of-pre-flop) range; when no
// reference is given (live panel / film) we fall back to two tiers (gold / black).
function heat(intensity: number, start: number | undefined): { bg: string; fg: string; out: boolean } {
  if (intensity >= 0.04) {
    const a = 0.20 + intensity * 0.80
    return { bg: `rgba(201,162,39,${a})`, fg: intensity > 0.55 ? '#1a1206' : '#e9d9a8', out: false }
  }
  if (start !== undefined && start >= 0.04) return { bg: 'rgba(176,52,42,0.34)', fg: 'rgba(255,176,166,0.55)', out: true } // abandoned in-hand
  return { bg: 'rgba(0,0,0,0.62)', fg: 'rgba(255,255,255,0.20)', out: true } // out from the start
}

export default function RangeHeatmap({
  view, move, effect, name, heroKey, style, width = 300, onCellClick, selectedKey, startView,
}: {
  view: RangeView
  move: string
  effect: string
  name: string
  heroKey?: string | null
  style?: React.CSSProperties
  width?: number
  onCellClick?: (key: string) => void   // when set, cells become clickable
  selectedKey?: string | null           // highlighted (clicked) cell
  startView?: RangeView                  // reference (end-of-preflop) range → 3-tier colouring
}) {
  const { t } = useTranslation()
  const s = width / 300            // scale factor — fonts scale with the grid
  const f = (px: number) => Math.round(px * s)
  return (
    <div className={`${onCellClick ? '' : 'pointer-events-none'} rounded-xl border border-[#c9a227]/40 shadow-2xl`}
      style={{ background: 'rgba(7,13,26,0.97)', width, padding: f(10), ...style }}>
      {/* Header: who + last move + consequence + range width */}
      <div style={{ marginBottom: f(6) }}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-white/85 truncate" style={{ fontSize: f(11) }}>{name}</span>
          <span className="font-bold text-[#c9a227]" style={{ fontSize: f(10) }}>{Math.round(view.pctOfHands)}% des mains</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ marginTop: f(2) }}>
          <span className="font-black rounded bg-[#c9a227]/20 text-[#c9a227] uppercase tracking-wide" style={{ fontSize: f(9), padding: `${f(2)}px ${f(6)}px` }}>{move}</span>
          <span className="text-white/55 leading-tight" style={{ fontSize: f(8.5) }}>{effect}</span>
        </div>
      </div>

      {/* 13×13 heatmap */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(13, 1fr)', gap: Math.max(1, f(1)) }}>
        {GRID_RANKS.map((_, i) =>
          GRID_RANKS.map((__, j) => {
            const key = cellKey(i, j)
            const intensity = view.cells[key] ?? 0
            const c = heat(intensity, startView?.cells[key])
            const isHero = !!heroKey && key === heroKey
            const isSel = !!selectedKey && key === selectedKey
            return (
              <div key={`${i}-${j}`}
                onClick={onCellClick ? () => onCellClick(key) : undefined}
                className="relative flex items-center justify-center rounded-[2px] select-none"
                style={{
                  aspectRatio: '1', fontSize: f(7), fontWeight: 700, background: c.bg, color: c.fg,
                  cursor: onCellClick ? 'pointer' : 'default',
                  outline: isSel ? '2px solid #fff' : isHero ? '2px solid #00e5ff' : 'none', outlineOffset: (isSel || isHero) ? '-1px' : 0,
                  // Cyan ring for the hero; otherwise a soft gold glow that grows as the
                  // hand becomes more represented — so when the range narrows between
                  // steps, the surviving value hands visibly "light up".
                  boxShadow: isSel ? '0 0 8px rgba(255,255,255,0.9)'
                    : isHero ? '0 0 8px rgba(0,229,255,0.85)'
                    : intensity > 0.6 ? `0 0 ${f(5)}px rgba(201,162,39,${((intensity - 0.6) * 0.9).toFixed(2)})` : 'none',
                  zIndex: (isSel || isHero) ? 2 : 1,
                  // Smoothly fade/brighten between range snapshots (the "film" effect).
                  transition: 'background-color 450ms ease, color 450ms ease, box-shadow 450ms ease',
                }}>
                {key.replace('s', '').replace('o', '')}
                {key.endsWith('s') && <span style={{ fontSize: f(6.5), fontWeight: 800, marginLeft: 1, color: c.fg, opacity: c.out ? 0.5 : 0.85 }}>s</span>}
                {key.endsWith('o') && <span style={{ fontSize: f(6.5), fontWeight: 700, marginLeft: 1, color: c.fg, opacity: 0.5 }}>o</span>}
              </div>
            )
          })
        )}
      </div>

      {/* Legend — real colour swatches so the shading is unambiguous */}
      <div className="flex items-center justify-between flex-wrap text-white/45" style={{ marginTop: f(6), fontSize: f(7.5), gap: f(6) }}>
        <div className="flex items-center" style={{ gap: f(6) }}>
          {/* frequency gradient: dark-gold (rare) → bright-gold (frequent) */}
          <span className="flex items-center" style={{ gap: f(3) }}>
            <span>{t('coach.heatWeak')}</span>
            <span style={{ display: 'inline-block', width: f(34), height: f(8), borderRadius: f(2), background: 'linear-gradient(90deg, rgba(201,162,39,0.30), rgba(201,162,39,1))', border: '1px solid rgba(201,162,39,0.4)' }} />
            <span>{t('coach.heatStrong')}</span>
            <span className="text-white/30">({t('coach.heatFreq')})</span>
          </span>
          {/* abandoned-in-hand swatch (only meaningful with a reference range) */}
          {startView && (
            <span className="flex items-center" style={{ gap: f(3) }}>
              <span style={{ display: 'inline-block', width: f(9), height: f(9), borderRadius: f(2), background: 'rgba(176,52,42,0.45)', border: '1px solid rgba(176,52,42,0.6)' }} />
              <span>{t('coach.heatAbandoned')}</span>
            </span>
          )}
          {/* out-from-the-start swatch */}
          <span className="flex items-center" style={{ gap: f(3) }}>
            <span style={{ display: 'inline-block', width: f(9), height: f(9), borderRadius: f(2), background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(255,255,255,0.15)' }} />
            <span>{t('coach.heatOutRange')}</span>
          </span>
        </div>
        <span><span className="text-white/60">s</span> {t('coach.heatSuited')} · <span className="text-white/60">o</span> {t('coach.heatOffsuit')} · {t('coach.heatEstRange')}</span>
      </div>
    </div>
  )
}
