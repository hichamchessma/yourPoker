/// <reference types="vite/client" />

interface Window {
  api: {
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
  }
}
