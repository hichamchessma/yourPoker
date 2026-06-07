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

// ── vs-OPEN (facing a single raise) — value 3-bets / 3-bet bluffs (ordered best
//    first) / flat call band, by HERO position and OPENER bucket (early vs late).
//    Fold = everything else. Tune freely; it's data. ───────────────────────────
interface DefEntry { value: string[]; bluff: string[]; call: string[] }
const VS_OPEN: Record<string, { early: DefEntry; late: DefEntry }> = {
  BB: {
    early: { value: ['JJ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'KJs', 'A3s', 'QJs'],
      call: ['22-TT', 'A2s-AJs', 'KTs+', 'QTs+', 'J9s+', 'T9s', '98s', '87s', '76s', 'ATo+', 'KJo+', 'QJo'] },
    late: { value: ['TT+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s'],
      call: ['22-99', 'A2s+', 'K2s+', 'Q6s+', 'J7s+', 'T7s+', '96s+', '86s+', '75s+', '65s', '54s', 'A2o+', 'K9o+', 'Q9o+', 'JTo', 'T9o', '98o'] },
  },
  SB: {
    early: { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'KJs'],
      call: ['99-JJ', 'AJs', 'ATs', 'KQs', 'AQo'] },
    late: { value: ['TT+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'KTs', 'QTs'],
      call: ['66-99', 'ATs+', 'KJs+', 'QJs', 'JTs', 'AQo', 'KQo'] },
  },
  BTN: {
    early: { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s'],
      call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', '76s', 'AQo', 'AJo', 'KQo'] },
    late: { value: ['JJ+', 'AKs', 'AKo', 'AQs', 'AJs'], bluff: ['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', 'T8s', '97s', '86s', '75s'],
      call: ['22-TT', 'A2s+', 'KTs+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s', 'ATo+', 'KJo+', 'QJo'] },
  },
  CO: {
    early: { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'KJs'],
      call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', 'AQo', 'KQo'] },
    late: { value: ['JJ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s'],
      call: ['22-TT', 'A9s+', 'KTs+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', 'ATo+', 'KQo'] },
  },
  DEFAULT: {
    early: { value: ['QQ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'K9s'],
      call: ['22-JJ', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', 'AJo+', 'KQo'] },
    late: { value: ['JJ+', 'AKs', 'AKo', 'AQs'], bluff: ['A5s', 'A4s', 'A3s', 'K9s', 'Q9s'],
      call: ['22-TT', 'A8s+', 'KTs+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s', 'ATo+', 'KQo'] },
  },
}
const LATE_OPENERS = new Set(['CO', 'BTN', 'BTN/SB', 'SB'])
export function vsOpenChart(heroPos: string, openerPos?: string): { value: Set<string>; bluff: string[]; call: Set<string> } {
  const row = VS_OPEN[heroPos] ?? VS_OPEN.DEFAULT
  const e = openerPos && LATE_OPENERS.has(openerPos) ? row.late : row.early
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}

// ── vs-3BET (we opened, face a re-raise) — value 4-bets / 4-bet bluffs / flat
//    call band, by HERO (opener) position. Fold = the rest. ────────────────────
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
export function vs3betChart(heroPos: string): { value: Set<string>; bluff: string[]; call: Set<string> } {
  const e = VS_3BET[heroPos] ?? VS_3BET.DEFAULT
  return { value: expandRange(e.value), bluff: expandOrdered(e.bluff), call: expandRange(e.call) }
}
