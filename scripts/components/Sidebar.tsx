import React from 'react'
import { User } from '../hooks/useAuth'
import './Sidebar.css'

interface SidebarProps {
  currentView: 'overview' | 'settings' | 'people' | 'pattern' | 'admin' | 'scheduler' | 'logs' | 'password' | 'shift-stats'
  onViewChange: (view: 'overview' | 'settings' | 'people' | 'pattern' | 'admin' | 'scheduler' | 'logs' | 'password' | 'shift-stats') => void
  user: User | null
  onLogout: () => void
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, user, onLogout }) => {
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const isGroupManagerOnly = Boolean(
    user?.group === 'manager' && user.role !== 'admin' && user.role !== 'manager'
  )

  return (
    <div className="sidebar">
      <div className="sidebar-icons">
        {/* Overview - available to all users */}
        <button
          className={`sidebar-icon ${currentView === 'overview' ? 'active' : ''}`}
          onClick={() => onViewChange('overview')}
          title="Leave Overview"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="3" y1="14" x2="21" y2="14" />
            <line x1="3" y1="18" x2="21" y2="18" />
            <circle cx="8" cy="7" r="1" />
            <circle cx="12" cy="11" r="1" />
            <circle cx="16" cy="15" r="1" />
            <circle cx="8" cy="19" r="1" />
          </svg>
        </button>



        {/* Scheduler - available to admin and manager */}
        {(isAdmin || isManager) && (
          <button
            className={`sidebar-icon ${currentView === 'scheduler' ? 'active' : ''}`}
            onClick={() => onViewChange('scheduler')}
            title="Shift Scheduler"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="3" y1="14" x2="21" y2="14" />
              <line x1="3" y1="18" x2="21" y2="18" />
              <circle cx="8" cy="10" r="1" />
              <circle cx="12" cy="14" r="1" />
              <circle cx="16" cy="18" r="1" />
            </svg>
          </button>
        )}

        {/* Admin-only menu items */}
        {isAdmin && (
          <button
            className={`sidebar-icon ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => onViewChange('settings')}
            title="Shift Settings"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        )}

        {/* Admin and Manager menu items */}
        {(isAdmin || isManager) && (
          <>
            <button
              className={`sidebar-icon ${currentView === 'pattern' ? 'active' : ''}`}
              onClick={() => onViewChange('pattern')}
              title="Shift Pattern"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <line x1="8" y1="4" x2="8" y2="22" />
                <circle cx="8" cy="10" r="2" />
              </svg>
            </button>

            <button
              className={`sidebar-icon ${currentView === 'admin' ? 'active' : ''}`}
              onClick={() => onViewChange('admin')}
              title="Admin"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </button>

            <button
              className={`sidebar-icon ${currentView === 'logs' ? 'active' : ''}`}
              onClick={() => onViewChange('logs')}
              title="System Logs"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
                <line x1="8" y1="14" x2="16" y2="14"></line>
                <line x1="8" y1="18" x2="16" y2="18"></line>
              </svg>
            </button>
          </>
        )}

        {isGroupManagerOnly && (
          <button
            className={`sidebar-icon ${currentView === 'admin' ? 'active' : ''}`}
            onClick={() => onViewChange('admin')}
            title="用戶管理（新增一般用戶）"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </button>
        )}

        <button
          className={`sidebar-icon ${currentView === 'password' ? 'active' : ''}`}
          onClick={() => onViewChange('password')}
          title="修改密碼"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M12 15v2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>

        {/* People - available to all users */}
        <button
          className={`sidebar-icon ${currentView === 'people' ? 'active' : ''}`}
          onClick={() => onViewChange('people')}
          title="People"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>

        {/* Shift Stats - available to admin and manager */}
        {(isAdmin || isManager) && (
          <button
            className={`sidebar-icon ${currentView === 'shift-stats' ? 'active' : ''}`}
            onClick={() => onViewChange('shift-stats')}
            title="班別統計"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
        )}
      </div>

      {/* User info section */}
      {user && (
        <div className="sidebar-user">
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-id">{user.employee_id}</div>
            {user.role === 'admin' && (
              <div className="user-role">管理員</div>
            )}
          </div>
          <button
            className="logout-button"
            onClick={onLogout}
            title="登出"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16,17 21,12 16,7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

export default Sidebar
