import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  GraduationCap,
  Medal,
  SlidersHorizontal,
  BookOpen,
  BarChart2,
  User,
  Trophy,
  HeadphonesIcon,
  LogOut
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'lobby', label: 'Accueil (Lobby)', icon: <Home size={20} />, path: '/lobby' },
  { id: 'training', label: 'Entraînement CashGame', icon: <GraduationCap size={20} />, path: '/training' },
  { id: 'tournament', label: 'Entraînement Tournoi', icon: <Medal size={20} />, path: '/tournament' },
  { id: 'setup', label: 'Scénario sur mesure', icon: <SlidersHorizontal size={20} />, path: '/setup' },
  { id: 'library', label: 'Bibliothèque', icon: <BookOpen size={20} />, path: '/library' },
  { id: 'stats', label: 'Statistiques', icon: <BarChart2 size={20} />, path: '/stats' },
  { id: 'profile', label: 'Profil', icon: <User size={20} />, path: '/profile' },
  { id: 'ranking', label: 'Classement', icon: <Trophy size={20} />, path: '/ranking' },
  { id: 'support', label: 'Support', icon: <HeadphonesIcon size={20} />, path: '/support' }
]

interface SidebarProps {
  activeItem?: string
}

export default function Sidebar({ activeItem }: SidebarProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuthStore()
  const [confirmLogout, setConfirmLogout] = useState(false)

  const currentPath = location.pathname

  const handleLogout = async () => {
    await supabase.auth.signOut()
    signOut()
    navigate('/auth', { replace: true })
  }

  return (
    <aside className="w-[220px] flex-shrink-0 bg-poker-darker border-r border-poker-border flex flex-col">
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
    </aside>
  )
}
