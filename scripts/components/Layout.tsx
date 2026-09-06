import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { User } from '../hooks/useAuth'
import Sidebar from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
  user: User | null
  onLogout: () => void
}

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const location = useLocation()
  const navigate = useNavigate()

  // Map pathname to sidebar highlight; must match App.tsx routes (esp. "/" and "*").
  const getViewFromPath = (path: string): 'overview' | 'settings' | 'people' | 'pattern' | 'admin' | 'scheduler' | 'logs' | 'password' | 'shift-stats' => {
    if (path === '/password') return 'password'
    if (path === '/admin') return 'admin'
    if (path === '/settings' || path.startsWith('/shift-settings')) return 'settings'
    if (path === '/people') return 'people'
    if (path === '/pattern' || path.startsWith('/shift-pattern')) return 'pattern'
    if (path === '/scheduler') return 'scheduler'
    if (path === '/overview') return 'overview'
    if (path === '/shift-stats') return 'shift-stats'
    if (path === '/logs') return 'logs'
    // "/" in App: admin -> ShiftScheduler; everyone else (incl. manager) -> LeaveOverview
    if (path === '/' || path === '') {
      return user?.role === 'admin' ? 'scheduler' : 'overview'
    }
    // Unmatched paths use App * fallback -> LeaveOverview
    return 'overview'
  }

  const currentView = getViewFromPath(location.pathname)

  const handleViewChange = (view: 'overview' | 'settings' | 'people' | 'pattern' | 'admin' | 'scheduler' | 'logs' | 'password' | 'shift-stats') => {
    switch (view) {
      case 'password':
        navigate('/password')
        break
      case 'overview':
        navigate('/overview')
        break
      case 'shift-stats':
        navigate('/shift-stats')
        break
      case 'scheduler':
        navigate('/scheduler')
        break
      case 'settings':
        navigate('/shift-settings')
        break
      case 'people':
        navigate('/people')
        break
      case 'pattern':
        navigate('/shift-pattern')
        break
      case 'admin':
        navigate('/admin')
        break
      case 'logs':
        navigate('/logs')
        break
    }
  }

  return (
    <div className="App">
      <Sidebar
        currentView={currentView}
        onViewChange={handleViewChange}
        user={user}
        onLogout={onLogout}
      />
      <div className="app-content">
        {children}
      </div>
    </div>
  )
}

export default Layout
