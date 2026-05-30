import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './assets/styles/globals.css'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session)
})

// Handle OAuth deep link: yourpoker://auth/callback?code=... (PKCE)
//                      or yourpoker://auth/callback#access_token=... (implicit)
window.api?.onAuthDeepLink?.(async (deepLinkUrl: string) => {
  try {
    const normalized = deepLinkUrl.replace(/\\/g, '/')
    const hashIdx = normalized.indexOf('#')
    const queryIdx = normalized.indexOf('?')

    if (hashIdx !== -1) {
      // Implicit flow — Supabase returns tokens directly in hash
      const params = new URLSearchParams(normalized.slice(hashIdx + 1))
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (error) console.error('[auth] setSession:', error.message)
        else if (data.session) useAuthStore.getState().setSession(data.session)
      }
    } else if (queryIdx !== -1) {
      // PKCE flow — exchange code for session
      const params = new URLSearchParams(normalized.slice(queryIdx + 1))
      const code = params.get('code')
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('[auth] exchangeCodeForSession:', error.message)
        else if (data.session) useAuthStore.getState().setSession(data.session)
      }
    }
  } catch (err) {
    console.error('[auth] deep link error:', err)
  }
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
