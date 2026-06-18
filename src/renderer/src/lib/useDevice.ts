import { useEffect, useState } from 'react'

// Lightweight device/orientation detector for the responsive + touch adaptation.
// Pure read of matchMedia + viewport — no side effects, safe on desktop (returns
// the same desktop profile it always had).

export interface DeviceInfo {
  /** Coarse pointer — a finger rather than a mouse. Drives tap-vs-hover behaviour. */
  isTouch: boolean
  /** Phone-sized viewport (< 768px on the short side). */
  isPhone: boolean
  /** Tablet-sized viewport (768–1023px). */
  isTablet: boolean
  isPortrait: boolean
  isLandscape: boolean
  width: number
  height: number
}

function read(): DeviceInfo {
  if (typeof window === 'undefined') {
    return { isTouch: false, isPhone: false, isTablet: false, isPortrait: false, isLandscape: true, width: 1280, height: 800 }
  }
  const w = window.innerWidth
  const h = window.innerHeight
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const portrait = h >= w
  return {
    isTouch: coarse,
    isPhone: Math.min(w, h) < 768,
    isTablet: Math.min(w, h) >= 768 && Math.min(w, h) < 1024,
    isPortrait: portrait,
    isLandscape: !portrait,
    width: w,
    height: h
  }
}

export function useDevice(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(read)
  useEffect(() => {
    const onChange = () => setInfo(read())
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
    }
  }, [])
  return info
}
