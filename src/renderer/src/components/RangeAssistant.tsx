import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  GRID_RANKS, buildRangeMap, buildJamCallMap, handKeyFromCards, cellKey,
  ACTION_LABEL, SCENARIO_LABEL, type Scenario, type RangeAction,
} from '../lib/preflopRanges'
import { getPostflopAdvice, monteCarloEquity, buildEquityReasoning, buildPreflopStory, type AdviceAction, type FacePlanRow, type ProPlan, type OutCard, type EquityReasoning, type VillainTier } from '../lib/postflopAdvisor'
import { useIsPro } from '../lib/entitlements'
import { Lock, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import RangeHeatmap from './RangeHeatmap'
import EquityReasoningBlock, { MiniCard, groupOuts } from './EquityReasoning'
import { money } from '../lib/money'
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
  strongDraw: boolean
  reasons: string[]
  confidence: 'haute' | 'moyenne' | 'basse'
  facePlan?: FacePlanRow[]
  proPlan?: ProPlan
  story?: string[]
  outs?: OutCard[]
}

export default function RangeAssistant({
  card1, card2, position, scenario, activePlayers, playersBehind,
  board, pot, toCall, heroStack, effStack, inPosition, aggression, barrels, bb,
  raiseToBB, multiway, numCallers = 0, vsOpenerPos, reRaiseRatio, threeBettorIP, numAllIn = 0,
  raiserBehindJam = false, aggressors, cappedRange, callPressure, donkLead, facingRaise,
  icmTighten = 1, icmPressure = 0, actionRecap, onClose, villainTier, villainLoose = false, heroOpened = false,
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
  numCallers?: number
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
  villainLoose?: boolean
  heroOpened?: boolean
  actionRecap: string[]
  onClose: () => void
  embedded?: boolean
  representedView?: RangeView | null
  representedMeta?: { move: string; effect: string } | null
}) {
  const { t, i18n } = useTranslation()
  const isPro = useIsPro()
  const isPreflop = scenario !== 'postflop'
  const heroKey = card1 && card2 ? handKeyFromCards(card1, card2) : null
  const effBB = bb > 0 ? effStack / bb : 100
  // Facing an all-in jam (one or more) → call-off range, not the normal flat range.
  const vsJam = isPreflop && numAllIn >= 1
  const potOddsPre = toCall > 0 ? toCall / (pot + toCall) : 0
  const closingAction = playersBehind === 0 // BB last to act preflop
  const rangeMap = !isPreflop ? null
    : vsJam ? buildJamCallMap(effBB, numAllIn, icmTighten, raiserBehindJam)
    : buildRangeMap(scenario as Scenario, position, playersBehind, { effBB, raiseToBB, multiway, numCallers, vsOpenerPos, reRaiseRatio, threeBettorIP, icmTighten, closingAction, potOdds: potOddsPre })
  const heroChartAction: RangeAction | null = rangeMap && heroKey ? rangeMap.get(heroKey) ?? 'fold' : null
  // Re-shove (3-bet jam) zone: 14-25bb facing an open/squeeze, the chart marks jam
  // hands as 'raise' (not '3bet') → a 'raise' here means an ALL-IN re-shove, not an open.
  const isReshove = (scenario === 'vsopen' || scenario === 'squeeze') && effBB > 13 && rangeMap
    ? [...rangeMap.values()].includes('raise')
    : false
  const formatLabel = activePlayers <= 2 ? t('coach.headsUp') : t('coach.activePlayers', { n: activePlayers })

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
      const sizingText = chart === 'fold' ? t('padv.szFold')
        : chart === 'call' ? (vsJam ? t('padv.szCallJam') : t('padv.szCall'))
        : chart === '3bet' ? (shortStack ? t('padv.szAllin') : t('padv.sz3bet'))
        : chart === '4bet' ? t('padv.sz4bet')
        : reshove ? t('padv.szReshove')
        : shortStack ? t('padv.szAllin') : t('padv.szOpen')
      const situationLabel = vsJam
        ? t('coach.vsJam', { n: numAllIn })
        : t(SCENARIO_LABEL[scenario as Scenario]).toLowerCase()
      const bb = Math.round(effBB)
      const reasons = vsJam ? [
        t('padv.jamOnly', { n: numAllIn, multi: numAllIn > 1 ? t('padv.jamMulti') : '' }),
        t('padv.jamEquity', { hero: heroKey, eq: pct(equity), odds: pct(potOdds), verdict: equity >= potOdds ? t('padv.jamVerdictCall') : t('padv.jamVerdictFold') }),
        t('padv.jamDepth', { bb, txt: effBB > 60 ? t('padv.depthDeep') : effBB < 20 ? t('padv.depthShort') : t('padv.depthMid') }),
      ] : [
        t('padv.rangePos', { position, situation: situationLabel, hero: heroKey, action: ACTION_LABEL[chart] }),
        t('padv.rawEquity', { eq: pct(equity), count: opponents }),
        inPosition ? t('padv.posIP') : t('padv.posOOP'),
      ]
      if (reshove) reasons.push(t('padv.reshove', { bb }))
      else if (effBB <= 13) reasons.push(t('padv.pushFold', { bb }))
      else if (effBB < 25) reasons.push(t('padv.shortStack', { bb }))
      else if (effBB > 80) reasons.push(t('padv.deepStack', { bb }))
      if (scenario === 'vsopen' && raiseToBB > 4) reasons.push(t('padv.bigOpen', { bb: raiseToBB.toFixed(1) }))
      else if (scenario === 'vsopen' && raiseToBB <= 2.6) reasons.push(t('padv.smallOpen', { bb: raiseToBB.toFixed(1) }))
      if (scenario === 'vs3bet' && reRaiseRatio !== undefined) {
        reasons.push(reRaiseRatio <= 2.3 ? t('padv.small3bet', { r: reRaiseRatio.toFixed(1) })
          : reRaiseRatio >= 3.5 ? t('padv.big3bet', { r: reRaiseRatio.toFixed(1) })
          : t('padv.std3bet', { r: reRaiseRatio.toFixed(1) }))
      }
      if (multiway) reasons.push(t('padv.multiway'))
      if ((chart === '3bet' || chart === '4bet' || chart === 'raise') && equity < 0.45)
        reasons.push(t('padv.bluffPolar'))
      if (chart === 'call' && heroKey && /^(22|33|44|55|66|77|88|99|TT)$/.test(heroKey) && effBB > 30)
        reasons.push(t('padv.setMine', { bb }))
      else if (chart === 'call' && heroKey && (heroKey.endsWith('s') && effBB > 30))
        reasons.push(t('padv.suitedDeep'))
      if (chart === 'call' && closingAction && potOddsPre > 0 && potOddsPre < 0.3)
        reasons.push(t('padv.closing', { eq: pct(equity), odds: pct(potOddsPre) }))
      if (icmPressure > 0.3)
        reasons.push(t('padv.icm', { n: Math.round(icmPressure * 100) }))
      const story = heroKey ? buildPreflopStory({
        position, scenario: vsJam ? 'vsJam' : (scenario as string), heroKey, chart, eq: equity,
        raiseToBB, vsJam, effBB, inPosition, reshove, heroRaised: heroOpened,
      }) : undefined
      return {
        actionText: reshove ? t('padv.reshoveAction') : ACTION_LABEL[chart], color: ACTION_COLOR[chart].bg, sizingText,
        equity, potOdds, madeHand: heroKey ?? '—', draws: [], strongDraw: false, reasons, story,
        confidence: chart === 'fold' && equity < 0.35 ? 'haute' : (chart === 'raise' || chart === '3bet') && equity > 0.55 ? 'haute' : 'moyenne',
      }
    }
    if (board.length < 3) return null
    const a = getPostflopAdvice({ hole: [card1, card2], board, pot, toCall, heroStack, effStack, opponents, inPosition, aggression, barrels, bb, villainTier, villainLoose, aggressors, cappedRange, callPressure, donkLead, facingRaise })
    return { actionText: a.action, color: ADVICE_COLOR[a.action], sizingText: a.sizingText, equity: a.equity, potOdds: a.potOdds, madeHand: a.madeHand, draws: a.draws, strongDraw: a.strongDraw, reasons: a.reasons, confidence: a.confidence, facePlan: a.facePlan, proPlan: a.proPlan, story: a.story, outs: a.outs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // i18n.language: the reasons/sizing/madeHand are built with t() INSIDE this memo,
    // so they must rebuild when the language changes (otherwise the coach panel stays
    // frozen in the previous language while the chrome around it switches).
  }, [i18n.language, isPreflop, scenario, heroKey, boardSig, pot, toCall, activePlayers, inPosition, position, aggression, barrels, effStack, numAllIn, raiserBehindJam, raiseToBB, reRaiseRatio, icmTighten, icmPressure, closingAction, potOddsPre, villainTier, villainLoose, aggressors, cappedRange, callPressure])

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
  // Two-stage reveal: on open the coach "steps out" with the story + range only; the
  // DETAILS button expands the full analysis (equity, reasons, plan…) WITHOUT the story.
  // Reset to the intro whenever the spot changes so every hand opens on the coach.
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => { setDetailsOpen(false) }, [boardSig, heroKey, scenario, toCall])

  function ask(q: string) {
    if (!advice) return
    const pct = (x: number) => `${Math.round(x * 100)}%`
    const drawing = advice.strongDraw
    // Verdict that stays consistent with the actual recommendation (handles the
    // implied-odds case where we call a draw slightly below direct pot odds).
    const oddsVerdict = advice.equity >= advice.potOdds
      ? t('cask.oddsOver')
      : (advice.actionText === 'CALL' && drawing)
        ? t('cask.oddsImplied')
        : t('cask.oddsUnder')
    if (q === 'why') setAnswer(advice.reasons.join(' '))
    else if (q === 'equity') setAnswer(t('cask.equity', { eq: pct(advice.equity), tail: toCall > 0 ? t('cask.equityOdds', { odds: pct(advice.potOdds), verdict: oddsVerdict }) : t('cask.equityFree') }))
    else if (q === 'raise') setAnswer(advice.equity >= 0.6 ? t('cask.raiseValue', { eq: pct(advice.equity) }) : advice.draws.length ? t('cask.raiseSemi', { draws: advice.draws.join(' / ') }) : t('cask.raiseRisky', { eq: pct(advice.equity) }))
    else if (q === 'hand') setAnswer(t('cask.hand', { made: advice.madeHand, draws: advice.draws.length ? t('cask.handDraws', { draws: advice.draws.join(t('cask.andSep', { defaultValue: ' & ' })) }) : '' }))
    else if (q === 'equity_calc') setAnswer(t('cask.equityCalc', { n: opponents, eq: pct(advice.equity) }))
    else if (q === 'potodds_calc') {
      if (toCall <= 0) { setAnswer(t('cask.potoddsNone')); return }
      setAnswer(t('cask.potoddsCalc', { toCall, pot, odds: pct(advice.potOdds), eq: pct(advice.equity), verdict: oddsVerdict }))
    }
    else if (q === 'face_raise') {
      if (!advice.facePlan || advice.facePlan.length === 0) { setAnswer(t('cask.faceNone')); return }
      const verb = advice.actionText === 'BET' ? t('cask.faceVerbBet') : advice.actionText === 'CALL' ? t('cask.faceVerbCall') : t('cask.faceVerbBetBehind')
      const lines = advice.facePlan.map(r => t('cask.faceRow', { verb, label: r.label, action: r.action, equation: r.equation, why: r.why })).join('\n')
      setAnswer(t('cask.faceIntro', { verb, lines }))
    }
    else if (q === 'bluff') {
      const betSize = Math.max(1, Math.round(pot * 0.66))
      const fe = betSize / (pot + betSize)
      const semi = advice.draws.length > 0
      setAnswer(t('cask.bluff', {
        verb: toCall > 0 ? t('cask.bluffVerbRaise') : t('cask.bluffVerbBet'),
        size: money(betSize), pot: money(pot), fe: pct(fe), eq: pct(advice.equity),
        tail: semi ? t('cask.bluffSemi', { draws: advice.draws.join(' / ') }) : t('cask.bluffPure'),
      }))
    }
  }

  const QA_BUTTONS: [string, string][] = [
    ['why', t('coach.qWhy')], ['equity', t('coach.qEquity')], ['raise', t('coach.qRaise')], ['hand', t('coach.qHand')],
    ['equity_calc', t('coach.qEquityCalc')], ['potodds_calc', t('coach.qPotoddsCalc')], ['bluff', t('coach.qBluff')],
  ]

  const preLegend: RangeAction[] = vsJam ? ['call', 'fold']
    : isReshove ? ['raise', 'fold']
    : (scenario === 'rfi' || scenario === 'iso') ? ['raise', 'fold']
    : (scenario === 'vsopen' || scenario === 'squeeze') ? ['3bet', 'call', 'fold']
    : ['4bet', 'call', 'fold']

  const panel = (
      <motion.div initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className={embedded
          ? 'w-[900px] max-w-[96vw] rounded-2xl border border-[#c9a227]/30 shadow-2xl'
          : 'w-full max-w-[900px] rounded-2xl border border-[#c9a227]/30'}
        style={{ background: '#070d1a' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 sticky top-0 z-10" style={{ background: '#070d1a' }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#c9a227] uppercase tracking-widest">{t('coach.title')}</span>
            <span className="text-[10px] text-white/35">{isPreflop ? t('coach.preflop') : t('coach.postflop')}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/8 border border-white/10 text-white/50 font-bold uppercase tracking-wide">{formatLabel}</span>
          </div>
          {embedded
            ? (detailsOpen
                ? <button onClick={() => setDetailsOpen(false)} title={t('coach.backToCoach')}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-[#c9a227] hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest">
                    <ChevronUp size={13} /> {t('coach.backToCoach')}
                  </button>
                : <span className="text-[9px] text-white/30 italic">{t('coach.hoverHint')}</span>)
            : <button onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10">✕</button>}
        </div>

        <div className="p-5 flex gap-4 items-start">
          {/* ══ LEFT: the analysis (scrolls on its own) ══ */}
          <div className="flex-1 min-w-0 overflow-y-auto pr-1.5 -mr-1.5" style={{ maxHeight: '74vh' }}>
          {/* Postflop before the flop is dealt */}
          {!advice && !isPreflop && <p className="text-white/50 text-sm text-center py-8">{t('coach.waitFlop')}</p>}

          {advice && (
            <>
              {/* recommendation banner */}
              <div className="flex items-center gap-4 rounded-xl border p-4 mb-4"
                style={{ background: advice.color + '1f', borderColor: advice.color + '88' }}>
                <div className="text-center min-w-[72px]">
                  <p className="text-[9px] text-white/40 uppercase tracking-widest">{t('coach.advice')}</p>
                  <p className="text-xl font-black tracking-wide leading-tight" style={{ color: advice.color }}>{advice.actionText}</p>
                </div>
                <div className="flex-1">
                  {heroKey && <p className="text-sm font-bold text-white/90 font-mono">{heroKey} · <span className="font-sans">{advice.sizingText}</span></p>}
                  <p className="text-[10px] text-white/45 mt-0.5">{t('coach.confidence')} <span className="font-bold" style={{ color: advice.color }}>{t(`coach.conf${advice.confidence.charAt(0).toUpperCase() + advice.confidence.slice(1)}`)}</span></p>
                </div>
              </div>
              {/* ── PRO PLAN — the announced multi-street line (Pro tier) ── */}
              {!isPreflop && advice.proPlan && <ProPlanBand plan={advice.proPlan} isPro={isPro} />}
              {/* Non-embedded (trainer) shows the story inline; in-game it lives in the intro view */}
              {!embedded && !!advice.story?.length && (
                <div className="mb-4"><StoryHero action={advice.actionText} color={advice.color} hand={heroKey} sizing={advice.sizingText} story={advice.story} sig={isPreflop ? (heroKey ?? 'pf') : boardSig} /></div>
              )}

              {/* Equity / pot odds */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-white/50 uppercase tracking-wide">{t('coach.yourEquity')}</span>
                  <span className="font-bold text-emerald-300">{Math.round(advice.equity * 100)}%
                    {toCall > 0 && <span className="text-white/40 font-normal"> · {t('coach.odds', { n: Math.round(advice.potOdds * 100) })}</span>}
                  </span>
                </div>
                <div className="relative h-3 rounded-full overflow-hidden bg-white/8">
                  <div className="h-full rounded-full" style={{ width: `${advice.equity * 100}%`, background: 'linear-gradient(90deg,#1f9d5e,#34d399)' }} />
                  {toCall > 0 && <div className="absolute top-0 bottom-0 w-[2px] bg-[#c9a227]" style={{ left: `${advice.potOdds * 100}%` }} title={t('coach.requiredEquity')} />}
                </div>
                {!isPreflop && (
                  <p className="text-[9px] text-white/30 mt-1">{t('coach.yourHand')} <span className="text-white/60 font-bold">{advice.madeHand}</span>{advice.draws.length ? ` · ${advice.draws.join(' · ')}` : ''}</p>
                )}
                {/* Outs — exact cards that improve the hero's hand (flop/turn only).
                    When FACING a bet the outs appear inside the reasoning block below,
                    so this standalone version only shows when there's nothing to call. */}
                {!isPreflop && toCall <= 0 && advice.outs && advice.outs.length > 0 && (
                  <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-emerald-300/80 font-bold">{t('coach.yourOuts')}</span>
                      <span className="text-[9px] text-white/40">{t('coach.outsImprove', { count: advice.outs.length })}</span>
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
                      <p className="text-[10px] text-amber-400/80 mt-1.5 leading-snug">{t('coach.dominatedFlush')}</p>
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
                <p className="text-[9px] text-white/35 uppercase tracking-widest mb-2">{t('coach.askCoach')}</p>
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
                        title={enabled ? t('coach.faceRaiseTitle') : t('coach.faceRaiseDisabled')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${enabled ? 'bg-[#c9a227]/12 border-[#c9a227]/40 text-[#c9a227] hover:bg-[#c9a227]/20' : 'bg-white/3 border-white/8 text-white/20 cursor-not-allowed'}`}>
                        {t('coach.qFaceRaise')}
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
                  <p className="text-[9px] text-white/35 uppercase tracking-widest mb-1.5">{t('coach.handFlow')}</p>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {actionRecap.map((l, i) => <p key={i} className="text-[10px] text-white/40 font-mono">{l}</p>)}
                  </div>
                </div>
              )}

              <p className="text-[9px] text-white/25 text-center mt-4 leading-relaxed">
                {isPreflop ? t('coach.footerPreflop') : t('coach.footerPostflop')}
              </p>
            </>
          )}
          </div>

          {/* ══ RIGHT: the range — always on its own column, fully visible ══ */}
          {advice && (isPreflop ? !!rangeMap : !!representedView) && (
            <div className="w-[300px] shrink-0">
              {isPreflop ? (
                <>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1.5 text-center">
                    <span className="text-[#c9a227] font-bold">{position}</span> — {vsJam ? t('coach.vsJam', { n: numAllIn }) : t(SCENARIO_LABEL[scenario as Scenario])}
                  </p>
                  {icmPressure > 0.3 && (
                    <p className="text-[9px] font-bold uppercase tracking-widest mb-2 px-2 py-1 rounded-md text-center"
                      style={{ color: '#f0c060', background: 'rgba(200,120,40,0.16)', border: '1px solid rgba(240,192,96,0.4)' }}>
                      {t('coach.icmBanner', { n: Math.round(icmPressure * 100) })}
                    </p>
                  )}
                  {rangeMap && <RangeGrid rangeMap={rangeMap} heroKey={heroKey} legend={preLegend} isReshove={isReshove} />}
                </>
              ) : representedView && (
                <>
                  <p className="text-[9px] text-white/35 uppercase tracking-widest mb-1.5">{t('coach.representedRange')}</p>
                  <RangeHeatmap view={representedView} move={representedMeta?.move ?? '—'} effect={representedMeta?.effect ?? ''}
                    name={t('coach.youRepresented')} heroKey={heroKey} width={300}/>
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>
  )

  // ── INTRO (in-game): the coach "steps out" on the left, the range card on the right ──
  const introView = (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start w-[720px] max-w-[96vw]">
      {/* LEFT — the coach, floating outside any panel */}
      <motion.div className="flex-1 min-w-0"
        initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}>
        {advice?.story?.length
          ? <StoryHero action={advice.actionText} color={advice.color} hand={heroKey} sizing={advice.sizingText}
              story={advice.story} sig={isPreflop ? (heroKey ?? 'pf') : boardSig} />
          : <p className="text-white/50 text-sm py-10 text-center rounded-2xl border border-white/10" style={{ background: '#070d1a' }}>{t('coach.waitFlop')}</p>}
      </motion.div>
      {/* RIGHT — the range card, smaller, appears just after */}
      {advice && (isPreflop ? !!rangeMap : !!representedView) && (
        <motion.div className="w-[270px] shrink-0 rounded-2xl border border-[#c9a227]/30 p-3 shadow-2xl"
          style={{ background: '#070d1a' }}
          initial={{ opacity: 0, x: 14, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: 0.35, delay: 0.3 }}>
          <p className="text-[9px] text-white/40 uppercase tracking-widest mb-2 text-center">
            {isPreflop
              ? <>{position} — {vsJam ? t('coach.vsJam', { n: numAllIn }) : t(SCENARIO_LABEL[scenario as Scenario])}</>
              : t('coach.representedRange')}
          </p>
          {isPreflop && rangeMap
            ? <RangeGrid rangeMap={rangeMap} heroKey={heroKey} legend={preLegend} isReshove={isReshove} compact />
            : representedView && (
              <RangeHeatmap view={representedView} move={representedMeta?.move ?? '—'} effect={representedMeta?.effect ?? ''}
                name={t('coach.youRepresented')} heroKey={heroKey} width={246} />
            )}
          <button onClick={() => setDetailsOpen(true)}
            className="w-full mt-3 py-2 rounded-xl border border-[#c9a227]/40 bg-[#c9a227]/10 text-[#f0c060] text-[10px] font-black uppercase tracking-[0.18em] hover:bg-[#c9a227]/20 transition-all flex items-center justify-center gap-1.5">
            {t('coach.detailsBtn')} <ChevronDown size={13} />
          </button>
        </motion.div>
      )}
    </motion.div>
  )

  if (embedded) {
    return detailsOpen ? (
      <>
        {/* dim the whole table so the focus is the analysis */}
        <motion.div className="fixed inset-0 z-0 bg-black/80 backdrop-blur-sm" onClick={() => setDetailsOpen(false)}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        <div className="relative z-10">{panel}</div>
      </>
    ) : introView
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }}>
      {panel}
    </div>
  )
}

// The 13×13 pre-flop range grid + its legend. Reused by the full panel and the compact
// intro card (smaller cells when `compact`).
function RangeGrid({ rangeMap, heroKey, legend, isReshove, compact }: {
  rangeMap: Map<string, RangeAction>; heroKey?: string | null; legend: RangeAction[]; isReshove?: boolean; compact?: boolean
}) {
  const { t } = useTranslation()
  const fs = compact ? 7 : 9
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(13, 1fr)', gap: compact ? 1.5 : 2 }}>
        {GRID_RANKS.map((_, i) => GRID_RANKS.map((__, j) => {
          const key = cellKey(i, j)
          const action = rangeMap.get(key) ?? 'fold'
          const c = ACTION_COLOR[action]
          const isHero = key === heroKey
          return (
            <div key={`${i}-${j}`} title={`${key} — ${ACTION_LABEL[action]}`}
              className="relative flex items-center justify-center rounded-[3px] select-none"
              style={{
                aspectRatio: '1', fontSize: fs, fontWeight: 700, background: c.bg, color: c.fg,
                outline: isHero ? '2px solid #00e5ff' : 'none', outlineOffset: isHero ? '-1px' : 0,
                boxShadow: isHero ? '0 0 8px rgba(0,229,255,0.8)' : 'none', zIndex: isHero ? 2 : 1,
              }}>
              {key.replace('s', '').replace('o', '')}
              {key.endsWith('s') && <span style={{ fontSize: fs - 3, opacity: 0.7, marginLeft: 1 }}>s</span>}
              {key.endsWith('o') && <span style={{ fontSize: fs - 3, opacity: 0.55, marginLeft: 1 }}>o</span>}
            </div>
          )
        }))}
      </div>
      <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
        {legend.map(a => (
          <div key={a} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ACTION_COLOR[a].bg }} />
            <span className="text-[9px] text-white/55 font-bold uppercase tracking-wide">{isReshove && a === 'raise' ? t('coach.reshoveLabel') : ACTION_LABEL[a]}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// Pro-tier "PLAN PRO" band: the announced multi-street line + a one-line glossary, a
// condensed decision tree and the next-street intent. Free users see it blurred (upsell).
// "In a pro's head" — a comic-style bubble: the coach avatar reasoning out loud into a
// thought cloud that LEADS with the recommended action (highlighted) and then explains it,
// beats revealing with a stagger. This floats on its own, outside the analysis panel.
function StoryHero({ action, color, hand, sizing, story, sig }: {
  action: string; color: string; hand?: string | null; sizing?: string; story: string[]; sig: string
}) {
  const { t } = useTranslation()
  // Opaque cloud so the bubble READS clearly against any (dark/blurred) table background.
  const cloud = { borderColor: 'rgba(167,139,255,0.6)', background: 'rgb(36,26,82)' }
  const puffs = [{ s: 6, l: -20, b: -2, d: 0.18 }, { s: 9, l: -13, b: 7, d: 0.30 }, { s: 13, l: -6, b: 18, d: 0.42 }]
  return (
    <div key={`story-${sig}`} className="flex gap-3 items-end">
      {/* Coach avatar — the pro, mid-thought */}
      <motion.div className="relative shrink-0 w-[56px] h-[56px] rounded-full overflow-hidden border-2"
        style={{ borderColor: '#a78bfa', boxShadow: '0 0 16px rgba(167,139,255,0.55)' }}
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
        <img src="/assets/player-avatar.webp" alt="coach" draggable={false} className="w-full h-full object-cover" />
      </motion.div>
      <div className="relative flex-1 min-w-0">
        {puffs.map((p, i) => (
          <motion.span key={i} className="absolute rounded-full border"
            style={{ ...cloud, width: p.s, height: p.s, left: p.l, bottom: p.b }}
            initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: p.d, type: 'spring', stiffness: 520, damping: 16 }} />
        ))}
        <motion.div initial="hidden" animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.22, delayChildren: 0.5 } } }}
          className="relative rounded-[22px] border-2 p-3.5 space-y-2"
          style={{ borderColor: 'rgba(167,139,255,0.55)', background: 'linear-gradient(180deg, #241a52, #181232)',
            boxShadow: '0 14px 44px rgba(0,0,0,0.6), 0 0 0 1px rgba(167,139,255,0.12)' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: '#c4b5fd' }}>{t('story.title')}</p>
          {/* LEAD with the action, highlighted — dark neutral pill so the action colour pops */}
          <motion.div variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
            className="inline-flex items-baseline gap-2 px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(0,0,0,0.34)', border: `1.5px solid ${color}`, boxShadow: `0 0 12px ${color}44` }}>
            <span className="text-[11px] text-white/65">{t('story.hereI')}</span>
            <span className="text-[16px] font-black tracking-wide" style={{ color, textShadow: `0 0 10px ${color}66` }}>{action} !</span>
            {(hand || sizing) && <span className="text-[11px] text-white/65 font-mono">{[hand, sizing].filter(Boolean).join(' · ')}</span>}
          </motion.div>
          {/* …then the explanation */}
          {story.map((beat, i) => (
            <motion.p key={i} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
              className="text-[12px] text-white/85 leading-relaxed">
              {beat}
            </motion.p>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

const PLAN_GLOSS: Record<string, string> = {
  'check-back': 'plan.glossCheckBack',
  'check-fold': 'plan.glossCheckFold', 'check-call': 'plan.glossCheckCall', 'check-raise': 'plan.glossCheckRaise',
  'bet-fold': 'plan.glossBetFold', 'bet-call': 'plan.glossBetCall', 'bet-3bet': 'plan.glossBet3bet',
  'bluff-catch': 'plan.glossBluffCatch', 'call': 'plan.glossCall', 'raise': 'plan.glossRaise',
}
const PLAN_KIND_COLOR: Record<string, string> = { call: '#34d399', fold: '#f87171', reraise: '#f0c060' }

function ProPlanBand({ plan, isPro }: { plan: ProPlan; isPro: boolean }) {
  const { t } = useTranslation()
  const glossKey = PLAN_GLOSS[plan.term]
  return (
    <div className="relative rounded-xl border mb-4 overflow-hidden"
      style={{ borderColor: 'rgba(167,139,255,0.4)', background: 'linear-gradient(135deg, rgba(124,92,240,0.12), rgba(40,30,90,0.18))' }}>
      <div className="flex items-center justify-between px-3.5 pt-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: '#c4b5fd' }}>
          <Zap size={12} /> {t('plan.title')}
        </span>
        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,255,0.2)', color: '#c4b5fd' }}>PRO</span>
      </div>
      <div className="px-3.5 pb-3 pt-1.5" style={isPro ? undefined : { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }}>
        <p className="text-[17px] font-black tracking-wide" style={{ color: '#e9e2ff' }}>{plan.line}</p>
        {glossKey && <p className="text-[10px] text-white/45 mt-0.5 leading-snug">{t(glossKey)}</p>}
        {plan.branches.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {plan.branches.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-white/45">{b.cond}</span>
                <span className="text-white/25">→</span>
                <span className="font-black tracking-wide" style={{ color: PLAN_KIND_COLOR[b.kind] }}>{b.act}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <span className="text-[8px] font-black uppercase tracking-widest mt-0.5 shrink-0" style={{ color: '#a78bfa' }}>{t('plan.turnLabel')}</span>
          <span className="text-[10.5px] text-white/65 leading-snug">{plan.turn}</span>
        </div>
      </div>
      {!isPro && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5" style={{ background: 'rgba(12,9,22,0.35)' }}>
          <Lock size={16} className="text-[#c4b5fd]" />
          <span className="text-[11px] font-bold text-white/85">{t('plan.lockedCta')}</span>
        </div>
      )}
    </div>
  )
}
