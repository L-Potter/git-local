import React, { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useUsersAPI } from '../hooks/useUsersAPI'
import './ChangePassword.css'

const ChangePassword: React.FC = () => {
  const { user } = useAuth()
  const { changeOwnPassword } = useUsersAPI()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!user?.employee_id) {
      setError('無法取得登入工號')
      return
    }
    if (!currentPassword || !newPassword) {
      setError('請填寫目前密碼與新密碼')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一致')
      return
    }

    setLoading(true)
    try {
      await changeOwnPassword({
        employee_id: user.employee_id,
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      })
      setSuccess('密碼已更新。此操作會記錄在系統日誌；下次登入請使用新密碼。')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '變更失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="change-password-page">
      <h1>修改密碼</h1>
      <p className="change-password-intro">
        變更成功後會寫入系統日誌（動作：<code>SELF_PASSWORD_CHANGE</code>），不含密碼內容。
      </p>
      {user && (
        <p className="change-password-user">
          工號：<strong>{user.employee_id}</strong>　姓名：{user.name}
        </p>
      )}
      <form className="change-password-form" onSubmit={handleSubmit}>
        <label>
          目前密碼
          <input
            type={showPw ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />
        </label>
        <label>
          新密碼
          <input
            type={showPw ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
          />
        </label>
        <label>
          確認新密碼
          <input
            type={showPw ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
          />
        </label>
        <label className="change-password-toggle">
          <input type="checkbox" checked={showPw} onChange={() => setShowPw(!showPw)} disabled={loading} />
          顯示密碼
        </label>
        {error && <div className="change-password-error">{error}</div>}
        {success && <div className="change-password-success">{success}</div>}
        <button type="submit" className="change-password-submit" disabled={loading}>
          {loading ? '更新中…' : '更新密碼'}
        </button>
      </form>
    </div>
  )
}

export default ChangePassword
