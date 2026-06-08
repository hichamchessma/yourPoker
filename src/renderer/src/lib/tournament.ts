// ─────────────────────────────────────────────────────────────────────────────
// Tournament (MTT) maths — blind structures, payout tables, ICM, and the field
// model (how the rest of the field busts while you play your own table). Pure &
// testable; the engine + HUD consume these.
// ─────────────────────────────────────────────────────────────────────────────

export type Speed = 'regular' | 'turbo' | 'hyper'
export interface Level { sb: number; bb: number; ante: number }
export interface PayoutSpot { place: number; amount: number }

// Hands per level — the trainer counts HANDS (no real clock). Faster speed = fewer.
export const HANDS_PER_LEVEL: Record<Speed, number> = { regular: 10, turbo: 6, hyper: 4 }
export const SPEED_LABEL: Record<Speed, string> = { regular: 'Régulier', turbo: 'Turbo', hyper: 'Hyper-Turbo' }

// Generate a smooth, escalating blind ladder. Big-blind ante kicks in at level 3
// (modern format: ante = 1 BB, posted by the big blind). Big blinds grow ~1.4×.
export function blindStructure(_speed: Speed): Level[] {
  const bbs = [100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 5000, 7000, 10000, 15000, 20000, 30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000, 800000]
  return bbs.map((bb, i) => ({ sb: Math.round(bb / 2), bb, ante: i >= 2 ? bb : 0 }))
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

// ── Field model — how many players remain after a given number of hands. The
//    field roughly halves every "few" levels; busts accelerate as blinds rise.
export function fieldRemaining(field: number, handsPlayed: number, handsPerLevel: number): number {
  const level = handsPlayed / handsPerLevel
  // Survival fraction decays; tuned so a big field reaches the final table over a
  // realistic number of levels and never drops below 1.
  const frac = Math.pow(0.78, level * 0.7 + handsPlayed / (field * 0.9 + 20))
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
