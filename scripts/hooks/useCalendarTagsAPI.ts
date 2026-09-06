export interface CalendarTag {
  date: string
  is_holiday: number
  shift_type: 'A' | 'B' | null
  created_at?: string
  updated_at?: string
}

export interface CalendarTagInput {
  date: string
  is_holiday?: boolean
  shift_type?: 'A' | 'B' | null
}

const API_BASE_URL = '/api'

export const useCalendarTagsAPI = () => {
  // 获取所有日历标签
  const getCalendarTags = async (): Promise<CalendarTag[]> => {
    const response = await fetch(`${API_BASE_URL}/calendar-tags`)
    if (!response.ok) {
      throw new Error('获取日历标签失败')
    }
    return response.json()
  }

  // 获取特定日期的标签
  const getCalendarTag = async (date: string): Promise<CalendarTag | null> => {
    const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`)
    if (!response.ok) {
      throw new Error('获取日历标签失败')
    }
    return response.json()
  }

  // 设置或更新日历标签
  const setCalendarTag = async (date: string, isHoliday?: boolean, shiftType?: 'A' | 'B' | null): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        is_holiday: isHoliday,
        shift_type: shiftType,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '设置日历标签失败')
    }
  }

  // 删除日历标签
  const deleteCalendarTag = async (date: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '删除日历标签失败')
    }
  }

  // 批量设置日历标签
  const batchSetCalendarTags = async (tags: CalendarTagInput[]): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/calendar-tags/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '批量设置日历标签失败')
    }
  }

  return {
    getCalendarTags,
    getCalendarTag,
    setCalendarTag,
    deleteCalendarTag,
    batchSetCalendarTags,
  }
}
