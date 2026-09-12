import { actorRequestHeaders } from '../utils/actorRequestHeaders'

export interface User {
  user_id: number
  name: string
  employee_id: string
  shift_type: 'A' | 'B' | '7' | null
  site: 'P1' | 'P2' | 'P3' | 'P4' | null
  day_night: 'D' | 'N' | null
  role: 'user' | 'admin' | 'manager'
  group: string
  created_at: string
  /** 當月加班時數上限（小時）；null／省略＝使用全站預設 */
  monthly_overtime_cap_hours?: number | null
}

export interface CreateUserData {
  name: string
  employee_id: string
  password: string
  shift_type?: 'A' | 'B'
  site?: 'P1' | 'P2' | 'P3' | 'P4'
  day_night?: 'D' | 'N'
  role?: 'user' | 'admin' | 'manager'
  group?: string
  /** 僅超級管理員；個人覆寫，省略＝資料庫 NULL（全站預設） */
  monthly_overtime_cap_hours?: number
}

export type UpdateUserPayload = Partial<CreateUserData> & {
  /** 設為 true 時清除 monthly_overtime_cap_hours（改回全站預設） */
  clear_monthly_overtime_cap?: boolean
}

const API_BASE_URL = '/api'

export interface PendingUserRegistration {
  registration_id: number
  name: string
  employee_id: string
  /** 自助註冊填寫；舊資料可能為空字串 */
  shift_type: string
  site: string
  day_night: string
  created_at: string
}

export const useUsersAPI = () => {
  // 获取所有用户
  const getUsers = async (): Promise<User[]> => {
    const response = await fetch(`${API_BASE_URL}/users`, { headers: actorRequestHeaders() })
    if (!response.ok) {
      throw new Error('获取用户列表失败')
    }
    const rawUsers = await response.json()
    return Array.isArray(rawUsers) ? rawUsers : []
  }

  // 获取单个用户
  const getUser = async (id: number): Promise<User> => {
    const response = await fetch(`${API_BASE_URL}/users/${id}`, { headers: actorRequestHeaders() })
    if (!response.ok) {
      throw new Error('获取用户失败')
    }
    return response.json()
  }

  // 创建用户
  const createUser = async (userData: CreateUserData): Promise<User> => {
    const response = await fetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...actorRequestHeaders(),
      },
      body: JSON.stringify(userData),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '创建用户失败')
    }

    return response.json()
  }

  // 更新用户
  const updateUser = async (id: number, updates: UpdateUserPayload): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/users/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...actorRequestHeaders(),
      },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '更新用户失败')
    }
  }

  // 删除用户
  const deleteUser = async (id: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/users/${id}`, {
      method: 'DELETE',
      headers: actorRequestHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '删除用户失败')
    }
  }

  /** 自助註冊（寫入 user_registrations，待 admin/manager 核准） */
  const registerAccount = async (payload: {
    name: string
    employee_id: string
    password: string
    password_confirm: string
    shift_type: 'A' | 'B'
    site: 'P1' | 'P2' | 'P3' | 'P4'
    day_night: 'D' | 'N'
  }): Promise<{ message: string; registration_id: number }> => {
    const response = await fetch(`${API_BASE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actorRequestHeaders() },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || '註冊失敗')
    }
    return data as { message: string; registration_id: number }
  }

  const getPendingUserRegistrations = async (): Promise<PendingUserRegistration[]> => {
    const response = await fetch(`${API_BASE_URL}/user-registrations`, { headers: actorRequestHeaders() })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || '讀取待審清單失敗')
    }
    const raw = await response.json()
    return Array.isArray(raw) ? raw : []
  }

  const approveUserRegistration = async (registrationId: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-registrations/${registrationId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actorRequestHeaders() },
      body: '{}',
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || '核准失敗')
    }
  }

  /** 已登入使用者變更自己的密碼（後端寫 admin_log：SELF_PASSWORD_CHANGE） */
  const changeOwnPassword = async (payload: {
    employee_id: string
    current_password: string
    new_password: string
    new_password_confirm: string
  }): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actorRequestHeaders() },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || '變更密碼失敗')
    }
  }

  /** 僅超級管理員：指定 A 或 B 班，將 users.day_night 的 D 與 N 對調（僅影響該班且目前為 D/N 者） */
  const swapDayNightByShift = async (
    shiftType: 'A' | 'B'
  ): Promise<{ swapped: number; shift_type: string }> => {
    const response = await fetch(`${API_BASE_URL}/users/swap-day-night`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actorRequestHeaders() },
      body: JSON.stringify({ shift_type: shiftType }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || '日夜班對調失敗')
    }
    return {
      swapped: typeof (data as { swapped?: number }).swapped === 'number' ? (data as { swapped: number }).swapped : 0,
      shift_type: String((data as { shift_type?: string }).shift_type ?? shiftType),
    }
  }

  const rejectUserRegistration = async (registrationId: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-registrations/${registrationId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actorRequestHeaders() },
      body: '{}',
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || '拒絕失敗')
    }
  }

  return {
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    registerAccount,
    getPendingUserRegistrations,
    approveUserRegistration,
    rejectUserRegistration,
    changeOwnPassword,
    swapDayNightByShift,
  }
}
