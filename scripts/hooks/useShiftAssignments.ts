import { useState, useEffect } from 'react'

export interface ShiftAssignment {
  employeeId: string
  date: string
  type: string
}

const STORAGE_KEY = 'shiftAssignments'

export const useShiftAssignments = () => {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load shift assignments from storage:', error)
    }
    return []
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments))
    } catch (error) {
      console.error('Failed to save shift assignments to storage:', error)
    }
  }, [assignments])

  const addAssignment = (assignment: ShiftAssignment) => {
    setAssignments([...assignments, assignment])
  }

  const updateAssignment = (employeeId: string, date: string, type: string) => {
    setAssignments(
      assignments.map(a =>
        a.employeeId === employeeId && a.date === date
          ? { ...a, type }
          : a
      )
    )
  }

  const removeAssignment = (employeeId: string, date: string) => {
    setAssignments(
      assignments.filter(
        a => !(a.employeeId === employeeId && a.date === date)
      )
    )
  }

  const moveAssignment = (
    fromEmployeeId: string,
    fromDate: string,
    toEmployeeId: string,
    toDate: string
  ) => {
    const assignment = assignments.find(
      a => a.employeeId === fromEmployeeId && a.date === fromDate
    )
    if (!assignment) return

    // 移除原位置
    const filtered = assignments.filter(
      a => !(a.employeeId === fromEmployeeId && a.date === fromDate)
    )

    // 检查目标位置是否已有排班
    const targetHasShift = filtered.some(
      a => a.employeeId === toEmployeeId && a.date === toDate
    )

    if (targetHasShift) {
      // 交换
      const targetAssignment = filtered.find(
        a => a.employeeId === toEmployeeId && a.date === toDate
      )
      if (targetAssignment) {
        // 将目标位置的排班移到原位置
        filtered.push({
          employeeId: fromEmployeeId,
          date: fromDate,
          type: targetAssignment.type,
        })
        // 将原位置的排班移到目标位置
        filtered.push({
          employeeId: toEmployeeId,
          date: toDate,
          type: assignment.type,
        })
      }
    } else {
      // 移动到新位置
      filtered.push({
        employeeId: toEmployeeId,
        date: toDate,
        type: assignment.type,
      })
    }

    setAssignments(filtered)
  }

  const getAssignmentsByEmployee = (employeeId: string): ShiftAssignment[] => {
    return assignments.filter(a => a.employeeId === employeeId)
  }

  const getAssignment = (employeeId: string, date: string): ShiftAssignment | undefined => {
    return assignments.find(a => a.employeeId === employeeId && a.date === date)
  }

  return {
    assignments,
    setAssignments,
    addAssignment,
    updateAssignment,
    removeAssignment,
    moveAssignment,
    getAssignmentsByEmployee,
    getAssignment,
  }
}

