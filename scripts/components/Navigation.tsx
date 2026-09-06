import React from 'react'
import './Navigation.css'

interface NavigationProps {
  currentView: 'overview' | 'settings'
  onViewChange: (view: 'overview' | 'settings') => void
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onViewChange }) => {
  return (
    <nav className="main-navigation">
      <div className="nav-tabs">
        <button
          className={`nav-tab ${currentView === 'overview' ? 'active' : ''}`}
          onClick={() => onViewChange('overview')}
        >
          Overview
        </button>
        <button
          className={`nav-tab ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => onViewChange('settings')}
        >
          Shift Settings
        </button>
      </div>
    </nav>
  )
}

export default Navigation

