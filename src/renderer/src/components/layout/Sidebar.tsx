import { motion } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  GraduationCap,
  BookOpen,
  BarChart2,
  User,
  Trophy,
  HeadphonesIcon
} from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'lobby', label: 'Accueil (Lobby)', icon: <Home size={20} />, path: '/lobby' },
  { id: 'training', label: 'Entraînement', icon: <GraduationCap size={20} />, path: '/training' },
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

  const currentPath = location.pathname

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

      {/* Bottom version */}
      <div className="p-4 text-center">
        <p className="text-white/20 text-[10px] uppercase tracking-widest">v1.0.0</p>
      </div>
    </aside>
  )
}
