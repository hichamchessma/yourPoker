import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { History, Medal, Coins, Trash2, Play, Calendar } from 'lucide-react'
import { loadSessions, deleteSession, type SessionKind, type SavedSession } from '../lib/historyStore'
import { HandHistoryModal } from './GamePage'

export default function HistoryPage() {
  const { t, i18n } = useTranslation()
  const [kind, setKind] = useState<SessionKind>('tournament')
  const [sessions, setSessions] = useState<SavedSession[]>(() => loadSessions('tournament'))
  const [open, setOpen] = useState<SavedSession | null>(null)

  function switchKind(k: SessionKind) { setKind(k); setSessions(loadSessions(k)) }
  function remove(id: number) { deleteSession(kind, id); setSessions(loadSessions(kind)) }

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #0d1322 0%, #080b14 60%, #05070e 100%)' }}>
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
        <History className="text-[#c9a227]" size={22} />
        <div>
          <h1 className="text-lg font-black text-[#c9a227] uppercase tracking-[0.2em]">{t('hist.title')}</h1>
          <p className="text-[10px] text-white/35 uppercase tracking-widest">{t('hist.subtitle')}</p>
        </div>
      </div>

      {/* tabs */}
      <div className="px-6 pt-4 flex gap-2">
        <Tab active={kind === 'tournament'} onClick={() => switchKind('tournament')} icon={<Medal size={14} />} label={t('hist.tabTournaments')} />
        <Tab active={kind === 'cash'} onClick={() => switchKind('cash')} icon={<Coins size={14} />} label={t('hist.tabCash')} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-white/30">
            <History size={48} className="mb-3 opacity-40" />
            <p className="text-sm">{kind === 'tournament' ? t('hist.emptyTournament') : t('hist.emptyCash')}</p>
            <p className="text-[11px] mt-1">{kind === 'tournament' ? t('hist.hintTournament') : t('hist.hintCash')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl mx-auto">
            {sessions.map(s => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="group rounded-2xl border border-white/10 bg-white/[0.02] p-4 hover:border-[#c9a227]/30 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-[13px] font-black text-white/85">{s.title}</h3>
                    <p className="text-[11px] text-white/45 mt-0.5">{s.subtitle}</p>
                  </div>
                  <span className={`text-[15px] font-black font-mono ${s.resultBB > 0 ? 'text-emerald-400' : s.resultBB < 0 ? 'text-red-400' : 'text-white/40'}`}>
                    {s.resultBB > 0 ? '+' : ''}{kind === 'tournament' ? `$${Math.abs(s.resultBB).toLocaleString()}` : `${s.resultBB} BB`}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/5">
                  <span className="flex items-center gap-1.5 text-[10px] text-white/35"><Calendar size={11} /> {new Date(s.date).toLocaleString(i18n.language, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {t('hist.moves', { count: s.hands.length })}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setOpen(s)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#c9a227]/15 border border-[#c9a227]/40 text-[#c9a227] hover:bg-[#c9a227]/25"><Play size={11} /> {t('hist.replay')}</button>
                    <button onClick={() => remove(s.id)} className="text-white/25 hover:text-red-400 transition-colors p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && open.hands.length > 0 && (
          <HandHistoryModal records={open.hands} onClose={() => setOpen(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all ${active ? 'bg-[#c9a227]/15 border-[#c9a227]/50 text-[#c9a227]' : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/10'}`}>
      {icon} {label}
    </button>
  )
}
