export interface LeaveType {
  leave_id: number
  name: string
  is_not_workday: number
  color?: string
  created_at: string
}

export interface CreateLeaveTypeData {
  name: string
  is_not_workday?: boolean
  color?: string
}

const API_BASE_URL = '/api'

export const useShiftSettingAPI = () => {
  // 获取所有请假类型
  const getLeaveTypes = async (): Promise<LeaveType[]> => {
    const response = await fetch(`${API_BASE_URL}/leave-types`)
    if (!response.ok) {
      throw new Error('获取请假类型失败')
    }
    return response.json()
  }

  // 获取特定请假类型
  const getLeaveType = async (id: number): Promise<LeaveType> => {
    const response = await fetch(`${API_BASE_URL}/leave-types/${id}`)
    if (!response.ok) {
      throw new Error('获取请假类型失败')
    }
    return response.json()
  }

  // 创建请假类型
  const createLeaveType = async (leaveTypeData: CreateLeaveTypeData): Promise<LeaveType> => {
    const response = await fetch(`${API_BASE_URL}/leave-types`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leaveTypeData),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '创建请假类型失败')
    }

    return response.json()
  }

  // 更新请假类型
  const updateLeaveType = async (id: number, updates: Partial<CreateLeaveTypeData>): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/leave-types/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '更新请假类型失败')
    }
  }

  // 删除请假类型
  const deleteLeaveType = async (id: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/leave-types/${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '删除请假类型失败')
    }
  }

  return {
    getLeaveTypes,
    getLeaveType,
    createLeaveType,
    updateLeaveType,
    deleteLeaveType,
  }
}
