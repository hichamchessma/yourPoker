import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Sidebar from '../components/layout/Sidebar'
import TopBar from '../components/layout/TopBar'
import { useDevice } from '../lib/useDevice'

export default function AppLayout(): JSX.Element {
  const path = useLocation().pathname
  const { isPhone } = useDevice()
  // The lobby is the ONLY page with a docked / always-visible menu. Every other view
  // (game, hand trainer, setups, leaderboard, profile, history…) auto-hides the
  // sidebar behind the left-edge crochet so the content gets the full width.
  const isLobby = path === '/lobby'
  // The two full-screen surfaces own their chrome (no top bar).
  const immersiveSurface = path === '/game' || path === '/handtrainer'
  const showTopBar = !immersiveSurface

  // Lobby on phone keeps the hamburger drawer; its drawer auto-closes on navigation.
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [path])

  if (isLobby && isPhone) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-poker-darker">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        <div className="flex-1 overflow-hidden"><Outlet /></div>
        <Sidebar drawer drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      </div>
    )
  }

  if (isLobby) {
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

  // Everywhere else: the sidebar auto-hides behind the edge crochet (frees the whole
  // width), with the top bar kept on non-immersive pages.
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-poker-darker">
      <Sidebar autoHide />
      <main className="flex-1 flex flex-col overflow-hidden">
        {showTopBar && <TopBar />}
        <div className="flex-1 overflow-hidden"><Outlet /></div>
      </main>
    </div>
  )
}
