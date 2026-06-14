// Small "PRO" tag for menu items and locked features.
export default function ProBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${className}`}
      style={{ background: 'linear-gradient(135deg,#f0d060,#c9a227)', color: '#1a1206' }}>
      Pro
    </span>
  )
}
