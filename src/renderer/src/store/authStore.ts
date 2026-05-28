import { create } from 'zustand'
import { Session, User } from '@supabase/supabase-js'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  setSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
  setLoading: (loading) => set({ loading }),
  signOut: () => set({ session: null, user: null })
}))
