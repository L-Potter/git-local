import React, { useState, useEffect, useMemo } from 'react'
import { useUsersAPI, User } from '../hooks/useUsersAPI'
import { useCalendarTagsAPI } from '../hooks/useCalendarTagsAPI'
import { useAuth } from '../hooks/useAuth'
import EmployeeDetailPanel from './EmployeeDetailPanel'
import './People.css'

const SHIFT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部班別' },
  { value: 'DA', label: 'DA（白A）' },
  { value: 'DB', label: 'DB（白B）' },
  { value: 'NA', label: 'NA（夜A）' },
  { value: 'NB', label: 'NB（夜B）' },
]

function shiftLineOf(u: User): string {
  return `${u.day_night ?? ''}${u.shift_type ?? ''}`
}

const People: React.FC = () => {
  const { getUsers } = useUsersAPI()
  const { getCalendarTags } = useCalendarTagsAPI()
  const { user: loggedInUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showDetailPanel, setShowDetailPanel] = useState(false)
  const [shiftFilter, setShiftFilter] = useState<string>('')

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoading(true)
        const data = await getUsers()
        setUsers(data)
      } catch (error) {
        console.error('加载用户列表失败:', error)
        alert('加载用户列表失败: ' + (error instanceof Error ? error.message : '未知错误'))
      } finally {
        setLoading(false)
      }
    }
    loadUsers()
  }, [])

  const handleOpenDetail = (user: User) => {
    setSelectedUser(user)
    setShowDetailPanel(true)
  }

  const handleCloseDetail = () => {
    setShowDetailPanel(false)
    setSelectedUser(null)
  }

  /**
   * 顯示用列表：
   * 1. 過濾掉 admin
   * 2. 依班別篩選
   * 3. 登入者排到第一筆（若他在結果中）
   */
  const displayedUsers = useMemo(() => {
    const base = users.filter((u) => u.role !== 'admin')
    const filtered = shiftFilter
      ? base.filter((u) => shiftLineOf(u) === shiftFilter)
      : base

    if (!loggedInUser) return filtered
    const selfIdx = filtered.findIndex((u) => u.user_id === loggedInUser.user_id)
    if (selfIdx <= 0) return filtered
    const self = filtered[selfIdx]
    return [self, ...filtered.slice(0, selfIdx), ...filtered.slice(selfIdx + 1)]
  }, [users, shiftFilter, loggedInUser])

  return (
    <>
      <div className={`people-page ${showDetailPanel ? 'dimmed' : ''}`}>
        <div className="people-header">
          <h1>員工管理</h1>
          <div className="people-toolbar">
            <label className="people-filter">
              <span className="people-filter-label">班別篩選：</span>
              <select
                className="people-filter-select"
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
              >
                {SHIFT_OPTIONS.map((opt) => (
                  <option key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="people-table-container">
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>載入中...</div>
          ) : (
            <table className="people-table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>工號</th>
                  <th>班別</th>
                  <th>廠區</th>
                  <th className="action-column"></th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                      尚無員工資料
                    </td>
                  </tr>
                ) : (
                  displayedUsers.map((user) => {
                    const isSelf = loggedInUser?.user_id === user.user_id
                    const shiftLine = shiftLineOf(user)
                    return (
                      <tr key={user.user_id} className={isSelf ? 'is-self-row' : ''}>
                        <td>
                          {user.name}
                          {isSelf && <span className="self-badge">（我）</span>}
                        </td>
                        <td>{user.employee_id}</td>
                        <td>
                          {shiftLine ? (
                            <span className="badge shift-badge">{shiftLine}</span>
                          ) : (
                            <span style={{ color: '#999' }}>-</span>
                          )}
                        </td>
                        <td>
                          {user.site ? (
                            <span className="badge factory-badge">{user.site}</span>
                          ) : (
                            <span style={{ color: '#999' }}>-</span>
                          )}
                        </td>
                        <td className="action-column">
                          <button
                            className="action-menu-btn"
                            onClick={() => handleOpenDetail(user)}
                            title="編輯資訊"
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="1"/>
                              <circle cx="12" cy="5" r="1"/>
                              <circle cx="12" cy="19" r="1"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showDetailPanel && selectedUser && (
        <EmployeeDetailPanel
          user={selectedUser}
          onClose={handleCloseDetail}
        />
      )}
    </>
  )
}

export default People
