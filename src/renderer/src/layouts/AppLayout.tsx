import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'
import TopBar from '../components/layout/TopBar'

export default function AppLayout(): JSX.Element {
  const path = useLocation().pathname
  // On the game table the menu auto-hides for immersion (reveals on a left-edge hover).
  const immersive = path === '/game'
  // The persistent top bar shows on every menu page, but NOT on the two full-screen
  // immersive surfaces (the live table and the Hand Trainer, which own their chrome).
  const showTopBar = path !== '/game' && path !== '/handtrainer'
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar autoHide={immersive} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {showTopBar && <TopBar />}
        <div className="flex-1 overflow-hidden"><Outlet /></div>
      </main>
    </div>
  )
}
