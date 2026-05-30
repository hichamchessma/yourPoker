// ─────────────────────────────────────────────────────────────────────────────
// Parametric flat-style player avatars (SVG). A catalog of varied men/women
// across poker archetypes (fish / recreational / TAG / aggro / GTO). Avatars are
// picked deterministically per seat so each player keeps a stable face.
// ─────────────────────────────────────────────────────────────────────────────

type Hair =
  | 'short' | 'buzz' | 'side' | 'curly' | 'bald' | 'mohawk'
  | 'long' | 'bun' | 'ponytail' | 'bob'
type Accessory = 'none' | 'sunglasses' | 'cap' | 'headphones' | 'visor'

export interface AvatarSpec {
  skin: string
  hair: string
  hairStyle: Hair
  female: boolean
  outfit: string          // jacket / top main color
  outfitDark: string      // shading
  shirt: string           // inner shirt / skin V
  accessory: Accessory
  beard: boolean
  bg: [string, string]
}

const SKIN = ['#f3c9a6', '#e8b48c', '#d49a6a', '#b87a4e', '#8d5524', '#f7d7be']

// ── Archetype pools ──────────────────────────────────────────────────────────
const FISH: AvatarSpec[] = [
  { skin: SKIN[0], hair: '#5b3a1e', hairStyle: 'short',  female: false, outfit: '#3a7d44', outfitDark: '#255030', shirt: '#dfe7e3', accessory: 'cap',     beard: false, bg: ['#13433f', '#0a2522'] },
  { skin: SKIN[3], hair: '#1b1b1b', hairStyle: 'curly',  female: false, outfit: '#7a5230', outfitDark: '#4d3219', shirt: '#e9d9c4', accessory: 'none',    beard: true,  bg: ['#2a3a13', '#16220a'] },
  { skin: SKIN[5], hair: '#9a6b3f', hairStyle: 'ponytail',female: true,  outfit: '#cf5a8a', outfitDark: '#8a3358', shirt: '#f6d7e3', accessory: 'none',    beard: false, bg: ['#3a1430', '#220a1c'] },
]
const REG: AvatarSpec[] = [
  { skin: SKIN[1], hair: '#2e2a26', hairStyle: 'side',   female: false, outfit: '#2f5d8a', outfitDark: '#1d3a57', shirt: '#e7eef5', accessory: 'none',    beard: false, bg: ['#16304a', '#0a1a2a'] },
  { skin: SKIN[4], hair: '#0f0f0f', hairStyle: 'buzz',   female: false, outfit: '#3b3f46', outfitDark: '#23262b', shirt: '#d7dde3', accessory: 'none',    beard: true,  bg: ['#1c2230', '#0d1018'] },
  { skin: SKIN[0], hair: '#caa14e', hairStyle: 'bob',    female: true,  outfit: '#4566c0', outfitDark: '#2b4185', shirt: '#e7ecf6', accessory: 'none',    beard: false, bg: ['#1a2a55', '#0c1530'] },
]
const TAG: AvatarSpec[] = [
  { skin: SKIN[2], hair: '#3a2415', hairStyle: 'short',  female: false, outfit: '#264b6b', outfitDark: '#16304a', shirt: '#eef3f8', accessory: 'none',    beard: true,  bg: ['#13314a', '#091a29'] },
  { skin: SKIN[5], hair: '#6b4423', hairStyle: 'long',   female: true,  outfit: '#1f6f6a', outfitDark: '#114440', shirt: '#e6f1ef', accessory: 'none',    beard: false, bg: ['#0f3d39', '#072421'] },
  { skin: SKIN[1], hair: '#1b1b1b', hairStyle: 'side',   female: false, outfit: '#5a3f86', outfitDark: '#382659', shirt: '#ece6f5', accessory: 'headphones', beard: false, bg: ['#291a44', '#150c26'] },
]
const AGGRO: AvatarSpec[] = [
  { skin: SKIN[3], hair: '#101010', hairStyle: 'mohawk', female: false, outfit: '#7a1f24', outfitDark: '#4d1316', shirt: '#e9c9cb', accessory: 'sunglasses', beard: true,  bg: ['#3a1216', '#1f0a0c'] },
  { skin: SKIN[0], hair: '#b03030', hairStyle: 'ponytail', female: true,  outfit: '#b02a3a', outfitDark: '#701822', shirt: '#f3d3d8', accessory: 'sunglasses', beard: false, bg: ['#3a1018', '#200a0e'] },
  { skin: SKIN[4], hair: '#0a0a0a', hairStyle: 'buzz',   female: false, outfit: '#1f1f24', outfitDark: '#101013', shirt: '#cfd3d8', accessory: 'cap',     beard: true,  bg: ['#241016', '#12080b'] },
]
const GTO: AvatarSpec[] = [
  { skin: SKIN[1], hair: '#222', hairStyle: 'side',      female: false, outfit: '#16181d', outfitDark: '#0a0b0e', shirt: '#dfe4ea', accessory: 'sunglasses', beard: false, bg: ['#1a1c22', '#0a0b0e'] },
  { skin: SKIN[5], hair: '#1a1a1a', hairStyle: 'bun',    female: true,  outfit: '#23252b', outfitDark: '#121317', shirt: '#e4e8ee', accessory: 'sunglasses', beard: false, bg: ['#20222a', '#0c0d11'] },
  { skin: SKIN[2], hair: '#0d0d0d', hairStyle: 'bald',   female: false, outfit: '#1c2733', outfitDark: '#0e1620', shirt: '#dce3ea', accessory: 'visor',   beard: true,  bg: ['#16222e', '#0a1119'] },
]

const HERO_SPEC: AvatarSpec = {
  skin: SKIN[1], hair: '#141414', hairStyle: 'short', female: false,
  outfit: '#0e3a4a', outfitDark: '#072530', shirt: '#bfeefb',
  accessory: 'sunglasses', beard: true, bg: ['#06343f', '#04181f'],
}

const POOLS: Record<number, AvatarSpec[]> = { 1: FISH, 2: REG, 3: TAG, 4: AGGRO, 5: GTO }

/** Deterministic pick: stable per (level, seed). */
export function avatarForSeat(level: number, seed: number, isHero = false): AvatarSpec {
  if (isHero) return HERO_SPEC
  const pool = POOLS[level] ?? REG
  return pool[((seed % pool.length) + pool.length) % pool.length]
}

// ── Hair shapes ────────────────────────────────────────────────────────────
function Hair({ style, color }: { style: Hair; color: string }) {
  const dark = 'rgba(0,0,0,0.25)'
  switch (style) {
    case 'bald':
      return null
    case 'buzz':
      return <path d="M30 40 C30 22 70 22 70 40 C70 33 64 28 50 28 C36 28 30 33 30 40 Z" fill={color} opacity={0.92} />
    case 'short':
      return <g fill={color}><path d="M28 42 C26 20 74 20 72 42 C72 30 64 24 50 24 C36 24 28 30 28 42 Z" /><path d="M28 42 C28 34 32 30 32 30 L32 40 Z" fill={dark} /></g>
    case 'side':
      return <g fill={color}><path d="M28 42 C27 20 75 19 73 41 C70 29 60 25 44 26 C36 26 30 31 28 42 Z" /><path d="M70 28 C74 32 73 40 72 43 L66 33 Z" /></g>
    case 'curly':
      return <g fill={color}><circle cx="36" cy="30" r="9"/><circle cx="50" cy="25" r="10"/><circle cx="64" cy="30" r="9"/><circle cx="30" cy="38" r="7"/><circle cx="70" cy="38" r="7"/></g>
    case 'mohawk':
      return <g fill={color}><path d="M45 16 L55 16 L57 40 L43 40 Z"/><path d="M30 40 C32 36 38 36 40 40 Z" opacity={0.8}/><path d="M60 40 C62 36 68 36 70 40 Z" opacity={0.8}/></g>
    case 'long':
      return <g fill={color}><path d="M26 66 C22 38 30 18 50 18 C70 18 78 38 74 66 L66 66 C70 44 66 28 50 28 C34 28 30 44 34 66 Z"/><path d="M28 40 C28 24 72 24 72 40 C72 30 64 25 50 25 C36 25 28 30 28 40 Z"/></g>
    case 'bob':
      return <g fill={color}><path d="M27 56 C24 32 32 18 50 18 C68 18 76 32 73 56 L64 56 C68 38 64 27 50 27 C36 27 32 38 36 56 Z"/><path d="M28 40 C28 24 72 24 72 40 C72 30 64 25 50 25 C36 25 28 30 28 40 Z"/></g>
    case 'ponytail':
      return <g fill={color}><path d="M70 30 C82 34 82 54 74 60 C78 50 74 40 68 38 Z"/><path d="M28 42 C27 20 75 20 73 42 C70 30 62 25 50 25 C36 25 29 31 28 42 Z"/></g>
    case 'bun':
      return <g fill={color}><circle cx="50" cy="16" r="7"/><path d="M28 42 C27 22 73 22 72 42 C70 30 62 25 50 25 C38 25 30 30 28 42 Z"/></g>
    default:
      return <path d="M28 42 C26 20 74 20 72 42 C72 30 64 24 50 24 C36 24 28 30 28 42 Z" fill={color} />
  }
}

function Accessory({ kind, hair }: { kind: Accessory; hair: string }) {
  switch (kind) {
    case 'sunglasses':
      return (
        <g>
          <rect x="33" y="42" width="14" height="9" rx="3" fill="#0c0f14" />
          <rect x="53" y="42" width="14" height="9" rx="3" fill="#0c0f14" />
          <rect x="46" y="45" width="8" height="2.5" rx="1" fill="#0c0f14" />
          <rect x="34.5" y="43.5" width="5" height="2" rx="1" fill="#3a4a5a" opacity={0.8} />
          <rect x="54.5" y="43.5" width="5" height="2" rx="1" fill="#3a4a5a" opacity={0.8} />
        </g>
      )
    case 'cap':
      return (
        <g>
          <path d="M27 40 C27 22 73 22 73 40 C73 33 64 28 50 28 C36 28 27 33 27 40 Z" fill={hair} opacity={0} />
          <path d="M26 41 C26 24 74 24 74 41 L26 41 Z" fill="#1f2a37" />
          <path d="M22 41 C30 41 34 41 50 41 L50 46 C30 46 24 44 22 41 Z" fill="#16202b" />
          <rect x="46" y="24" width="8" height="6" rx="2" fill="#2a3744" />
        </g>
      )
    case 'visor':
      return (
        <g>
          <path d="M30 38 C30 30 70 30 70 38 L70 41 L30 41 Z" fill="#10161d" />
          <path d="M24 41 C34 41 40 41 50 41 L50 45 C34 45 28 44 24 41 Z" fill="#0b1016" />
        </g>
      )
    case 'headphones':
      return (
        <g fill="none">
          <path d="M28 44 C28 22 72 22 72 44" stroke="#1f2a37" strokeWidth="4" />
          <rect x="24" y="42" width="8" height="13" rx="3" fill="#2a3744" />
          <rect x="68" y="42" width="8" height="13" rx="3" fill="#2a3744" />
        </g>
      )
    default:
      return null
  }
}

export default function PlayerAvatar({ spec, size = 48 }: { spec: AvatarSpec; size?: number }) {
  const id = Math.round((spec.bg[0].charCodeAt(1) + size) * 1000 + spec.skin.charCodeAt(1))
  const longHairBack = spec.hairStyle === 'long' || spec.hairStyle === 'bob' || spec.hairStyle === 'ponytail'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', borderRadius: '50%' }}>
      <defs>
        <radialGradient id={`bg${id}`} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor={spec.bg[0]} />
          <stop offset="100%" stopColor={spec.bg[1]} />
        </radialGradient>
        <clipPath id={`clip${id}`}><circle cx="50" cy="50" r="50" /></clipPath>
      </defs>

      <g clipPath={`url(#clip${id})`}>
        <rect x="0" y="0" width="100" height="100" fill={`url(#bg${id})`} />

        {/* Hair behind the head (long styles) */}
        {longHairBack && <Hair style={spec.hairStyle} color={spec.hair} />}

        {/* Shoulders / outfit */}
        <path d="M16 100 C16 80 30 70 50 70 C70 70 84 80 84 100 Z" fill={spec.outfit} />
        <path d="M16 100 C16 84 26 74 38 71 L40 100 Z" fill={spec.outfitDark} opacity={0.55} />
        <path d="M84 100 C84 84 74 74 62 71 L60 100 Z" fill={spec.outfitDark} opacity={0.55} />
        {/* Shirt / neckline */}
        {spec.female
          ? <path d="M42 71 L50 86 L58 71 C56 70 44 70 42 71 Z" fill={spec.shirt} />
          : <g><path d="M42 71 L50 92 L58 71 Z" fill={spec.shirt} /><path d="M47 71 L50 82 L53 71 Z" fill={spec.outfitDark} /></g>}

        {/* Neck */}
        <path d="M43 62 L43 72 C43 76 57 76 57 72 L57 62 Z" fill={spec.skin} />
        <path d="M43 66 C46 70 54 70 57 66 L57 62 L43 62 Z" fill="rgba(0,0,0,0.12)" />

        {/* Ears */}
        <circle cx="30" cy="46" r="4.5" fill={spec.skin} />
        <circle cx="70" cy="46" r="4.5" fill={spec.skin} />
        {spec.female && <><circle cx="30" cy="51" r="1.6" fill="#e7c25a" /><circle cx="70" cy="51" r="1.6" fill="#e7c25a" /></>}

        {/* Head */}
        <ellipse cx="50" cy="44" rx="20" ry="23" fill={spec.skin} />
        {/* soft cheek shading */}
        <ellipse cx="50" cy="50" rx="20" ry="17" fill="rgba(0,0,0,0.06)" />

        {/* Beard / stubble */}
        {spec.beard && !spec.female && (
          <path d="M32 46 C32 64 40 70 50 70 C60 70 68 64 68 46 C66 58 60 62 50 62 C40 62 34 58 32 46 Z"
            fill="#000" opacity={0.22} />
        )}

        {/* Eyebrows */}
        <g fill="#000" opacity={spec.accessory === 'sunglasses' ? 0 : 0.5}>
          <rect x="36" y="38" width="10" height="2.4" rx="1.2" />
          <rect x="54" y="38" width="10" height="2.4" rx="1.2" />
        </g>

        {/* Eyes (hidden behind sunglasses) */}
        {spec.accessory !== 'sunglasses' && (
          <g>
            <ellipse cx="41" cy="44" rx="3.4" ry="2.4" fill="#fff" />
            <ellipse cx="59" cy="44" rx="3.4" ry="2.4" fill="#fff" />
            <circle cx="41.4" cy="44" r="1.5" fill="#2a2118" />
            <circle cx="59.4" cy="44" r="1.5" fill="#2a2118" />
          </g>
        )}

        {/* Nose */}
        <path d="M50 46 L47 53 C48 54.5 52 54.5 53 53 Z" fill="rgba(0,0,0,0.12)" />

        {/* Mouth */}
        {spec.female
          ? <path d="M44 58 C47 61 53 61 56 58" stroke="#b15566" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          : <path d="M44 58 C47 60.5 53 60.5 56 58" stroke="rgba(0,0,0,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />}

        {/* Hair in front + accessory */}
        {!longHairBack && <Hair style={spec.hairStyle} color={spec.hair} />}
        <Accessory kind={spec.accessory} hair={spec.hair} />

        {/* Glossy top light */}
        <ellipse cx="40" cy="24" rx="26" ry="14" fill="white" opacity={0.05} />
      </g>
      {/* Rim */}
      <circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
    </svg>
  )
}
