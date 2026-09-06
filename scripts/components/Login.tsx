import React, { useState } from 'react'
import './Login.css'

interface LoginProps {
  onLogin: (employeeId: string, password: string) => Promise<boolean>
}

type Mode = 'login' | 'register'

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<Mode>('login')
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [regName, setRegName] = useState('')
  const [regEmployeeId, setRegEmployeeId] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('')
  const [regShowPassword, setRegShowPassword] = useState(false)
  const [regSuccess, setRegSuccess] = useState('')
  const [regShiftType, setRegShiftType] = useState<'A' | 'B'>('A')
  const [regSite, setRegSite] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P1')
  const [regDayNight, setRegDayNight] = useState<'D' | 'N'>('D')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId || !password) {
      setError('請輸入工號和密碼')
      return
    }

    setLoading(true)
    setError('')

    try {
      const success = await onLogin(employeeId, password)
      if (!success) {
        setError('工號或密碼錯誤')
      }
    } catch {
      setError('登入失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setRegSuccess('')

    if (!regName.trim() || !regEmployeeId.trim() || !regPassword) {
      setError('請填寫姓名、工號與密碼')
      return
    }
    if (regPassword !== regPasswordConfirm) {
      setError('兩次輸入的密碼不一致')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          employee_id: regEmployeeId.trim(),
          password: regPassword,
          password_confirm: regPasswordConfirm,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : '註冊失敗')
        return
      }
      setRegName('')
      setRegEmployeeId('')
      setRegPassword('')
      setRegPasswordConfirm('')
      setRegShowPassword(false)
      setRegShiftType('A')
      setRegSite('P1')
      setRegDayNight('D')
      setRegSuccess(typeof data.message === 'string' ? data.message : '申請已送出，請待管理員核准後再登入')
      setMode('login')
    } catch {
      setError('註冊失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>排班系統登入</h1>
          <p>{mode === 'login' ? '請輸入您的工號和密碼' : '建立帳號申請（核准後方可登入）'}</p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="employeeId">工號</label>
              <input
                type="text"
                id="employeeId"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="請輸入工號"
                disabled={loading}
                autoComplete="username"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">密碼</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  tabIndex={-1}
                >
                  {showPassword ? '隱藏' : '顯示'}
                </button>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}
            {regSuccess && <div className="success-banner">{regSuccess}</div>}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? '處理中...' : '登入'}
            </button>

            <button
              type="button"
              className="login-link-button"
              disabled={loading}
              onClick={() => {
                setError('')
                setRegSuccess('')
                setMode('register')
              }}
            >
              註冊
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="login-form">
            <div className="form-group">
              <label htmlFor="regName">姓名</label>
              <input
                id="regName"
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="請輸入姓名"
                disabled={loading}
                autoComplete="name"
              />
            </div>
            <div className="form-group">
              <label htmlFor="regEmployeeId">工號</label>
              <input
                id="regEmployeeId"
                type="text"
                value={regEmployeeId}
                onChange={(e) => setRegEmployeeId(e.target.value)}
                placeholder="請輸入工號"
                disabled={loading}
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="regShiftType">班別 *</label>
              <select
                id="regShiftType"
                value={regShiftType}
                onChange={(e) => setRegShiftType(e.target.value as 'A' | 'B')}
                disabled={loading}
              >
                <option value="A">A 班</option>
                <option value="B">B 班</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="regSite">廠區 *</label>
              <select
                id="regSite"
                value={regSite}
                onChange={(e) => setRegSite(e.target.value as 'P1' | 'P2' | 'P3' | 'P4')}
                disabled={loading}
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="regDayNight">日夜班 *</label>
              <select
                id="regDayNight"
                value={regDayNight}
                onChange={(e) => setRegDayNight(e.target.value as 'D' | 'N')}
                disabled={loading}
              >
                <option value="D">日班</option>
                <option value="N">夜班</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="regPassword">密碼</label>
              <div className="password-input-wrapper">
                <input
                  id="regPassword"
                  type={regShowPassword ? 'text' : 'password'}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="請設定密碼"
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setRegShowPassword(!regShowPassword)}
                  disabled={loading}
                  tabIndex={-1}
                >
                  {regShowPassword ? '隱藏' : '顯示'}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="regPasswordConfirm">確認密碼</label>
              <input
                id="regPasswordConfirm"
                type={regShowPassword ? 'text' : 'password'}
                value={regPasswordConfirm}
                onChange={(e) => setRegPasswordConfirm(e.target.value)}
                placeholder="請再次輸入密碼"
                disabled={loading}
                autoComplete="new-password"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? '送出中...' : '送出註冊申請'}
            </button>

            <button
              type="button"
              className="login-link-button"
              disabled={loading}
              onClick={() => {
                setError('')
                setMode('login')
              }}
            >
              返回登入
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default Login
