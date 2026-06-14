import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './assets/styles/globals.css'
import { supabase } from './lib/supabase'
import { isWeb } from './lib/platform'
import { useAuthStore } from './store/authStore'
import { refreshProFromServer } from './lib/entitlements'

// Register the auth listener FIRST so no event is missed during the callback exchange.
supabase.auth.onAuthStateChange((event, session) => {
  // A recovery link opens a temporary session AND fires PASSWORD_RECOVERY — flag it so
  // the app shows the "new password" screen instead of the lobby.
  if (event === 'PASSWORD_RECOVERY') {
    useAuthStore.getState().setPasswordRecovery(true)
  }
  useAuthStore.getState().setSession(session)
  // Sync the real Pro status from the server whenever a session is present.
  if (session) refreshProFromServer()
})

// Safety: never get stuck on the loading spinner if no auth event ever arrives.
setTimeout(() => useAuthStore.getState().setLoading(false), 2500)

// ── Web auth callback (OAuth / magic link / password recovery) ──────────────────
// In a HashRouter SPA, Supabase's automatic detectSessionInUrl can race with the router
// rewriting the URL and silently miss the code. So on web we DISABLE it (see supabase.ts)
// and exchange the callback ourselves here, deterministically, before React mounts. We
// read the session from the exchange result directly (not just the event) so it's applied
// regardless of timing. Handles PKCE (?code=) and implicit (#access_token=) returns.
if (isWeb) {
  const href = window.location.href
  if (href.includes('type=recovery')) useAuthStore.getState().setPasswordRecovery(true)

  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')
  // The hash is either a router path (#/route) or implicit tokens (#access_token=...).
  const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  const hashParams = new URLSearchParams(rawHash.includes('=') ? rawHash : '')
  const access_token = hashParams.get('access_token')
  const refresh_token = hashParams.get('refresh_token')
  // Errors (e.g. provider denied) are left in the URL for AuthPage to surface.
  const hasError = /[?#&]error(?:_description)?=/.test(href)

  if (!hasError && (code || (access_token && refresh_token))) {
    useAuthStore.getState().setLoading(true)
    ;(async () => {
      try {
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
          if (data.session) useAuthStore.getState().setSession(data.session)
        } else if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) throw error
          if (data.session) useAuthStore.getState().setSession(data.session)
        }
        // Strip callback params so a refresh doesn't re-trigger, and hand a clean hash
        // route to the router.
        const recovery = useAuthStore.getState().passwordRecovery
        window.history.replaceState({}, document.title, window.location.origin + (recovery ? '/#/auth' : '/#/'))
      } catch (err) {
        console.error('[auth] web callback exchange failed:', err)
      } finally {
        useAuthStore.getState().setLoading(false)
      }
    })()
  }
}

// Handle OAuth deep link (desktop): yourpoker://auth/callback?code=... (PKCE)
//                                or yourpoker://auth/callback#access_token=... (implicit)
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
