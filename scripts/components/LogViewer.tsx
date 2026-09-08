import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLogsAPI, LogEntry, LogDeleteItem } from '../hooks/useLogsAPI'
import { useAuth } from '../hooks/useAuth'
import './LogViewer.css'

/** action 英文代碼或舊資料 → 中文顯示 */
const ACTION_LABEL_MAP: Record<string, string> = {
  CREATE: '建立',
  UPDATE: '更新',
  DELETE: '刪除',
  UPSERT: '寫入',
  APPROVE_REG: '核准註冊',
  REJECT_REG: '拒絕註冊',
  SELF_PASSWORD_CHANGE: '自行改密',
  ADMIN_PASSWORD_CHANGE: '管理員改密',
  MOVE_FROM: '移動來源',
  BATCH_UPDATE: '批次更新',
  LOGIN_SUCCESS: '登入成功',
  LOGIN_FAILURE: '登入失敗',
  LOGOUT: '登出',
  登入成功: '登入成功',
  登入失敗: '登入失敗',
  登出: '登出',
  DELETE_LOG_BATCH: '批次刪除日誌',
  DELETE_LOG_BEFORE: '依時間刪除日誌',
  日夜班對調: '日夜班對調',
}

function localizeAction(action: string): string {
  return ACTION_LABEL_MAP[action] ?? action
}

type LogDisplayRow = LogEntry & { action_label: string; row_uid: string }

export const LogViewer: React.FC = () => {
  const { user } = useAuth()
  const { getLogs, deleteLogsBatch, deleteLogsBefore, loading } = useLogsAPI()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteBeforeAt, setDeleteBeforeAt] = useState('')
  const [purgingBefore, setPurgingBefore] = useState(false)

  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [userFilter, setUserFilter] = useState<string>('')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [detailsFilter, setDetailsFilter] = useState<string>('')

  const [sortField, setSortField] = useState<keyof LogDisplayRow>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)

  const reloadLogs = useCallback(() => {
    return getLogs().then((data) => {
      setLogs(data)
      setSelectedRows(new Set())
    })
  }, [getLogs])

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'manager')) {
      void reloadLogs()
    }
  }, [user, reloadLogs])

  const localizedLogs = useMemo((): LogDisplayRow[] => {
    return logs.map((l) => {
      const src = l.log_source ?? 'admin'
      const owner = l.owner_employee_id ?? ''
      return {
        ...l,
        action_label: localizeAction(l.action),
        row_uid: `${src}|${owner}|${l.log_id}`,
      }
    })
  }, [logs])

  const filteredLogs = useMemo(() => {
    return localizedLogs.filter((log) => {
      if (startDate && log.created_at) {
        if (new Date(log.created_at) < new Date(startDate)) return false
      }
      if (endDate && log.created_at) {
        const endDay = new Date(endDate)
        endDay.setDate(endDay.getDate() + 1)
        if (new Date(log.created_at) >= endDay) return false
      }

      if (userFilter && !log.user.toLowerCase().includes(userFilter.toLowerCase())) return false

      if (actionFilter) {
        const f = actionFilter.toLowerCase()
        const raw = log.action.toLowerCase()
        const zh = log.action_label.toLowerCase()
        if (!raw.includes(f) && !zh.includes(f)) return false
      }

      if (detailsFilter && log.details && !log.details.toLowerCase().includes(detailsFilter.toLowerCase())) return false

      return true
    })
  }, [localizedLogs, startDate, endDate, userFilter, actionFilter, detailsFilter])

  const sortedAndFilteredLogs = useMemo(() => {
    const list = [...filteredLogs]
    list.sort((a, b) => {
      const valA = a[sortField] ?? ''
      const valB = b[sortField] ?? ''
      let cmp = 0
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB
      } else {
        cmp = String(valA).localeCompare(String(valB), 'zh-Hant')
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return list
  }, [filteredLogs, sortField, sortDirection])

  const allFilteredSelected = useMemo(() => {
    if (filteredLogs.length === 0) return false
    return filteredLogs.every((r) => selectedRows.has(r.row_uid))
  }, [filteredLogs, selectedRows])

  const someFilteredSelected = useMemo(() => {
    return filteredLogs.some((r) => selectedRows.has(r.row_uid))
  }, [filteredLogs, selectedRows])

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someFilteredSelected && !allFilteredSelected
    }
  }, [someFilteredSelected, allFilteredSelected])

  const handleToggleSelectAll = () => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filteredLogs.forEach((r) => next.delete(r.row_uid))
      } else {
        filteredLogs.forEach((r) => next.add(r.row_uid))
      }
      return next
    })
  }

  const handleToggleRow = (rowUid: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowUid)) {
        next.delete(rowUid)
      } else {
        next.add(rowUid)
      }
      return next
    })
  }

  const handleSort = (field: keyof LogDisplayRow) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const formatBeforeForApi = (datetimeLocal: string): string => {
    const v = datetimeLocal.trim()
    if (!v) return ''
    if (v.includes('T')) {
      const [d, t] = v.split('T')
      if (t.length === 5) return `${d} ${t}:00`
      return `${d} ${t}`
    }
    return v
  }

  const handleDeleteBefore = async () => {
    if (user?.role !== 'admin' || !deleteBeforeAt.trim()) return
    const before = formatBeforeForApi(deleteBeforeAt)
    if (
      !window.confirm(
        `確定刪除「生效時間」嚴格早於以下時間點的所有日誌？\n\n${before}\n\n（主庫 admin_log 與各人員庫 user_log 一併套用；此動作無法還原。）`
      )
    ) {
      return
    }
    setPurgingBefore(true)
    try {
      const r = await deleteLogsBefore(before)
      alert(
        `已刪除共 ${r.deleted} 筆（主庫 ${r.deleted_admin}、個人庫 ${r.deleted_user}），截止對照：${r.before}`
      )
      reloadLogs()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setPurgingBefore(false)
    }
  }

  const handleBatchDelete = async () => {
    if (user?.role !== 'admin' || selectedRows.size === 0) return
    const picked = filteredLogs.filter((r) => selectedRows.has(r.row_uid))
    const entries: LogDeleteItem[] = picked.map((r) => {
      const src = r.log_source ?? 'admin'
      if (src === 'user') {
        return {
          log_source: 'user',
          log_id: r.log_id,
          owner_employee_id: r.owner_employee_id ?? '',
        }
      }
      return { log_source: 'admin', log_id: r.log_id }
    })
    if (
      !window.confirm(
        `確定刪除已選取的 ${entries.length} 筆日誌？此動作無法還原。`
      )
    ) {
      return
    }
    setDeleting(true)
    try {
      const n = await deleteLogsBatch(entries)
      alert(`已刪除 ${n} 筆（若 log_id 不存在則不計入）`)
      reloadLogs()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setDeleting(false)
    }
  }

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return <div style={{ padding: 20 }}>權限不足：僅角色為超級管理員或經理可檢視系統日誌</div>
  }

  return (
    <div className="log-viewer-page">
      <h2 style={{ marginBottom: '8px', color: '#333' }}>系統日誌</h2>
      {user.role === 'manager' && (
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#666' }}>
          您為經理身分：列表已隱藏「角色為超級管理員」之操作紀錄；超級管理員可查閱全部。
        </p>
      )}
      {user.role === 'admin' && (
        <p style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>
          超級管理員可勾選列後批次刪除，或指定<strong>截止時間</strong>：刪除「生效時間」早於該時間點的<strong>全部</strong>日誌（主庫
          admin_log 與各人員庫 user_log；不含該時間點當秒）。
        </p>
      )}

      <div className="log-filter-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>從:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>到:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <input
          placeholder="過濾 作用者..."
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <input
          placeholder="過濾 操作..."
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', width: '120px' }}
        />
        <input
          placeholder="過濾 說明..."
          value={detailsFilter}
          onChange={(e) => setDetailsFilter(e.target.value)}
          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', width: '200px' }}
        />
        <button
          type="button"
          onClick={() => {
            setStartDate('')
            setEndDate('')
            setUserFilter('')
            setActionFilter('')
            setDetailsFilter('')
          }}
          style={{
            padding: '6px 15px',
            background: '#e0e0e0',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          清除過濾
        </button>
        {user.role === 'admin' && (
          <>
            <span style={{ fontSize: 13, color: '#444', marginRight: 4 }}>截止時間</span>
            <input
              type="datetime-local"
              value={deleteBeforeAt}
              onChange={(e) => setDeleteBeforeAt(e.target.value)}
              style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <button
              type="button"
              disabled={purgingBefore || !deleteBeforeAt.trim()}
              onClick={() => void handleDeleteBefore()}
              style={{
                padding: '6px 15px',
                background: !deleteBeforeAt.trim() ? '#ccc' : '#b71c1c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: !deleteBeforeAt.trim() ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
              }}
            >
              {purgingBefore ? '刪除中…' : '刪除早於此時間的全部'}
            </button>
            <button
              type="button"
              disabled={deleting || selectedRows.size === 0}
              onClick={() => void handleBatchDelete()}
              style={{
                padding: '6px 15px',
                background: selectedRows.size === 0 ? '#ccc' : '#c62828',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: selectedRows.size === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
              }}
            >
              {deleting ? '刪除中…' : `刪除選取 (${selectedRows.size})`}
            </button>
          </>
        )}
      </div>

      <div className="log-table-container">
        {loading ? (
          <p style={{ padding: 20 }}>載入中...</p>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                {user.role === 'admin' && (
                  <th style={{ width: 44, textAlign: 'center' }}>
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAll}
                      aria-label="全選／取消全選"
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                )}
                <th
                  className="sortable"
                  style={{ width: 170 }}
                  onClick={() => handleSort('created_at')}
                >
                  生效時間
                  <span className="log-sort-icon">
                    {sortField === 'created_at' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
                <th
                  className="sortable"
                  style={{ width: 180 }}
                  onClick={() => handleSort('user')}
                >
                  作用者
                  <span className="log-sort-icon">
                    {sortField === 'user' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
                <th
                  className="sortable"
                  style={{ width: 120 }}
                  onClick={() => handleSort('action_label')}
                >
                  操作
                  <span className="log-sort-icon">
                    {sortField === 'action_label' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
                <th
                  className="sortable"
                  style={{ width: 140 }}
                  onClick={() => handleSort('record_id')}
                >
                  作用日期
                  <span className="log-sort-icon">
                    {sortField === 'record_id' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort('details')}
                >
                  說明
                  <span className="log-sort-icon">
                    {sortField === 'details' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={user.role === 'admin' ? 6 : 5} className="log-empty-message">
                    無符合條件的日誌
                  </td>
                </tr>
              ) : (
                sortedAndFilteredLogs.map((row) => {
                  const isSelected = selectedRows.has(row.row_uid)
                  return (
                    <tr
                      key={row.row_uid}
                      className={isSelected ? 'row-selected' : ''}
                      onClick={user.role === 'admin' ? () => handleToggleRow(row.row_uid) : undefined}
                      style={{ cursor: user.role === 'admin' ? 'pointer' : 'default' }}
                    >
                      {user.role === 'admin' && (
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleRow(row.row_uid)}
                            aria-label="選取此筆日誌"
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                      )}
                      <td style={{ whiteSpace: 'nowrap' }}>{row.created_at || '—'}</td>
                      <td>{row.user}</td>
                      <td>{row.action_label}</td>
                      <td>{row.record_id || '—'}</td>
                      <td style={{ wordBreak: 'break-all' }}>{row.details || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
