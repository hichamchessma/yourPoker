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
  /** Skip heavy looping animations (touch device, or OS "reduce motion"): saves battery/heat. */
  reduceFx: boolean
}

function read(): DeviceInfo {
  if (typeof window === 'undefined') {
    return { isTouch: false, isPhone: false, isTablet: false, isPortrait: false, isLandscape: true, width: 1280, height: 800, reduceFx: false }
  }
  const w = window.innerWidth
  const h = window.innerHeight
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const portrait = h >= w
  // A phone is a COARSE-POINTER device whose SHORTER side is < 768px — true in both
  // portrait AND landscape (a phone in landscape is wide but only ~400px tall). The
  // `coarse` gate keeps wide-but-short DESKTOP windows (mouse) out, so they stay
  // "desktop" and never regress to the mobile chrome.
  const minSide = Math.min(w, h)
  return {
    isTouch: coarse,
    isPhone: coarse && minSide < 768,
    isTablet: coarse && minSide >= 768 && minSide < 1024,
    isPortrait: portrait,
    isLandscape: !portrait,
    width: w,
    height: h,
    reduceFx: coarse || reducedMotion
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
