/// <reference types="vite/client" />

interface Window {
  electron: import('@electron-toolkit/preload').ElectronAPI
  api: {
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
  }
}
