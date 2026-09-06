import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './components/Login'
import ShiftScheduler from './components/ShiftScheduler'
import LeaveOverview from './components/LeaveOverview'
import ShiftStatsReport from './components/ShiftStatsReport'
import ShiftSettings from './components/ShiftSettings'
import People from './components/People'
import ShiftPattern from './components/ShiftPattern'
import Admin from './components/Admin'
import ChangePassword from './components/ChangePassword'
import { LogViewer } from './components/LogViewer'
import { useKeepalive } from './hooks/useKeepalive'
import './App.css'

function App() {
  const { user, loading, login, logout, isAuthenticated } = useAuth()
  useKeepalive()

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px'
      }}>
        載入中...
      </div>
    )
  }

  if (!isAuthenticated()) {
    return <Login onLogin={login} />
  }

  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const isGroupManager = user?.group === 'manager'

  return (
    <BrowserRouter>
      <Routes>
        {/* Default route - redirect non-admin to overview */}
        <Route path="/" element={
          isAdmin ?
            <Layout user={user} onLogout={logout}><ShiftScheduler /></Layout> :
            <Layout user={user} onLogout={logout}><LeaveOverview /></Layout>
        } />

        {/* Routes available to all users */}
        <Route path="/overview" element={<Layout user={user} onLogout={logout}><LeaveOverview /></Layout>} />
        <Route path="/shift-stats" element={<Layout user={user} onLogout={logout}><ShiftStatsReport /></Layout>} />
        <Route path="/password" element={<Layout user={user} onLogout={logout}><ChangePassword /></Layout>} />
        <Route path="/people" element={<Layout user={user} onLogout={logout}><People /></Layout>} />

        {/* Manger-only routes */}
        {isManager && (
          <>
            <Route path="/scheduler" element={<Layout user={user} onLogout={logout}><ShiftScheduler /></Layout>} />
            <Route path="/shift-pattern" element={<Layout user={user} onLogout={logout}><ShiftPattern /></Layout>} />
            <Route path="/admin" element={<Layout user={user} onLogout={logout}><Admin /></Layout>} />
            <Route path="/logs" element={<Layout user={user} onLogout={logout}><LogViewer /></Layout>} />
          </>
        )}

        {isGroupManager && !isAdmin && !isManager && (
          <Route path="/admin" element={<Layout user={user} onLogout={logout}><Admin /></Layout>} />
        )}

        {/* Admin-only routes */}
        {isAdmin && (
          <>
            <Route path="/scheduler" element={<Layout user={user} onLogout={logout}><ShiftScheduler /></Layout>} />
            <Route path="/shift-settings" element={<Layout user={user} onLogout={logout}><ShiftSettings /></Layout>} />
            <Route path="/shift-pattern" element={<Layout user={user} onLogout={logout}><ShiftPattern /></Layout>} />
            <Route path="/admin" element={<Layout user={user} onLogout={logout}><Admin /></Layout>} />
            <Route path="/logs" element={<Layout user={user} onLogout={logout}><LogViewer /></Layout>} />
          </>
        )}

        {/* Fallback for unauthorized access - redirect to overview */}
        <Route path="*" element={<Layout user={user} onLogout={logout}><LeaveOverview /></Layout>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
