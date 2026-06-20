import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Sidebar from '../components/layout/Sidebar'
import TopBar from '../components/layout/TopBar'
import { useDevice } from '../lib/useDevice'

export default function AppLayout(): JSX.Element {
  const path = useLocation().pathname
  const { isPhone } = useDevice()
  // The live table is the only immersive surface that hides the menu behind the
  // left-edge crochet for maximum space. The Hand Trainer keeps the normal docked
  // menu (it's a study screen, not the table) so navigation stays visible on web.
  const immersiveSurface = path === '/game'

  // Phone menu pages: the sidebar collapses into a hamburger drawer (auto-closes on nav).
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [path])

  if (immersiveSurface) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
        <Sidebar autoHide />
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden"><Outlet /></div>
        </main>
      </div>
    )
  }

  if (isPhone) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-poker-darker">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        <div className="flex-1 overflow-hidden"><Outlet /></div>
        <Sidebar drawer drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      </div>
    )
  }

  // Desktop menu pages (lobby, setups, leaderboard, profile, history): docked menu.
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-hidden"><Outlet /></div>
      </main>
    </div>
  )
}
