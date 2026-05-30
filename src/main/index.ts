import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null

// Register yourpoker:// protocol — in dev mode include the app path so Windows
// launches the existing instance correctly instead of trying to load the URL as a module
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('yourpoker', process.execPath, [resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('yourpoker')
}

// Windows: single instance lock so deep link redirects reach the existing window
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const deepLink = argv.find(arg => arg.startsWith('yourpoker://'))
    if (deepLink) mainWindow?.webContents.send('auth-deep-link', deepLink)
  })
}

// macOS: deep link comes via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainWindow?.webContents.send('auth-deep-link', url)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0f1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', code, desc, url)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone', details)
  })

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 1) console.log('[renderer]', message)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.yourpoker.app')
  }

  ipcMain.on('minimize-window', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('maximize-window', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('close-window', () => BrowserWindow.getFocusedWindow()?.close())

  // Open system browser for OAuth (can't open external URLs from renderer directly)
  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
