import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  envDir: resolve(__dirname, '.'),
  plugins: [
    react(),
    // PWA — makes the web build installable ("Add to Home Screen") with offline
    // caching. Only affects the web (browser) build; the Electron build uses
    // electron.vite.config.ts and never loads this plugin. autoUpdate + skipWaiting
    // keep installs fresh on every deploy (no stale-cache lock-in).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'YourPoker — Elite Poker Coaching',
        short_name: 'YourPoker',
        description: 'Entraîne-toi au poker avec un coach en direct : cash, tournois MTT, ranges et analyse de mains.',
        theme_color: '#0a1120',
        background_color: '#05070e',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,webp,png,woff2,ttf}'],
        // The "Angry Coach" images are large (~3.6 MB) and only needed when the alarm
        // fires → keep them OUT of the install precache; the browser fetches + caches
        // them on demand. Everything else (cards, fonts, bundles) stays offline-ready.
        globIgnores: ['**/assets/cards/enervement*.png'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
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
