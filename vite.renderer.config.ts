import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  envDir: resolve(__dirname, '.'),
  plugins: [react()],
  css: {
    postcss: resolve(__dirname, 'postcss.config.js')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  // Web (browser) build target — a standalone static SPA. HashRouter means no server
  // rewrites are needed, so the output deploys as-is to any static host (Vercel/Netlify).
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
})
