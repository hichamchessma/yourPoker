import { contextBridge, ipcRenderer } from 'electron'

const api = {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onAuthDeepLink: (callback: (url: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('auth-deep-link', handler)
    return () => ipcRenderer.removeListener('auth-deep-link', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
