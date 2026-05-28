import { Routes, Route, Navigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import LobbyPage from './pages/LobbyPage'
import AppLayout from './layouts/AppLayout'
import { useAuthStore } from './store/authStore'

function App(): JSX.Element {
  const { session } = useAuthStore()

  return (
    <Routes>
      <Route path="/auth" element={session ? <Navigate to="/lobby" replace /> : <AuthPage />} />
      <Route
        path="/"
        element={session ? <AppLayout /> : <Navigate to="/auth" replace />}
      >
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="lobby" element={<LobbyPage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/lobby' : '/auth'} replace />} />
    </Routes>
  )
}

export default App
