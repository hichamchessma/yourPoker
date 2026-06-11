// ─────────────────────────────────────────────────────────────────────────────
// Shared poker-table visual primitives — the felt SVG, casino chips, PNG cards and
// dealer button used by the live game table. Extracted so other surfaces (e.g. the
// "Lecture de spot" trainer) render on the EXACT same table design.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Casino chips ─────────────────────────────────────────────────────────────
const CHIP_DENOMS = [25000, 10000, 2500, 500, 100, 25, 5, 1]
const CHIP_CFG: Record<number, { bg: string; rim: string; spot: string }> = {
  25000: { bg: '#f97316', rim: '#7c2d12', spot: '#fed7aa' },
  10000: { bg: '#3b82f6', rim: '#1e3a8a', spot: '#bfdbfe' },
  2500: { bg: '#eab308', rim: '#713f12', spot: '#fef08a' },
  500: { bg: '#a855f7', rim: '#3b0764', spot: '#e9d5ff' },
  100: { bg: '#27272a', rim: '#52525b', spot: '#a1a1aa' },
  25: { bg: '#16a34a', rim: '#14532d', spot: '#86efac' },
  5: { bg: '#dc2626', rim: '#7f1d1d', spot: '#fca5a5' },
  1: { bg: '#d1d5db', rim: '#6b7280', spot: '#f9fafb' },
}
export function getChipBreakdown(amount: number): { denom: number; count: number }[] {
  const out: { denom: number; count: number }[] = []
  let rem = Math.max(0, Math.round(amount))
  for (const d of CHIP_DENOMS) {
    if (rem >= d) { out.push({ denom: d, count: Math.floor(rem / d) }); rem %= d }
  }
  return out
}
export function CasinoChip({ denom, sz = 24 }: { denom: number; sz?: number }) {
  const c = CHIP_CFG[denom] ?? CHIP_CFG[1]
  const R = sz / 2
  const spotR = R * 0.77
  const spotSz = sz * 0.088
  const spots = Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4 - Math.PI / 8
    return { x: R + spotR * Math.cos(a), y: R + spotR * Math.sin(a) }
  })
  return (
    <svg width={sz} height={sz + 3} viewBox={`0 0 ${sz} ${sz + 3}`}
      style={{ filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.85))' }}>
      <circle cx={R + 0.3} cy={R + 2.8} r={R - 0.5} fill={c.rim} opacity={0.45} />
      <circle cx={R} cy={R + 1.6} r={R - 0.5} fill={c.rim} />
      <circle cx={R} cy={R} r={R - 0.5} fill={c.bg} />
      <circle cx={R} cy={R} r={R - 0.5} fill="none" stroke={c.rim} strokeWidth={sz * 0.1} />
      {spots.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={spotSz} fill={c.spot} />)}
      <circle cx={R} cy={R} r={R * 0.52} fill="none" stroke={c.spot} strokeWidth={0.7} opacity={0.65} />
      <circle cx={R} cy={R} r={R * 0.19} fill={c.spot} opacity={0.45} />
      <ellipse cx={R * 0.65} cy={R * 0.60} rx={R * 0.30} ry={R * 0.19}
        fill="white" opacity={0.22} transform={`rotate(-35,${R},${R})`} />
    </svg>
  )
}
export function ChipStack({ amount, maxVisible = 7, sz = 22 }: { amount: number; maxVisible?: number; sz?: number }) {
  const breakdown = getChipBreakdown(amount)
  const chips: { denom: number }[] = []
  for (const { denom, count } of breakdown) {
    const show = Math.min(count, 2)
    for (let i = 0; i < show && chips.length < maxVisible; i++) chips.push({ denom })
  }
  if (chips.length === 0) return null
  const SZ = sz, STEP = Math.max(4, Math.round(sz * 0.23))
  return (
    <div style={{ position: 'relative', width: SZ, height: SZ + 3 + (chips.length - 1) * STEP }}>
      {chips.map((chip, i) => (
        <div key={i} style={{ position: 'absolute', bottom: i * STEP, left: 0, zIndex: i }}>
          <CasinoChip denom={chip.denom} sz={SZ} />
        </div>
      ))}
    </div>
  )
}
// A small stack of chips used for in-flight animation (collect / payout).
export function FlyingStack({ amount, sz = 18 }: { amount: number; sz?: number }) {
  return <ChipStack amount={amount} sz={sz} maxVisible={5} />
}

// ─── Card image components — PNG assets from /assets/cards/ ───────────────────
const RANK_MAP: Record<string, string> = {
  A: '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
  '7': '7', '8': '8', '9': '9', T: '10', J: 'j', Q: 'q', K: 'k',
}
const SUIT_MAP: Record<string, string> = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' }
export function cardSrc(rank: string, suit: string): string {
  return `/assets/cards/card_${RANK_MAP[rank] ?? rank.toLowerCase()}${SUIT_MAP[suit] ?? 's'}.png`
}
export function PlayingCard({ rank, suit, w = 58, h = 82 }: { rank: string; suit: string; w?: number; h?: number }) {
  return (
    <img src={cardSrc(rank, suit)} alt={`${rank}${suit}`} width={w} height={h} draggable={false}
      style={{
        display: 'block', borderRadius: Math.round(w * 0.10),
        boxShadow: '0 8px 22px rgba(0,0,0,0.72), 0 2px 6px rgba(0,0,0,0.4)',
        objectFit: 'cover', userSelect: 'none',
      }} />
  )
}
export function FaceDown({ w = 40, h = 56 }: { w?: number; h?: number }) {
  return (
    <img src="/assets/cards/card_back.png" alt="face down" width={w} height={h} draggable={false}
      style={{
        display: 'block', borderRadius: Math.round(w * 0.10),
        boxShadow: '0 4px 12px rgba(0,0,0,0.75)', objectFit: 'cover', userSelect: 'none',
      }} />
  )
}
export function EmptySlot({ w = 50, h = 70 }: { w?: number; h?: number }) {
  return (
    <div style={{ width: w, height: h }} className="border border-dashed border-white/10 rounded-md flex items-center justify-center bg-black/15">
      <span className="text-white/10 text-sm">?</span>
    </div>
  )
}

// ─── Dealer button token ──────────────────────────────────────────────────────
export function DealerButtonToken({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 46"
      style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.9)) drop-shadow(0 0 8px rgba(200,0,0,0.3))' }}>
      <circle cx="23" cy="23" r="22.5" fill="#0d0d0d" />
      <circle cx="23" cy="23" r="21" fill="#1a1a1a" />
      <circle cx="23" cy="23" r="19.5" fill="#0a0a0a" />
      <circle cx="23" cy="23" r="18.5" fill="#cc1111" />
      <circle cx="23" cy="23" r="17" fill="#0a0a0a" />
      <circle cx="23" cy="23" r="15.8" fill="white" />
      <path d="M23 8 C23 8 32 15 32 20 C32 24 27.5 25 23 22 C18.5 25 14 24 14 20 C14 15 23 8 23 8Z" fill="#cc1111" />
      <path d="M20.5 22 L19 27 L27 27 L25.5 22 C24.5 23.5 21.5 23.5 20.5 22Z" fill="#cc1111" />
      <polygon points="23,10 24.3,14.1 28.6,14.1 25.2,16.6 26.5,20.7 23,18.2 19.5,20.7 20.8,16.6 17.4,14.1 21.7,14.1" fill="white" />
      <text x="23" y="36" textAnchor="middle" fontSize="4.8" fontFamily="Arial Black,Arial,sans-serif"
        fontWeight="900" fill="#111" letterSpacing="0.6">DEALER</text>
      <circle cx="23" cy="23" r="15.8" fill="none" stroke="#ff3333" strokeWidth="0.6" />
    </svg>
  )
}

// ─── Felt table SVG + room ambiance ───────────────────────────────────────────
export type RoomVariant = 'default' | 'scenario' | 'sim'
export const FELT_STOPS: Record<RoomVariant, [string, string, string, string]> = {
  default: ['#1b7e8c', '#0e5b67', '#083e48', '#041a20'], // teal — the live training table
  scenario: ['#9a4150', '#6a2c39', '#3d1620', '#180809'], // warm garnet — "Setup Position" studio
  sim: ['#5b3fa6', '#3c2a72', '#241848', '#0c0820'], // indigo — "Revive" sandbox
}
export function TableSVG({ variant = 'default' }: { variant?: RoomVariant }) {
  const f = FELT_STOPS[variant]
  return (
    <svg viewBox="0 0 840 450" width="100%" style={{ display: 'block' }}>
      <defs>
        <radialGradient id="tF" cx="50%" cy="38%" r="58%">
          <stop offset="0%" stopColor={f[0]} /><stop offset="42%" stopColor={f[1]} />
          <stop offset="78%" stopColor={f[2]} /><stop offset="100%" stopColor={f[3]} />
        </radialGradient>
        <radialGradient id="tG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(28,180,200,0.12)" /><stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="tR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8e870" /><stop offset="12%" stopColor="#d8b030" />
          <stop offset="45%" stopColor="#a07818" /><stop offset="100%" stopColor="#2e1a02" />
        </linearGradient>
        <linearGradient id="tW" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a4e20" /><stop offset="100%" stopColor="#1c0e04" />
        </linearGradient>
        <filter id="tS" x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="16" stdDeviation="24" floodColor="black" floodOpacity="0.9" />
        </filter>
        <filter id="tRG" x="-4%" y="-4%" width="108%" height="116%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="tC" cx="50%" cy="50%" r="45%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)" /><stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <ellipse cx="420" cy="235" rx="430" ry="245" fill="url(#tG)" />
      <ellipse cx="424" cy="248" rx="390" ry="210" fill="black" opacity="0.75" filter="url(#tS)" />
      <ellipse cx="420" cy="228" rx="388" ry="208" fill="url(#tR)" filter="url(#tRG)" />
      <ellipse cx="420" cy="220" rx="384" ry="203" fill="none" stroke="rgba(255,245,160,0.22)" strokeWidth="2" />
      <ellipse cx="420" cy="228" rx="370" ry="190" fill="url(#tW)" />
      <ellipse cx="420" cy="228" rx="352" ry="172" fill="url(#tF)" />
      <ellipse cx="420" cy="228" rx="350" ry="170" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1.5" />
      <ellipse cx="420" cy="228" rx="308" ry="134" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1.2" strokeDasharray="12 9" />
      <ellipse cx="420" cy="228" rx="200" ry="95" fill="url(#tC)" />
      <g opacity="0.06" transform="translate(420,228)">
        <polygon points="0,-46 31,0 0,46 -31,0" fill="white" />
        <circle cx="0" cy="0" r="12" fill="none" stroke="white" strokeWidth="1.2" />
        <text x="0" y="5" textAnchor="middle" fontSize="12" fill="white" fontFamily="serif">♠</text>
      </g>
      {variant !== 'default' && (
        <text x="420" y="300" textAnchor="middle" fontSize="20" letterSpacing="9" fontWeight="bold"
          fill={variant === 'scenario' ? '#f0c060' : '#b9a6ff'} opacity="0.16" fontFamily="sans-serif">
          {variant === 'scenario' ? 'SETUP POSITION' : 'SIMULATION'}
        </text>
      )}
    </svg>
  )
}
export function Room({ variant = 'default' }: { variant?: RoomVariant }) {
  if (variant === 'scenario') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 95% at 50% 26%, #2a1018 0%, #1a0a10 50%, #0a0406 100%)' }} />
        <div className="absolute inset-x-0 top-0" style={{ height: '82%', background: 'radial-gradient(ellipse 70% 60% at 50% -6%, rgba(240,180,80,0.30) 0%, rgba(180,90,40,0.14) 42%, transparent 72%)' }} />
        <div className="absolute inset-x-0 bottom-0" style={{ height: '70%', background: 'radial-gradient(ellipse 62% 56% at 50% 84%, rgba(200,70,90,0.16) 0%, transparent 64%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(125% 105% at 50% 46%, transparent 54%, rgba(0,0,0,0.58) 100%)' }} />
        <div className="absolute inset-x-0 top-0" style={{ height: '24%', background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)' }} />
        <div className="absolute inset-x-0 bottom-0" style={{ height: '20%', background: 'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, transparent 100%)' }} />
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ background: 'rgba(255,220,150,0.95)', boxShadow: '0 0 22px 11px rgba(230,170,70,0.45), 0 0 72px 34px rgba(200,110,40,0.25)' }} />
      </div>
    )
  }
  if (variant === 'sim') {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 95% at 50% 26%, #1a1840 0%, #0e0c26 50%, #060512 100%)' }} />
        <div className="absolute inset-x-0 top-0" style={{ height: '82%', background: 'radial-gradient(ellipse 70% 60% at 50% -6%, rgba(150,120,255,0.30) 0%, rgba(90,70,200,0.12) 42%, transparent 72%)' }} />
        <div className="absolute inset-0" style={{ opacity: 0.16, backgroundImage: 'linear-gradient(rgba(150,170,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(150,170,255,0.5) 1px, transparent 1px)', backgroundSize: '46px 46px' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(125% 105% at 50% 46%, transparent 52%, rgba(0,0,0,0.6) 100%)' }} />
        <div className="absolute inset-x-0 top-0" style={{ height: '24%', background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)' }} />
        <div className="absolute inset-x-0 bottom-0" style={{ height: '20%', background: 'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, transparent 100%)' }} />
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ background: 'rgba(190,170,255,0.95)', boxShadow: '0 0 22px 11px rgba(150,120,255,0.45), 0 0 72px 34px rgba(110,80,220,0.25)' }} />
      </div>
    )
  }
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 95% at 50% 28%, #0f2230 0%, #0a1622 46%, #050a12 100%)' }} />
      <div className="absolute inset-x-0 top-0" style={{ height: '82%', background: 'radial-gradient(ellipse 68% 62% at 50% -6%, rgba(214,172,64,0.42) 0%, rgba(150,100,28,0.16) 40%, transparent 72%)' }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: '72%', background: 'radial-gradient(ellipse 62% 56% at 50% 82%, rgba(24,150,170,0.20) 0%, transparent 64%)' }} />
      <div className="absolute top-0 bottom-0 left-0" style={{ width: '30%', background: 'radial-gradient(ellipse at 0% 45%, rgba(184,124,40,0.16) 0%, transparent 60%)' }} />
      <div className="absolute top-0 bottom-0 right-0" style={{ width: '30%', background: 'radial-gradient(ellipse at 100% 45%, rgba(184,124,40,0.16) 0%, transparent 60%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(125% 105% at 50% 46%, transparent 54%, rgba(0,0,0,0.55) 100%)' }} />
      <div className="absolute inset-x-0 top-0" style={{ height: '26%', background: 'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, transparent 100%)' }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: '20%', background: 'linear-gradient(0deg, rgba(0,0,0,0.80) 0%, transparent 100%)' }} />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ background: 'rgba(255,236,152,0.95)', boxShadow: '0 0 22px 11px rgba(222,182,62,0.5), 0 0 72px 34px rgba(180,120,30,0.28)' }} />
      <div className="absolute top-[30%] left-12 w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(120,214,232,0.7)', boxShadow: '0 0 14px 7px rgba(40,168,196,0.35)' }} />
      <div className="absolute top-[30%] right-12 w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(120,214,232,0.7)', boxShadow: '0 0 14px 7px rgba(40,168,196,0.35)' }} />
    </div>
  )
}
