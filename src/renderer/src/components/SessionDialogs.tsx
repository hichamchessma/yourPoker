import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { DoorOpen, Play, RotateCcw, Sparkles } from 'lucide-react'

const backdrop =
  'fixed inset-0 z-[200] flex items-center justify-center p-4'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={backdrop} style={{ background: 'rgba(3,5,10,0.72)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ scale: 0.92, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="relative w-full max-w-[420px] rounded-2xl border p-6 text-center"
        style={{
          background: 'linear-gradient(180deg, rgba(16,22,38,0.98), rgba(9,13,24,0.98))',
          borderColor: 'rgba(201,162,39,0.28)',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8), 0 0 40px -16px rgba(201,162,39,0.35)'
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.6), rgba(0,212,255,0.4), transparent)' }} />
        {children}
      </motion.div>
    </div>
  )
}

/** Asked when the player tries to leave a live table. */
export function LeaveTableModal({
  open, onStay, onLeave
}: { open: boolean; onStay: () => void; onLeave: () => void }) {
  const { t } = useTranslation()
  return (
    <AnimatePresence>
      {open && (
        <Shell>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(201,162,39,0.14)', border: '1px solid rgba(201,162,39,0.35)' }}>
            <DoorOpen size={22} className="text-[#f0c060]" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">{t('resume.leaveTitle')}</h2>
          <p className="mt-2 text-[13px] text-white/55 leading-relaxed">{t('resume.leaveBody')}</p>
          <div className="mt-5 flex gap-3">
            <button onClick={onStay}
              className="flex-1 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest text-white/70 border border-white/12 hover:bg-white/5 transition-colors">
              {t('resume.leaveStay')}
            </button>
            <button onClick={onLeave}
              className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
              {t('resume.leaveConfirm')}
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  )
}

/** Asked before the setup page when a resumable session of that format exists. */
export function ResumeSessionModal({
  open, label, onResume, onNew
}: { open: boolean; label: string; onResume: () => void; onNew: () => void }) {
  const { t } = useTranslation()
  return (
    <AnimatePresence>
      {open && (
        <Shell>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <RotateCcw size={22} className="text-[#00d4ff]" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">{t('resume.title')}</h2>
          <p className="mt-2 text-[13px] text-white/55">{t('resume.subtitle')}</p>

          <button onClick={onResume}
            className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg,#16c79a,#0e8f6e)', color: '#04140c', boxShadow: '0 0 24px -8px rgba(22,199,154,0.7)' }}>
            <Play size={15} /> {t('resume.resumeBtn')}
          </button>
          <p className="mt-1.5 text-[11px] text-[#00d4ff]/70 font-mono">{label}</p>

          <button onClick={onNew}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest text-white/60 border border-white/12 hover:bg-white/5 hover:text-white/80 transition-colors">
            <Sparkles size={14} /> {t('resume.newBtn')}
          </button>
          <p className="mt-1.5 text-[10px] text-white/30">{t('resume.newNote')}</p>
        </Shell>
      )}
    </AnimatePresence>
  )
}
