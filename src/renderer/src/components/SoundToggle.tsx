import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useSoundStore } from '../store/soundStore'
import { playSound } from '../lib/sound'

// Mute toggle + volume slider (on hover). Drop it in any header.
export default function SoundToggle({ className = '' }: { className?: string }) {
  const { muted, volume, toggleMute, setVolume } = useSoundStore()
  const [open, setOpen] = useState(false)

  return (
    <div className={`relative ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        onClick={() => { toggleMute(); if (muted) playSound('click') }}
        title={muted ? 'Activer le son' : 'Couper le son'}
        className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white/90"
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
      {open && !muted && (
        <div className="absolute top-full right-0 mt-1 p-2 rounded-lg bg-black/85 border border-white/10 backdrop-blur z-50">
          <input
            type="range" min={0} max={1} step={0.05} value={volume}
            onChange={e => { setVolume(Number(e.target.value)); }}
            onMouseUp={() => playSound('chips')}
            className="w-24 accent-[#c9a227] cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}
