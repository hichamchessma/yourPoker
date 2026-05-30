/// <reference types="vite/client" />

interface Window {
  api: {
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
    openExternal: (url: string) => Promise<void>
    onAuthDeepLink: (callback: (url: string) => void) => () => void
  }
}
