// ─────────────────────────────────────────────────────────────────────────────
// Free vs Pro entitlements. The whole paywall UX is built around `isPro`.
//
// SOURCE OF TRUTH (later): a server-validated subscription flag written by the
// Stripe/MoR webhook into the user's row in Supabase. Until that backend is wired,
// `isPro` is a LOCAL stub persisted in localStorage. During the open beta the Pricing
// page grants Pro for free (one click) so nothing is actually locked away — but the
// full gating UX is real and visible. When payments go live, only the source flips:
// `isPro` reads the server flag and "Passer Pro" opens checkout.
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand'
import { supabase } from './supabase'

const LS_PRO = 'yourpoker_pro'

interface EntitlementsState {
  isPro: boolean
  setPro: (v: boolean) => void
}

export const useEntitlements = create<EntitlementsState>((set) => ({
  isPro: localStorage.getItem(LS_PRO) === '1',
  setPro: (v: boolean) => { localStorage.setItem(LS_PRO, v ? '1' : '0'); set({ isPro: v }) },
}))

export function useIsPro(): boolean {
  return useEntitlements((s) => s.isPro)
}

// Read the REAL Pro status from the server (the subscriptions table, written by the
// webhook). If the table/row doesn't exist yet (beta, payments not wired), we leave the
// local stub untouched — so the beta "free unlock" keeps working. Once a real row
// exists, the server is authoritative (handles renewals AND cancellations).
export async function refreshProFromServer(): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    const { data, error } = await supabase
      .from('subscriptions')
      .select('status,current_period_end')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || data == null) return // not configured / no subscription → keep local stub
    const active = data.status === 'active' &&
      (!data.current_period_end || new Date(data.current_period_end as string) > new Date())
    useEntitlements.getState().setPro(active)
  } catch { /* ignore — offline / not configured */ }
}

// The Lemon Squeezy checkout URL for a billing cycle, or null in beta (not configured).
// The user id is passed as custom data so the webhook can map the payment back.
export function checkoutUrl(cycle: 'monthly' | 'yearly', email?: string, userId?: string): string | null {
  const base = (cycle === 'yearly'
    ? import.meta.env.VITE_LS_CHECKOUT_YEARLY
    : import.meta.env.VITE_LS_CHECKOUT_MONTHLY) as string | undefined
  if (!base) return null
  try {
    const url = new URL(base)
    if (email) url.searchParams.set('checkout[email]', email)
    if (userId) url.searchParams.set('checkout[custom][user_id]', userId)
    return url.toString()
  } catch { return base }
}

// Features reserved for Pro (used for menu badges + page gates). Easy to re-split.
export const PRO_FEATURES = {
  simulation: 'Simulation (banc de test)',
  scenario: 'Scénario sur mesure',
} as const

// What each plan includes — drives the Pricing page comparison.
export const PLAN_FREE = [
  'Hand Trainer (lecture de spot & décisions)',
  'Cash game avec le coach en direct',
  'Tournois MTT (push/fold & ICM de base)',
  'Range Vision animée',
  'Classement & historique récent',
]
export const PLAN_PRO = [
  'Tout le gratuit, sans limite',
  'Simulation — banc de test (EV prouvée sur des milliers de mains)',
  'Scénario sur mesure (recrée n’importe quel spot)',
  'Coach tournoi avancé (ICM, re-shove, bulle)',
  'Historique complet + replay illimité',
  'Support prioritaire',
]

export const PRICE = { monthly: 9.99, yearly: 79, currency: '€' }
