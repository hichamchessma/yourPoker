import { spawn } from 'child_process'
import { createServer } from 'vite'
import { build } from 'electron-vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const electronBin = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')

async function startDev() {
  // 1. Build main + preload
  console.log('Building main & preload...')
  await build({
    main: { build: { watch: {} } },
    preload: { build: { watch: {} } }
  })

  // 2. Start Vite renderer dev server
  const viteServer = await createServer({
    configFile: false,
    root: path.join(__dirname, 'src', 'renderer'),
    server: { port: 5173 }
  })
  await viteServer.listen()
  console.log('Renderer dev server: http://localhost:5173')

  // 3. Start Electron with ELECTRON_RENDERER_URL
  const electronProcess = spawn(electronBin, ['.'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: 'http://localhost:5173'
    },
    stdio: 'inherit'
  })

  electronProcess.on('close', () => {
    viteServer.close()
    process.exit(0)
  })
}

startDev().catch(console.error)
