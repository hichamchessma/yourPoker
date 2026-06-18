import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Crown, Menu } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useIsPro } from '../../lib/entitlements'
import { playersOnline } from '../../lib/leaderboard'
import LanguageSwitcher from '../LanguageSwitcher'
import SoundToggle from '../SoundToggle'
import WindowControls from './WindowControls'

// Persistent top bar shown on every menu page (via AppLayout): players-online social
// proof, language + sound, and the profile chip with the Pro crown — so the crown and
// controls stay visible no matter which page you're on.
export default function TopBar({ onMenu }: { onMenu?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isPro = useIsPro()
  const [online, setOnline] = useState(() => playersOnline())
  useEffect(() => { const id = setInterval(() => setOnline(playersOnline()), 4000); return () => clearInterval(id) }, [])
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Joueur'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null

  return (
    <header className="app-drag relative z-50 flex items-center gap-3 px-5 h-14 flex-shrink-0 border-b border-white/8"
      style={{ background: 'linear-gradient(180deg, rgba(9,14,26,0.96), rgba(6,11,20,0.92))', backdropFilter: 'blur(10px)' }}>
      {/* hairline accent — gold → teal */}
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.45), rgba(0,212,255,0.35), transparent)' }} />

      {/* Hamburger — phone only (opens the sidebar drawer) */}
      {onMenu && (
        <button onClick={onMenu} aria-label="Menu"
          className="app-drag-none flex items-center justify-center w-9 h-9 -ml-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
          <Menu size={22} />
        </button>
      )}

      {/* Players online — social proof (stays on every page) */}
      <div className="app-drag-none hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 shadow-[0_0_18px_-8px_rgba(16,185,129,0.6)]">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" /></span>
        <span className="text-[11px] text-white/75 font-medium">{t('lobby.online', { count: online.toLocaleString() })}</span>
      </div>

      <div className="flex-1" />

      <div className="app-drag-none flex items-center gap-2">
        <LanguageSwitcher />
        <SoundToggle />

        {/* Profile chip — avatar + name + Pro crown */}
        <button onClick={() => navigate('/profile')} className="flex items-center gap-2 pl-3 ml-1 border-l border-white/10 group">
          <div className="relative flex-shrink-0">
            {isPro && (
              <motion.div initial={{ y: 2, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                <Crown size={13} className="text-[#f0d060] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" fill="#f0d060" />
              </motion.div>
            )}
            <div className={`w-8 h-8 rounded-full overflow-hidden ${isPro ? 'border-2 border-[#c9a227]' : 'border border-poker-gold/30'}`}
              style={isPro ? { boxShadow: '0 0 10px rgba(201,162,39,0.55)' } : undefined}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-poker-gold/20 flex items-center justify-center">
                  <span className="text-poker-gold font-bold text-sm">{displayName[0].toUpperCase()}</span>
                </div>
              )}
            </div>
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-bold text-white/90 leading-tight group-hover:text-white transition-colors flex items-center gap-1">
              {displayName}
              {isPro && <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded text-[#1a1206]" style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)' }}>Pro</span>}
            </p>
            <p className="text-[9px] text-white/35 group-hover:text-poker-teal transition-colors">{t('lobby.viewProfile')}</p>
          </div>
        </button>

        <WindowControls />
      </div>
    </header>
  )
}
