import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'

export default function AppLayout(): JSX.Element {
  // On the game table the menu auto-hides for immersion (reveals on a left-edge hover).
  const immersive = useLocation().pathname === '/game'
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar autoHide={immersive} />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
