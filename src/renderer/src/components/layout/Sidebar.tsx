import { useState, useRef, useMemo, useLayoutEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  Target,
  GraduationCap,
  Medal,
  SlidersHorizontal,
  User,
  History,
  FlaskConical,
  Trophy,
  LogOut,
  ChevronRight
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useLiveSession } from '../../store/liveSessionStore'
import { useDevice } from '../../lib/useDevice'
import { LeaveTableModal } from '../SessionDialogs'
import { useIsPro } from '../../lib/entitlements'
import ProBadge from '../ProBadge'
import LanguageSwitcher from '../LanguageSwitcher'
import { Sparkles, Crown } from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
  pro?: boolean
}

// Only routes that actually exist (App.tsx). Dead entries (Bibliothèque, Statistiques,
// Classement, Support) were removed to avoid menu dead-ends; re-add them with a real
// page when built.
const NAV_ITEMS: NavItem[] = [
  { id: 'lobby', label: 'nav.lobby', icon: <Home size={20} />, path: '/lobby' },
  { id: 'handtrainer', label: 'nav.handTrainer', icon: <Target size={20} />, path: '/handtrainer' },
  { id: 'training', label: 'nav.cashTraining', icon: <GraduationCap size={20} />, path: '/training' },
  { id: 'tournament', label: 'nav.tournamentTraining', icon: <Medal size={20} />, path: '/tournament' },
  { id: 'simulation', label: 'nav.simulation', icon: <FlaskConical size={20} />, path: '/simulation', pro: true },
  { id: 'setup', label: 'nav.scenario', icon: <SlidersHorizontal size={20} />, path: '/setup', pro: true },
  { id: 'leaderboard', label: 'nav.leaderboard', icon: <Trophy size={20} />, path: '/leaderboard' },
  { id: 'profile', label: 'nav.profile', icon: <User size={20} />, path: '/profile' },
  { id: 'history', label: 'nav.history', icon: <History size={20} />, path: '/history' },
]

interface SidebarProps {
  activeItem?: string
  /** On the game table we hide the menu and reveal it on a left-edge hover (immersion). */
  autoHide?: boolean
  /** Phone: render as an off-canvas drawer toggled by the TopBar hamburger. */
  drawer?: boolean
  drawerOpen?: boolean
  onCloseDrawer?: () => void
}

export default function Sidebar({ activeItem, autoHide = false, drawer = false, drawerOpen = false, onCloseDrawer }: SidebarProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { signOut } = useAuthStore()
  const isPro = useIsPro()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const currentPath = location.pathname

  // Leave guard: a live cash/tournament table is in progress → confirm before
  // navigating away (the session is already checkpointed and stays resumable).
  const activeFormat = useLiveSession(s => s.activeFormat)
  const { isTouch } = useDevice()
  const [pendingNav, setPendingNav] = useState<string | null>(null)
  const go = (path: string): void => {
    if (activeFormat && currentPath === '/game' && path !== '/game') setPendingNav(path)
    else { navigate(path); onCloseDrawer?.(); setRevealed(false) }
  }

  // ── Mascot pointer ──────────────────────────────────────────────────────
  // A little runner that parks beside the *selected* menu item and dashes to
  // whatever row the mouse hovers; when the cursor leaves the menu he runs
  // back to the last selected item (lobby by default).
  const contentRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const selectedId = useMemo(
    () => NAV_ITEMS.find((i) => i.path === currentPath)?.id ?? 'lobby',
    [currentPath]
  )
  const [hoverId, setHoverId] = useState<string | null>(null)
  const shownId = hoverId ?? selectedId
  const [markerY, setMarkerY] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = itemRefs.current[shownId]
    if (el) setMarkerY(el.offsetTop + el.offsetHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, isPro, i18n.language, currentPath])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    signOut()
    navigate('/auth', { replace: true })
  }

  // Rendered OUTSIDE the (transform-animated) autoHide wrapper — a position:fixed
  // child of a transformed ancestor would anchor to that ancestor, not the viewport.
  const leaveModal = (
    <LeaveTableModal
      open={pendingNav !== null}
      onStay={() => setPendingNav(null)}
      onLeave={() => { const p = pendingNav; setPendingNav(null); if (p) navigate(p) }}
    />
  )

  const content = (
    <div ref={contentRef} className="relative w-[220px] flex-shrink-0 h-full bg-poker-darker border-r border-poker-border flex flex-col">
      {/* Logo (much smaller on touch so all menu items fit a short landscape height) */}
      <div className={isTouch ? 'px-3 pt-2 pb-1.5 flex items-center gap-2' : 'p-6 pb-4'}>
        <img src="/assets/yourpoker-logo.webp" alt="YourPoker — Elite Coaching" draggable={false}
          className={`rounded-xl border border-poker-gold/20 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] ${isTouch ? '' : 'w-full'}`}
          style={{ maxWidth: isTouch ? 96 : 184 }} />
        <div className={isTouch ? '' : 'flex flex-col items-center mt-3 w-full'}>
          <div className={isTouch ? '' : 'flex justify-center'}><LanguageSwitcher /></div>
          {!isTouch && <div className="mt-3 h-px w-full bg-gradient-to-r from-transparent via-poker-gold/30 to-transparent" />}
        </div>
      </div>
      {isTouch && <div className="mx-3 h-px bg-gradient-to-r from-transparent via-poker-gold/30 to-transparent" />}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto" onMouseLeave={() => setHoverId(null)}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeItem === item.id || currentPath === item.path

          return (
            <motion.button
              key={item.id}
              ref={(el) => { itemRefs.current[item.id] = el }}
              onClick={() => go(item.path)}
              onMouseEnter={() => setHoverId(item.id)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className={`w-full flex items-center gap-3 px-4 ${isTouch ? 'py-1.5' : 'py-3'} rounded-lg text-left transition-all duration-200 group relative ${
                isActive
                  ? 'bg-poker-teal/15 text-poker-teal'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              {/* Active indicator */}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-poker-teal rounded-r-full"
                />
              )}
              <span className={`transition-colors ${isActive ? 'text-poker-teal' : 'text-white/40 group-hover:text-white/70'}`}>
                {item.icon}
              </span>
              <span className="font-display font-semibold text-sm tracking-wide uppercase">
                {t(item.label)}
              </span>
              {item.pro && !isPro && <ProBadge className="ml-auto flex-shrink-0" />}
            </motion.button>
          )
        })}
      </nav>

      {/* Mascot pointer — runs to the hovered row, parks on the selected one.
          mix-blend screen melts its near-black backdrop into the dark sidebar
          for a holographic look; the radial mask feathers the edges. */}
      {markerY !== null && (
        <motion.div
          className="pointer-events-none absolute right-1 z-20 -translate-y-1/2"
          initial={false}
          animate={{ top: markerY, opacity: 1 }}
          transition={{
            top: { type: 'spring', stiffness: 460, damping: 30, mass: 0.7 },
            opacity: { duration: 0.3 }
          }}
        >
          {/* soft glow puck under the runner */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.22), transparent 70%)' }}
          />
          <motion.img
            src="/assets/mascot-runner.webp"
            alt=""
            draggable={false}
            animate={{ y: [0, -2.5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              height: 54,
              width: 'auto',
              scaleX: -1,
              mixBlendMode: 'screen',
              WebkitMaskImage:
                'radial-gradient(62% 66% at 50% 46%, #000 52%, transparent 100%)',
              maskImage: 'radial-gradient(62% 66% at 50% 46%, #000 52%, transparent 100%)',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5)) drop-shadow(0 0 7px rgba(0,212,255,0.4))'
            }}
          />
        </motion.div>
      )}

      {/* Bottom — upgrade CTA + logout + version */}
      <div className={isTouch ? 'p-2 space-y-1' : 'p-3 space-y-2'}>
        {isPro ? (
          <div className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#c9a227]/10 border border-[#c9a227]/30 text-[#c9a227]">
            <Crown size={13} /> <span className="text-[10px] font-black uppercase tracking-widest">{t('nav.proMember')}</span>
          </div>
        ) : (
          <button onClick={() => navigate('/pricing')}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
            <Sparkles size={13} /> {t('nav.goPro')}
          </button>
        )}

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <AnimatePresence>
          {confirmLogout ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2"
            >
              <p className="text-[10px] text-white/60 text-center uppercase tracking-wider">
                {t('nav.logoutConfirm')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
                >
                  {t('nav.cancel')}
                </button>
                <button
                  onClick={handleLogout}
                  className="flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  {t('nav.yes')}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="logout-btn"
              onClick={() => setConfirmLogout(true)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 group"
            >
              <LogOut size={18} />
              <span className="font-display font-semibold text-xs tracking-wide uppercase">
                {t('nav.logout')}
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        <p className="text-white/20 text-[10px] uppercase tracking-widest text-center">v1.0.0</p>
      </div>
    </div>
  )

  // Phone: off-canvas drawer with a dimmed backdrop, slides in from the left.
  if (drawer) {
    return (
      <>
        {leaveModal}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="drawer-backdrop"
                className="fixed inset-0 z-[90]"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onCloseDrawer}
              />
              <motion.div
                key="drawer-panel"
                className="fixed left-0 top-0 bottom-0 z-[100] shadow-2xl shadow-black/60"
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {content}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    )
  }

  // Normal pages: the menu is always docked.
  if (!autoHide) return <>{leaveModal}{content}</>

  // Immersive surfaces on TOUCH: replace the hover-to-reveal edge strip (unusable with
  // a finger) with a clearly-visible edge tab that opens the menu as a proper drawer.
  if (isTouch) {
    return (
      <>
        {leaveModal}
        <button onClick={() => setRevealed(true)} aria-label="Menu"
          className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-7 h-14 rounded-r-xl bg-poker-teal/20 border border-l-0 border-poker-teal/45 text-poker-teal active:bg-poker-teal/35"
          style={{ boxShadow: '0 0 14px -4px rgba(0,212,255,0.6)' }}>
          <ChevronRight size={16} />
        </button>
        <AnimatePresence>
          {revealed && (
            <>
              <motion.div key="bg" className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.6)' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRevealed(false)} />
              <motion.div key="panel" className="fixed left-0 top-0 bottom-0 z-[100] shadow-2xl shadow-black/60"
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                {content}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    )
  }

  // Game table: the menu hides for immersion and reveals on a left-edge hover with a
  // laser sweep. A thin glowing strip + pulsing handle shows it's there.
  return (
    <>
      {leaveModal}
      <div className="fixed left-0 top-0 bottom-0 w-4 z-40" onMouseEnter={() => setRevealed(true)}>
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-poker-teal to-transparent opacity-70" style={{ boxShadow: '0 0 8px #00d4ff' }} />
        <motion.div className="absolute left-0 top-1/2 -translate-y-1/2"
          animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}>
          <div className="flex items-center justify-center w-5 h-12 rounded-r-lg bg-poker-teal/15 border border-l-0 border-poker-teal/40 text-poker-teal">
            <ChevronRight size={14} />
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={false}
        animate={{ x: revealed ? 0 : '-101%' }}
        transition={{ type: 'tween', duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        onMouseLeave={() => { setRevealed(false); setConfirmLogout(false) }}
        className="fixed left-0 top-0 bottom-0 z-50 shadow-2xl shadow-black/60"
      >
        {revealed && (
          <motion.div
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 260, opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-y-0 w-16 z-20 bg-gradient-to-r from-transparent via-poker-teal/40 to-transparent blur-md"
          />
        )}
        {content}
      </motion.div>
    </>
  )
}
