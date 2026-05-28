const { spawn, execSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 5173

// Step 1 — build main + preload
console.log('[dev] Building main & preload...')
try {
  execSync('npx electron-vite build', { stdio: 'inherit', cwd: ROOT })
} catch (e) {
  process.exit(1)
}

// Step 2 — start Vite renderer dev server
console.log('[dev] Starting renderer dev server on port', PORT, '...')
const vite = spawn(
  'npx',
  ['vite', '--config', 'vite.renderer.config.ts', '--port', String(PORT), '--strictPort'],
  { stdio: 'inherit', cwd: ROOT, shell: true }
)

vite.on('error', (err) => {
  console.error('[dev] Vite error:', err)
  process.exit(1)
})

// Step 3 — wait for Vite then launch Electron (no ELECTRON_RUN_AS_NODE!)
const waitOn = require('wait-on')
const RENDERER_URL = `http://localhost:${PORT}`

waitOn({ resources: [RENDERER_URL], timeout: 30000 }).then(() => {
  console.log('[dev] Renderer ready. Launching Electron...')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE  // Must be unset — if set, Electron runs as plain Node.js (no API)

  const electron = spawn(ELECTRON_BIN, ['.'], {
    env: {
      ...env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: RENDERER_URL
    },
    stdio: 'inherit',
    cwd: ROOT
  })

  electron.on('close', (code) => {
    console.log('[dev] Electron closed.')
    vite.kill()
    process.exit(code ?? 0)
  })
}).catch((err) => {
  console.error('[dev] Vite did not start in time:', err.message)
  vite.kill()
  process.exit(1)
})

process.on('SIGINT', () => {
  vite.kill()
  process.exit(0)
})
