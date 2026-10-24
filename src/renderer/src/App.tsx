import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AppLayout from './layouts/AppLayout'
import ProGate from './components/ProGate'
import { useAuthStore } from './store/authStore'
import { useIsPro } from './lib/entitlements'

// ─── Route-level code splitting ──────────────────────────────────────────────
// EAGER: the three surfaces a first-time visitor actually sees (landing → auth →
// lobby). Everything else is a separate chunk fetched on navigation, so arriving
// on a shared link no longer downloads the game engine, the simulation lab and
// the trainers before painting anything.
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import LobbyPage from './pages/LobbyPage'

// LAZY: the heavy surfaces. GamePage is by far the biggest module and is also
// pulled in by History/Simulation (they reuse its replay modal), so Rollup emits
// it as a shared chunk loaded only when one of those routes is opened.
const GamePage = lazy(() => import('./pages/GamePage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const SimulationPage = lazy(() => import('./pages/SimulationPage'))
const HandTrainerPage = lazy(() => import('./pages/HandTrainerPage'))
const TrainingSetupPage = lazy(() => import('./pages/TrainingSetupPage'))
const TournamentSetupPage = lazy(() => import('./pages/TournamentSetupPage'))
const SetupPositionPage = lazy(() => import('./pages/SetupPositionPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))

// Shown while a route chunk is in flight — same spinner as the auth boot screen,
// so a navigation never flashes a blank page.
function RouteFallback(): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-poker-darker">
      <div className="w-8 h-8 border-2 border-poker-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Gates a Pro-only page: the wrapped page only mounts when the user is Pro (keeps the
// page's own hooks isolated), otherwise the upgrade wall is shown.
function Gated({ titleKey, descKey, children }: { titleKey: string; descKey: string; children: JSX.Element }): JSX.Element {
  const { t } = useTranslation()
  return useIsPro() ? children : <ProGate title={t(titleKey)} desc={t(descKey)} />
}

function App(): JSX.Element {
  const { session, loading, passwordRecovery } = useAuthStore()

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-poker-darker">
        <div className="w-8 h-8 border-2 border-poker-teal border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Password-recovery flow: show the reset screen exclusively, even though the
  // recovery link created an active session.
  if (passwordRecovery) {
    return <AuthPage />
  }

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Public marketing landing — the first thing a logged-out visitor sees. */}
      <Route path="/welcome" element={session ? <Navigate to="/lobby" replace /> : <LandingPage />} />
      <Route path="/auth" element={session ? <Navigate to="/lobby" replace /> : <AuthPage />} />
      <Route
        path="/"
        element={session ? <AppLayout /> : <Navigate to="/welcome" replace />}
      >
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="lobby" element={<LobbyPage />} />
        <Route path="handtrainer" element={<HandTrainerPage />} />
        <Route path="training" element={<TrainingSetupPage />} />
        <Route path="tournament" element={<TournamentSetupPage />} />
        <Route path="simulation" element={<Gated titleKey="pricing.gateSimTitle" descKey="pricing.gateSimDesc"><SimulationPage /></Gated>} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="setup" element={<Gated titleKey="pricing.gateScenTitle" descKey="pricing.gateScenDesc"><SetupPositionPage /></Gated>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="game" element={<GamePage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/lobby' : '/welcome'} replace />} />
    </Routes>
    </Suspense>
  )
}

export default App
