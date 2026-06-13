import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, KeyRound } from 'lucide-react'
import SocialButton from '../components/auth/SocialButton'
import WindowControls from '../components/layout/WindowControls'
import { supabase } from '../lib/supabase'
import { isElectron } from '../lib/platform'
import { useAuthStore } from '../store/authStore'
import type { Session } from '@supabase/supabase-js'

function PokerChip({ id, color = 'gold', size = 120 }: { id: string; color?: 'gold' | 'teal'; size?: number }) {
  const g = color === 'gold'
    ? { outer: '#c9a227', mid: '#8B6810', inner: '#f0d060', dark: '#1a2840', text: '#0a0f1a' }
    : { outer: '#00d4ff', mid: '#006688', inner: '#66eeff', dark: '#0a1e2e', text: '#003344' }

  const notches = Array.from({ length: 8 }).map((_, i) => {
    const angle = (i * 45 - 22.5) * (Math.PI / 180)
    return { x: 50 + 39 * Math.cos(angle), y: 50 + 39 * Math.sin(angle) }
  })

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 8px 24px ${color === 'gold' ? 'rgba(201,162,39,0.5)' : 'rgba(0,212,255,0.5)'})` }}>
      <defs>
        <radialGradient id={`rg-${id}`} cx="38%" cy="32%" r="65%">
          <stop offset="0%" stopColor={g.inner} />
          <stop offset="60%" stopColor={g.outer} />
          <stop offset="100%" stopColor={g.mid} />
        </radialGradient>
        <radialGradient id={`rgi-${id}`} cx="38%" cy="32%" r="65%">
          <stop offset="0%" stopColor={g.inner} stopOpacity="0.8" />
          <stop offset="100%" stopColor={g.outer} />
        </radialGradient>
        <filter id={`blur-${id}`}>
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      {/* Drop shadow */}
      <ellipse cx="52" cy="55" rx="42" ry="12" fill="rgba(0,0,0,0.5)" filter={`url(#blur-${id})`} />
      {/* Outer rim */}
      <circle cx="50" cy="50" r="47" fill={`url(#rg-${id})`} />
      {/* Notch cutouts */}
      {notches.map((n, i) => (
        <rect key={i} x={n.x - 5} y={n.y - 3.5} width="10" height="7" rx="1.5"
          fill={g.dark} transform={`rotate(${i * 45 - 22.5} ${n.x} ${n.y})`} />
      ))}
      {/* Inner ring */}
      <circle cx="50" cy="50" r="32" fill={g.mid} />
      <circle cx="50" cy="50" r="30" fill={`url(#rgi-${id})`} />
      {/* Dark center */}
      <circle cx="50" cy="50" r="22" fill={g.dark} />
      <circle cx="50" cy="50" r="20" fill={g.dark} stroke={g.outer} strokeWidth="1" />
      {/* Center spade */}
      <text x="50" y="57" textAnchor="middle" fill={g.outer} fontSize="18" fontFamily="serif" fontWeight="bold">♠</text>
      {/* Top shine */}
      <ellipse cx="38" cy="34" rx="11" ry="7" fill="white" opacity="0.18" transform="rotate(-25 38 34)" />
    </svg>
  )
}

function PlayingCard({ rank, suit, rotation = 0, glowColor = '#c9a227' }: { rank: string; suit: string; rotation?: number; glowColor?: string }) {
  return (
    <svg width="72" height="104" viewBox="0 0 72 104" style={{ transform: `rotate(${rotation}deg)`, filter: `drop-shadow(0 6px 20px ${glowColor}66)` }}>
      <defs>
        <linearGradient id={`cardGrad-${rank}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e3050" />
          <stop offset="100%" stopColor="#0d1a2e" />
        </linearGradient>
      </defs>
      {/* Shadow */}
      <rect x="4" y="6" width="66" height="96" rx="7" fill="rgba(0,0,0,0.4)" />
      {/* Card body */}
      <rect x="2" y="2" width="68" height="100" rx="7" fill={`url(#cardGrad-${rank})`} />
      {/* Gold border */}
      <rect x="2" y="2" width="68" height="100" rx="7" fill="none" stroke="#c9a227" strokeWidth="1.5" />
      {/* Inner border */}
      <rect x="6" y="6" width="60" height="92" rx="5" fill="none" stroke="rgba(201,162,39,0.25)" strokeWidth="0.5" />
      {/* Top-left rank + suit */}
      <text x="10" y="22" fill="#c9a227" fontSize="15" fontWeight="bold" fontFamily="Georgia, serif">{rank}</text>
      <text x="10" y="36" fill="#c9a227" fontSize="13" fontFamily="Georgia, serif">{suit}</text>
      {/* Center large suit */}
      <text x="36" y="64" textAnchor="middle" fill="#c9a227" fontSize="36" fontFamily="Georgia, serif">{suit}</text>
      {/* Bottom-right (rotated) */}
      <text x="62" y="92" textAnchor="middle" fill="#c9a227" fontSize="15" fontWeight="bold" fontFamily="Georgia, serif"
        transform="rotate(180 62 88)">{rank}</text>
      {/* Card shine */}
      <rect x="6" y="6" width="60" height="46" rx="5" fill="white" opacity="0.04" />
    </svg>
  )
}

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'

export default function AuthPage(): JSX.Element {
  const { setSession, passwordRecovery, setPasswordRecovery } = useAuthStore()
  const [mode, setMode] = useState<AuthMode>(passwordRecovery ? 'reset' : 'login')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Surface OAuth / recovery errors that providers return in the URL, and force
  // the reset screen when a recovery link is opened.
  useEffect(() => {
    if (passwordRecovery) setMode('reset')
    const raw = window.location.href
    const errMatch = /[?#&]error_description=([^&]+)/.exec(raw) || /[?#&]error=([^&]+)/.exec(raw)
    if (errMatch) {
      try { setError(decodeURIComponent(errMatch[1].replace(/\+/g, ' '))) } catch { setError('Erreur d’authentification') }
    }
  }, [passwordRecovery])

  const switchMode = (m: AuthMode) => {
    setMode(m); setError(null); setNotice(null); setConfirmPassword('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    if (mode === 'signup') return handleSignup(e)
    if (mode === 'forgot') return handleForgot(e)
    if (mode === 'reset') return handleReset(e)
    return handleLogin(e)
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)
    if (!identifier.includes('@')) { setError('Entre l’adresse e-mail de ton compte.'); return }
    setIsLoading(true)
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(identifier.trim(), {
        redirectTo: `${window.location.origin}/?type=recovery`
      })
      if (resetErr) throw resetErr
      setNotice('Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’envoi du lien')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)
    if (password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères.'); return }
    if (password !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); return }
    setIsLoading(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw updErr
      // Done: drop the recovery session and send the user back to a clean login.
      await supabase.auth.signOut()
      setPasswordRecovery(false)
      setPassword(''); setConfirmPassword('')
      setNotice('Mot de passe mis à jour ! Connecte-toi avec ton nouveau mot de passe.')
      setMode('login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)
    if (!identifier.includes('@')) { setError('Entre une adresse e-mail valide.'); return }
    if (password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères.'); return }
    if (password !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); return }
    setIsLoading(true)
    try {
      const { data, error: signErr } = await supabase.auth.signUp({
        email: identifier.trim(),
        password,
        options: { emailRedirectTo: window.location.origin }
      })
      if (signErr) throw signErr
      if (data.session) {
        // Email confirmation disabled in Supabase → user is logged in immediately.
        setSession(data.session)
      } else {
        // Confirmation enabled → a verification email was sent.
        setNotice('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.')
        switchMode('login')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'inscription")
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // ── Local admin bypass (dev/test): "admin" / "admin" → direct access ──
    if (identifier.trim().toLowerCase() === 'admin' && password === 'admin') {
      const adminUser = {
        id: 'admin-local', aud: 'authenticated', role: 'authenticated',
        email: 'admin@local', created_at: new Date().toISOString(),
        app_metadata: { provider: 'local' }, user_metadata: { full_name: 'Admin' },
      } as unknown as Session['user']
      const adminSession = {
        access_token: 'admin-local', refresh_token: 'admin-local',
        token_type: 'bearer', expires_in: 31536000,
        expires_at: Math.floor(Date.now() / 1000) + 31536000, user: adminUser,
      } as unknown as Session
      setSession(adminSession)
      return
    }

    setIsLoading(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: identifier, password })
      if (authError) throw authError
      setSession(data.session)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError(null)
    console.warn('[google] signInWithOAuth start')
    if (isElectron) {
      // Desktop: open the system browser and catch the deep-link callback (yourpoker://).
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'yourpoker://auth/callback', skipBrowserRedirect: true }
      })
      console.warn('[google] result url:', data?.url, 'error:', error?.message)
      if (error) { setError(`Google: ${error.message}`); return }
      if (!data?.url) { setError('URL Google null — activez Google dans Supabase Auth → Providers'); return }
      await window.api.openExternal(data.url)
    } else {
      // Web: standard browser redirect back to the app origin; Supabase parses the callback.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      })
      if (error) { setError(`Google: ${error.message}`); return }
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* No app sidebar on the auth screen — the nav must not show before login. */}
      <div className="flex-1 relative overflow-hidden">
        {/* ── BACKGROUND ── */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 60% 40%, #0d2545 0%, #080e1c 55%, #040810 100%)' }} />

        {/* Casino floor atmosphere */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[20%] w-[500px] h-[300px] opacity-25"
            style={{ background: 'radial-gradient(ellipse, #005577 0%, transparent 70%)' }} />
          <div className="absolute bottom-[-5%] left-[5%] w-[350px] h-[250px] opacity-20"
            style={{ background: 'radial-gradient(ellipse, #003355 0%, transparent 70%)' }} />
          <div className="absolute top-[30%] left-[35%] w-[200px] h-[200px] opacity-10"
            style={{ background: 'radial-gradient(ellipse, #c9a227 0%, transparent 70%)' }} />
          {/* Subtle bokeh dots */}
          {[
            { left: '8%', top: '12%', size: 3, opacity: 0.3 },
            { left: '22%', top: '78%', size: 4, opacity: 0.2 },
            { left: '38%', top: '8%', size: 2, opacity: 0.25 },
            { left: '15%', top: '55%', size: 5, opacity: 0.15 },
            { left: '30%', top: '88%', size: 3, opacity: 0.2 },
          ].map((dot, i) => (
            <div key={i} className="absolute rounded-full bg-poker-teal"
              style={{ left: dot.left, top: dot.top, width: dot.size * 4, height: dot.size * 4, opacity: dot.opacity, filter: 'blur(2px)' }} />
          ))}
        </div>

        {/* ── LEFT VISUAL — Chips & Cards ── */}
        <div className="absolute left-0 top-0 bottom-0 w-[46%] flex items-center justify-center pointer-events-none select-none">

          {/* Scattered background chips */}
          <motion.div className="absolute" style={{ left: '6%', top: '12%', opacity: 0.45 }}
            animate={{ y: [-6, 8, -6], rotate: [-5, 5, -5] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
            <PokerChip id="bg1" color="teal" size={55} />
          </motion.div>

          <motion.div className="absolute" style={{ right: '8%', top: '18%', opacity: 0.35 }}
            animate={{ y: [8, -6, 8], rotate: [8, -3, 8] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}>
            <PokerChip id="bg2" color="gold" size={45} />
          </motion.div>

          <motion.div className="absolute" style={{ left: '12%', bottom: '15%', opacity: 0.4 }}
            animate={{ y: [4, -8, 4], rotate: [0, 10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 3 }}>
            <PokerChip id="bg3" color="teal" size={40} />
          </motion.div>

          {/* Main central composition */}
          <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>

            {/* Card A♠ — right, slightly back */}
            <motion.div className="absolute z-10"
              style={{ right: 10, top: 20 }}
              animate={{ y: [6, -6, 6], rotate: [14, 17, 14] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}>
              <PlayingCard rank="A" suit="♠" rotation={15} glowColor="#00d4ff" />
            </motion.div>

            {/* Card K♠ — left, slightly back */}
            <motion.div className="absolute z-10"
              style={{ left: 10, top: 20 }}
              animate={{ y: [-6, 6, -6], rotate: [-17, -14, -17] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
              <PlayingCard rank="K" suit="♠" rotation={-15} glowColor="#c9a227" />
            </motion.div>

            {/* Main gold chip — front center */}
            <motion.div className="absolute z-20"
              style={{ top: 50, left: '50%', transform: 'translateX(-50%)' }}
              animate={{ y: [-12, 12, -12] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
              <PokerChip id="main" color="gold" size={155} />
            </motion.div>

            {/* Teal chip — lower left, slightly behind */}
            <motion.div className="absolute z-10"
              style={{ bottom: 10, left: 20 }}
              animate={{ y: [10, -8, 10] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}>
              <PokerChip id="sec" color="teal" size={105} />
            </motion.div>

            {/* Small gold chip — lower right */}
            <motion.div className="absolute z-10"
              style={{ bottom: 25, right: 15, opacity: 0.8 }}
              animate={{ y: [-8, 10, -8], rotate: [0, 15, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2 }}>
              <PokerChip id="sm" color="gold" size={70} />
            </motion.div>
          </div>
        </div>

        {/* ── RIGHT — Title + Form ── */}
        <div className="absolute right-0 top-0 bottom-0 w-[57%] flex flex-col items-center justify-center px-6">
          <WindowControls />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="w-full max-w-md"
          >
            {/* Title */}
            <div className="text-center mb-6">
              <h1 className="font-display text-4xl font-bold text-white tracking-widest uppercase leading-tight">
                Poker Elite Coach
              </h1>
              <p className="text-poker-teal text-xs tracking-[0.35em] uppercase mt-2 font-semibold">
                {mode === 'signup' ? 'Créer un compte'
                  : mode === 'forgot' ? 'Mot de passe oublié'
                  : mode === 'reset' ? 'Nouveau mot de passe'
                  : "Page d'Authentification"}
              </p>
              <div className="w-28 h-px bg-gradient-to-r from-transparent via-poker-teal/60 to-transparent mx-auto mt-3" />
            </div>

            {/* Auth card */}
            <div className="glass-card p-7">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email — hidden in reset mode (recovery session already identifies the user) */}
                {mode !== 'reset' && (
                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-1.5">
                    {mode === 'login' ? "E-mail ou Nom d'Utilisateur" : 'E-mail'}
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-poker-teal/60">
                      <KeyRound size={15} />
                    </div>
                    <input
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="input-dark pl-10"
                      autoComplete="username"
                    />
                  </div>
                </div>
                )}

                {/* Password — hidden in forgot mode (only the e-mail is needed) */}
                {mode !== 'forgot' && (
                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-1.5">
                    {mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de Passe'}
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-poker-teal/60">
                      <Lock size={15} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-dark pl-10 pr-24"
                      placeholder="••••••••••"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-white/40 hover:text-white/80 transition-colors text-[10px] font-bold tracking-wider uppercase"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      <span>Afficher</span>
                    </button>
                  </div>
                </div>
                )}

                {/* Confirm password — signup and reset */}
                {(mode === 'signup' || mode === 'reset') && (
                  <div>
                    <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-1.5">
                      Confirmer le mot de passe
                    </label>
                    <div className="relative">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-poker-teal/60">
                        <Lock size={15} />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="input-dark pl-10"
                        placeholder="••••••••••"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                )}

                {/* Remember + Forgot — login only */}
                {mode === 'login' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => setRememberMe(!rememberMe)}>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${rememberMe ? 'bg-poker-teal border-poker-teal' : 'border-white/30'}`}>
                      {rememberMe && (
                        <svg className="w-2.5 h-2.5 text-poker-darker" fill="none" stroke="currentColor" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[10px] text-white/50 uppercase tracking-wider select-none">Se souvenir de moi</span>
                  </label>
                  <button type="button" onClick={() => switchMode('forgot')} className="text-[10px] text-poker-teal hover:text-poker-gold transition-colors uppercase tracking-wider font-semibold">
                    Mot de passe oublié ?
                  </button>
                </div>
                )}

                {error && (
                  <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2 text-center">
                    {error}
                  </motion.p>
                )}

                {notice && (
                  <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-4 py-2 text-center">
                    {notice}
                  </motion.p>
                )}

                {/* Dev shortcut — login only */}
                {mode === 'login' && (
                  <button type="button" onClick={() => { setIdentifier('admin'); setPassword('admin') }}
                    className="text-[10px] text-poker-gold/70 hover:text-poker-gold transition-colors text-center uppercase tracking-wider w-full">
                    Accès dev : admin / admin
                  </button>
                )}

                <motion.button
                  type="submit"
                  disabled={isLoading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full btn-gold py-3.5 text-sm mt-1"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      {mode === 'signup' ? 'Création...'
                        : mode === 'forgot' ? 'Envoi...'
                        : mode === 'reset' ? 'Mise à jour...'
                        : 'Connexion...'}
                    </span>
                  ) : (
                    mode === 'signup' ? "S'inscrire"
                      : mode === 'forgot' ? 'Envoyer le lien'
                      : mode === 'reset' ? 'Mettre à jour le mot de passe'
                      : 'Se Connecter'
                  )}
                </motion.button>
              </form>

              {/* Divider + social — login/signup only */}
              {(mode === 'login' || mode === 'signup') && (
                <>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[10px] text-white/30 uppercase tracking-widest">{mode === 'signup' ? "Ou s'inscrire avec" : 'Ou se connecter avec'}</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>

                  <div className="flex justify-center gap-3">
                    <SocialButton provider="google" onClick={handleGoogleLogin} />
                  </div>
                </>
              )}

              {/* Bottom navigation between modes */}
              <p className="text-center mt-5 text-[10px] text-white/40 uppercase tracking-wider">
                {mode === 'login' && (
                  <>Pas encore de compte ?{' '}
                    <button type="button" onClick={() => switchMode('signup')}
                      className="text-poker-teal hover:text-poker-gold transition-colors font-bold underline underline-offset-2">
                      S'inscrire ici
                    </button>
                  </>
                )}
                {mode === 'signup' && (
                  <>Déjà un compte ?{' '}
                    <button type="button" onClick={() => switchMode('login')}
                      className="text-poker-teal hover:text-poker-gold transition-colors font-bold underline underline-offset-2">
                      Se connecter
                    </button>
                  </>
                )}
                {mode === 'forgot' && (
                  <>Tu te souviens ?{' '}
                    <button type="button" onClick={() => switchMode('login')}
                      className="text-poker-teal hover:text-poker-gold transition-colors font-bold underline underline-offset-2">
                      Retour à la connexion
                    </button>
                  </>
                )}
                {mode === 'reset' && (
                  <>Choisis un nouveau mot de passe pour ton compte.</>
                )}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
