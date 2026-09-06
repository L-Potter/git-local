import { useState, useEffect } from 'react'

export interface ShiftType {
  id: string
  label: string
  color: string
}

const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  { id: 'overtime', label: '加班', color: '#ff6b6b' },
  { id: 'leave', label: '請假', color: '#4ecdc4' },
  { id: 'class', label: '上課', color: '#95e1d3' },
]

const STORAGE_KEY = 'shiftTypes'

export const useShiftTypes = () => {
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>(() => {
    // 从 localStorage 加载，如果没有则使用默认值
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load shift types from storage:', error)
    }
    return DEFAULT_SHIFT_TYPES
  })

  // 保存到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shiftTypes))
    } catch (error) {
      console.error('Failed to save shift types to storage:', error)
    }
  }, [shiftTypes])

  const addShiftType = (label: string, color: string) => {
    const newId = `shift_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newType: ShiftType = {
      id: newId,
      label,
      color,
    }
    setShiftTypes([...shiftTypes, newType])
    return newId
  }

  const updateShiftType = (id: string, label: string, color: string) => {
    setShiftTypes(
      shiftTypes.map(type =>
        type.id === id ? { ...type, label, color } : type
      )
    )
  }

  const deleteShiftType = (id: string) => {
    // 至少要保留一个排班类型
    if (shiftTypes.length <= 1) {
      return false // 至少需要保留一个类型
    }
    setShiftTypes(shiftTypes.filter(type => type.id !== id))
    return true
  }

  return {
    shiftTypes,
    addShiftType,
    updateShiftType,
    deleteShiftType,
  }
}

