import { Outlet } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'
import WindowControls from '../components/layout/WindowControls'

export default function AppLayout(): JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar />
      <main className="flex-1 relative overflow-hidden">
        <WindowControls />
        <Outlet />
      </main>
    </div>
  )
}
