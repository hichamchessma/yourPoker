import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check } from 'lucide-react'
import { LANGS } from '../i18n'

// Real SVG flags — emoji flags don't render on Windows (they show "FR"/"GB"/"ES").
export function Flag({ code, size = 18 }: { code: string; size?: number }) {
  const h = Math.round(size * 0.67)
  const common = { width: size, height: h, style: { borderRadius: 2, display: 'block', flexShrink: 0 } as React.CSSProperties }
  if (code === 'fr') return (
    <svg viewBox="0 0 3 2" {...common}><rect width="1" height="2" fill="#0055A4" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#EF4135" /></svg>
  )
  if (code === 'es') return (
    <svg viewBox="0 0 3 2" {...common}><rect width="3" height="2" fill="#AA151B" /><rect y="0.5" width="3" height="1" fill="#F1BF00" /></svg>
  )
  // en → Union Jack (outer svg clips the overflowing diagonals)
  return (
    <svg viewBox="0 0 60 30" {...common}>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  )
}

// Compact language picker. Drop it in any header.
export default function LanguageSwitcher({ className = '', up = false }: { className?: string; up?: boolean }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const cur = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2)
  const active = LANGS.find(l => l.code === cur) ?? LANGS[1]

  return (
    <div className={`relative ${className}`} onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70"
        title="Language">
        <Globe size={14} className="opacity-60" />
        <Flag code={active.code} size={18} />
      </button>
      {open && (
        <div className={`absolute right-0 py-1 rounded-lg bg-[#0c1424] border border-white/10 shadow-xl z-[100] min-w-[150px] ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {LANGS.map(l => (
            <button key={l.code}
              onClick={() => { i18n.changeLanguage(l.code); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors">
              <Flag code={l.code} size={20} />
              <span className="text-[12px] text-white/75 flex-1">{l.label}</span>
              {l.code === cur && <Check size={13} className="text-[#c9a227]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
