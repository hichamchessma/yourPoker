import { Routes, Route, Navigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import LobbyPage from './pages/LobbyPage'
import TrainingSetupPage from './pages/TrainingSetupPage'
import SetupPositionPage from './pages/SetupPositionPage'
import GamePage from './pages/GamePage'
import AppLayout from './layouts/AppLayout'
import { useAuthStore } from './store/authStore'

function App(): JSX.Element {
  const { session, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-poker-darker">
        <div className="w-8 h-8 border-2 border-poker-teal border-t-transparent rounded-full animate-spin" />
      </div>
    )
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
        <Route path="training" element={<TrainingSetupPage />} />
        <Route path="setup" element={<SetupPositionPage />} />
        <Route path="game" element={<GamePage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/lobby' : '/auth'} replace />} />
    </Routes>
  )
}

export default App
