import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { isElectron } from './platform'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const isConfigured = supabaseUrl && supabaseUrl !== 'your_supabase_project_url' && supabaseAnonKey && supabaseAnonKey !== 'your_supabase_anon_key'

// Returns a no-op client when Supabase is not configured yet
function createNoopClient(): SupabaseClient {
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: () => Promise.resolve({ data: { session: null, user: null }, error: { message: 'Supabase non configuré — ajoutez vos credentials dans .env' } as never }),
      signInWithOAuth: () => Promise.resolve({ data: { provider: null, url: null }, error: null })
    }
  } as unknown as SupabaseClient
}

export const supabase: SupabaseClient = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      // Desktop uses a deep-link token flow (session injected manually), so it keeps
      // persistSession off. On the web we want the standard browser flow: persist the
      // session in localStorage and let Supabase parse the OAuth callback from the URL.
      auth: isElectron
        ? { persistSession: false }
        : { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : createNoopClient()

export const isSupabaseConfigured = isConfigured
