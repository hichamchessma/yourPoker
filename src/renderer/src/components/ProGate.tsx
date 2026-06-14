import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Lock, Sparkles, ArrowRight } from 'lucide-react'

// Full-page lock shown when a Free user opens a Pro feature. Sends them to /pricing.
export default function ProGate({ title, desc }: { title: string; desc: string }) {
  const navigate = useNavigate()
  return (
    <div className="h-full w-full flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(130% 100% at 50% -10%, #14223a 0%, #0a1120 45%, #060912 100%)' }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center rounded-3xl border border-[#c9a227]/30 p-8"
        style={{ background: 'linear-gradient(160deg, rgba(201,162,39,0.10), transparent)' }}>
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#c9a227]/15 border border-[#c9a227]/40 flex items-center justify-center mb-4">
          <Lock size={26} className="text-[#c9a227]" />
        </div>
        <h2 className="text-xl font-black text-white">{title} <span className="text-[#c9a227]">· Pro</span></h2>
        <p className="text-[13px] text-white/50 mt-2 leading-relaxed">{desc}</p>
        <button onClick={() => navigate('/pricing')}
          className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-wide transition-all hover:brightness-110"
          style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#0a0a0a' }}>
          <Sparkles size={16} /> Passer Pro <ArrowRight size={16} />
        </button>
        <p className="text-[10px] text-white/30 mt-3">Pendant la bêta, le Pro est offert.</p>
      </motion.div>
    </div>
  )
}
