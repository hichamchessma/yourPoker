import { Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Sidebar from '../components/layout/Sidebar'
import TopBar from '../components/layout/TopBar'
import { useDevice } from '../lib/useDevice'

export default function AppLayout(): JSX.Element {
  const path = useLocation().pathname
  const { isPhone } = useDevice()
  // On the game table the menu auto-hides for immersion (reveals on a left-edge hover).
  const immersive = path === '/game'
  // Surfaces that own their full-screen chrome (no docked menu / top bar).
  const immersiveSurface = immersive || path === '/handtrainer'
  // The persistent top bar shows on every menu page, but NOT on the two full-screen
  // immersive surfaces (the live table and the Hand Trainer, which own their chrome).
  const showTopBar = !immersiveSurface

  // Phone menu pages: the sidebar collapses into a hamburger-triggered drawer so the
  // content gets the full width. The drawer auto-closes on navigation.
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [path])

  if (isPhone && !immersiveSurface) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-poker-darker">
        {showTopBar && <TopBar onMenu={() => setDrawerOpen(true)} />}
        <div className="flex-1 overflow-hidden"><Outlet /></div>
        <Sidebar drawer drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      </div>
    )
  }

  // Desktop / tablet / immersive — unchanged from before.
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
