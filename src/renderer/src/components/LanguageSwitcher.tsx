import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check } from 'lucide-react'
import { LANGS } from '../i18n'

// Compact language picker (flag + dropdown). Drop it in any header.
export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const cur = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2)
  const active = LANGS.find(l => l.code === cur) ?? LANGS[1]

  return (
    <div className={`relative ${className}`} onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70"
        title="Language">
        <Globe size={15} />
        <span className="text-[13px] leading-none">{active.flag}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 py-1 rounded-lg bg-[#0c1424] border border-white/10 shadow-xl z-[100] min-w-[150px]">
          {LANGS.map(l => (
            <button key={l.code}
              onClick={() => { i18n.changeLanguage(l.code); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors">
              <span className="text-[15px]">{l.flag}</span>
              <span className="text-[12px] text-white/75 flex-1">{l.label}</span>
              {l.code === cur && <Check size={13} className="text-[#c9a227]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
