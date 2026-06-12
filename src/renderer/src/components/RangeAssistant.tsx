import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  GRID_RANKS, buildRangeMap, buildJamCallMap, handKeyFromCards, cellKey,
  ACTION_LABEL, SCENARIO_LABEL, type Scenario, type RangeAction,
} from '../lib/preflopRanges'
import { getPostflopAdvice, monteCarloEquity, buildEquityReasoning, type AdviceAction, type FacePlanRow, type OutCard, type EquityReasoning, type VillainTier } from '../lib/postflopAdvisor'
import RangeHeatmap from './RangeHeatmap'
import EquityReasoningBlock, { MiniCard, groupOuts } from './EquityReasoning'
import type { RangeView } from '../lib/rangeEstimator'

interface Card { rank: string; suit: string }

const ACTION_COLOR: Record<RangeAction, { bg: string; fg: string }> = {
  raise: { bg: '#c9a227', fg: '#1a1206' },
  '3bet': { bg: '#dc2626', fg: '#fff' },
  '4bet': { bg: '#b91c1c', fg: '#fff' },
  call:  { bg: '#1f7a4d', fg: '#eafff3' },
  fold:  { bg: '#1a2230', fg: '#5b6675' },
}
const ADVICE_COLOR: Record<AdviceAction, string> = {
  BET: '#c9a227', RAISE: '#c9a227', CALL: '#1f9d5e', CHECK: '#3aa0d8', FOLD: '#c0392b',
}

interface UnifiedAdvice {
  actionText: string
  color: string
  sizingText: string
  equity: number
  potOdds: number
  madeHand: string
  draws: string[]
  reasons: string[]
  confidence: 'haute' | 'moyenne' | 'basse'
  facePlan?: FacePlanRow[]
  outs?: OutCard[]
}

export default function RangeAssistant({
  card1, card2, position, scenario, activePlayers, playersBehind,
  board, pot, toCall, heroStack, effStack, inPosition, aggression, barrels, bb,
  raiseToBB, multiway, vsOpenerPos, reRaiseRatio, threeBettorIP, numAllIn = 0,
  raiserBehindJam = false, aggressors, cappedRange, callPressure, donkLead, facingRaise,
  icmTighten = 1, icmPressure = 0, actionRecap, onClose, villainTier,
  embedded = false, representedView = null, representedMeta = null,
}: {
  card1: Card | null
  card2: Card | null
  position: string
  scenario: Scenario | 'postflop'
  activePlayers: number
  playersBehind: number
  board: Card[]
  pot: number
  toCall: number
  heroStack: number
  effStack: number
  inPosition: boolean
  aggression: number
  barrels: number
  bb: number
  raiseToBB: number
  multiway: boolean
  vsOpenerPos?: string
  reRaiseRatio?: number
  threeBettorIP?: boolean
  numAllIn?: number
  raiserBehindJam?: boolean
  aggressors?: number
  cappedRange?: boolean
  callPressure?: number
  donkLead?: boolean
  facingRaise?: boolean
  icmTighten?: number
  icmPressure?: number
  villainTier?: VillainTier
  actionRecap: string[]
  onClose: () => void
  embedded?: boolean
  representedView?: RangeView | null
  representedMeta?: { move: string; effect: string } | null
}) {
  const isPreflop = scenario !== 'postflop'
  const heroKey = card1 && card2 ? handKeyFromCards(card1, card2) : null
  const effBB = bb > 0 ? effStack / bb : 100
  // Facing an all-in jam (one or more) → call-off range, not the normal flat range.
  const vsJam = isPreflop && numAllIn >= 1
  const potOddsPre = toCall > 0 ? toCall / (pot + toCall) : 0
  const closingAction = playersBehind === 0 // BB last to act preflop
  const rangeMap = !isPreflop ? null
    : vsJam ? buildJamCallMap(effBB, numAllIn, icmTighten, raiserBehindJam)
    : buildRangeMap(scenario as Scenario, position, playersBehind, { effBB, raiseToBB, multiway, vsOpenerPos, reRaiseRatio, threeBettorIP, icmTighten, closingAction, potOdds: potOddsPre })
  const heroChartAction: RangeAction | null = rangeMap && heroKey ? rangeMap.get(heroKey) ?? 'fold' : null
  // Re-shove (3-bet jam) zone: 14-25bb facing an open/squeeze, the chart marks jam
  // hands as 'raise' (not '3bet') → a 'raise' here means an ALL-IN re-shove, not an open.
  const isReshove = (scenario === 'vsopen' || scenario === 'squeeze') && effBB > 13 && rangeMap
    ? [...rangeMap.values()].includes('raise')
    : false
  const formatLabel = activePlayers <= 2 ? 'Heads-up (2 joueurs)' : `${activePlayers} joueurs actifs`

  const boardSig = board.map(c => c.rank + c.suit).join('')
  const opponents = Math.max(1, activePlayers - 1)

  // Unified advice — preflop (chart action + raw equity) or postflop (full sim).
  const advice = useMemo<UnifiedAdvice | null>(() => {
    if (!card1 || !card2) return null
    const pct = (x: number) => `${Math.round(x * 100)}%`
    if (isPreflop) {
      const chart = heroChartAction ?? 'fold'
      const equity = monteCarloEquity([card1, card2], [], opponents, 1000)
      const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
      const shortStack = effBB <= 13
      const reshove = isReshove && chart === 'raise'
      const sizingText = chart === 'fold' ? 'couche-toi'
        : chart === 'call' ? (vsJam ? 'paie le tapis (all-in)' : 'suis la mise')
        : chart === '3bet' ? (shortStack ? 'TAPIS (all-in)' : 'relance (3-bet ≈ 3×)')
        : chart === '4bet' ? 'sur-relance (4-bet)'
        : reshove ? 'TAPIS — 3-bet (re-shove)'
        : shortStack ? 'TAPIS (all-in)' : 'ouvre / relance (≈ 2.5–3 BB)'
      const situationLabel = vsJam
        ? `face à ${numAllIn} tapis (all-in)`
        : SCENARIO_LABEL[scenario as Scenario].toLowerCase()
      const reasons = vsJam ? [
        `Face à ${numAllIn} tapis (all-in), tu ne peux que PAYER ou te COUCHER — pas de flat${numAllIn > 1 ? ', et la range de call-off se resserre fort à plusieurs tapis' : ''}.`,
        `Décision d'équité : ${heroKey} a ≈ ${pct(equity)} d'équité, il faut ${pct(potOdds)} pour payer → ${equity >= potOdds ? 'CALL rentable.' : 'FOLD (sous la cote).'}`,
        `Profondeur ~${Math.round(effBB)} BB : ${effBB > 60 ? 'tapis profonds → seules les mains premium paient' : effBB < 20 ? 'tapis courts → call-off bien plus large' : 'profondeur moyenne'}.`,
      ] : [
        `Selon la range de ta position (${position} — ${situationLabel}), ${heroKey} se joue : ${ACTION_LABEL[chart]}.`,
        `Équité brute estimée : ${pct(equity)} face à ${opponents} adversaire${opponents > 1 ? 's' : ''}.`,
        inPosition ? 'Tu es en position : tu peux jouer un peu plus large.' : 'Tu es hors de position : resserre légèrement.',
      ]
      if (reshove) reasons.push(`Tapis ~${Math.round(effBB)} BB face à une ouverture → RE-SHOVE (3-bet TAPIS), pas un 3-bet petit : à cette profondeur un petit 3-bet te COMMET (tu ne peux plus fold à un 4-bet tapis) et flatter OOP joue un pot à bas SPR. Tu shoves pour la fold equity + l'argent mort de l'ouvreur.`)
      else if (effBB <= 13) reasons.push(`Tapis court (~${Math.round(effBB)} BB) → PUSH/FOLD : tu mets tapis ou tu jettes, plus de jeu post-flop.`)
      else if (effBB < 25) reasons.push(`Tapis court (~${Math.round(effBB)} BB) : privilégie 3-bet TAPIS (re-shove) / fold, peu de flats.`)
      else if (effBB > 80) reasons.push(`Tapis profond (~${Math.round(effBB)} BB) : les mains assorties/connectées gagnent en valeur.`)
      if (scenario === 'vsopen' && raiseToBB > 4) reasons.push(`Grosse ouverture (~${raiseToBB.toFixed(1)} BB) : pas de fold equity → on coupe les bluffs de 3-bet, value only.`)
      else if (scenario === 'vsopen' && raiseToBB <= 2.6) reasons.push(`Petite ouverture (~${raiseToBB.toFixed(1)} BB) : range de 3-bet polarisée pleine + flats larges.`)
      if (scenario === 'vs3bet' && reRaiseRatio !== undefined) {
        reasons.push(reRaiseRatio <= 2.3 ? `Petit 3-bet (~${reRaiseRatio.toFixed(1)}× l'ouverture) : bonne cote → tu continues bien plus large.`
          : reRaiseRatio >= 3.5 ? `Gros 3-bet (~${reRaiseRatio.toFixed(1)}× l'ouverture) : resserre fort (surtout les flats).`
          : `3-bet standard (~${reRaiseRatio.toFixed(1)}× l'ouverture).`)
      }
      if (multiway) reasons.push('Plusieurs joueurs déjà dans le coup : resserre (surtout les mains dépareillées).')
      if ((chart === '3bet' || chart === '4bet' || chart === 'raise') && equity < 0.45)
        reasons.push('Main jouée en BLUFF / semi-bluff polarisé : sa valeur vient de la fold equity + des blockers + la jouabilité quand on est payé — PAS de l’équité au showdown. Ne te fie pas au % brut affiché ici.')
      if (chart === 'call' && heroKey && /^(22|33|44|55|66|77|88|99|TT)$/.test(heroKey) && effBB > 30)
        reasons.push(`Set-mine : tu paies bon marché pour toucher un brelan (~1 fois sur 8) et empiler un tapis profond (~${Math.round(effBB)} BB) — les cotes implicites rendent le call rentable même si l'équité brute paraît basse.`)
      else if (chart === 'call' && heroKey && (heroKey.endsWith('s') && effBB > 30))
        reasons.push('Main assortie jouée IP en profondeur : tu suis pour la jouabilité + les cotes implicites (couleur/quinte), pas seulement la cote directe.')
      if (chart === 'call' && closingAction && potOddsPre > 0 && potOddsPre < 0.3)
        reasons.push(`Tu FERMES l’action (grosse blinde) : ${pct(equity)} d’équité pour une cote de seulement ${pct(potOddsPre)} → tu as le prix pour payer, on défend large à ce tarif (K-high, connecteurs, paires…) puisque personne ne peut relancer derrière.`)
      if (icmPressure > 0.3)
        reasons.push(`Pression ICM (~${Math.round(icmPressure * 100)}%) : près de la bulle / d’un saut de prix, busté coûte cher. Resserre tes tapis et tes call-off — survivre vaut plus que d’encaisser un petit edge.`)
      return {
        actionText: reshove ? 'TAPIS (RE-SHOVE)' : ACTION_LABEL[chart], color: ACTION_COLOR[chart].bg, sizingText,
        equity, potOdds, madeHand: heroKey ?? '—', draws: [], reasons,
        confidence: chart === 'fold' && equity < 0.35 ? 'haute' : (chart === 'raise' || chart === '3bet') && equity > 0.55 ? 'haute' : 'moyenne',
      }
    }
    if (board.length < 3) return null
    const a = getPostflopAdvice({ hole: [card1, card2], board, pot, toCall, heroStack, effStack, opponents, inPosition, aggression, barrels, bb, villainTier, aggressors, cappedRange, callPressure, donkLead, facingRaise })
    return { actionText: a.action, color: ADVICE_COLOR[a.action], sizingText: a.sizingText, equity: a.equity, potOdds: a.potOdds, madeHand: a.madeHand, draws: a.draws, reasons: a.reasons, confidence: a.confidence, facePlan: a.facePlan, outs: a.outs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreflop, scenario, heroKey, boardSig, pot, toCall, activePlayers, inPosition, position, aggression, barrels, effStack, numAllIn, raiserBehindJam, raiseToBB, reRaiseRatio, icmTighten, icmPressure, closingAction, potOddsPre, villainTier, aggressors, cappedRange, callPressure])

  // "How a pro reasons about the price" — POSTFLOP only. Pre-flop the decision is a
  // RANGE call (domination / realizability), not a pot-odds one: a hand can clear the
  // raw price (e.g. ATo ~45% vs 24% odds) and still be a fold because it's dominated
  // by the 3-bet range. Showing "pot odds vs equity" there contradicts the verdict.
  const reasoning: EquityReasoning | null = advice && toCall > 0 && card1 && card2 && !isPreflop
    ? buildEquityReasoning({
        hole: [card1, card2], board, pot, toCall, equity: advice.equity,
        decision: advice.actionText === 'FOLD' ? 'fold' : advice.actionText === 'CALL' ? 'call' : 'aggro',
      })
    : null

  const [answer, setAnswer] = useState<string | null>(null)

  function ask(q: string) {
    if (!advice) return
    const pct = (x: number) => `${Math.round(x * 100)}%`
    const drawing = advice.draws.some(d => d.includes('couleur') || d.includes('ouvert'))
    // Verdict that stays consistent with the actual recommendation (handles the
    // implied-odds case where we call a draw slightly below direct pot odds).
    const oddsVerdict = advice.equity >= advice.potOdds
      ? 'tu es au-dessus → payer est rentable.'
      : (advice.actionText === 'CALL' && drawing)
        ? 'tu es légèrement sous la cote directe, MAIS ton tirage donne des gains implicites (tu gagnes plus en touchant) → le call reste correct.'
        : 'tu es en dessous → sur la cote directe, payer perd à long terme (d’où le fold).'
    if (q === 'why') setAnswer(advice.reasons.join(' '))
    else if (q === 'equity') setAnswer(`Tu as environ ${pct(advice.equity)} de chances de gagner le coup. ${toCall > 0 ? `Pour payer, il te faut au moins ${pct(advice.potOdds)} : ${oddsVerdict}` : 'Personne n’a misé : tu peux checker gratuitement ou miser pour la valeur.'}`)
    else if (q === 'raise') setAnswer(advice.equity >= 0.6 ? `Avec ${pct(advice.equity)} d’équité, relancer pour la valeur est excellent : tu fais payer les mains plus faibles et les tirages.` : advice.draws.length ? `Relancer en semi-bluff est jouable : même battu maintenant, ton ${advice.draws.join(' / ')} peut te faire gagner gros.` : `Relancer ici est risqué : avec seulement ${pct(advice.equity)} d’équité, tu te fais payer surtout par mieux.`)
    else if (q === 'hand') setAnswer(`Ta main : ${advice.madeHand}${advice.draws.length ? `, avec ${advice.draws.join(' et ')}` : ''}.`)
    else if (q === 'equity_calc') setAnswer(`Je le calcule par simulation (Monte-Carlo) : je rejoue ce coup ~1000–1500 fois en distribuant au hasard les cartes manquantes du board et les mains des ${opponents} adversaire(s), puis je compare ta main à la leur à chaque fois. Le % de fois où tu gagnes (les partages comptent en fraction) = ton équité, soit ~${pct(advice.equity)} ici. Plus je fais de simulations, plus le chiffre est précis.`)
    else if (q === 'potodds_calc') {
      if (toCall <= 0) { setAnswer(`Personne n’a misé : tu n’as rien à payer, donc pas de cote du pot à atteindre.`); return }
      setAnswer(`C’est purement mathématique : tu dois payer ${toCall} pour tenter de remporter le pot. Équité requise = mise à payer ÷ (pot total après ton call) = ${toCall} ÷ (${pot} + ${toCall}) ≈ ${pct(advice.potOdds)}. Il faut donc gagner le coup au moins ${pct(advice.potOdds)} du temps pour que payer soit rentable. Toi tu gagnes ~${pct(advice.equity)} → ${oddsVerdict}`)
    }
    else if (q === 'face_raise') {
      if (!advice.facePlan || advice.facePlan.length === 0) { setAnswer('Disponible quand le conseil est CHECK, BET ou CALL.'); return }
      const verb = advice.actionText === 'BET' ? 'te relance' : advice.actionText === 'CALL' ? 'relance derrière' : 'mise derrière toi'
      const lines = advice.facePlan.map(r => `▸ S’il ${verb} ${r.label} → ${r.action}\n   ${r.equation}\n   ${r.why}`).join('\n')
      setAnswer(`Anticipe : si l’adversaire ${verb}, voici le coup optimal selon sa taille (req = équité nécessaire pour payer, B = sa mise) :\n\n${lines}\n\nClé : un PETIT sizing avec une main forte → souvent un RE-RAISE / 4-bet pour la valeur, pas un simple call.`)
    }
    else if (q === 'bluff') {
      const betSize = Math.max(1, Math.round(pot * 0.66))
      const fe = betSize / (pot + betSize)
      const semi = advice.draws.length > 0
      setAnswer(`Pour bluffer, ${toCall > 0 ? 'il faudrait relancer' : 'tu mises'} pour faire abandonner l’adversaire. Une taille d’environ ⅔ pot (~$${betSize}) est crédible : tu risques $${betSize} pour gagner $${pot}, donc il faut qu’il se couche au moins ~${pct(fe)} du temps (mise ÷ (pot + mise)) pour que le bluff soit gagnant. ⚠️ Risque : s’il paie, tu n’as plus que ~${pct(advice.equity)} d’équité — tu perds ta mise la plupart du temps. ${semi ? `Bonne nouvelle : avec ton ${advice.draws.join(' / ')}, c’est un SEMI-bluff — même payé tu peux encore toucher, donc bien moins risqué.` : `Sans tirage, ce serait un bluff “pur” : tu ne comptes que sur son fold. À réserver aux board qui touchent ta range et aux adversaires capables de se coucher.`}`)
    }
  }

  const QA_BUTTONS: [string, string][] = [
    ['why', 'Pourquoi ?'], ['equity', 'Mon équité ?'], ['raise', 'Et si je relance ?'], ['hand', 'C’est quoi ma main ?'],
    ['equity_calc', 'Comment tu calcules mon équité ?'], ['potodds_calc', 'Comment tu calcules la cote ?'], ['bluff', 'Et si j’essaie de bluffer ?'],
  ]

  const panel = (
      <motion.div initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className={embedded
          ? 'w-[620px] max-w-[94vw] max-h-[88vh] overflow-y-auto rounded-2xl border border-[#c9a227]/30 shadow-2xl'
          : 'w-full max-w-[680px] max-h-[92vh] overflow-y-auto rounded-2xl border border-[#c9a227]/30'}
        style={{ background: '#070d1a' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 sticky top-0 z-10" style={{ background: '#070d1a' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#c9a227] uppercase tracking-widest">Assistant Coach</span>
            <span className="text-[10px] text-white/35">{isPreflop ? 'Préflop' : 'Postflop'}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/8 border border-white/10 text-white/50 font-bold uppercase tracking-wide">{formatLabel}</span>
          </div>
          {embedded
            ? <span className="text-[9px] text-white/30 italic">survol — quitte le profil pour fermer</span>
            : <button onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10">✕</button>}
        </div>

        <div className="p-5">
          {/* Postflop before the flop is dealt */}
          {!advice && !isPreflop && <p className="text-white/50 text-sm text-center py-8">En attente du flop…</p>}

          {advice && (
            <>
              {/* Situation + recommendation banner */}
              {isPreflop && (
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">
                  Situation : <span className="text-[#c9a227] font-bold">{position}</span> — {vsJam ? `Face à ${numAllIn} tapis (all-in)` : SCENARIO_LABEL[scenario as Scenario]}
                </p>
              )}
              {isPreflop && icmPressure > 0.3 && (
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 px-2 py-1 rounded-md inline-block"
                  style={{ color: '#f0c060', background: 'rgba(200,120,40,0.16)', border: '1px solid rgba(240,192,96,0.4)' }}>
                  ⚠️ ICM / Bulle — resserre : survivre &gt; maximiser ({Math.round(icmPressure * 100)}%)
                </p>
              )}
              <div className="flex items-center gap-4 rounded-xl border p-4 mb-4"
                style={{ background: advice.color + '1f', borderColor: advice.color + '88' }}>
                <div className="text-center min-w-[72px]">
                  <p className="text-[9px] text-white/40 uppercase tracking-widest">Conseil</p>
                  <p className="text-xl font-black tracking-wide leading-tight" style={{ color: advice.color }}>{advice.actionText}</p>
                </div>
                <div className="flex-1">
                  {heroKey && <p className="text-sm font-bold text-white/90 font-mono">{heroKey} · <span className="font-sans">{advice.sizingText}</span></p>}
                  <p className="text-[10px] text-white/45 mt-0.5">Confiance : <span className="font-bold" style={{ color: advice.color }}>{advice.confidence}</span></p>
                </div>
              </div>
            </>
          )}

          {/* Preflop grid */}
          {isPreflop && rangeMap && (
            <>
              <div className="mx-auto" style={{ width: 'min(100%, 520px)' }}>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(13, 1fr)', gap: 2 }}>
                  {GRID_RANKS.map((_, i) =>
                    GRID_RANKS.map((__, j) => {
                      const key = cellKey(i, j)
                      const action = rangeMap.get(key) ?? 'fold'
                      const c = ACTION_COLOR[action]
                      const isHero = key === heroKey
                      return (
                        <div key={`${i}-${j}`} title={`${key} — ${ACTION_LABEL[action]}`}
                          className="relative flex items-center justify-center rounded-[3px] select-none"
                          style={{
                            aspectRatio: '1', fontSize: 9, fontWeight: 700, background: c.bg, color: c.fg,
                            outline: isHero ? '2px solid #00e5ff' : 'none', outlineOffset: isHero ? '-1px' : 0,
                            boxShadow: isHero ? '0 0 10px rgba(0,229,255,0.8)' : 'none', zIndex: isHero ? 2 : 1,
                          }}>
                          {key.replace('s', '').replace('o', '')}
                          {key.endsWith('s') && <span style={{ fontSize: 6, opacity: 0.7, marginLeft: 1 }}>s</span>}
                          {key.endsWith('o') && <span style={{ fontSize: 6, opacity: 0.55, marginLeft: 1 }}>o</span>}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 my-3 flex-wrap">
                {(vsJam ? (['call', 'fold'] as RangeAction[])
                  : isReshove ? (['raise', 'fold'] as RangeAction[])
                  : scenario === 'rfi' || scenario === 'iso' ? (['raise', 'fold'] as RangeAction[])
                  : scenario === 'vsopen' || scenario === 'squeeze' ? (['3bet', 'call', 'fold'] as RangeAction[])
                  : (['4bet', 'call', 'fold'] as RangeAction[])
                ).map(a => (
                  <div key={a} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm" style={{ background: ACTION_COLOR[a].bg }} />
                    <span className="text-[10px] text-white/55 font-bold uppercase tracking-wide">{isReshove && a === 'raise' ? 'TAPIS (RE-SHOVE)' : ACTION_LABEL[a]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {advice && (
            <>
              {/* Represented range (perceived) — postflop, all streets */}
              {!isPreflop && representedView && (
                <div className="mb-4 flex flex-col items-center">
                  <p className="text-[9px] text-white/35 uppercase tracking-widest mb-1.5 self-start">Ta range représentée (perçue)</p>
                  <RangeHeatmap view={representedView} move={representedMeta?.move ?? '—'} effect={representedMeta?.effect ?? ''}
                    name="Toi — range représentée" heroKey={heroKey}/>
                </div>
              )}
              {/* Equity / pot odds */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-white/50 uppercase tracking-wide">Ton équité</span>
                  <span className="font-bold text-emerald-300">{Math.round(advice.equity * 100)}%
                    {toCall > 0 && <span className="text-white/40 font-normal"> · cote {Math.round(advice.potOdds * 100)}%</span>}
                  </span>
                </div>
                <div className="relative h-3 rounded-full overflow-hidden bg-white/8">
                  <div className="h-full rounded-full" style={{ width: `${advice.equity * 100}%`, background: 'linear-gradient(90deg,#1f9d5e,#34d399)' }} />
                  {toCall > 0 && <div className="absolute top-0 bottom-0 w-[2px] bg-[#c9a227]" style={{ left: `${advice.potOdds * 100}%` }} title="Équité requise pour payer" />}
                </div>
                {!isPreflop && (
                  <p className="text-[9px] text-white/30 mt-1">Ta main : <span className="text-white/60 font-bold">{advice.madeHand}</span>{advice.draws.length ? ` · ${advice.draws.join(' · ')}` : ''}</p>
                )}
                {/* Outs — exact cards that improve the hero's hand (flop/turn only).
                    When FACING a bet the outs appear inside the reasoning block below,
                    so this standalone version only shows when there's nothing to call. */}
                {!isPreflop && toCall <= 0 && advice.outs && advice.outs.length > 0 && (
                  <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-emerald-300/80 font-bold">Tes outs</span>
                      <span className="text-[9px] text-white/40">{advice.outs.length} carte{advice.outs.length > 1 ? 's' : ''} qui t’améliorent</span>
                    </div>
                    <div className="space-y-1">
                      {groupOuts(advice.outs).map(g => {
                        const weak = g.cards.every(c => c.weak)
                        return (
                          <div key={g.label} className="flex items-start gap-1.5">
                            <span className="text-[10px] leading-[21px] w-[82px] shrink-0" style={{ color: weak ? 'rgba(245,158,11,0.9)' : 'rgba(255,255,255,0.55)' }}>
                              {g.label}{weak ? ' ⚠︎' : ''} <span className="text-white/35">({g.cards.length})</span>
                            </span>
                            <div className="flex flex-wrap gap-0.5">
                              {/* Dominated-flush outs are STILL real outs (counted in equity) — show
                                  them full-colour; the ⚠︎ label + note below carry the nuance. */}
                              {g.cards.map((o, i) => <MiniCard key={i} rank={o.card.rank} suit={o.card.suit} />)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {advice.outs.some(o => o.weak) && (
                      <p className="text-[10px] text-amber-400/80 mt-1.5 leading-snug">⚠︎ couleur dominée : ça reste un out (compté dans ton équité), mais tu peux toucher et perdre quand même face à une couleur plus haute.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Pro reasoning — equity vs pot odds, with outs as cards */}
              {reasoning && <EquityReasoningBlock r={reasoning} />}

              {/* Reasons */}
              <div className="space-y-2 mb-4">
                {advice.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[#c9a227] mt-0.5 text-[12px]">▸</span>
                    <p className="text-[13px] text-white/80 leading-relaxed">{r}</p>
                  </div>
                ))}
              </div>

              {/* Guided Q&A */}
              <div className="border-t border-white/8 pt-3">
                <p className="text-[9px] text-white/35 uppercase tracking-widest mb-2">Demande au coach</p>
                <div className="flex flex-wrap gap-2">
                  {QA_BUTTONS.map(([q, label]) => (
                    <button key={q} onClick={() => ask(q)}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/5 border border-white/10 text-white/60 hover:text-[#c9a227] hover:border-[#c9a227]/40 transition-all">
                      {label}
                    </button>
                  ))}
                  {/* Anticipation question — active when we'd CHECK / BET / CALL */}
                  {(() => {
                    const enabled = !!advice.facePlan && ['CHECK', 'BET', 'CALL'].includes(advice.actionText)
                    return (
                      <button onClick={() => enabled && ask('face_raise')} disabled={!enabled}
                        title={enabled ? 'Plan si l’adversaire mise / te relance, par taille' : 'Disponible quand le conseil est CHECK, BET ou CALL'}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${enabled ? 'bg-[#c9a227]/12 border-[#c9a227]/40 text-[#c9a227] hover:bg-[#c9a227]/20' : 'bg-white/3 border-white/8 text-white/20 cursor-not-allowed'}`}>
                        🎯 Et si je me fais raise ?
                      </button>
                    )
                  })()}
                </div>
                {answer && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-3 p-3 rounded-lg bg-[#00d4ff]/8 border border-[#00d4ff]/20">
                    <p className="text-[13px] text-white/85 leading-relaxed whitespace-pre-line">💬 {answer}</p>
                  </motion.div>
                )}
              </div>

              {/* Action recap */}
              {actionRecap.length > 0 && (
                <div className="border-t border-white/8 pt-3 mt-3">
                  <p className="text-[9px] text-white/35 uppercase tracking-widest mb-1.5">Déroulé du coup</p>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {actionRecap.map((l, i) => <p key={i} className="text-[10px] text-white/40 font-mono">{l}</p>)}
                  </div>
                </div>
              )}

              <p className="text-[9px] text-white/25 text-center mt-4 leading-relaxed">
                {isPreflop
                  ? 'Range adaptée au nombre de joueurs en jeu + équité estimée par simulation. Conseil d’entraînement, pas un solveur.'
                  : 'Équité estimée par simulation (Monte-Carlo) vs mains aléatoires. Conseil heuristique d’entraînement, pas un solveur.'}
              </p>
            </>
          )}
        </div>
      </motion.div>
  )
  if (embedded) return panel
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }}>
      {panel}
    </div>
  )
}
