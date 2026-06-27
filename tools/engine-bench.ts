// ─── Game-engine regression bench ──────────────────────────────────────────
// Invariant suite for the LIVE engine core (src/renderer/src/lib/pokerEngine.ts):
// hand evaluation, side pots, and bet/raise resolution incl. the incomplete-raise
// rule. These are the EXACT functions GamePage delegates to, so green here = no
// behavioural regression in the live game. Run after every engine change:
//
//   npx esbuild tools/engine-bench.ts --bundle --format=esm --outfile=_e.mjs \
//     --log-level=error && node _e.mjs && rm _e.mjs
//
import { bestHandScore, evalFive, computeSidePots, resolveAction, isReopened, type BetTable } from '../src/renderer/src/lib/pokerEngine'

const C = (r: string, s: string) => ({ rank: r, suit: s })
const H = (str: string) => str.trim().split(/\s+/).map(x => C(x[0], x[1])) as any   // "Ah Kd Qc" → cards
const fail: string[] = []; let n = 0
const t = (cond: boolean, msg: string) => { n++; if (!cond) fail.push(msg) }
const sc = (str: string) => bestHandScore(H(str)).score
const cat = (str: string) => bestHandScore(H(str)).cat

// ════ A. HAND EVALUATION — category ordering ════
console.log('A. Évaluateur — ordre des catégories:')
const CATS: [string, number, string][] = [
  ['As Ks Qs Js Ts', 8, 'quinte flush'], ['9h 9d 9s 9c 2h', 7, 'carré'],
  ['Kh Kd Ks 4c 4h', 6, 'full'], ['Ah 9h 6h 3h 2h', 5, 'couleur'],
  ['7h 6d 5s 4c 3h', 4, 'quinte'], ['Qh Qd Qs 8c 2h', 3, 'brelan'],
  ['Jh Jd 5s 5c 2h', 2, 'deux paires'], ['Ah Ad 9s 6c 2h', 1, 'paire'],
  ['Ah Kd 9s 6c 2h', 0, 'hauteur'],
]
for (const [hand, expCat, label] of CATS) t(cat(hand) === expCat, `${label} = cat ${expCat} (got ${cat(hand)})`)
// strict monotonic ordering of the example hands
for (let i = 0; i < CATS.length - 1; i++) t(sc(CATS[i][0]) > sc(CATS[i + 1][0]), `${CATS[i][2]} > ${CATS[i + 1][2]}`)

// ════ B. ÉVALUATEUR — départages fins ════
console.log('B. Évaluateur — kickers & cas pièges:')
t(evalFive(H('Ah 5d 4s 3c 2h')) === 4 * 15 ** 5 + 5, 'wheel A-2-3-4-5 = quinte à 5')
t(sc('6h 5d 4s 3c 2h') > sc('Ah 5d 4s 3c 2h'), 'quinte au 6 > wheel (roue = la plus basse)')
t(sc('As Ah Kd Qc Jh') > sc('As Ah Kd Qc Th'), 'paire d’As kicker Q-J > kicker Q-T')
t(sc('Qh Qd Jh Jc 7s') > sc('Qh Qd 5h 5c As'), 'QQJJ7 > QQ55A (2e paire prime sur le kicker)')
t(sc('Kh Kd Ks 2c 2h') > sc('Ah Ad 9s 9c 8h'), 'full (KKK22) > deux paires (AA99)')
t(sc('5h 5d 5s 5c Ah') > sc('Ah Ad As Kc Kh'), 'carré de 5 > full AAA-KK')
t(sc('Ah Ad Ks Qc Jh') === sc('As Ac Kh Qd Jc'), 'mains identiques (couleurs ≠) → égalité parfaite')

// best-of-7 picks the best five
t(bestHandScore(H('Ah Kh Qh Jh Th 2c 3d')).cat === 8, 'best-of-7 trouve la quinte flush')
t(bestHandScore(H('As Ad Ah Kc Kd 2h 7s')).cat === 6, 'best-of-7 trouve le full AAAKK (pas juste le brelan)')

// ════ C. SIDE POTS ════
console.log('C. Side pots:')
const sp = (xs: [number, number, boolean][]) => computeSidePots(xs.map(([idx, totalBet, isFolded]) => ({ idx, totalBet, isFolded })))
{
  // 3 joueurs, mêmes mises → un seul pot, tous éligibles
  const p = sp([[0, 100, false], [1, 100, false], [2, 100, false]])
  t(p.length === 1 && p[0].amount === 300 && p[0].eligible.length === 3, '3× mises égales → 1 pot de 300')
}
{
  // un short all-in (50) + 2 à 200 → pot principal 150 (tous), side 300 (les deux gros)
  const p = sp([[0, 50, false], [1, 200, false], [2, 200, false]])
  t(p.length === 2, 'short all-in → 2 pots')
  t(p[0].amount === 150 && p[0].eligible.length === 3, 'pot principal 150, 3 éligibles')
  t(p[1].amount === 300 && p[1].eligible.join(',') === '1,2', 'side pot 300, éligibles 1 & 2')
}
{
  // un folder a mis 200 puis fold : ses jetons restent (dead money) mais il n’est pas éligible
  const p = sp([[0, 200, true], [1, 200, false], [2, 200, false]])
  t(p.length === 1 && p[0].amount === 600 && !p[0].eligible.includes(0), 'folder = dead money, non éligible, jetons comptés')
}
{
  // deux all-ins de tailles différentes → main + 2 sides ; conservation des jetons
  const contribs: [number, number, boolean][] = [[0, 30, false], [1, 70, false], [2, 120, false], [3, 120, false]]
  const p = sp(contribs)
  const total = p.reduce((a, b) => a + b.amount, 0)
  t(total === 30 + 70 + 120 + 120, 'somme des pots = somme des mises (conservation)')
  t(p.length === 3, 'deux all-ins inégaux → 3 pots')
}

// ════ D. RÉSOLUTION DES MISES + RÈGLE DE RÉOUVERTURE (le fix main #124) ════
console.log('D. Résolution mises + réouverture:')
type S = { bet: number; stack: number; totalBet: number; actedLevel: number; isFolded: boolean; isAllIn: boolean }
const seat = (stack: number, bet = 0): S => ({ bet, stack, totalBet: bet, actedLevel: -1, isFolded: false, isAllIn: false })
// driver: applique une action au siège contre la table partagée (comme executeAction)
function act(seats: S[], table: BetTable, idx: number, action: string, amount = 0) {
  const r = resolveAction(seats[idx], action, amount, table)
  seats[idx] = { ...seats[idx], bet: r.bet, stack: r.stack, totalBet: r.totalBet, actedLevel: r.actedLevel, isFolded: r.isFolded, isAllIn: r.isAllIn }
  table.currentBet = r.currentBet; table.minRaise = r.minRaise; table.raiseLevel = r.raiseLevel
  return r
}

// — Scénario EXACT de la main #124 (bb 1500) : open 9000, call, all-in 9777 (+777 incomplet) —
{
  const bb = 1500
  const table: BetTable = { currentBet: bb, minRaise: bb, raiseLevel: 0 }   // pré-flop : BB déjà posté
  const seats = [seat(36880), seat(60000), seat(9777)]   // 0=héros(UTG) 1=Steve 2=Pat(court)
  act(seats, table, 0, 'RAISE', 9000)                    // héros ouvre à 9000 (relance complète)
  t(table.raiseLevel === 1, 'open = relance complète → raiseLevel 1')
  act(seats, table, 1, 'CALL')                           // Steve suit
  const pat = act(seats, table, 2, 'ALL-IN')             // Pat tapis 9777 (+777)
  t(pat.isAllIn && table.currentBet === 9777, 'Pat tapis → currentBet 9777')
  t(table.raiseLevel === 1, 'tapis incomplet (+777 < min-raise) NE rouvre PAS (raiseLevel reste 1)')
  const heroTry = act(seats, table, 0, 'ALL-IN', 36880)  // héros tente de re-tapis
  t(heroTry.action === 'CALL', '✅ re-tapis du héros DÉMOTÉ en CALL (relance bloquée)')
  t(table.currentBet === 9777 && seats[0].bet === 9777, 'héros suit juste à 9777, ne relance pas')
  t(!seats[0].isAllIn, 'héros n’est pas all-in (il lui reste des jetons)')
}
// — Contrôle : une relance COMPLÈTE rouvre bien l’action —
{
  const table: BetTable = { currentBet: 1500, minRaise: 1500, raiseLevel: 0 }
  const seats = [seat(80000), seat(80000), seat(80000)]
  act(seats, table, 0, 'RAISE', 9000)
  act(seats, table, 1, 'CALL')
  act(seats, table, 2, 'RAISE', 20000)                   // relance complète (incrément 11000 ≥ 7500)
  t(table.raiseLevel === 2, 'relance complète → raiseLevel 2')
  const heroReraise = act(seats, table, 0, 'RAISE', 45000)
  t(heroReraise.action === 'RAISE' && table.currentBet === 45000, '✅ re-relance du héros AUTORISÉE après relance complète')
}
// — Un siège FRAIS (actedLevel -1 : début de coup/rue, ex. SB qui n'a que posté la blinde)
//   peut TOUJOURS (re)relancer face à une mise. Garde la régression "bouton RAISE bloqué"
//   où un actedLevel périmé de la main précédente survivait au nouveau coup. —
{
  const table: BetTable = { currentBet: 2000, minRaise: 1500, raiseLevel: 1 }   // une relance complète a eu lieu
  const sb = seat(40000, 250)                                                    // SB, n'a fait que poster (actedLevel -1)
  const r = act([sb], table, 0, 'RAISE', 6000)
  t(isReopened({ currentBet: 2000, minRaise: 1500, raiseLevel: 1 }, { bet: 250, stack: 40000, totalBet: 250, actedLevel: -1 }), 'siège frais : action ré-ouverte')
  t(r.action === 'RAISE' && table.currentBet === 6000, '✅ siège frais peut 3-bet face à une relance (pas de blocage périmé)')
}
// — Check-raise autorisé (postflop) —
{
  const table: BetTable = { currentBet: 0, minRaise: 100, raiseLevel: 0 }
  const seats = [seat(10000), seat(10000)]               // 0 = OOP, 1 = IP
  act(seats, table, 0, 'CHECK')
  act(seats, table, 1, 'BET', 300)
  t(table.raiseLevel === 1, 'open bet postflop → raiseLevel 1')
  const cr = act(seats, table, 0, 'RAISE', 1000)
  t(cr.action === 'RAISE' && table.currentBet === 1000, '✅ check-raise autorisé')
}
// — Clamps : relance sous le minimum remontée ; relance au-dessus du tapis plafonnée —
{
  const table: BetTable = { currentBet: 200, minRaise: 200, raiseLevel: 1 }
  const seats = [seat(10000, 0)]
  const tiny = act(seats, table, 0, 'RAISE', 250)         // < minTo (400) → remonté à 400
  t(tiny.bet === 400, 'relance sous le min remontée au min légal (400)')
}
{
  const table: BetTable = { currentBet: 200, minRaise: 200, raiseLevel: 1 }
  const seats = [seat(500, 0)]                            // stack 500 → ne peut pas atteindre 9999
  const capped = act(seats, table, 0, 'RAISE', 9999)
  t(capped.bet === 500 && capped.isAllIn, 'relance au-dessus du tapis plafonnée au tapis (all-in 500)')
}
// — Call all-in pour ≤ le call : reste un all-in, PAS démoté —
{
  const table: BetTable = { currentBet: 9777, minRaise: 7500, raiseLevel: 1 }
  const seats = [seat(4000, 0)]                           // ne peut que suivre partiellement → all-in court
  seats[0].actedLevel = 1                                 // a déjà agi (non rouvert)
  const callAllin = act(seats, table, 0, 'ALL-IN')
  t(callAllin.action === 'ALL-IN' && callAllin.bet === 4000 && table.currentBet === 9777, 'call all-in ≤ call : reste all-in, ne relève pas currentBet')
}

console.log('\n' + '═'.repeat(52))
console.log(fail.length === 0 ? `✅ ${n} INVARIANTS MOTEUR — TOUS PASSENT` : `⚠️  ${fail.length}/${n} ÉCHEC(S):\n  - ` + fail.join('\n  - '))
if (fail.length) process.exit(1)
