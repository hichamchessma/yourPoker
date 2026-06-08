// ─────────────────────────────────────────────────────────────────────────────
// Reference preflop charts (100bb cash) — REAL ranges, not a heuristic score.
// Ranges are written in standard Hold'em notation ("77+", "A2s+", "KJo+",
// "A5s-A2s", "T9s"…) and expanded to the 169 hand keys. The coach LOOKS UP these
// charts instead of scoring hands, so the ranges are inspectable & editable.
//
// Indexed by PLAYERS BEHIND (seats still to act after the hero) so a single set
// of ranges adapts to ANY table size: 9-max early position = many behind = tight,
// button = 2 behind = wide, SB blind battle = 1 behind, etc.
// ─────────────────────────────────────────────────────────────────────────────

const RK = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const IDX: Record<string, number> = Object.fromEntries(RK.map((r, i) => [r, i]))

// Expand one token of range notation into concrete 169-hand keys.
function expandToken(tok: string): string[] {
  const t = tok.trim()
  if (!t) return []
  // ── Range "X-Y" (pairs "22-55", or same-high combos "A5s-A2s") ──
  if (t.includes('-')) {
    const [a, b] = t.split('-').map(s => s.trim())
    // pair range
    if (a.length === 2 && a[0] === a[1] && b.length === 2 && b[0] === b[1]) {
      let lo = IDX[a[0]], hi = IDX[b[0]]
      if (lo > hi) [lo, hi] = [hi, lo]            // lo = stronger (smaller idx)
      const out: string[] = []
      for (let i = lo; i <= hi; i++) out.push(RK[i] + RK[i])
      return out
    }
    // suited/offsuit range, same high card: "A5s-A2s"
    const suit = a[2]
    const high = a[0]
    let k1 = IDX[a[1]], k2 = IDX[b[1]]
    if (k1 > k2) [k1, k2] = [k2, k1]
    const out: string[] = []
    for (let k = k1; k <= k2; k++) out.push(high + RK[k] + suit)
    return out
  }
  // ── Pairs ──
  if ((t.length === 2 || t.length === 3) && t[0] === t[1]) {
    if (t.length === 2) return [t]               // "AA"
    // "77+" → 77 up to AA
    const out: string[] = []
    for (let i = IDX[t[0]]; i >= 0; i--) out.push(RK[i] + RK[i])
    return out
  }
  // ── Combos "XYs" / "XYo" (+ optional "+") ──
  const high = t[0], low = t[1], suit = t[2]     // suit = 's' | 'o'
  const plus = t.endsWith('+')
  const xi = IDX[high]
  if (!plus) return [high + low + suit]
  // "+" → fix the high card, run the kicker UP to one below the high card.
  const out: string[] = []
  for (let k = xi + 1; k <= IDX[low]; k++) out.push(high + RK[k] + suit)
  return out
}

export function expandRange(tokens: string[]): Set<string> {
  const s = new Set<string>()
  for (const tok of tokens) for (const h of expandToken(tok)) s.add(h)
  return s
}
// Ordered + de-duped expansion (keeps the written order — used for bluff lists
// where the BEST bluffs come first so callers can keep a fraction of them).
function expandOrdered(tokens: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = []
  for (const tok of tokens) for (const h of expandToken(tok)) if (!seen.has(h)) { seen.add(h); out.push(h) }
  return out
}

// ── RFI (raise-first-in) reference ranges, tightest → widest. Written as full
//    lists (the parser keeps them compact). Roughly the standard 100bb solver
//    open ranges; tune freely — they're just data. ─────────────────────────────
const RFI = {
  // very early (9-max UTG / UTG+1) ~12%
  EP: ['77+', 'A4s+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', 'AJo+', 'KQo'],
  // middle ~18%
  MP: ['55+', 'A2s+', 'KTs+', 'QTs+', 'J9s+', 'T9s', '98s', '87s', '76s', 'ATo+', 'KJo+'],
  // hijack / lojack ~22%
  HJ: ['44+', 'A2s+', 'K9s+', 'Q9s+', 'J9s+', 'T8s+', '97s+', '86s+', '76s', '65s', 'ATo+', 'KJo+', 'QJo'],
  // cutoff ~28%
  CO: ['22+', 'A2s+', 'K7s+', 'Q8s+', 'J8s+', 'T7s+', '96s+', '86s+', '75s+', '65s', '54s', 'A8o+', 'KTo+', 'QTo+', 'JTo'],
  // button ~48%
  BTN: ['22+', 'A2s+', 'K2s+', 'Q4s+', 'J6s+', 'T6s+', '95s+', '85s+', '74s+', '64s+', '53s+', '43s', 'A2o+', 'K8o+', 'Q9o+', 'J9o+', 'T8o+', '98o', '87o', '76o'],
  // small blind (raise-only steal, OOP) ~42%
  SB: ['22+', 'A2s+', 'K5s+', 'Q7s+', 'J7s+', 'T7s+', '96s+', '86s+', '75s+', '64s+', '54s', 'A2o+', 'K9o+', 'Q9o+', 'J9o+', 'T9o'],
  // big blind "option" set (unopened folded to BB — degenerate; a wide playable set)
  BB: ['22+', 'A2s+', 'K2s+', 'Q2s+', 'J4s+', 'T6s+', '95s+', '84s+', '74s+', '63s+', '53s+', '43s', 'A2o+', 'K6o+', 'Q8o+', 'J8o+', 'T8o+', '97o+', '87o', '76o', '65o'],
}

// Map "players behind the hero" → the RFI tier. 1 behind = SB blind battle, 2 =
// button, then it tightens up toward early position as more players are behind.
function rfiTierForBehind(behind: number): string[] {
  if (behind <= 0) return RFI.BB
  if (behind === 1) return RFI.SB
  if (behind === 2) return RFI.BTN
  if (behind === 3) return RFI.CO
  if (behind === 4) return RFI.HJ
  if (behind === 5) return RFI.MP
  return RFI.EP // 6+ behind → earliest positions
}

// Fallback when only a position label is known (no players-behind count).
const POS_TO_BEHIND: Record<string, number> = {
  UTG: 6, 'UTG+1': 6, MP: 5, 'MP+1': 5, HJ: 4, LJ: 4, CO: 3, BTN: 2, 'BTN/SB': 2, SB: 1, BB: 0,
}

// The set of hands the hero opens (RFI) for a given players-behind / position.
export function rfiRange(playersBehind: number | undefined, position: string): Set<string> {
  const behind = playersBehind !== undefined ? playersBehind : (POS_TO_BEHIND[position] ?? 5)
  return expandRange(rfiTierForBehind(behind))
}

export interface ChartRange { value: Set<string>; bluff: string[]; call: Set<string> }
interface DefEntry { value: string[]; bluff: string[]; call: string[] }

// ── PUSH / FOLD (short stacks) — when you're short you SHOVE or fold (no post-
//    flop play). Ranges widen as the stack shortens and toward late position.
//    Buckets by effective BB: very short (≤8), short (≤13), mid (≤17). ──────────
const PUSH = {
  vshort: { // ≤ 8 BB — shove very wide
    early: ['22+', 'A2s+', 'A7o+', 'K8s+', 'KTo+', 'Q9s+', 'QJo', 'J9s+', 'JTo', 'T9s'],
    late: ['22+', 'A2s+', 'A2o+', 'K2s+', 'K6o+', 'Q4s+', 'Q8o+', 'J6s+', 'J8o+', 'T6s+', 'T8o+', '96s+', '98o', '85s+', '75s+', '64s+', '54s', '43s'],
  },
  short: { // ≤ 13 BB
    early: ['44+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QJs'],
    late: ['22+', 'A2s+', 'A7o+', 'K7s+', 'K9o+', 'Q8s+', 'QTo+', 'J8s+', 'JTo', 'T8s+', '97s+', '87s', '76s', '65s'],
  },
}
// Pure shove-or-fold only applies when genuinely short (≤13 BB). Above that you
// can open-raise and play, so the normal charts take over (no tight-push cliff).
export function pushBucket(effBB: number): 'vshort' | 'short' | null {
  if (effBB <= 8) return 'vshort'
  if (effBB <= 13) return 'short'
  return null
}
export function pushFoldRange(effBB: number, playersBehind: number | undefined, position: string): Set<string> {
  const b = pushBucket(effBB)
  if (!b) return new Set()
  const behind = playersBehind !== undefined ? playersBehind : (POS_TO_BEHIND[position] ?? 4)
  return expandRange(behind <= 3 ? PUSH[b].late : PUSH[b].early)
}

// ── vs-OPEN (facing a single raise) — value 3-bets / 3-bet bluffs (ordered best
//    first) / flat band, by HERO position × OPENER bucket. 4 buckets so a UTG open
//    is defended tighter than an HJ open, and a CO open differently from a BTN
//    steal. Missing buckets fall back to the nearest defined one. ───────────────
type Bucket = 'ep' | 'mp' | 'co' | 'btn'
const BUCKET_ORDER: Bucket[] = ['ep', 'mp', 'co', 'btn']
function bucketOf(openerPos?: string): Bucket {
  if (!openerPos) return 'mp'
  if (['UTG', 'UTG+1', 'UTG+2'].includes(openerPos)) return 'ep'
  if (['MP', 'MP+1', 'LJ', 'HJ'].includes(openerPos)) return 'mp'
  if (openerPos === 'CO') return 'co'
  return 'btn' // BTN, BTN/SB, SB steal
}
type Row = Partial<Record<Bucket, DefEntry>>
function pickBucket(row: Row, b: Bucket): DefEntry {
  const i = BUCKET_ORDER.indexOf(b)
  for (let d = 0; d < BUCKET_ORDER.length; d++) {
    const up = BUCKET_ORDER[i + d], dn = BUCKET_ORDER[i - d]
    if (up && row[up]) return row[up]!
    if (dn && row[dn]) return row[dn]!
  }
  return Object.values(row)[0]!
}
const VS_OPEN: Record<string, Row> = {
  BB: {
    ep:  { value: ['JJ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'KJs'],
      call: ['22-TT', 'ATs-AJs', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', 'AJo+', 'KQo'] },
    mp:  { value: ['TT+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'KJs', 'QJs'],
      call: ['22-99', 'A9s-AJs', 'KTs+', 'QTs+', 'J9s+', 'T9s', '98s', '87s', '76s', 'ATo+', 'KJo+', 'QJo'] },
    co:  { value: ['TT+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s', 'J9s'],
      call: ['22-99', 'A2s+', 'KTs+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s', 'A9o+', 'KTo+', 'QTo+', 'JTo'] },
    btn: { value: ['TT+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s-A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s'],
      call: ['22-99', 'A2s+', 'K2s+', 'Q6s+', 'J7s+', 'T7s+', '96s+', '86s+', '75s+', '65s', '54s', 'A2o+', 'K9o+', 'Q9o+', 'JTo', 'T9o', '98o'] },
  },
  SB: {
    mp:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'KJs'], call: ['99-JJ', 'AJs', 'ATs', 'KQs', 'AQo'] },
    co:  { value: ['TT+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'KJs'], call: ['88-JJ', 'ATs+', 'KJs+', 'QJs', 'AQo', 'KQo'] },
    btn: { value: ['TT+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s-A2s', 'K9s', 'KTs', 'QTs'], call: ['66-TT', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'AQo', 'KQo', 'AJo'] },
  },
  BTN: {
    ep:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s'],
      call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', '76s', 'AQo', 'AJo', 'KQo'] },
    mp:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s', 'J9s'],
      call: ['22-JJ', 'A9s+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', '76s', '65s', 'AJo+', 'KQo'] },
    co:  { value: ['JJ+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s-A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s'],
      call: ['22-TT', 'A2s+', 'KTs+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s', '54s', 'ATo+', 'KJo+', 'QJo'] },
  },
  CO: {
    ep:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'KJs'], call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', 'AQo', 'KQo'] },
    mp:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s'], call: ['22-JJ', 'A9s+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', 'ATo+', 'KQo'] },
  },
  HJ: {
    ep:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s'], call: ['22-JJ', 'ATs+', 'KJs+', 'QJs', 'JTs', 'T9s', 'AJo+', 'KQo'] },
    mp:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'K9s'], call: ['22-JJ', 'A9s+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', 'ATo+', 'KQo'] },
  },
  MP: {
    ep:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s'], call: ['22-JJ', 'ATs+', 'KJs+', 'QJs', 'JTs', 'AJo+', 'KQo'] },
  },
  DEFAULT: {
    mp:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'K9s'], call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', 'AJo+', 'KQo'] },
  },
}
export function vsOpenChart(heroPos: string, openerPos?: string): ChartRange {
  const row = VS_OPEN[heroPos] ?? VS_OPEN.DEFAULT
  const e = pickBucket(row, bucketOf(openerPos))
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}

// ── ISO-RAISE (limpers in front, no raise) — punish limpers with a value-raise
//    range (no light bluffs; raise-or-fold). Wider in late position. ────────────
const ISO_EARLY = ['77+', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'AJo+', 'KQo']
const ISO_LATE = ['44+', 'A9s+', 'KTs+', 'QTs+', 'J9s+', 'T9s', '98s', 'ATo+', 'KJo+', 'QJo']
export function isoRange(playersBehind: number | undefined, position: string): Set<string> {
  const behind = playersBehind !== undefined ? playersBehind : (POS_TO_BEHIND[position] ?? 4)
  return expandRange(behind <= 2 ? ISO_LATE : ISO_EARLY) // 0-2 behind = late = wider
}

// ── SQUEEZE (raise + at least one caller, hero behind) — polarized & MULTIWAY, so
//    mostly 3-bet-or-fold: value + blocker bluffs, very small flat band. ─────────
const SQUEEZE: Record<string, DefEntry> = {
  BTN: { value: ['JJ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'KJs', 'QJs'], call: ['99-TT', 'AQs', 'AJs', 'KQs', 'ATs'] },
  CO:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'KJs'], call: ['TT-JJ', 'AQs', 'AJs'] },
  SB:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['JJ', 'AQs'] },
  BB:  { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s'], call: ['TT-JJ', 'AQs', 'AJs'] },
  DEFAULT: { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['JJ', 'AQs'] },
}
export function squeezeChart(heroPos: string): ChartRange {
  const e = SQUEEZE[heroPos] ?? SQUEEZE.DEFAULT
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}

// ── vs-3BET (we opened, face a re-raise) — value 4-bets / 4-bet bluffs / flat
//    band, by HERO (opener) position. Fold = the rest. ─────────────────────────
const VS_3BET: Record<string, DefEntry> = {
  EP:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['JJ', 'TT', 'AQs', 'AJs', 'KQs'] },
  MP:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['TT-JJ', 'AQs', 'AJs', 'KQs', 'KJs'] },
  HJ:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s', 'A3s'], call: ['99-JJ', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs'] },
  CO:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s', 'A3s'], call: ['88-JJ', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs'] },
  BTN: { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s', 'A3s'], call: ['77-JJ', 'AQs', 'AJs', 'ATs', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', 'AQo'] },
  SB:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['99-JJ', 'AQs', 'AJs', 'KQs', 'KJs'] },
  BB:  { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s', 'A3s'], call: ['88-JJ', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs'] },
  DEFAULT: { value: ['QQ+', 'AKs', 'AKo'], bluff: ['A5s', 'A4s'], call: ['TT-JJ', 'AQs', 'AJs', 'KQs'] },
}
export function vs3betChart(heroPos: string): ChartRange {
  const e = VS_3BET[heroPos] ?? VS_3BET.DEFAULT
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}

// ── vs-4BET (we 3-bet, face a 4-bet) — very tight: jam the nuts, flat the next
//    tier IP, fold the rest. `value` = 5-bet jam, `call` = flat. ────────────────
const VS_4BET: Record<string, DefEntry> = {
  BTN: { value: ['KK+', 'AKs'], bluff: [], call: ['QQ', 'JJ', 'AKo', 'AQs'] },
  CO:  { value: ['KK+', 'AKs'], bluff: [], call: ['QQ', 'AKo'] },
  DEFAULT: { value: ['KK+', 'AKs'], bluff: [], call: ['QQ', 'AKo'] },
}
export function vs4betChart(heroPos: string): ChartRange {
  const e = VS_4BET[heroPos] ?? VS_4BET.DEFAULT
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}
