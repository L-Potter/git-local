import { useState, useEffect } from 'react'

export type ShiftPattern = 'A' | 'B'

export interface CalendarTag {
  date: string // YYYY-MM-DD
  isHoliday: boolean
  pattern: ShiftPattern | null
  comment?: string
  created_at?: string
  updated_at?: string
}

export interface CalendarTagInput {
  date: string
  is_holiday?: boolean
  shift_type?: ShiftPattern | null
  comment?: string
}

const API_BASE_URL = '/api'

export const useCalendarTags = () => {
  const [tags, setTags] = useState<CalendarTag[]>([])
  const [loading, setLoading] = useState(false)

  // 获取所有日历标签
  const getAllTags = async (): Promise<CalendarTag[]> => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/calendar-tags`)
      if (!response.ok) {
        throw new Error('获取日历标签失败')
      }
      const data = await response.json()
      // 转换API数据为前端格式
      const convertedData = data.map((tag: any) => ({
        ...tag,
        isHoliday: tag.is_holiday === 1,
        pattern: tag.shift_type,
      }))
      setTags(convertedData)
      return convertedData
    } catch (error) {
      console.error('获取日历标签失败:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  // 获取特定日期的标签
  const getTag = async (date: string): Promise<CalendarTag | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`)
      if (!response.ok) {
        throw new Error('获取日历标签失败')
      }
      const data = await response.json()
      if (!data) return null
      // 转换API数据为前端格式
      return {
        ...data,
        isHoliday: data.is_holiday === 1,
        pattern: data.shift_type,
      }
    } catch (error) {
      console.error('获取日历标签失败:', error)
      throw error
    }
  }

  // 设置或更新日历标签
  const setTag = async (date: string, isHoliday?: boolean, shiftType?: ShiftPattern | null, comment?: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_holiday: isHoliday,
          shift_type: shiftType,
          comment: comment === '' ? ' ' : comment,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '设置日历标签失败')
      }

      // 重新获取所有标签以保持状态同步
      await getAllTags()
    } catch (error) {
      console.error('设置日历标签失败:', error)
      throw error
    }
  }

  // 删除日历标签
  const deleteTag = async (date: string): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/calendar-tags/${date}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '删除日历标签失败')
      }

      // 重新获取所有标签以保持状态同步
      await getAllTags()
    } catch (error) {
      console.error('删除日历标签失败:', error)
      throw error
    }
  }

  // 批量设置日历标签
  const batchSetTags = async (tags: CalendarTagInput[]): Promise<void> => {
    try {
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

      // 重新获取所有标签以保持状态同步
      await getAllTags()
    } catch (error) {
      console.error('批量设置日历标签失败:', error)
      throw error
    }
  }

  // 初始化时获取所有标签
  useEffect(() => {
    getAllTags()
  }, [])

  // 兼容性方法
  const getTagByDate = (date: string): CalendarTag | undefined => tags.find(t => t.date === date)

  const setHoliday = async (date: string, isHoliday: boolean) => {
    await setTag(date, isHoliday)
  }

  const setPattern = async (date: string, pattern: ShiftPattern | null) => {
    await setTag(date, undefined, pattern)
  }

  const setComment = async (date: string, comment: string) => {
    await setTag(date, undefined, undefined, comment)
  }

  const getComment = (date: string): string => {
    const tag = getTagByDate(date)
    return tag?.comment || ''
  }

  const clearMonth = async (year: number, month: number) => {
    // 获取该月的标签并删除
    const monthTags = tags.filter(t => {
      const d = new Date(t.date + 'T00:00:00')
      return d.getFullYear() === year && d.getMonth() === month
    })

    for (const tag of monthTags) {
      await deleteTag(tag.date)
    }
  }

  const getMonthMap = (year: number, month: number): Record<string, CalendarTag> => {
    const map: Record<string, CalendarTag> = {}
    tags.forEach(t => {
      const d = new Date(t.date + 'T00:00:00')
      if (d.getFullYear() === year && d.getMonth() === month) {
        map[t.date] = t
      }
    })
    return map
  }

  return {
    tags,
    loading,
    getAllTags,
    getTag,
    setTag,
    deleteTag,
    batchSetTags,
    getTagByDate,
    setHoliday,
    setPattern,
    setComment,
    getComment,
    clearMonth,
    getMonthMap,
  }
}
