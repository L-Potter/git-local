import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  useUsersAPI,
  User,
  CreateUserData,
  PendingUserRegistration,
  UpdateUserPayload,
} from '../hooks/useUsersAPI'
import { DEFAULT_MONTHLY_OVERTIME_CAP_HOURS } from '../constants/workLimits'
import { useGroupsAPI, UserGroup } from '../hooks/useGroupsAPI'
import './Admin.css'

const Admin: React.FC = () => {
  const {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    getPendingUserRegistrations,
    approveUserRegistration,
    rejectUserRegistration,
    swapDayNightByShift,
  } = useUsersAPI()
  const { getGroups, createGroup, updateGroup, deleteGroup } = useGroupsAPI()
  const { user } = useAuth()
  const navigate = useNavigate()

  const isSuperAdmin = user?.role === 'admin'
  /** 群組為 manager 且非超級管理員：僅可新增一般用戶；可編輯但不可改密碼；不可刪除 */
  const isGroupManagerRecruiter = Boolean(user && user.group === 'manager' && user.role !== 'admin')
  /** 角色為 admin 或 manager：可核准／拒絕自助註冊。 */
  const canModerateRegistrations = user?.role === 'admin' || user?.role === 'manager'

  const [pendingRegs, setPendingRegs] = useState<PendingUserRegistration[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingErr, setPendingErr] = useState('')

  const [groupsList, setGroupsList] = useState<UserGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [groupSuccess, setGroupSuccess] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editGroupData, setEditGroupData] = useState<{ group: string; grouplimitnumber: number; allow_overtime: number }>({
    group: '',
    grouplimitnumber: 3,
    allow_overtime: 1,
  })
  const [newGroupForm, setNewGroupForm] = useState<{ group: string; grouplimitnumber: number; allow_overtime: number }>({
    group: '',
    grouplimitnumber: 3,
    allow_overtime: 1,
  })

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [editFormData, setEditFormData] = useState<
    Partial<CreateUserData> & { monthly_overtime_cap_hours?: number; clear_monthly_overtime_cap?: boolean }
  >({})
  const [passwordChangeUserId, setPasswordChangeUserId] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const [formData, setFormData] = useState<CreateUserData>({
    name: '',
    employee_id: '',
    password: '',
    shift_type: 'A',
    site: 'P1',
    day_night: 'D',
    role: 'user',
    group: '',
  })
  const [showSuccess, setShowSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [nameFilter, setNameFilter] = useState('')
  const [employeeIdFilter, setEmployeeIdFilter] = useState('')
  const [shiftTypeFilter, setShiftTypeFilter] = useState<'ALL' | 'A' | 'B' | 'UNSET'>('ALL')
  const [siteFilter, setSiteFilter] = useState<'ALL' | 'P1' | 'P2' | 'P3' | 'P4' | 'UNSET'>('ALL')
  const [dayNightFilter, setDayNightFilter] = useState<'ALL' | 'D' | 'N' | 'UNSET'>('ALL')
  const [groupFilter, setGroupFilter] = useState<'ALL' | 'UNSET' | string>('ALL')
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'user' | 'manager' | 'admin'>('ALL')

  useEffect(() => {
    if (isGroupManagerRecruiter) {
      setFormData(prev => (prev.role === 'user' ? prev : { ...prev, role: 'user' }))
    }
  }, [isGroupManagerRecruiter])

  // 加载用户列表 且 Access Control（admin、role manager、或 group===manager）
  useEffect(() => {
    const allowed =
      user &&
      (user.role === 'admin' || user.role === 'manager' || user.group === 'manager')
    if (user && !allowed) {
      navigate('/')
      return
    }
    loadUsers()
    loadGroups()
    if (user && (user.role === 'admin' || user.role === 'manager')) {
      loadPendingRegistrations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate])

  const loadGroups = async () => {
    try {
      setGroupsLoading(true)
      const data = await getGroups()
      setGroupsList(data)
    } catch (error) {
      console.error('載入群組清單失敗:', error)
    } finally {
      setGroupsLoading(false)
    }
  }

  const loadPendingRegistrations = async () => {
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      setPendingRegs([])
      return
    }
    try {
      setPendingLoading(true)
      setPendingErr('')
      const rows = await getPendingUserRegistrations()
      setPendingRegs(rows)
    } catch (error) {
      setPendingErr(error instanceof Error ? error.message : '載入待審清單失敗')
      setPendingRegs([])
    } finally {
      setPendingLoading(false)
    }
  }

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim() || !formData.employee_id.trim() || !formData.password.trim()) {
      alert('請填寫姓名、工號和密碼')
      return
    }

    try {
      const { monthly_overtime_cap_hours: capField, ...rest } = formData
      const groupValue = formData.group || (groupsList[0]?.group || 'G1')
      const payload: CreateUserData = isGroupManagerRecruiter
        ? { ...rest, group: groupValue, role: 'user' }
        : { ...rest, group: groupValue }
      if (
        isSuperAdmin &&
        typeof capField === 'number' &&
        !Number.isNaN(capField) &&
        capField > 0
      ) {
        payload.monthly_overtime_cap_hours = capField
      }
      await createUser(payload)
      setShowSuccess(true)
      setFormData({
        name: '',
        employee_id: '',
        password: '',
        shift_type: 'A',
        site: 'P1',
        day_night: 'D',
        role: 'user',
        group: '',
        monthly_overtime_cap_hours: undefined,
      })
      setShowPassword(false)

      // 重新加载用户列表
      await loadUsers()
      if (canModerateRegistrations) {
        await loadPendingRegistrations()
      }

      setTimeout(() => setShowSuccess(false), 3000)
    } catch (error) {
      alert(error instanceof Error ? error.message : '創建用戶失敗')
    }
  }

  const startEdit = (u: User) => {
    setEditingUserId(u.user_id)
    setEditFormData({
      shift_type: u.shift_type || undefined,
      site: u.site || undefined,
      day_night: u.day_night || undefined,
      group: u.group || (groupsList[0]?.group || 'G1'),
      monthly_overtime_cap_hours: u.monthly_overtime_cap_hours ?? undefined,
      clear_monthly_overtime_cap: false,
    })
    setPasswordChangeUserId(null)
  }

  const cancelEdit = () => {
    setEditingUserId(null)
    setEditFormData({})
  }

  const saveEdit = async (id: number) => {
    try {
      const payload: UpdateUserPayload = { ...editFormData }
      delete payload.clear_monthly_overtime_cap
      if (isGroupManagerRecruiter) {
        delete payload.password
      }
      if (!isSuperAdmin) {
        delete payload.monthly_overtime_cap_hours
      } else if (editFormData.clear_monthly_overtime_cap) {
        payload.clear_monthly_overtime_cap = true
        delete payload.monthly_overtime_cap_hours
      } else if (
        typeof editFormData.monthly_overtime_cap_hours === 'number' &&
        !Number.isNaN(editFormData.monthly_overtime_cap_hours)
      ) {
        payload.monthly_overtime_cap_hours = editFormData.monthly_overtime_cap_hours
      } else {
        delete payload.monthly_overtime_cap_hours
      }
      await updateUser(id, payload)
      setEditingUserId(null)
      loadUsers()
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新用戶失敗')
    }
  }

  const handlePasswordChange = async (id: number) => {
    if (!newPassword.trim()) {
      alert('密碼不能為空')
      return
    }
    try {
      await updateUser(id, { password: newPassword })
      alert('密碼變更成功')
      setPasswordChangeUserId(null)
      setNewPassword('')
    } catch (error) {
      alert(error instanceof Error ? error.message : '變更密碼失敗')
    }
  }

  const handleSwapDayNight = async (shift: 'A' | 'B') => {
    if (!isSuperAdmin) return
    if (
      !window.confirm(
        `確定對「${shift}班」所有使用者進行日班／夜班對調？\n\n僅會更新目前班別為 ${shift} 且日夜班為「日班(D)」或「夜班(N)」的帳號（D↔N）。\n未設定日夜班者不改變。`
      )
    ) {
      return
    }
    try {
      const r = await swapDayNightByShift(shift)
      await loadUsers()
      alert(`已對調完成：${r.shift_type}班共更新 ${r.swapped} 筆。`)
    } catch (e) {
      alert(e instanceof Error ? e.message : '對調失敗')
    }
  }

  const handleDelete = async (userId: number, name: string) => {
    if (window.confirm(`確定要刪除員工「${name}」嗎？`)) {
      try {
        await deleteUser(userId)
        // 重新加载用户列表
        await loadUsers()
      } catch (error) {
        alert(error instanceof Error ? error.message : '刪除用戶失敗')
      }
    }
  }

  const groupFilterOptions = useMemo(() => {
    const groups = new Set<string>()
    groupsList.forEach((g) => {
      if (g.group && g.group !== '未定義') groups.add(g.group)
    })
    users.forEach((u) => {
      if (u.group && u.group !== '未定義') groups.add(u.group)
    })
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [users, groupsList])

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setGroupError('')
    setGroupSuccess('')
    const trimmed = newGroupForm.group.trim()
    if (!trimmed) {
      setGroupError('請輸入群組名稱')
      return
    }
    try {
      await createGroup({
        group: trimmed,
        grouplimitnumber: Number(newGroupForm.grouplimitnumber) || 0,
        allow_overtime: Number(newGroupForm.allow_overtime) === 0 ? 0 : 1,
      })
      setGroupSuccess(`群組「${trimmed}」建立成功`)
      setNewGroupForm({ group: '', grouplimitnumber: 3, allow_overtime: 1 })
      await loadGroups()
      setTimeout(() => setGroupSuccess(''), 3000)
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : '建立群組失敗')
    }
  }

  const handleSaveGroup = async (id: number) => {
    setGroupError('')
    setGroupSuccess('')
    try {
      await updateGroup(id, {
        group: editGroupData.group.trim(),
        grouplimitnumber: Number(editGroupData.grouplimitnumber) || 0,
        allow_overtime: Number(editGroupData.allow_overtime) === 0 ? 0 : 1,
      })
      setGroupSuccess('群組更新成功')
      setEditingGroupId(null)
      await loadGroups()
      await loadUsers()
      setTimeout(() => setGroupSuccess(''), 3000)
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : '更新群組失敗')
    }
  }

  const handleDeleteGroup = async (id: number, groupName: string) => {
    if (!window.confirm(`確定要刪除群組「${groupName}」嗎？`)) return
    setGroupError('')
    setGroupSuccess('')
    try {
      await deleteGroup(id)
      setGroupSuccess(`群組「${groupName}」已刪除`)
      await loadGroups()
      setTimeout(() => setGroupSuccess(''), 3000)
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : '刪除群組失敗')
    }
  }

  const filteredUsers = useMemo(() => {
    const keywordName = nameFilter.trim().toLowerCase()
    const keywordEmployeeId = employeeIdFilter.trim().toLowerCase()

    return users.filter((u) => {
      const nameMatched = keywordName ? u.name.toLowerCase().includes(keywordName) : true
      const employeeIdMatched = keywordEmployeeId ? u.employee_id.toLowerCase().includes(keywordEmployeeId) : true
      const shiftMatched =
        shiftTypeFilter === 'ALL' ? true : shiftTypeFilter === 'UNSET' ? !u.shift_type : u.shift_type === shiftTypeFilter
      const siteMatched = siteFilter === 'ALL' ? true : siteFilter === 'UNSET' ? !u.site : u.site === siteFilter
      const dayNightMatched =
        dayNightFilter === 'ALL' ? true : dayNightFilter === 'UNSET' ? !u.day_night : u.day_night === dayNightFilter
      const groupMatched =
        groupFilter === 'ALL'
          ? true
          : groupFilter === 'UNSET'
            ? !u.group || u.group === '未定義'
            : u.group === groupFilter
      const roleMatched = roleFilter === 'ALL' ? true : u.role === roleFilter

      return nameMatched && employeeIdMatched && shiftMatched && siteMatched && dayNightMatched && groupMatched && roleMatched
    })
  }, [users, nameFilter, employeeIdFilter, shiftTypeFilter, siteFilter, dayNightFilter, groupFilter, roleFilter])

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>管理員 - 用戶管理</h1>
        {isGroupManagerRecruiter && (
          <p className="admin-subtitle">
            您可新增「一般用戶」，並可編輯班別／廠區／日夜班／群組；無法變更密碼。刪除帳號僅限超級管理員。
          </p>
        )}
        {isSuperAdmin && (
          <div className="admin-swap-day-night" style={{ marginTop: 12 }}>
            <span className="admin-hint" style={{ marginRight: 12 }}>
              批次日夜對調（僅該班、且目前為 D/N 者，語意同 D→空→N 三步）：
            </span>
            <button
              type="button"
              className="submit-btn"
              style={{ padding: '6px 14px', fontSize: '13px', width: 'auto', marginRight: 8, marginTop: 0 }}
              onClick={() => void handleSwapDayNight('A')}
            >
              A 班對調
            </button>
            <button
              type="button"
              className="submit-btn"
              style={{ padding: '6px 14px', fontSize: '13px', width: 'auto', marginTop: 0, background: '#5c6bc0' }}
              onClick={() => void handleSwapDayNight('B')}
            >
              B 班對調
            </button>
          </div>
        )}
      </div>

      <div className="admin-content">
        {canModerateRegistrations && (
          <div className="create-user-section registration-queue-section">
            <h2>待審核註冊申請</h2>
            <p className="admin-hint">
              核准時會在資料庫單一交易中寫入通過。
            </p>
            {pendingErr && (
              <div className="error-inline">{pendingErr}</div>
            )}
            {pendingLoading ? (
              <div style={{ padding: '12px', color: '#666' }}>載入待審清單中…</div>
            ) : pendingRegs.length === 0 ? (
              <p className="admin-muted">目前沒有待審核的註冊申請。</p>
            ) : (
              <div className="user-table-container">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>編號</th>
                      <th>姓名</th>
                      <th>工號</th>
                      <th>班別</th>
                      <th>廠區</th>
                      <th>日夜班</th>
                      <th>申請時間</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRegs.map((r) => (
                      <tr key={r.registration_id}>
                        <td>{r.registration_id}</td>
                        <td>{r.name}</td>
                        <td>{r.employee_id}</td>
                        <td>{r.shift_type || '—'}</td>
                        <td>{r.site || '—'}</td>
                        <td>{r.day_night === 'D' ? '日班' : r.day_night === 'N' ? '夜班' : (r.day_night || '—')}</td>
                        <td>{r.created_at || '—'}</td>
                        <td style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', border: 'none' }}>
                          <button
                            type="button"
                            className="submit-btn"
                            style={{ padding: '6px 12px', fontSize: '13px', width: 'auto', marginTop: 0 }}
                            onClick={async () => {
                              if (!window.confirm(`核准「${r.name}」（${r.employee_id}）註冊？`)) return
                              try {
                                await approveUserRegistration(r.registration_id)
                                await loadUsers()
                                await loadPendingRegistrations()
                              } catch (e) {
                                alert(e instanceof Error ? e.message : '核准失敗')
                              }
                            }}
                          >
                            核准
                          </button>
                          <button
                            type="button"
                            className="delete-btn"
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={async () => {
                              if (!window.confirm(`拒絕「${r.name}」（${r.employee_id}）的申請？`)) return
                              try {
                                await rejectUserRegistration(r.registration_id)
                                await loadPendingRegistrations()
                              } catch (e) {
                                alert(e instanceof Error ? e.message : '拒絕失敗')
                              }
                            }}
                          >
                            拒絕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 群組出勤限制管理 (僅 admin 角色可見可改) isSuperAdmin &&*/}
        {isSuperAdmin && (
          <div className="create-user-section registration-queue-section">
            <h2>群組出勤限制管理</h2>
            <p className="admin-hint">
              設定各群組每日請假人數上限（grouplimitnumber），以及該群組是否允許以加班人數沖銷請假數（allow overtime）。
            </p>
            {groupError && <div className="error-inline">{groupError}</div>}
            {groupSuccess && <div className="success-message">{groupSuccess}</div>}

            {/* 新增群組表單 */}
            <form onSubmit={handleCreateGroup} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '20px', background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>群組名稱 *</label>
                <input
                  type="text"
                  placeholder="例如 G3, IT..."
                  value={newGroupForm.group}
                  onChange={(e) => setNewGroupForm({ ...newGroupForm, group: e.target.value })}
                  style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', minWidth: '120px' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>請假人數限制 (grouplimitnumber) *</label>
                <input
                  type="number"
                  min="0"
                  value={newGroupForm.grouplimitnumber}
                  onChange={(e) => setNewGroupForm({ ...newGroupForm, grouplimitnumber: parseInt(e.target.value) || 0 })}
                  style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', width: '120px' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>允許加班沖銷請假數 (allow overtime) *</label>
                <select
                  value={newGroupForm.allow_overtime}
                  onChange={(e) => setNewGroupForm({ ...newGroupForm, allow_overtime: parseInt(e.target.value) || 0 })}
                  style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                >
                  <option value={1}>1 - 是（淨請假 = 請假 - 加班）</option>
                  <option value={0}>0 - 否（僅看請假人數）</option>
                </select>
              </div>
              <button
                type="submit"
                className="submit-btn"
                style={{ padding: '8px 16px', fontSize: '13px', width: 'auto', marginTop: 0 }}
              >
                新增群組
              </button>
            </form>

            {/* 群組清單表格 */}
            {groupsLoading ? (
              <div style={{ padding: '12px', color: '#666' }}>載入群組設定中…</div>
            ) : groupsList.length === 0 ? (
              <p className="admin-muted">目前沒有群組設定。</p>
            ) : (
              <div className="user-table-container">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>群組名稱 (group)</th>
                      <th>請假限制人數 (grouplimitnumber)</th>
                      <th>加班沖銷 (allow overtime)</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupsList.map((g) => {
                      const isEditing = editingGroupId === g.id
                      return (
                        <tr key={g.id}>
                          <td>{g.id}</td>
                          <td>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editGroupData.group}
                                onChange={(e) => setEditGroupData({ ...editGroupData, group: e.target.value })}
                                style={{ padding: '4px 8px', fontSize: '13px', width: '100px' }}
                              />
                            ) : (
                              <strong>{g.group}</strong>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                value={editGroupData.grouplimitnumber}
                                onChange={(e) => setEditGroupData({ ...editGroupData, grouplimitnumber: parseInt(e.target.value) || 0 })}
                                style={{ padding: '4px 8px', fontSize: '13px', width: '80px' }}
                              />
                            ) : (
                              <span>{g.grouplimitnumber} 人</span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                value={editGroupData.allow_overtime}
                                onChange={(e) => setEditGroupData({ ...editGroupData, allow_overtime: parseInt(e.target.value) || 0 })}
                                style={{ padding: '4px 8px', fontSize: '13px' }}
                              >
                                <option value={1}>1 - 允許加班沖銷</option>
                                <option value={0}>0 - 僅看請假人數</option>
                              </select>
                            ) : (
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  backgroundColor: g.allow_overtime === 0 ? '#ffebee' : '#e8f5e9',
                                  color: g.allow_overtime === 0 ? '#c62828' : '#2e7d32',
                                  fontWeight: 500,
                                }}
                              >
                                {g.allow_overtime === 0 ? '0（僅看請假數）' : '1（允許加班沖銷）'}
                              </span>
                            )}
                          </td>
                          <td style={{ display: 'flex', gap: '8px', border: 'none' }}>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="submit-btn"
                                  style={{ padding: '4px 10px', fontSize: '12px', width: 'auto', marginTop: 0 }}
                                  onClick={() => handleSaveGroup(g.id)}
                                >
                                  儲存
                                </button>
                                <button
                                  type="button"
                                  className="cancel-btn"
                                  style={{ padding: '4px 10px', fontSize: '12px', width: 'auto', marginTop: 0 }}
                                  onClick={() => setEditingGroupId(null)}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="edit-btn"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                  onClick={() => {
                                    setEditingGroupId(g.id)
                                    setEditGroupData({
                                      group: g.group,
                                      grouplimitnumber: g.grouplimitnumber,
                                      allow_overtime: g.allow_overtime ?? (g['allow overtime'] ?? 1),
                                    })
                                  }}
                                >
                                  編輯
                                </button>
                                <button
                                  type="button"
                                  className="delete-btn"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                  onClick={() => handleDeleteGroup(g.id, g.group)}
                                >
                                  刪除
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 創建用戶表單 */}
        {(isSuperAdmin || isGroupManagerRecruiter) && (
          <div className="create-user-section">
            <h2>新增員工</h2>
            <p className="admin-hint">此流程不經待審表；與上方自助註冊審核為兩條路徑。</p>
            {showSuccess && (
              <div className="success-message">✓ 員工已成功新增</div>
            )}
            <form onSubmit={handleSubmit} className="user-form">
              <div className="form-group">
                <label htmlFor="name">姓名 *</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="請輸入姓名"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="employee_id">工號 *</label>
                <input
                  id="employee_id"
                  type="text"
                  value={formData.employee_id}
                  onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                  placeholder="請輸入工號"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">密碼 *</label>
                <div className="password-input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="請輸入密碼"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? '隱藏密碼' : '顯示密碼'}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="shift_type">班別 *</label>
                <select
                  id="shift_type"
                  value={formData.shift_type}
                  onChange={(e) => setFormData({ ...formData, shift_type: e.target.value as CreateUserData['shift_type'] })}
                  required
                >
                  <option value="A">A 班</option>
                  <option value="B">B 班</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="site">廠區 *</label>
                <select
                  id="site"
                  value={formData.site}
                  onChange={(e) => setFormData({ ...formData, site: e.target.value as CreateUserData['site'] })}
                  required
                >
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                  <option value="P4">P4</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="day_night">日夜班 *</label>
                <select
                  id="day_night"
                  value={formData.day_night}
                  onChange={(e) => setFormData({ ...formData, day_night: e.target.value as CreateUserData['day_night'] })}
                  required
                >
                  <option value="D">日班</option>
                  <option value="N">夜班</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="group">群組 *</label>
                <select
                  id="group"
                  value={formData.group || (groupsList[0]?.group || 'G1')}
                  onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                  required
                >
                  {groupsList.map((g) => (
                    <option key={g.id} value={g.group}>
                      {g.group}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="role">角色 *</label>
                {isGroupManagerRecruiter ? (
                  <input id="role" type="text" value="一般用戶" readOnly className="readonly-field" />
                ) : (
                  <select
                    id="role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as CreateUserData['role'] })}
                    required
                  >
                    <option value="user">一般用戶</option>
                    <option value="manager">管理員</option>
                    <option value="admin">超級管理員</option>
                  </select>
                )}
              </div>

              {isSuperAdmin && (
                <div className="form-group">
                  <label htmlFor="monthly_overtime_cap_hours">當月加班上限（小時，選填）</label>
                  <input
                    id="monthly_overtime_cap_hours"
                    type="number"
                    min={1}
                    step={1}
                    value={formData.monthly_overtime_cap_hours ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setFormData({
                        ...formData,
                        monthly_overtime_cap_hours: v === '' ? undefined : parseInt(v, 10),
                      })
                    }}
                    placeholder={`空白＝全站預設 ${DEFAULT_MONTHLY_OVERTIME_CAP_HOURS} 小時`}
                  />
                </div>
              )}

              <button type="submit" className="submit-btn">新增員工</button>
            </form>
          </div>
        )}

        {/* 員工列表 */}
        <div className="user-list-section">
          <h2>員工列表 ({filteredUsers.length}/{users.length})</h2>
          <div className="user-list-filters">
            <label className="user-list-filter-item">
              姓名
              <input
                type="text"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="輸入姓名關鍵字"
              />
            </label>
            <label className="user-list-filter-item">
              工號
              <input
                type="text"
                value={employeeIdFilter}
                onChange={(e) => setEmployeeIdFilter(e.target.value)}
                placeholder="輸入工號關鍵字"
              />
            </label>
            <label className="user-list-filter-item">
              班別
              <select value={shiftTypeFilter} onChange={(e) => setShiftTypeFilter(e.target.value as 'ALL' | 'A' | 'B' | 'UNSET')}>
                <option value="ALL">全部</option>
                <option value="A">A 班</option>
                <option value="B">B 班</option>
                <option value="UNSET">未設定</option>
              </select>
            </label>
            <label className="user-list-filter-item">
              廠區
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value as 'ALL' | 'P1' | 'P2' | 'P3' | 'P4' | 'UNSET')}>
                <option value="ALL">全部</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
                <option value="UNSET">未設定</option>
              </select>
            </label>
            <label className="user-list-filter-item">
              日夜班
              <select value={dayNightFilter} onChange={(e) => setDayNightFilter(e.target.value as 'ALL' | 'D' | 'N' | 'UNSET')}>
                <option value="ALL">全部</option>
                <option value="D">日班</option>
                <option value="N">夜班</option>
                <option value="UNSET">未設定</option>
              </select>
            </label>
            <label className="user-list-filter-item">
              群組
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="ALL">全部</option>
                {groupFilterOptions.map((groupName) => (
                  <option key={groupName} value={groupName}>{groupName}</option>
                ))}
                <option value="UNSET">未定義/空白</option>
              </select>
            </label>
            <label className="user-list-filter-item">
              角色
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'ALL' | 'user' | 'manager' | 'admin')}>
                <option value="ALL">全部</option>
                <option value="user">一般用戶</option>
                <option value="manager">管理員</option>
                <option value="admin">超級管理員</option>
              </select>
            </label>
          </div>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>載入中...</div>
          ) : (
            <div className="user-table-container">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>工號</th>
                    <th>班別</th>
                    <th>廠區</th>
                    <th>日夜班</th>
                    <th>群組</th>
                    {isSuperAdmin && <th>月加班上限</th>}
                    <th>角色</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={isSuperAdmin ? 9 : 8} style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                        沒有符合條件的員工資料
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const isEditing = editingUserId === u.user_id;
                      return (
                        <tr key={u.user_id}>
                          <td>{u.name}</td>
                          <td>{u.employee_id}</td>

                          {/* 班別 */}
                          <td>
                            {isEditing ? (
                              <select
                                value={editFormData.shift_type || ''}
                                onChange={(e) => setEditFormData({ ...editFormData, shift_type: e.target.value as 'A' | 'B' })}
                              >
                                <option value="A">A 班</option>
                                <option value="B">B 班</option>
                              </select>
                            ) : (
                              u.shift_type ? (
                                <span className="badge shift-badge">{u.shift_type}</span>
                              ) : (
                                <span style={{ color: '#999' }}>-</span>
                              )
                            )}
                          </td>

                          {/* 廠區 */}
                          <td>
                            {isEditing ? (
                              <select
                                value={editFormData.site || ''}
                                onChange={(e) => setEditFormData({ ...editFormData, site: e.target.value as CreateUserData['site'] })}
                              >
                                <option value="P1">P1</option>
                                <option value="P2">P2</option>
                                <option value="P3">P3</option>
                                <option value="P4">P4</option>
                              </select>
                            ) : (
                              u.site ? (
                                <span className="badge factory-badge">{u.site}</span>
                              ) : (
                                <span style={{ color: '#999' }}>-</span>
                              )
                            )}
                          </td>

                          {/* 日夜班 */}
                          <td>
                            {isEditing ? (
                              <select
                                value={editFormData.day_night || 'D'}
                                onChange={(e) => setEditFormData({ ...editFormData, day_night: e.target.value as CreateUserData['day_night'] })}
                              >
                                <option value="D">日班</option>
                                <option value="N">夜班</option>
                              </select>
                            ) : (
                              u.day_night ? (
                                <span className="badge day-night-badge">{u.day_night === 'D' ? '日班' : '夜班'}</span>
                              ) : (
                                <span style={{ color: '#999' }}>-</span>
                              )
                            )}
                          </td>

                          {/* 群組 */}
                          <td>
                            {isEditing ? (
                              <select
                                value={editFormData.group || (groupsList[0]?.group || 'G1')}
                                onChange={(e) =>
                                  setEditFormData({ ...editFormData, group: e.target.value })
                                }
                                style={{ width: '90px', padding: '4px' }}
                              >
                                {groupsList.map((g) => (
                                  <option key={g.id} value={g.group}>
                                    {g.group}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              u.group || <span style={{ color: '#999' }}>-</span>
                            )}
                          </td>

                          {isSuperAdmin && (
                            <td style={{ minWidth: '140px' }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    disabled={editFormData.clear_monthly_overtime_cap === true}
                                    value={
                                      editFormData.clear_monthly_overtime_cap
                                        ? ''
                                        : editFormData.monthly_overtime_cap_hours ?? ''
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setEditFormData({
                                        ...editFormData,
                                        clear_monthly_overtime_cap: false,
                                        monthly_overtime_cap_hours:
                                          v === '' ? undefined : parseInt(v, 10),
                                      })
                                    }}
                                    placeholder={`預設 ${DEFAULT_MONTHLY_OVERTIME_CAP_HOURS}`}
                                    style={{ width: '100%', padding: '4px' }}
                                  />
                                  <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <input
                                      type="checkbox"
                                      checked={editFormData.clear_monthly_overtime_cap === true}
                                      onChange={(e) =>
                                        setEditFormData({
                                          ...editFormData,
                                          clear_monthly_overtime_cap: e.target.checked,
                                        })
                                      }
                                    />
                                    全站預設
                                  </label>
                                </div>
                              ) : u.monthly_overtime_cap_hours != null ? (
                                <span>{u.monthly_overtime_cap_hours} h</span>
                              ) : (
                                <span style={{ color: '#888' }}>全站 {DEFAULT_MONTHLY_OVERTIME_CAP_HOURS} h</span>
                              )}
                            </td>
                          )}

                          <td>
                            <span className={`badge ${u.role === 'admin' ? 'role-admin' :
                              u.role === 'manager' ? 'role-manager' : 'role-user'
                              }`}>
                              {u.role === 'admin' ? '超級管理員' :
                                u.role === 'manager' ? '管理員' : '一般用戶'}
                            </span>
                          </td>

                          {/* 操作 */}
                          <td style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minWidth: '150px', border: 'none' }}>
                            {isEditing ? (
                              <>
                                {isSuperAdmin && (
                                  <input
                                    type="text"
                                    placeholder="新密碼 (選填)"
                                    value={editFormData.password || ''}
                                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                                    style={{ width: '120px', padding: '4px' }}
                                  />
                                )}
                                <button className="submit-btn" style={{ padding: '4px 8px', fontSize: '12px', width: 'auto', marginTop: 0 }} onClick={() => saveEdit(u.user_id)}>儲存</button>
                                <button className="delete-btn" style={{ padding: '4px 8px', fontSize: '12px', background: '#999' }} onClick={cancelEdit}>取消</button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="submit-btn"
                                  style={{ padding: '4px 8px', fontSize: '12px', width: 'auto', marginTop: 0, background: '#2196F3' }}
                                  onClick={() => startEdit(u)}
                                >
                                  編輯
                                </button>
                                {isSuperAdmin && (
                                  <button
                                    className="delete-btn"
                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                    onClick={() => handleDelete(u.user_id, u.name)}
                                  >
                                    刪除
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Admin
