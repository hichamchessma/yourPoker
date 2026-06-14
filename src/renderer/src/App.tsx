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
import GamePage from './pages/GamePage'
import AppLayout from './layouts/AppLayout'
import { useAuthStore } from './store/authStore'

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
        <Route path="simulation" element={<SimulationPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="setup" element={<SetupPositionPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="game" element={<GamePage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/lobby' : '/auth'} replace />} />
    </Routes>
  )
}

export default App
