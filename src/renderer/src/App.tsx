import { Routes, Route, Navigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import LobbyPage from './pages/LobbyPage'
import HandTrainerPage from './pages/HandTrainerPage'
import ProfilePage from './pages/ProfilePage'
import HistoryPage from './pages/HistoryPage'
import TrainingSetupPage from './pages/TrainingSetupPage'
import TournamentSetupPage from './pages/TournamentSetupPage'
import SetupPositionPage from './pages/SetupPositionPage'
import SimulationPage from './pages/SimulationPage'
import LeaderboardPage from './pages/LeaderboardPage'
import PricingPage from './pages/PricingPage'
import GamePage from './pages/GamePage'
import AppLayout from './layouts/AppLayout'
import ProGate from './components/ProGate'
import { useAuthStore } from './store/authStore'
import { useIsPro } from './lib/entitlements'

// Gates a Pro-only page: the wrapped page only mounts when the user is Pro (keeps the
// page's own hooks isolated), otherwise the upgrade wall is shown.
function Gated({ title, desc, children }: { title: string; desc: string; children: JSX.Element }): JSX.Element {
  return useIsPro() ? children : <ProGate title={title} desc={desc} />
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
    <Routes>
      <Route path="/auth" element={session ? <Navigate to="/lobby" replace /> : <AuthPage />} />
      <Route
        path="/"
        element={session ? <AppLayout /> : <Navigate to="/auth" replace />}
      >
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="lobby" element={<LobbyPage />} />
        <Route path="handtrainer" element={<HandTrainerPage />} />
        <Route path="training" element={<TrainingSetupPage />} />
        <Route path="tournament" element={<TournamentSetupPage />} />
        <Route path="simulation" element={<Gated title="Simulation" desc="Le banc de test qui mesure l'EV du coach sur des milliers de mains. Réservé aux membres Pro."><SimulationPage /></Gated>} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="setup" element={<Gated title="Scénario sur mesure" desc="Recrée n'importe quel spot (cartes, board, tapis) pour tester le coach. Réservé aux membres Pro."><SetupPositionPage /></Gated>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="game" element={<GamePage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/lobby' : '/auth'} replace />} />
    </Routes>
  )
}

export default App
