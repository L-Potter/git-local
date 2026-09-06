import { useState, useCallback } from 'react'

const API_BASE_URL = '/api'

function viewerRole(): 'admin' | 'manager' | '' {
  try {
    const role = JSON.parse(localStorage.getItem('user') ?? '{}').role
    return role === 'admin' || role === 'manager' ? role : ''
  } catch {
    return ''
  }
}

export interface LogEntry {
  log_id: number
  /** 後端：admin_log 為 admin；各人員庫 user_log 為 user */
  log_source?: 'admin' | 'user'
  /** user_log 所屬工號；admin_log 省略或空字串 */
  owner_employee_id?: string
  user: string
  action: string
  table_name: string
  record_id: string
  details: string
  created_at?: string
}

export interface LogDeleteItem {
  log_source: 'admin' | 'user'
  log_id: number
  owner_employee_id?: string
}

export function useLogsAPI() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getLogs = useCallback(async (): Promise<LogEntry[]> => {
    setLoading(true)
    setError(null)
    try {
      const role = viewerRole()
      const path = role ? `${API_BASE_URL}/logs?viewer_role=${role}` : `${API_BASE_URL}/logs`
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error('获取系统日志失败')
      }
      const data = await response.json()
      return data || []
    } catch (err: any) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  /** 僅超級管理員；批次刪除 admin_log / user_log（不影響 getLogs 的 loading） */
  const deleteLogsBatch = useCallback(async (entries: LogDeleteItem[]): Promise<number> => {
    const response = await fetch(`${API_BASE_URL}/logs/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || '刪除日誌失敗')
    }
    return typeof (data as { deleted?: number }).deleted === 'number' ? (data as { deleted: number }).deleted : 0
  }, [])

  /** 僅超級管理員；刪除生效時間嚴格早於 `before` 的所有 admin_log / user_log */
  const deleteLogsBefore = useCallback(
    async (
      before: string
    ): Promise<{ deleted: number; deleted_admin: number; deleted_user: number; before: string }> => {
      const response = await fetch(`${API_BASE_URL}/logs/delete-before`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || '依時間刪除日誌失敗')
      }
      const d = data as {
        deleted?: number
        deleted_admin?: number
        deleted_user?: number
        before?: string
      }
      return {
        deleted: typeof d.deleted === 'number' ? d.deleted : 0,
        deleted_admin: typeof d.deleted_admin === 'number' ? d.deleted_admin : 0,
        deleted_user: typeof d.deleted_user === 'number' ? d.deleted_user : 0,
        before: typeof d.before === 'string' ? d.before : before,
      }
    },
    []
  )

  return { getLogs, deleteLogsBatch, deleteLogsBefore, loading, error }
}
