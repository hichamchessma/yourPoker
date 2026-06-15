import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Sparkles, Crown, ArrowLeft } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useEntitlements, checkoutUrl, PRICE } from '../lib/entitlements'

const FREE_KEYS = ['free1', 'free2', 'free3', 'free4', 'free5']
const PRO_KEYS = ['pro1', 'pro2', 'pro3', 'pro4', 'pro5', 'pro6']

export default function PricingPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { isPro, setPro } = useEntitlements()
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('yearly')
  const [done, setDone] = useState(false)

  // Real checkout if Lemon Squeezy is configured, else beta free-unlock.
  const goPro = () => {
    const url = checkoutUrl(cycle, user?.email ?? undefined, user?.id)
    if (url) { window.location.href = url; return }
    setPro(true); setDone(true)
  }

  const price = cycle === 'monthly' ? PRICE.monthly : PRICE.yearly
  const perMonth = cycle === 'yearly' ? (PRICE.yearly / 12).toFixed(2) : PRICE.monthly.toFixed(2)
  const save = Math.round((1 - PRICE.yearly / (PRICE.monthly * 12)) * 100)

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'radial-gradient(130% 100% at 50% -10%, #14223a 0%, #0a1120 45%, #060912 100%)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-4">
          <ArrowLeft size={14} /> {t('pricing.back')}
        </button>

        <div className="text-center mb-7">
          <h1 className="text-3xl font-black text-white tracking-tight">{t('pricing.title')}</h1>
          <p className="text-[13px] text-white/45 mt-2">{t('pricing.sub')}</p>
        </div>

        {/* Billing cycle toggle */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <button onClick={() => setCycle('monthly')} className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all ${cycle === 'monthly' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>{t('pricing.monthly')}</button>
          <button onClick={() => setCycle('yearly')} className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2 ${cycle === 'yearly' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>
            {t('pricing.yearly')} <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-black">-{save}%</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Free */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{t('pricing.free')}</p>
            <p className="text-3xl font-black text-white mt-1">0 {PRICE.currency}</p>
            <p className="text-[11px] text-white/35 mb-4">{t('pricing.forever')}</p>
            <ul className="space-y-2">
              {FREE_KEYS.map((k) => (
                <li key={k} className="flex items-start gap-2 text-[12px] text-white/60"><Check size={14} className="text-white/30 mt-0.5 flex-shrink-0" /> {t(`pricing.${k}`)}</li>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div className="relative rounded-3xl border-2 border-[#c9a227]/50 p-6 overflow-hidden" style={{ background: 'linear-gradient(170deg, rgba(201,162,39,0.12), rgba(201,162,39,0.02))' }}>
            <span className="absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-[#c9a227]/20 text-[#c9a227] border border-[#c9a227]/40">{t('pricing.popular')}</span>
            <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold flex items-center gap-1.5"><Crown size={13} /> {t('pricing.pro')}</p>
            <div className="flex items-end gap-1.5 mt-1">
              <p className="text-3xl font-black text-white">{price} {PRICE.currency}</p>
              <p className="text-[12px] text-white/40 mb-1">{cycle === 'monthly' ? t('pricing.perMonth') : t('pricing.perYear')}</p>
            </div>
            <p className="text-[11px] text-white/35 mb-4">{cycle === 'yearly' ? t('pricing.billedYearly', { price: perMonth, currency: PRICE.currency }) : t('pricing.billedMonthly')}</p>
            <ul className="space-y-2 mb-5">
              {PRO_KEYS.map((k) => (
                <li key={k} className="flex items-start gap-2 text-[12px] text-white/80"><Check size={14} className="text-[#c9a227] mt-0.5 flex-shrink-0" /> {t(`pricing.${k}`)}</li>
              ))}
            </ul>

            {isPro ? (
              <div className="text-center">
                <p className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[13px] font-bold"><Crown size={15} /> {t('pricing.youArePro')}</p>
                {done && <p className="text-[11px] text-white/40 mt-2">{t('pricing.proActivated')}</p>}
                <button onClick={() => setPro(false)} className="block mx-auto mt-3 text-[10px] text-white/25 hover:text-white/50 transition-colors">{t('pricing.backToFree')}</button>
              </div>
            ) : (
              <button onClick={goPro}
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black uppercase tracking-wide transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
                <Sparkles size={16} /> {t('pricing.goPro')}
              </button>
            )}
            <p className="text-[10px] text-white/30 mt-3 text-center">{t('pricing.betaNote')}</p>
          </div>
        </div>

        <p className="text-center text-[11px] text-white/30 mt-6">{t('pricing.disclaimer')}</p>
      </div>
    </div>
  )
}
