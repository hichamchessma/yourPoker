// ─────────────────────────────────────────────────────────────────────────────
// Tournament (MTT) maths — blind structures, payout tables, ICM, and the field
// model (how the rest of the field busts while you play your own table). Pure &
// testable; the engine + HUD consume these.
// ─────────────────────────────────────────────────────────────────────────────

export type Speed = 'regular' | 'turbo' | 'hyper'
export interface Level { sb: number; bb: number; ante: number }
export interface PayoutSpot { place: number; amount: number }

export const SPEED_LABEL: Record<Speed, string> = { regular: 'Régulier', turbo: 'Turbo', hyper: 'Hyper-Turbo' }
// Level duration is a real CLOCK (minutes), chosen by the player.
export const LEVEL_MINUTES_OPTIONS = [2, 3, 5, 10]

// Round a blind up to a "poker-nice" number (50, 75, 100, 125, 150, 200, 250…).
function niceRound(x: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(x)))
  const f = x / mag
  const nice = f < 1.25 ? 1 : f < 1.75 ? 1.5 : f < 2.25 ? 2 : f < 2.75 ? 2.5 : f < 3.5 ? 3 : f < 4.5 ? 4 : f < 5.5 ? 5 : f < 7 ? 6 : f < 9 ? 8 : 10
  return Math.round(nice * mag)
}
// Generate the escalating blind ladder. `speed` sets HOW STEEPLY the blinds climb
// each level (Regular ~1.4×, Turbo ~1.6×, Hyper ~1.85×) — a DIFFERENT axis from the
// level DURATION (the clock). With `antes` on, a big-blind ante (= 1 BB, posted by
// the BB) kicks in at level 3.
export function blindStructure(speed: Speed, antes = true): Level[] {
  const ramp = speed === 'hyper' ? 1.85 : speed === 'turbo' ? 1.6 : 1.4
  const out: Level[] = []
  let bb = 100
  for (let i = 0; i < 26; i++) {
    const v = niceRound(bb)
    out.push({ sb: Math.max(1, Math.round(v / 2)), bb: v, ante: antes && i >= 2 ? v : 0 })
    bb *= ramp
  }
  return out
}

// Places paid = round(field × pct), clamped to [1, field].
export function placesPaid(field: number, paidPct: number): number {
  return Math.max(1, Math.min(field, Math.round(field * paidPct / 100)))
}

// Payout table. Standard / top-heavy / flat curve over `places` spots, summing to
// the prize pool. Uses a geometric decay tuned by the curve shape.
export function payoutTable(prizePool: number, places: number, curve: 'standard' | 'topheavy' | 'flat'): PayoutSpot[] {
  const decay = curve === 'topheavy' ? 0.55 : curve === 'flat' ? 0.86 : 0.72
  const weights: number[] = []
  for (let i = 0; i < places; i++) weights.push(Math.pow(decay, i))
  const sum = weights.reduce((a, b) => a + b, 0)
  // Round to "nice" chip-ish amounts, then fix the remainder onto 1st place.
  const raw = weights.map(w => (w / sum) * prizePool)
  const rounded = raw.map(a => Math.max(1, Math.round(a)))
  const diff = prizePool - rounded.reduce((a, b) => a + b, 0)
  rounded[0] += diff
  return rounded.map((amount, i) => ({ place: i + 1, amount }))
}

// What a given finishing place wins (0 if out of the money).
export function prizeForPlace(place: number, table: PayoutSpot[]): number {
  return table.find(p => p.place === place)?.amount ?? 0
}

// ── ICM (Independent Chip Model) ─────────────────────────────────────────────
// Each player's $EV given chip stacks and remaining payouts (Malmuth-Harville:
// P(i is next to finish 1st) = stack_i / total, then recurse). Exponential, so we
// model only the largest CAP stacks precisely — enough for bubble / final-table.
export function icm(stacks: number[], payouts: number[], cap = 8): number[] {
  const n = stacks.length
  const ev = new Array(n).fill(0)
  if (n === 0 || payouts.length === 0) return ev
  // Reduce to the top `cap` stacks (the ones whose ICM actually moves).
  const order = stacks.map((_, i) => i).sort((a, b) => stacks[b] - stacks[a]).slice(0, cap)

  function rec(idxs: number[], payIdx: number): Record<number, number> {
    const out: Record<number, number> = {}
    const tot = idxs.reduce((s, i) => s + stacks[i], 0)
    const pay = payouts[payIdx] ?? 0
    if (idxs.length === 0 || tot <= 0) return out
    if (idxs.length === 1) { out[idxs[0]] = pay; return out }
    for (const i of idxs) {
      const p = stacks[i] / tot
      out[i] = (out[i] ?? 0) + p * pay
      const sub = rec(idxs.filter(j => j !== i), payIdx + 1)
      for (const k in sub) out[+k] = (out[+k] ?? 0) + p * sub[+k]
    }
    return out
  }
  const res = rec(order, 0)
  for (const k in res) ev[+k] = res[+k]
  return ev
}

// ── Field model — how many players remain at a given level progress (level index
//    + fraction through it). The field shrinks faster as blinds rise; tuned so a
//    typical field reaches the final table over ~15-18 levels.
export function fieldRemaining(field: number, levelFloat: number): number {
  const frac = Math.pow(0.74, levelFloat * 0.55)
  return Math.max(1, Math.round(field * frac))
}

// Rough live rank from your stack vs the average (you're "ahead of" the players
// with smaller stacks). Heuristic — good enough for a HUD estimate.
export function estimateRank(myStack: number, avgStack: number, playersLeft: number): number {
  if (playersLeft <= 1) return 1
  const ratio = myStack / Math.max(1, avgStack)
  // ratio 1 → middle; >1 → better than average → lower (better) rank.
  const pctile = Math.max(0.01, Math.min(0.99, 0.5 / Math.max(0.2, ratio)))
  return Math.max(1, Math.min(playersLeft, Math.round(pctile * playersLeft)))
}
