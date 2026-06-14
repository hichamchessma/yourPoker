// ─────────────────────────────────────────────────────────────────────────────
// Generated player roster for the leaderboard / "lively community" feel. These are
// AI/bot profiles (the same kind of opponents you face in-game), deterministically
// seeded so the ranking is stable across visits. Used for social proof: a populated
// leaderboard, "players online", a recent-wins ticker. No fake real-user claims —
// just a vibrant ranked roster, like any single-player game.
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

const ADJ = ['Sharp', 'Tight', 'Loose', 'Cold', 'Silent', 'Lucky', 'Iron', 'Swift', 'Mad', 'Cool', 'Quiet', 'Royal', 'Shadow', 'Golden', 'Brutal', 'Sly', 'Calm', 'Bold', 'Grim', 'Rapid', 'Stone', 'Vivid', 'Dark', 'Wild', 'Frost', 'Night', 'Prime', 'Zen']
const NOUN = ['Shark', 'Ace', 'Bluff', 'River', 'Chip', 'Nuts', 'Reg', 'Grinder', 'Caller', 'Shover', 'Trap', 'King', 'Joker', 'Raise', 'Stack', 'Fold', 'Pot', 'Donk', 'Flop', 'Turn', 'Dealer', 'Bandit', 'Wizard', 'Phantom', 'Viper', 'Falcon', 'Cobra', 'Tilt']
const HANDLE = ['nitMaster', 'shoveBot', 'TightIsRight', 'r1verRat', 'AllInAndy', 'coldFour', 'gtoWizard', 'limp4life', 'snapcall', 'icmHero', 'value_town', 'bluffCatcher', 'deepStacked', 'minRaiseMax', 'tripBarrel', 'soulRead', 'rundeep', 'flushDraw99', 'pocketRockets', 'rangeMerge', 'sizeQueen', 'donkLead', 'overbetCity', 'thinValue', 'blockerBet', 'checkRaise', 'positionKing', 'spewMaster', 'tagFishHunter', 'levelOneThinker']
const FIRST = ['Tim', 'Sam', 'Rita', 'Mike', 'Shawn', 'Léa', 'Yuki', 'Carlos', 'Nadia', 'Omar', 'Elena', 'Ravi', 'Sofia', 'Hugo', 'Ivan', 'Mei', 'Diego', 'Anya', 'Liam', 'Zoé', 'Kenji', 'Marco', 'Aïcha', 'Noah', ' Feder']
const FLAGS = ['🇫🇷', '🇬🇧', '🇩🇪', '🇪🇸', '🇮🇹', '🇧🇷', '🇨🇦', '🇺🇸', '🇳🇱', '🇸🇪', '🇵🇹', '🇯🇵', '🇲🇦', '🇧🇪', '🇵🇱', '🇦🇷', '🇲🇽', '🇮🇳', '🇰🇷', '🇨🇭', '🇮🇪', '🇦🇺', '🇷🇴', '🇨🇿']

export interface RosterPlayer {
  id: number
  rank: number
  name: string
  flag: string
  rating: number
  tier: string
  tierColor: string
  hands: number
  itm: number      // %
  roi: number      // %
  biggest: number  // $
  online: boolean
}

const TIERS = [
  { name: 'Crusher', color: '#e0457b', min: 2100 },
  { name: 'Requin', color: '#c9a227', min: 1850 },
  { name: 'Grinder', color: '#38bdf8', min: 1550 },
  { name: 'Régulier', color: '#22c55e', min: 1250 },
  { name: 'Amateur', color: '#9aa4b2', min: 0 },
]
function tierFor(rating: number) { return TIERS.find(t => rating >= t.min) ?? TIERS[TIERS.length - 1] }

function nameFor(rng: () => number): string {
  const r = rng()
  if (r < 0.45) return `${ADJ[Math.floor(rng() * ADJ.length)]}${NOUN[Math.floor(rng() * NOUN.length)]}`
  if (r < 0.75) return HANDLE[Math.floor(rng() * HANDLE.length)] + (rng() < 0.5 ? Math.floor(rng() * 900 + 10) : '')
  return `${FIRST[Math.floor(rng() * FIRST.length)].trim()} ${ADJ[Math.floor(rng() * ADJ.length)]}`
}

let cached: RosterPlayer[] | null = null

// A stable roster of ~1200 ranked AI players (seeded → identical each visit).
export function getRoster(): RosterPlayer[] {
  if (cached) return cached
  const rng = mulberry32(0x9E3779B9)
  const N = 1200
  const players: Omit<RosterPlayer, 'rank'>[] = []
  for (let i = 0; i < N; i++) {
    // Rating distribution: a few crushers up top, a fat middle, a tail of amateurs.
    const skew = Math.pow(rng(), 1.7)
    const rating = Math.round(1080 + skew * 1180 + (rng() - 0.5) * 80)
    const t = tierFor(rating)
    const hands = Math.round(800 + Math.pow(rng(), 1.5) * 240000)
    const itm = Math.round(10 + (rating - 1080) / 1300 * 22 + (rng() - 0.5) * 6)
    const roi = Math.round(-12 + (rating - 1080) / 1300 * 90 + (rng() - 0.5) * 30)
    const biggest = Math.round(300 + Math.pow(rng(), 2) * 45000)
    players.push({
      id: i + 1,
      name: nameFor(rng),
      flag: FLAGS[Math.floor(rng() * FLAGS.length)],
      rating,
      tier: t.name,
      tierColor: t.color,
      hands,
      itm: Math.max(6, itm),
      roi,
      biggest,
      online: false,
    })
  }
  players.sort((a, b) => b.rating - a.rating)
  cached = players.map((p, i) => ({ ...p, rank: i + 1 }))
  return cached
}

// "Players online" — feels alive: a daily sine curve (more in the evening) + a small
// deterministic wobble that drifts over minutes. Always > 0.
export function playersOnline(): number {
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60
  // peak ~21h, trough ~5h
  const daily = 0.5 + 0.5 * Math.cos(((h - 21) / 24) * 2 * Math.PI)
  const base = 180 + daily * 940
  const wobble = Math.sin((now.getTime() / 60000) * 1.3) * 18 + Math.sin((now.getTime() / 17000)) * 7
  return Math.max(120, Math.round(base + wobble))
}

// A rolling feed of recent notable wins (generated from the roster).
export interface WinEvent { name: string; flag: string; amount: number; kind: 'tournoi' | 'cash' }
export function recentWins(count = 6): WinEvent[] {
  const roster = getRoster()
  const seed = Math.floor(Date.now() / 8000) // changes every 8s
  const rng = mulberry32(seed)
  const out: WinEvent[] = []
  for (let i = 0; i < count; i++) {
    const p = roster[Math.floor(rng() * Math.min(400, roster.length))]
    const kind: WinEvent['kind'] = rng() < 0.5 ? 'tournoi' : 'cash'
    const amount = kind === 'tournoi' ? Math.round(500 + rng() * 24000) : Math.round(80 + rng() * 1400)
    out.push({ name: p.name, flag: p.flag, amount, kind })
  }
  return out
}

// The hero's position in the roster, by rating (so the leaderboard shows "your rank").
export function heroRank(heroRating: number): { rank: number; total: number } {
  const roster = getRoster()
  const better = roster.filter(p => p.rating > heroRating).length
  return { rank: better + 1, total: roster.length + 1 }
}
