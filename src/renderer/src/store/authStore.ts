import { create } from 'zustand'
import { Session, User } from '@supabase/supabase-js'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  // True after a password-recovery link is opened: the app must show the
  // "set a new password" screen instead of the lobby, even though a (recovery)
  // session is technically active.
  passwordRecovery: boolean
  setSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
  setPasswordRecovery: (v: boolean) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  // Start in loading: the app shows a spinner until Supabase restores the session,
  // so a logged-in user never flashes the landing/login before redirecting.
  loading: true,
  passwordRecovery: false,
  setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
  setLoading: (loading) => set({ loading }),
  setPasswordRecovery: (v) => set({ passwordRecovery: v }),
  signOut: () => set({ session: null, user: null, passwordRecovery: false })
}))
