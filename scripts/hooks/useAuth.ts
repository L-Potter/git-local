import { useState, useEffect } from 'react'
import memoryCache from './useMemoryCache'

export interface User {
  user_id: number
  name: string
  employee_id: string
  shift_type: 'A' | 'B' | null
  site: 'P1' | 'P2' | 'P3' | 'P4' | null
  day_night: 'D' | 'N' | null
  role: 'user' | 'admin' | 'manager'
  group?: string
  monthly_overtime_cap_hours?: number | null
}

const API_BASE_URL = '/api'

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Check if user is logged in on app start (from localStorage)
  useEffect(() => {
    const checkAuth = () => {
      try {
        // Token is no longer part of authentication; remove values left by older builds.
        localStorage.removeItem('manager_session_token')
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
          const userData = JSON.parse(storedUser)
          setUser(userData)
        }
      } catch (error) {
        console.error('Failed to load user from localStorage:', error)
        localStorage.removeItem('user') // Clear corrupted data
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  // Login function
  const login = async (employeeId: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          employee_id: employeeId,
          password: password,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '登入失敗')
      }

      const userData = await response.json()
      setUser(userData)
      localStorage.setItem('user', JSON.stringify(userData))
      return true
    } catch (error) {
      console.error('Login failed:', error)
      return false
    }
  }

  // Logout function
  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setUser(null)
      localStorage.removeItem('user')
      memoryCache.clear()
    }
  }

  // Check if user is authenticated
  const isAuthenticated = () => {
    return user !== null
  }

  return {
    user,
    loading,
    login,
    logout,
    isAuthenticated,
  }
}
