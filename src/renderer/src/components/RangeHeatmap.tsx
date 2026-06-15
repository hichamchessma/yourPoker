import { useTranslation } from 'react-i18next'
import { GRID_RANKS, cellKey } from '../lib/preflopRanges'
import type { RangeView } from '../lib/rangeEstimator'

// Heat colour: out-of-range → dark; in-range → dark-gold → bright-gold by frequency.
function heat(intensity: number): { bg: string; fg: string } {
  if (intensity < 0.04) return { bg: 'rgba(255,255,255,0.03)', fg: 'rgba(255,255,255,0.18)' }
  const a = 0.18 + intensity * 0.82
  return { bg: `rgba(201,162,39,${a})`, fg: intensity > 0.55 ? '#1a1206' : '#e9d9a8' }
}

export default function RangeHeatmap({
  view, move, effect, name, heroKey, style, width = 300, onCellClick, selectedKey,
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
            const c = heat(intensity)
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
                {key.endsWith('s') && <span style={{ fontSize: f(6.5), fontWeight: 800, marginLeft: 1, color: intensity > 0.45 ? c.fg : '#37d6ef' }}>s</span>}
                {key.endsWith('o') && <span style={{ fontSize: f(6.5), fontWeight: 700, marginLeft: 1, color: c.fg, opacity: 0.55 }}>o</span>}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between text-white/30" style={{ marginTop: f(6), fontSize: f(7.5) }}>
        <span>● {t('coach.heatWeak')} → ● {t('coach.heatStrong')} · <span className="text-white/45">s</span> {t('coach.heatSuited')} · <span className="text-white/45">o</span> {t('coach.heatOffsuit')}</span>
        <span>{t('coach.heatEstRange')}</span>
      </div>
    </div>
  )
}
