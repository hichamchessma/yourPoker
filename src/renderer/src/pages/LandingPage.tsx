import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import {
  Sparkles, Target, Eye, FlaskConical, GraduationCap, Medal, Crown,
  ArrowRight, Check, Spade, Brain, TrendingUp, ShieldCheck
} from 'lucide-react'
import { playersOnline, getRoster } from '../lib/leaderboard'
import { PRICE } from '../lib/entitlements'
import LanguageSwitcher from '../components/LanguageSwitcher'

const fmt = (n: number) => Math.round(n).toLocaleString()

export default function LandingPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [online, setOnline] = useState(() => playersOnline())
  useEffect(() => { const id = setInterval(() => setOnline(playersOnline()), 4000); return () => clearInterval(id) }, [])
  const handsAnalysed = getRoster().reduce((s, p) => s + p.hands, 0)

  const cta = () => navigate('/auth')

  return (
    <div className="h-screen w-screen overflow-y-auto text-white" style={{ background: 'radial-gradient(120% 80% at 50% -10%, #102341 0%, #0a1120 45%, #05070e 100%)' }}>
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[15%] w-[600px] h-[400px] opacity-20" style={{ background: 'radial-gradient(ellipse, #00d4ff 0%, transparent 70%)' }} />
        <div className="absolute bottom-[5%] right-[10%] w-[500px] h-[400px] opacity-15" style={{ background: 'radial-gradient(ellipse, #c9a227 0%, transparent 70%)' }} />
      </div>

      {/* NAV */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-poker-gold/20 border border-poker-gold/40 flex items-center justify-center">
            <Spade size={18} className="text-poker-gold" fill="#c9a227" />
          </div>
          <div className="leading-none">
            <p className="font-display font-bold tracking-widest uppercase text-sm">Your<span className="text-poker-gold">Poker</span></p>
            <p className="text-poker-gold/70 text-[9px] tracking-[0.3em] uppercase">Elite Coaching</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button onClick={cta} className="px-5 py-2 rounded-lg text-[13px] font-bold border border-white/15 hover:bg-white/10 transition-colors">
            {t('landing.signIn')}
          </button>
        </div>
      </header>

      {/* HERO */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pt-12 md:pt-20 pb-16 text-center">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/60 mb-6">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span>
            <Trans i18nKey="landing.online" values={{ count: fmt(online) }} components={[<b className="text-emerald-400 font-mono" />]} />
          </span>
          <h1 className="text-4xl md:text-6xl font-black leading-[1.05] tracking-tight">
            {t('landing.heroLine1')}<br />
            <span style={{ background: 'linear-gradient(90deg,#f0d060,#c9a227)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t('landing.heroAccent')}</span>
          </h1>
          <p className="text-[15px] md:text-lg text-white/55 mt-5 max-w-2xl mx-auto leading-relaxed">
            <Trans i18nKey="landing.heroSub" components={[<b className="text-white/80" />, <b className="text-white/80" />]} />
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <button onClick={cta} className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-black uppercase tracking-wide transition-all hover:brightness-110 hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
              <Sparkles size={17} /> {t('landing.ctaStart')} <ArrowRight size={17} />
            </button>
            <span className="text-[12px] text-white/35">{t('landing.ctaNote')}</span>
          </div>
          <p className="text-[12px] text-white/40 mt-6">
            <Trans i18nKey="landing.handsAnalysed" values={{ count: fmt(handsAnalysed) }} components={[<b className="text-white/70 font-mono" />]} />
          </p>
        </motion.div>
      </section>

      {/* 3 HOOKS */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: <Brain size={22} />, c: '#00d4ff', t: t('landing.hook1Title'), d: t('landing.hook1Desc') },
            { icon: <Eye size={22} />, c: '#c9a227', t: t('landing.hook2Title'), d: t('landing.hook2Desc') },
            { icon: <FlaskConical size={22} />, c: '#a855f7', t: t('landing.hook3Title'), d: t('landing.hook3Desc') },
          ].map((h, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 hover:border-white/20 transition-colors">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ background: h.c + '1f', color: h.c }}>{h.icon}</div>
              <h3 className="text-[15px] font-black text-white/90">{h.t}</h3>
              <p className="text-[12.5px] text-white/50 mt-1.5 leading-relaxed">{h.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FEATURE STRIP */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-16">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 md:p-8">
          <h2 className="text-2xl md:text-3xl font-black text-center mb-2">{t('landing.featuresTitle')}</h2>
          <p className="text-[13px] text-white/45 text-center mb-7">{t('landing.featuresSub')}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { icon: <Target size={18} />, t: 'Hand Trainer', d: t('landing.fHandTrainer') },
              { icon: <GraduationCap size={18} />, t: 'Cash Game', d: t('landing.fCash') },
              { icon: <Medal size={18} />, t: 'Tournois MTT', d: t('landing.fMtt') },
              { icon: <FlaskConical size={18} />, t: 'Simulation', d: t('landing.fSim') },
              { icon: <Eye size={18} />, t: 'Range Vision', d: t('landing.fRange') },
              { icon: <TrendingUp size={18} />, t: 'Replay', d: t('landing.fHistory') },
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-poker-gold/10 border border-poker-gold/20 text-poker-gold flex items-center justify-center flex-shrink-0">{f.icon}</span>
                <div>
                  <p className="text-[13px] font-bold text-white/85">{f.t}</p>
                  <p className="text-[11.5px] text-white/45">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 pb-16">
        <h2 className="text-2xl md:text-3xl font-black text-center mb-6">{t('landing.pricingTitle')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <p className="text-[11px] uppercase tracking-widest text-white/40 font-bold">{t('pricing.free')}</p>
            <p className="text-2xl font-black mt-1 mb-3">0 {PRICE.currency}</p>
            <ul className="space-y-1.5">
              {['free1', 'free2', 'free3', 'free4'].map(k => <li key={k} className="flex items-start gap-2 text-[12px] text-white/55"><Check size={13} className="text-white/30 mt-0.5 flex-shrink-0" />{t(`pricing.${k}`)}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border-2 border-[#c9a227]/50 p-5" style={{ background: 'linear-gradient(170deg, rgba(201,162,39,0.12), transparent)' }}>
            <p className="text-[11px] uppercase tracking-widest text-[#c9a227] font-bold flex items-center gap-1.5"><Crown size={13} /> {t('pricing.pro')}</p>
            <p className="text-2xl font-black mt-1 mb-3">{PRICE.yearly} {PRICE.currency}<span className="text-[12px] text-white/40 font-normal">{t('pricing.perYear')}</span></p>
            <ul className="space-y-1.5">
              {['pro1', 'pro2', 'pro3', 'pro4'].map(k => <li key={k} className="flex items-start gap-2 text-[12px] text-white/75"><Check size={13} className="text-[#c9a227] mt-0.5 flex-shrink-0" />{t(`pricing.${k}`)}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 pb-12 text-center">
        <div className="rounded-3xl border border-[#c9a227]/30 p-8" style={{ background: 'radial-gradient(80% 120% at 50% 0%, rgba(201,162,39,0.14), transparent)' }}>
          <h2 className="text-2xl md:text-3xl font-black">{t('landing.finalTitle')}</h2>
          <p className="text-[13px] text-white/50 mt-2">{t('landing.finalSub')}</p>
          <button onClick={cta} className="mt-5 inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-black uppercase tracking-wide transition-all hover:brightness-110 hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
            <Sparkles size={17} /> {t('landing.finalCta')}
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 max-w-5xl mx-auto px-6 py-8 border-t border-white/5 text-center">
        <p className="flex items-center justify-center gap-2 text-[11px] text-white/35">
          <ShieldCheck size={13} /> {t('landing.footerDisclaimer')}
        </p>
        <p className="text-[10px] text-white/25 mt-3">© {new Date().getFullYear()} YourPoker · CGU · Confidentialité · Contact</p>
      </footer>
    </div>
  )
}
