import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './assets/styles/globals.css'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'

// Bootstrap: restore session on launch (no-op if Supabase not configured yet)
supabase.auth.getSession().then(({ data }) => {
  useAuthStore.getState().setSession(data.session)
}).catch(() => {
  useAuthStore.getState().setSession(null)
})

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
