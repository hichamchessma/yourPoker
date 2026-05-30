import { Outlet } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'

export default function AppLayout(): JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
