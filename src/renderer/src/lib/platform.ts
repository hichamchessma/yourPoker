// Platform detection — the same renderer ships to Electron (desktop) and the web.
// On the web `window.api` (exposed by the Electron preload) is undefined, so every
// Electron-only path is gated behind `isElectron`. Keeps a single codebase for both.
export const isElectron: boolean =
  typeof window !== 'undefined' && !!(window as unknown as { api?: unknown }).api

export const isWeb = !isElectron
