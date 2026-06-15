import { Trans, useTranslation } from 'react-i18next'
import type { EquityReasoning, OutCard } from '../lib/postflopAdvisor'

// Shared <Trans> tag → styled element map (white / gold / green / dim-white bolds).
const TAGS = {
  w: <b className="text-white" />,
  w2: <b className="text-white/75" />,
  gold: <b style={{ color: '#e8c547' }} />,
  green: <b style={{ color: '#34d399' }} />,
}

// Tiny face-up card used to visualise outs / draws in the coach panels.
export function MiniCard({ rank, suit, dim }: { rank: string; suit: string; dim?: boolean }) {
  const red = suit === '♥' || suit === '♦'
  return (
    <span className="inline-flex flex-col items-center justify-center rounded-[3px] leading-none"
      style={{ width: 15, height: 21, border: '1px solid rgba(0,0,0,0.3)', background: dim ? '#9aa3ad' : '#fff', color: red ? (dim ? '#a33' : '#d11') : '#111', opacity: dim ? 0.6 : 1 }}>
      <span className="font-black" style={{ fontSize: 9 }}>{rank}</span>
      <span style={{ fontSize: 8, marginTop: -1 }}>{suit}</span>
    </span>
  )
}

// Group outs by the hand they complete, preserving the (strongest-first) order.
export function groupOuts(outs: OutCard[]): { label: string; cards: OutCard[] }[] {
  const groups: { label: string; cards: OutCard[] }[] = []
  for (const o of outs) {
    let g = groups.find(x => x.label === o.label)
    if (!g) { g = { label: o.label, cards: [] }; groups.push(g) }
    g.cards.push(o)
  }
  return groups
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`

// "How a pro reasons about the price" — pot → call → pot odds → outs (as cards) →
// quick rule-of-2/4 estimate → real equity → verdict (I have the odds or not).
// Shared by the live coach panel and the hand-history critique so they read the same.
export default function EquityReasoningBlock({ r }: { r: EquityReasoning }) {
  const { t } = useTranslation()
  const reqTxt = pct(r.potOdds)
  const eqTxt = pct(r.equity)
  const hasOuts = r.outs.length > 0
  const weakOnly = hasOuts && r.outs.every(o => o.weak)
  const verdictColor =
    r.verdict === 'fold' ? '#f0796b'
    : r.verdict === 'raise-value' ? '#c9a227'
    : r.verdict === 'raise-bluff' ? '#3aa0d8'
    : '#34d399'
  const verdictKey =
    r.verdict === 'fold' ? 'equity.vFold'
    : r.verdict === 'call' ? 'equity.vCall'
    : r.verdict === 'implied' ? 'equity.vImplied'
    : r.verdict === 'raise-value' ? 'equity.vRaiseValue'
    : 'equity.vRaiseBluff'
  const realEquityKey = hasOuts ? 'equity.realEquityOuts' : r.preflop ? 'equity.realEquityPreflop' : 'equity.realEquityRiver'

  return (
    <div className="mb-4 rounded-xl border border-[#3aa0d8]/25 bg-[#3aa0d8]/[0.06] p-3">
      <p className="text-[9px] uppercase tracking-widest text-[#7cc4ec] font-bold mb-2">{t('equity.header')}</p>
      <div className="space-y-1.5">
        {/* Pot odds */}
        <p className="text-[12.5px] text-white/80 leading-relaxed">
          <span className="text-[#3aa0d8] mr-1">▸</span>
          <Trans i18nKey="equity.potLine" components={TAGS} values={{ pot: money(r.pot), toCall: money(r.toCall), req: reqTxt }} />
        </p>

        {/* Outs as cards (flop/turn) */}
        {r.cardsToCome > 0 && hasOuts && (
          <div className="text-[12.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            <Trans i18nKey="equity.outsIntro" count={r.outs.length} components={TAGS} values={{ count: r.outs.length }} />
            <div className="mt-1 mb-1 space-y-1 pl-4">
              {groupOuts(r.outs).map(g => {
                const weak = g.cards.every(c => c.weak)
                return (
                  <div key={g.label} className="flex items-start gap-1.5">
                    <span className="text-[10px] leading-[21px] w-[82px] shrink-0" style={{ color: weak ? 'rgba(245,158,11,0.9)' : 'rgba(255,255,255,0.55)' }}>
                      {g.label}{weak ? ' ⚠︎' : ''} <span className="text-white/35">({g.cards.length})</span>
                    </span>
                    <div className="flex flex-wrap gap-0.5">
                      {/* Dominated-flush outs are STILL real outs (counted in equity) — full-colour. */}
                      {g.cards.map((o, i) => <MiniCard key={i} rank={o.card.rank} suit={o.card.suit} />)}
                    </div>
                  </div>
                )
              })}
            </div>
            <span className="text-[#3aa0d8] mr-1">▸</span>
            <Trans i18nKey="equity.outsRule" components={TAGS} values={{
              rule: r.cardsToCome === 2 ? t('equity.ruleFlop') : t('equity.ruleTurn'),
              count: r.outs.length, s: r.outs.length > 1 ? 's' : '', approx: pct(r.outsApprox),
              cap: r.outs.length > 8 && r.cardsToCome === 2 ? t('equity.ruleCap') : '',
              weak: weakOnly ? t('equity.ruleWeak') : '',
            }} />
          </div>
        )}
        {r.cardsToCome > 0 && !hasOuts && (
          <p className="text-[12.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            {t('equity.noOuts')}
          </p>
        )}
        {r.cardsToCome === 0 && !r.preflop && (
          <p className="text-[12.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            {t('equity.river')}
          </p>
        )}

        {/* Real equity — explain WHERE the number comes from. When outs cards are
            shown (flop/turn) they already illustrate it, so keep it short; otherwise
            (preflop / river, no outs) spell out the Monte-Carlo simulation. */}
        <p className="text-[12.5px] text-white/80 leading-relaxed">
          <span className="text-[#3aa0d8] mr-1">▸</span>
          <Trans i18nKey={realEquityKey} components={TAGS} values={{ eq: eqTxt }} />
        </p>

        {/* Why real equity > raw outs: the outs only count the times I IMPROVE; I also
            win plenty of the time WITHOUT improving (my high card / pair already beats
            his missed draws & air at showdown). Make that jump explicit. */}
        {hasOuts && r.equity - r.outsApprox > 0.06 && (() => {
          const sdv = r.equity - r.outsApprox            // "already ahead at showdown" slice
          const noImp = Math.max(0.05, 1 - r.outsApprox) // P(I miss all my outs)
          const beatShare = Math.min(0.99, sdv / noImp)  // P(my current hand beats his range | no improve)
          return (
            <p className="text-[12px] leading-relaxed rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(52,211,153,0.08)', color: 'rgba(255,255,255,0.78)' }}>
              <span className="font-bold" style={{ color: '#34d399' }}>{t('equity.whyTitle', { eq: eqTxt, approx: pct(r.outsApprox) })}</span>
              <Trans i18nKey="equity.whyBody" components={TAGS} values={{ approx: pct(r.outsApprox), sdv: pct(sdv), eq: eqTxt }} />
              <br />
              <span className="text-white/55">
                <Trans i18nKey="equity.whyCalc" components={TAGS} values={{ sdv: pct(sdv), noImp: pct(noImp), beat: pct(beatShare) }} />
              </span>
            </p>
          )
        })()}

        {/* Verdict */}
        <p className="text-[13px] leading-relaxed font-semibold mt-0.5" style={{ color: verdictColor }}>
          {t(verdictKey, { eq: eqTxt, req: reqTxt })}
        </p>
      </div>
    </div>
  )
}
