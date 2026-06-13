import { useState } from 'react'
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
  LogOut,
  ChevronRight
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
}

// Only routes that actually exist (App.tsx). Dead entries (Bibliothèque, Statistiques,
// Classement, Support) were removed to avoid menu dead-ends; re-add them with a real
// page when built.
const NAV_ITEMS: NavItem[] = [
  { id: 'lobby', label: 'Accueil (Lobby)', icon: <Home size={20} />, path: '/lobby' },
  { id: 'handtrainer', label: 'Hand Trainer', icon: <Target size={20} />, path: '/handtrainer' },
  { id: 'training', label: 'Entraînement CashGame', icon: <GraduationCap size={20} />, path: '/training' },
  { id: 'tournament', label: 'Entraînement Tournoi', icon: <Medal size={20} />, path: '/tournament' },
  { id: 'simulation', label: 'Simulation (banc de test)', icon: <FlaskConical size={20} />, path: '/simulation' },
  { id: 'setup', label: 'Scénario sur mesure', icon: <SlidersHorizontal size={20} />, path: '/setup' },
  { id: 'profile', label: 'Profil', icon: <User size={20} />, path: '/profile' },
  { id: 'history', label: 'Historique', icon: <History size={20} />, path: '/history' },
]

interface SidebarProps {
  activeItem?: string
  /** On the game table we hide the menu and reveal it on a left-edge hover (immersion). */
  autoHide?: boolean
}

export default function Sidebar({ activeItem, autoHide = false }: SidebarProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuthStore()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const currentPath = location.pathname

  const handleLogout = async () => {
    await supabase.auth.signOut()
    signOut()
    navigate('/auth', { replace: true })
  }

  const content = (
    <div className="w-[220px] flex-shrink-0 h-full bg-poker-darker border-r border-poker-border flex flex-col">
      {/* Logo */}
      <div className="p-6 pb-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 relative">
            {/* Spade logo placeholder */}
            <div className="w-full h-full rounded-full border-2 border-poker-gold/50 flex items-center justify-center bg-poker-gold/10">
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-poker-gold">
                <path d="M12 2C8 6 4 8 4 12c0 2.5 1.5 4 3.5 4 .8 0 1.5-.2 2.1-.6L9 17H7v2h10v-2h-2l-.6-1.6c.6.4 1.3.6 2.1.6 2 0 3.5-1.5 3.5-4 0-4-4-6-8-10z" />
              </svg>
            </div>
          </div>
          <div className="text-center">
            <p className="font-display font-bold text-white text-sm tracking-widest uppercase">Poker Elite</p>
            <p className="text-poker-gold/70 text-[10px] tracking-[0.25em] uppercase">— Coach —</p>
          </div>
        </div>
        <div className="mt-4 h-px bg-gradient-to-r from-transparent via-poker-gold/30 to-transparent" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeItem === item.id || currentPath === item.path

          return (
            <motion.button
              key={item.id}
              onClick={() => navigate(item.path)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200 group relative ${
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
                {item.label}
              </span>
            </motion.button>
          )
        })}
      </nav>

      {/* Bottom — logout + version */}
      <div className="p-3 space-y-2">
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
                Se déconnecter ?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleLogout}
                  className="flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Oui
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
                Déconnexion
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        <p className="text-white/20 text-[10px] uppercase tracking-widest text-center">v1.0.0</p>
      </div>
    </div>
  )

  // Normal pages: the menu is always docked.
  if (!autoHide) return content

  // Game table: the menu hides for immersion and reveals on a left-edge hover with a
  // laser sweep. A thin glowing strip + pulsing handle shows it's there.
  return (
    <>
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
