// ─── Coach regression bench ────────────────────────────────────────────────
// A self-contained invariant suite for the coach (sizing + made-hand decisions +
// preflop ranges). Run it after EVERY change to the advisor to catch regressions:
//
//   npx esbuild tools/coach-bench.ts --bundle --format=esm --outfile=_b.mjs \
//     --log-level=error && node _b.mjs && rm _b.mjs
//
// Assertions use clear-cut hands (not razor-edge equities) so Monte-Carlo noise can't
// flake them. A failing line prints "❌ <reason>". Green = no behavioural regression.
import { getPostflopAdvice, buildEquityReasoning } from '../src/renderer/src/lib/postflopAdvisor'
import { buildRangeMap } from '../src/renderer/src/lib/preflopRanges'
import { applyAction, initRange } from '../src/renderer/src/lib/rangeEstimator'

const C = (r: string, s: string) => ({ rank: r, suit: s })
const H = (s: string) => { const x = s.replace(/\s/g, ''); return [C(x[0], x[1]), C(x[2], x[3])] as any }
const BD = (s: string) => s.split(' ').map(x => C(x[0], x[1])) as any
function A(hole: any, board: any, o: any = {}) {
  return getPostflopAdvice({ hole, board, pot: 1000, toCall: o.toCall ?? 0, heroStack: 9000, effStack: o.eff ?? 9000,
    opponents: o.opp ?? 1, inPosition: o.ip ?? true, aggression: o.aggr ?? (o.toCall ? 0.5 : 0), barrels: o.toCall ? 1 : 0, bb: 50 } as any)
}
const fail: string[] = []; let n = 0
const t = (cond: boolean, msg: string) => { n++; if (!cond) fail.push(msg) }
const bf = (a: any) => a.betFrac ?? 0

// ════ A. SIZING (strong value = set) by texture × street ════
console.log('A. SIZING set par texture:')
const TEX: [string, string, string][] = [
  ['sec-haut', '6s6d', 'Ad Kc 6h'], ['sec-bas', '4s4d', '7d 4c 2h'],
  ['dynam(2t)', '8c8h', 'Ks 8s 3d'], ['connect', 'TsTc', 'Td 9c 8h'], ['mono', '9s9d', 'Ah 9h 4h'],
]
for (const [k, h, b] of TEX) { const a = A(H(h), BD(b)); console.log(`   ${k.padEnd(10)} flop ${a.action} ${bf(a).toFixed(2)}`) }
t(bf(A(H('6s6d'), BD('Ad Kc 6h'))) >= 1, 'set sec-haut HU → overbet (>1)')
t(bf(A(H('8c8h'), BD('Ks 8s 3d'))) >= 1, 'set dynamique-haut HU → overbet')
t(bf(A(H('9s9d'), BD('Ah 9h 4h'))) <= 0.45, 'set monotone → petit (≤0.45)')
t(bf(A(H('TsTc'), BD('Td 9c 8h'))) <= 0.6, 'set connecté → size down (≤0.6)')
t(bf(A(H('4s4d'), BD('7d 4c 2h'))) < 1, 'set sec-BAS → pas overbet (rien à charger)')
t(bf(A(H('6s6d'), BD('Ad Kc 6h'), { opp: 3 })) < 1, 'set multiway → JAMAIS overbet')
// monotone reste petit sur toutes les rues ; top paire ne sur-size pas à la river
t(bf(A(H('9s9d'), BD('Ah 9h 4h 2c 3s'))) <= 0.45, 'set monotone river → petit')
t(bf(A(H('AsKd'), BD('Kc 7h 2d 3s 9c'))) < 0.85, 'top paire river → pas un gros polar bet')

// ════ B. DÉCISIONS checké-à-nous ════
console.log('B. Décisions checké-à-nous:')
t(A(H('7s2d'), BD('Ad Kc 6h')).action !== 'BET', 'air (72) ne value-bet pas')
t(A(H('AsKd'), BD('Ad Kc 6h')).action === 'BET', 'top paire AK value-bet')
t(bf(A(H('6s6d'), BD('Ad Kc 6h'))) >= 1, 'set value-bet (overbet)')
t(A(H('AhKh'), BD('Qh 7h 2h')).action === 'BET', 'flush (on a monotone board) value-bet, pas check')

// ════ C. FACE À UNE MISE ════
console.log('C. Face à une mise (board sec A-9-4):')
t(A(H('7s2d'), BD('Ah 9c 4d'), { toCall: 1000 }).action === 'FOLD', 'air fold vs pot bet')
t(['CALL', 'RAISE'].includes(A(H('9s9d'), BD('Ah 9c 4d'), { toCall: 1000 }).action), 'set continue vs pot')
t(A(H('AdKc'), BD('Ah 9c 4d'), { toCall: 300 }).action !== 'FOLD', 'top paire ne fold pas un petit bet')
t(A(H('2s3s'), BD('Ah 9c 4d'), { toCall: 1000 }).action === 'FOLD', 'air bas fold vs pot')

// ════ D. PRÉFLOP RFI (largeur croissante) ════
console.log('D. Préflop RFI:')
function openPct(pos: string, behind: number) {
  const m = buildRangeMap('rfi', pos, behind, { effBB: 100 }); const R = '23456789TJQKA'; let raise = 0, tot = 0
  for (let hi = 12; hi >= 0; hi--) for (let lo = hi; lo >= 0; lo--) {
    if (hi === lo) { tot += 6; if (m.get(R[hi] + R[hi]) === 'raise') raise += 6 }
    else { tot += 4; if (m.get(R[hi] + R[lo] + 's') === 'raise') raise += 4; tot += 12; if (m.get(R[hi] + R[lo] + 'o') === 'raise') raise += 12 }
  }
  return Math.round(100 * raise / tot)
}
const utg = openPct('UTG', 8), co = openPct('CO', 3), btn = openPct('BTN', 2)
console.log(`   UTG ${utg}%  CO ${co}%  BTN ${btn}%`)
t(utg < co && co < btn, 'RFI croît UTG < CO < BTN')
t(utg >= 11 && utg <= 20, `UTG ${utg}% dans 11-20`)
t(btn >= 38 && btn <= 55, `BTN ${btn}% dans 38-55`)
const rUTG = buildRangeMap('rfi', 'UTG', 8, { effBB: 100 })
t(rUTG.get('AA') === 'raise', 'AA open UTG'); t(rUTG.get('72o') === 'fold', '72o fold UTG'); t(rUTG.get('72s') === 'fold', '72s fold UTG (100bb)')

// ════ E. vs OPEN / 3BET ════
console.log('E. vs open / squeeze:')
const vo = buildRangeMap('vsopen', 'CO', undefined, { effBB: 100, raiseToBB: 2.5, vsOpenerPos: 'MP' })
t(['3bet', 'raise'].includes(vo.get('AA') as string), 'AA 3bet vs open'); t(vo.get('72o') === 'fold', '72o fold vs open')
// squeeze re-jam tightens with cold-callers: A9s folds vs open+2 callers (10bb), jams vs +1
const sq2 = buildRangeMap('squeeze', 'BTN', 2, { effBB: 10, multiway: true, numCallers: 2, raiseToBB: 4 })
const sq1 = buildRangeMap('squeeze', 'BTN', 2, { effBB: 10, multiway: true, numCallers: 1, raiseToBB: 4 })
t(sq2.get('A9s') === 'fold', 'A9s fold le squeeze vs open+2 callers (10bb)')
t(sq1.get('A9s') === 'raise', 'A9s jam le squeeze vs open+1 caller (10bb)')

// ════ F. JAMS short-stack ════
console.log('F. Jams short-stack RFI UTG+1:')
t(buildRangeMap('rfi', 'UTG+1', 6, { effBB: 10 }).get('72s') === 'fold', '72s fold à 10bb')
t(buildRangeMap('rfi', 'UTG+1', 6, { effBB: 1 }).get('72s') === 'raise', '72s jam à 1bb (any two)')
t(buildRangeMap('rfi', 'UTG+1', 6, { effBB: 10 }).get('AA') === 'raise', 'AA jam/open à 10bb')

// ════ G. LECTURE des sizings (estimateur : gros = polarisé, petit = mergé) ════
console.log('G. Lecture des sizings:')
{
  const bd = BD('Kc 8h 3d')
  const base: any = { preflop: false, board: bd, toCall: 0, potOdds: 0, posBonus: 0.85, tier: 2, human: false, mood: 0, priorRaises: 0 }
  const r0 = initRange(bd)
  const small = applyAction(r0, 'aggr', { ...base, betFrac: 0.33 }) as any
  const big = applyAction(r0, 'aggr', { ...base, betFrac: 1.5 }) as any
  const sum = (r: any) => Object.values(r).reduce((a: any, b: any) => a + b, 0) as number
  const wt = (r: any, k: string) => (r[k] ?? 0) / sum(r)
  // medium made hand (2nd pair A8s) : kept after a SMALL bet, CUT after a big one
  t(wt(small, 'A8s') > wt(big, 'A8s') * 1.5, 'A8s (2e paire, medium) coupée par le GROS bet (polarise)')
  // strong value (top set KK) : present at BOTH sizes
  t(wt(big, 'KK') >= wt(small, 'KK') * 0.8, 'KK (set) gardé au gros bet (value polaire)')
  console.log(`   A8s: petit ${(wt(small,'A8s')*100).toFixed(2)}% > gros ${(wt(big,'A8s')*100).toFixed(2)}%  ✓ polarise`)
}

// ════ H. EXPLOIT vs loose/station (Lot 4) ════
console.log('H. Exploit vs station (value up):')
{
  const loose = (h: any, b: any) => getPostflopAdvice({ hole: h, board: b, pot: 1000, toCall: 0, heroStack: 9000,
    effStack: 9000, opponents: 1, inPosition: true, aggression: 0, barrels: 0, bb: 50, villainLoose: true } as any)
  const sTP = bf(A(H('AsKd'), BD('Ad Kc 6h'))), lTP = bf(loose(H('AsKd'), BD('Ad Kc 6h')))
  console.log(`   top paire: std ${sTP.toFixed(2)} → station ${lTP.toFixed(2)}`)
  t(lTP > sTP + 0.08, 'value-bet PLUS GROS vs station')
  t(loose(H('AsKd'), BD('Ad Kc 6h')).action === 'BET', 'value garde BET vs station')
  // air still doesn't bet (don't bluff a station) — exploit must not turn checks into bets
  t(loose(H('7s2d'), BD('Ad Kc 6h')).action !== 'BET', 'air ne se met PAS à bluffer vs station')
}

// ════ I. ÉQUITÉ vs COTE — comparaison & cohérence du texte (anti-bug screenshot) ════
console.log('I. Équité vs cote:')
{
  // Un tirage à ~10 outs (gutshot + 2 surcartes) qui A la cote ne doit JAMAIS folder —
  // c'était le bug : classé "air", cushion trop sévère → fold à 35% vs 23%.
  const gut = A(H('KhQd'), BD('Ts 9c 2d'), { toCall: 250, opp: 1 })   // potOdds ≈ 20%
  console.log(`   gutshot+overs: ${gut.action} eq ${Math.round(gut.equity * 100)}% vs cote ${Math.round(gut.potOdds * 100)}% (${gut.outs.length} outs)`)
  t(gut.outs.length >= 8, 'gutshot + 2 surcartes = un vrai tirage (≥8 outs), pas de l’air')
  t(gut.equity >= gut.potOdds, 'ce tirage a la cote brute (eq ≥ potOdds)')
  t(gut.action !== 'FOLD', 'un tirage qui a la cote ne FOLD pas (call ou raise)')
  // De l’air sans équité reste un FOLD face à une grosse mise
  t(A(H('7s2d'), BD('Ah Kc 6d'), { toCall: 700, opp: 2 }).action === 'FOLD', 'air sans équité fold vs grosse mise')
  // buildEquityReasoning : hasOdds == (eq ≥ potOdds), TOUJOURS — la base de tout le texte
  const r1 = buildEquityReasoning({ hole: H('KhQd'), board: BD('Ts 9c 2d'), pot: 1000, toCall: 250, equity: 0.35, decision: 'call' })!
  t(r1.hasOdds === (0.35 >= r1.potOdds) && r1.hasOdds, 'hasOdds = (eq ≥ potOdds) → vrai à 35% vs ~20%')
  const r2 = buildEquityReasoning({ hole: H('Ah2d'), board: BD('Kh Qc 7d'), pot: 1000, toCall: 700, equity: 0.10, decision: 'fold' })!
  t(!r2.hasOdds && r2.verdict === 'fold', 'sous le prix (10% vs 41%) → PAS la cote, verdict fold')
  // FOLD alors qu’on A la cote (réalisation) → hasOdds reste VRAI → le rendu choisit
  // "vFoldRealize" (jamais "je n'ai PAS la cote" en se contredisant).
  const r3 = buildEquityReasoning({ hole: H('KhQd'), board: BD('Ts 9c 2d'), pot: 1000, toCall: 250, equity: 0.35, decision: 'fold' })!
  t(r3.hasOdds && r3.verdict === 'fold', 'fold AVEC la cote → hasOdds reste vrai (texte realize, pas de contradiction)')
}

console.log('\n' + '═'.repeat(52))
console.log(fail.length === 0 ? `✅ ${n} INVARIANTS — TOUS PASSENT` : `⚠️  ${fail.length}/${n} ÉCHEC(S):\n  - ` + fail.join('\n  - '))
if (fail.length) process.exit(1)
