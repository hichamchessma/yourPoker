import type { EquityReasoning, OutCard } from '../lib/postflopAdvisor'

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
  const reqTxt = pct(r.potOdds)
  const eqTxt = pct(r.equity)
  const hasOuts = r.outs.length > 0
  const weakOnly = hasOuts && r.outs.every(o => o.weak)
  const verdictColor =
    r.verdict === 'fold' ? '#f0796b'
    : r.verdict === 'raise-value' ? '#c9a227'
    : r.verdict === 'raise-bluff' ? '#3aa0d8'
    : '#34d399'
  const verdictText =
    r.verdict === 'fold'
      ? `❌ Il me faut ${reqTxt} et je n'ai que ${eqTxt} → je n'ai PAS la cote → je me couche.`
    : r.verdict === 'call'
      ? `✅ ${eqTxt} d'équité ≥ ${reqTxt} requis → j'ai la cote → je paie.`
    : r.verdict === 'implied'
      ? `≈ Je suis un peu sous la cote directe (${eqTxt} vs ${reqTxt}), mais mes gains implicites — je gagne gros quand je touche — la compensent → call.`
    : r.verdict === 'raise-value'
      ? `✅ J'ai la cote (${eqTxt} vs ${reqTxt}) — et même mieux : je ne me contente pas de payer, je relance pour la valeur.`
      : `Sur la seule cote je n'ai pas le compte (${eqTxt} vs ${reqTxt}), mais je joue ce coup en (semi-)bluff : la décision vient de la fold equity, pas du prix.`

  return (
    <div className="mb-4 rounded-xl border border-[#3aa0d8]/25 bg-[#3aa0d8]/[0.06] p-3">
      <p className="text-[9px] uppercase tracking-widest text-[#7cc4ec] font-bold mb-2">🧠 Comment je raisonne</p>
      <div className="space-y-1.5">
        {/* Pot odds */}
        <p className="text-[11.5px] text-white/80 leading-relaxed">
          <span className="text-[#3aa0d8] mr-1">▸</span>
          Le pot fait <b className="text-white">{money(r.pot)}</b> et je dois payer <b className="text-white">{money(r.toCall)}</b>.
          {' '}Ma cote = mise ÷ (pot + mise) = {money(r.toCall)} ÷ ({money(r.pot)} + {money(r.toCall)}) ≈ <b style={{ color: '#e8c547' }}>{reqTxt}</b> :
          {' '}il me faut au moins <b style={{ color: '#e8c547' }}>{reqTxt}</b> d'équité pour payer.
        </p>

        {/* Outs as cards (flop/turn) */}
        {r.cardsToCome > 0 && hasOuts && (
          <div className="text-[11.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            J'ai <b className="text-white">{r.outs.length}</b> out{r.outs.length > 1 ? 's' : ''} qui m'améliorent :
            <div className="mt-1 mb-1 space-y-1 pl-4">
              {groupOuts(r.outs).map(g => {
                const weak = g.cards.every(c => c.weak)
                return (
                  <div key={g.label} className="flex items-start gap-1.5">
                    <span className="text-[9px] leading-[18px] w-[78px] shrink-0" style={{ color: weak ? 'rgba(245,158,11,0.85)' : 'rgba(255,255,255,0.5)' }}>
                      {g.label}{weak ? ' ⚠︎' : ''} <span className="text-white/30">({g.cards.length})</span>
                    </span>
                    <div className="flex flex-wrap gap-0.5">
                      {g.cards.map((o, i) => <MiniCard key={i} rank={o.card.rank} suit={o.card.suit} dim={o.weak} />)}
                    </div>
                  </div>
                )
              })}
            </div>
            <span className="text-[#3aa0d8] mr-1">▸</span>
            Règle des outs ({r.cardsToCome === 2 ? '×4 au flop, 2 cartes à venir' : '×2 au turn, 1 carte à venir'}) : ces {r.outs.length} out{r.outs.length > 1 ? 's' : ''} ≈ <b style={{ color: '#34d399' }}>{pct(r.outsApprox)}</b> d'équité de tirage{r.outs.length > 8 && r.cardsToCome === 2 ? ' (plafonné — au-delà de ~8 outs la règle surestime)' : ''}{weakOnly ? ' (tirage dominé → compté de moitié)' : ''}.
          </div>
        )}
        {r.cardsToCome > 0 && !hasOuts && (
          <p className="text-[11.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            Aucune carte ne m'améliore vraiment — mon équité vient seulement de ce que je bats déjà.
          </p>
        )}
        {r.cardsToCome === 0 && !r.preflop && (
          <p className="text-[11.5px] text-white/80 leading-relaxed">
            <span className="text-[#3aa0d8] mr-1">▸</span>
            Plus de carte à venir : mon équité, c'est uniquement ce que je bats à l'abattage.
          </p>
        )}

        {/* Real equity — explain WHERE the number comes from. When outs cards are
            shown (flop/turn) they already illustrate it, so keep it short; otherwise
            (preflop / river, no outs) spell out the Monte-Carlo simulation. */}
        <p className="text-[11.5px] text-white/80 leading-relaxed">
          <span className="text-[#3aa0d8] mr-1">▸</span>
          Mon équité réelle ≈ <b style={{ color: '#34d399' }}>{eqTxt}</b>
          {hasOuts
            ? ' (simulation : je rejoue le coup des milliers de fois — ça inclut mes outs ci-dessus + ce que je bats déjà).'
            : r.preflop
              ? ` — estimée par simulation : je rejoue ce coup des milliers de fois en distribuant au hasard les mains adverses + le board, et je compte la part où je gagne (${eqTxt} ici). Pas d'outs à montrer avant le flop.`
              : ' — estimée par simulation : je rejoue les abattages des milliers de fois et je compte la part où je gagne.'}
        </p>

        {/* Verdict */}
        <p className="text-[12px] leading-relaxed font-semibold mt-0.5" style={{ color: verdictColor }}>
          {verdictText}
        </p>
      </div>
    </div>
  )
}
