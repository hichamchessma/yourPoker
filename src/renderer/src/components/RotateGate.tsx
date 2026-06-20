import { motion } from 'framer-motion'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDevice } from '../lib/useDevice'

/**
 * Forced-landscape gate. On a phone held in PORTRAIT it covers the surface with a
 * "rotate your device" prompt — the cash/tournament setup, the live table and the
 * hand-history replay all need the width of landscape to fit on one screen.
 * Renders nothing on desktop/tablet or when the phone is already in landscape.
 */
export default function RotateGate({ onQuit }: { onQuit?: () => void }): JSX.Element | null {
  const { isPhone, isPortrait } = useDevice()
  const { t } = useTranslation()
  if (!isPhone || !isPortrait) return null
  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: 'rgba(4,6,12,0.97)' }}>
      <motion.div animate={{ rotate: [0, 0, 90, 90, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.2, 0.45, 0.75, 1] }}>
        <RotateCw size={58} className="text-[#00d4ff]" />
      </motion.div>
      <div>
        <h2 className="text-lg font-black text-white">{t('game.rotateTitle')}</h2>
        <p className="mt-1.5 text-[13px] text-white/55 max-w-xs mx-auto">{t('game.rotateBody')}</p>
      </div>
      {onQuit && (
        <button onClick={onQuit}
          className="mt-2 text-[12px] text-white/45 underline underline-offset-2 hover:text-white/70">
          {t('game.quit')}
        </button>
      )}
    </div>
  )
}
