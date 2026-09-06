export interface UserGroup {
  id: number
  group: string
  grouplimitnumber: number
  allow_overtime: number
  'allow overtime'?: number
}

export interface CreateUserGroupData {
  group: string
  grouplimitnumber?: number
  allow_overtime?: number
  'allow overtime'?: number
}

export interface UpdateUserGroupData {
  group?: string
  grouplimitnumber?: number
  allow_overtime?: number
  'allow overtime'?: number
}

const API_BASE_URL = '/api'

export const useGroupsAPI = () => {
  // 獲取所有群組
  const getGroups = async (): Promise<UserGroup[]> => {
    const response = await fetch(`${API_BASE_URL}/groups`)
    if (!response.ok) {
      throw new Error('獲取群組列表失敗')
    }
    return response.json()
  }

  // 建立群組
  const createGroup = async (data: CreateUserGroupData): Promise<UserGroup> => {
    const response = await fetch(`${API_BASE_URL}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '建立群組失敗')
    }

    return response.json()
  }

  // 更新群組
  const updateGroup = async (id: number, data: UpdateUserGroupData): Promise<UserGroup> => {
    const response = await fetch(`${API_BASE_URL}/groups/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '更新群組失敗')
    }

    return response.json()
  }

  // 刪除群組
  const deleteGroup = async (id: number): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/groups/${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '刪除群組失敗')
    }
  }

  return {
    getGroups,
    createGroup,
    updateGroup,
    deleteGroup,
  }
}
