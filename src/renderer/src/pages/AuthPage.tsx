import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, KeyRound } from 'lucide-react'
import Sidebar from '../components/layout/Sidebar'
import SocialButton from '../components/auth/SocialButton'
import WindowControls from '../components/layout/WindowControls'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function AuthPage(): JSX.Element {
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setSession } = useAuthStore()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: identifier,
        password
      })
      if (authError) throw authError
      setSession(data.session)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSocialLogin = async (provider: 'google' | 'discord' | 'facebook') => {
    await supabase.auth.signInWithOAuth({ provider })
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      {/* Sidebar */}
      <Sidebar activeItem="lobby" />

      {/* Main content */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Background poker chips / cards visual */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -left-10 top-1/2 -translate-y-1/2 w-96 h-96 opacity-60">
            <img src="/assets/chips-cards.png" alt="" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          </div>
          {/* Ambient glow */}
          <div className="absolute top-1/4 left-1/3 w-64 h-64 bg-poker-teal/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-poker-gold/5 rounded-full blur-3xl" />
        </div>

        {/* Window controls (frameless window) */}
        <WindowControls />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md mx-8"
        >
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl font-bold text-white tracking-widest uppercase">
              Poker Elite Coach
            </h1>
            <p className="text-poker-teal text-sm tracking-[0.3em] uppercase mt-2 font-medium">
              Page d'Authentification
            </p>
            <div className="w-32 h-px bg-gradient-to-r from-transparent via-poker-teal/50 to-transparent mx-auto mt-3" />
          </div>

          {/* Auth card */}
          <div className="glass-card p-8">
            <form onSubmit={handleLogin} className="space-y-5">
              {/* Email / Username */}
              <div>
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-widest mb-2">
                  E-mail ou Nom d'Utilisateur
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                    <KeyRound size={16} />
                  </div>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-dark pl-10"
                    placeholder=""
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-widest mb-2">
                  Mot de Passe
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                    <Lock size={16} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-dark pl-10 pr-20"
                    placeholder="••••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors text-xs font-semibold tracking-wider uppercase"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    <span className="ml-1">Afficher</span>
                  </button>
                </div>
              </div>

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div
                    onClick={() => setRememberMe(!rememberMe)}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer ${
                      rememberMe
                        ? 'bg-poker-teal border-poker-teal'
                        : 'border-white/30 bg-transparent'
                    }`}
                  >
                    {rememberMe && (
                      <svg className="w-2.5 h-2.5 text-poker-darker" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-white/50 uppercase tracking-wider">Se souvenir de moi</span>
                </label>
                <button type="button" className="text-xs text-poker-teal hover:text-poker-gold transition-colors uppercase tracking-wider font-medium">
                  Mot de passe oublié ?
                </button>
              </div>

              {/* Error message */}
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2 text-center"
                >
                  {error}
                </motion.p>
              )}

              {/* Submit button */}
              <motion.button
                type="submit"
                disabled={isLoading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full btn-gold py-4 text-sm relative overflow-hidden"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Connexion...
                  </span>
                ) : (
                  'Se Connecter'
                )}
              </motion.button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30 uppercase tracking-widest">Ou se connecter avec</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Social buttons */}
            <div className="flex justify-center gap-4">
              <SocialButton provider="google" onClick={() => handleSocialLogin('google')} />
              <SocialButton provider="apple" />
              <SocialButton provider="discord" onClick={() => handleSocialLogin('discord')} />
              <SocialButton provider="facebook" onClick={() => handleSocialLogin('facebook')} />
            </div>

            {/* Sign up link */}
            <p className="text-center mt-6 text-xs text-white/40 uppercase tracking-wider">
              Pas encore de compte ?{' '}
              <button className="text-poker-teal hover:text-poker-gold transition-colors font-semibold underline underline-offset-2">
                S'inscrire ici
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
