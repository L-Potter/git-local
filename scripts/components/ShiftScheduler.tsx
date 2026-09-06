import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useShiftTypes, ShiftType } from '../hooks/useShiftTypes'
import { useUsersAPI, User } from '../hooks/useUsersAPI'
import { useShiftAssignmentsAPI, ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import { useCalendarTags } from '../hooks/useCalendarTags'
import { useShiftSettingAPI, LeaveType } from '../hooks/useShiftSettingAPI'
import { useAuth } from '../hooks/useAuth'
import { useMemoryCache, CACHE_KEYS, CACHE_TTL } from '../hooks/useMemoryCache'
import { useGroupsAPI, UserGroup } from '../hooks/useGroupsAPI'
import { useNavigate } from 'react-router-dom'
import {
  buildShiftAssignmentExportRows,
  downloadShiftAssignmentsCsv,
  downloadShiftAssignmentsXlsx,
} from '../utils/shiftAssignmentExport'
import './ShiftScheduler.css'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const MONTHS_ZH = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
]

type EmployeeMonthlyStats = {
  leaveDays: number
  overtimeDays: number
}

const ShiftScheduler: React.FC = () => {
  const { shiftTypes } = useShiftTypes()
  const { getUsers } = useUsersAPI()
  const {
    getShiftAssignments,
    saveShiftAssignment,
    deleteShiftAssignment,
  } = useShiftAssignmentsAPI()
  const { getMonthMap } = useCalendarTags()
  const { getLeaveTypes } = useShiftSettingAPI()

  const { user } = useAuth()
  const { get: getCache, set: setCache, delete: removeCache } = useMemoryCache()
  const { getGroups } = useGroupsAPI()
  const [dbGroups, setDbGroups] = useState<UserGroup[]>([])
  const navigate = useNavigate()

  const [currentDate, setCurrentDate] = useState(new Date()) // Today
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [shiftDayNightFilter, setShiftDayNightFilter] = useState<Record<string, boolean>>({
    'DA': true,
    'DB': true,
    'NA': true,
    'NB': true
  })
  const [groupFilter, setGroupFilter] = useState<Record<string, boolean>>({
    'G1': true,
    'G2': true,
    'OCC': true,
    'ESH': true,
    'manager': true,
    'PTS': true,
    '未定義': true
  })

  const availableGroups = useMemo(() => {
    if (dbGroups.length === 0) {
      return ['G1', 'G2', 'OCC', 'ESH', 'manager', 'PTS', '未定義']
    }
    const set = new Set<string>()
    dbGroups.forEach(g => {
      if (g.group && g.group !== '未定義') set.add(g.group)
    })
    return [...Array.from(set), '未定義']
  }, [dbGroups])

  useEffect(() => {
    if (dbGroups.length > 0) {
      setGroupFilter(prev => {
        const next = { ...prev }
        dbGroups.forEach(g => {
          if (next[g.group] === undefined) {
            next[g.group] = true
          }
        })
        if (next['未定義'] === undefined) {
          next['未定義'] = true
        }
        return next
      })
    }
  }, [dbGroups])

  const [searchQuery, setSearchQuery] = useState('')
  const [sortDate, setSortDate] = useState<string | null>(null)
  const [employeeSortMode, setEmployeeSortMode] = useState<'leave' | 'overtime' | null>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportStartStr, setExportStartStr] = useState('')
  const [exportEndStr, setExportEndStr] = useState('')

  const [selectedCell, setSelectedCell] = useState<{ employeeId: string; date: string } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)

  // New state for comment
  const [comment, setComment] = useState('')

  // Scroll Dragging State
  const calendarContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!calendarContainerRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - calendarContainerRef.current.offsetLeft)
    setScrollLeft(calendarContainerRef.current.scrollLeft)
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !calendarContainerRef.current) return
    e.preventDefault()
    const x = e.pageX - calendarContainerRef.current.offsetLeft
    const walk = (x - startX) * 1.5 // Scroll speed multiplier
    calendarContainerRef.current.scrollLeft = scrollLeft - walk
  }

  // const [draggedShift, setDraggedShift] = useState<{ employeeId: string; date: string; type: string } | null>(null)
  // const [hoveredCell, setHoveredCell] = useState<{ employeeId: string; date: string } | null>(null)
  const [employees, setEmployees] = useState<User[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Access Control
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') {
      navigate('/')
    }
  }, [user, navigate])

  // Load data with Cache
  useEffect(() => {
    if (!user) return

    const loadData = async () => {
      try {
        setLoading(true)

        let users = getCache<User[]>(CACHE_KEYS.USERS)
        let types = getCache<LeaveType[]>(CACHE_KEYS.LEAVE_TYPES)

        if (!users) {
          users = await getUsers()
          setCache(CACHE_KEYS.USERS, users, CACHE_TTL.USERS)
        }
        if (!types) {
          types = await getLeaveTypes()
          setCache(CACHE_KEYS.LEAVE_TYPES, types, CACHE_TTL.LEAVE_TYPES)
        }

        setEmployees(users)
        setLeaveTypes(types)

        try {
          const gList = await getGroups()
          setDbGroups(gList)
        } catch (err) {
          console.error('Failed to load groups in ShiftScheduler:', err)
        }

        const allAssignments: ShiftAssignment[] = []
        // 排班一律從 API 載入：sessionStorage 快取會跨重新整理，若只用快取會與 DB 不同步
        for (const u of users) {
          try {
            const cacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(u.employee_id)
            const userAssignments = await getShiftAssignments(u.employee_id)
            const list = Array.isArray(userAssignments) ? userAssignments : []
            setCache(cacheKey, list, CACHE_TTL.SHIFT_ASSIGNMENTS)
            allAssignments.push(...list)
          } catch (error) {
            console.error(`Failed to load assignments for user ${u.employee_id}:`, error)
          }
        }
        setAssignments(allAssignments)
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user]) // Re-run if user changes (login)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const monthName = MONTHS[month]
  const monthNameZh = MONTHS_ZH[month]

  // 获取当前月的所有日期
  const dates = useMemo(() => {
    const lastDay = new Date(year, month + 1, 0)
    const days: Date[] = []
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i))
    }
    return days
  }, [year, month])

  const monthTagMap = getMonthMap(year, month)

  // Filter employees based on group selection
  const activeGroupEmployees = useMemo(() => {
    return employees.filter(e => {
      const g = e.group || ''
      if (!g || g === '未定義') return groupFilter['未定義'] === true
      return groupFilter[g] === true
    })
  }, [employees, groupFilter])

  const monthDateStrings = useMemo(() => {
    return dates.map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
  }, [dates])

  const monthDateSet = useMemo(() => new Set(monthDateStrings), [monthDateStrings])

  const leaveTypeMapByName = useMemo(
    () => new Map(leaveTypes.map((leaveType) => [leaveType.name, leaveType])),
    [leaveTypes]
  )

  const assignmentTypeByEmployeeDate = useMemo(() => {
    const map = new Map<string, string>()
    assignments.forEach((a) => map.set(`${a.employee_id}::${a.date}`, a.shift_type))
    return map
  }, [assignments])

  const employeeMonthlyStats = useMemo(() => {
    const summary = new Map<string, { leaveDays: Set<string>; overtimeDays: Set<string> }>()
    const ensure = (employeeId: string) => {
      if (!summary.has(employeeId)) {
        summary.set(employeeId, { leaveDays: new Set<string>(), overtimeDays: new Set<string>() })
      }
      return summary.get(employeeId)!
    }

    for (const assignment of assignments) {
      if (!monthDateSet.has(assignment.date)) continue
      const leaveType = leaveTypeMapByName.get(assignment.shift_type)
      if (!leaveType) continue
      const target = ensure(assignment.employee_id)
      if (leaveType.is_not_workday === 1) {
        target.overtimeDays.add(assignment.date)
      } else {
        target.leaveDays.add(assignment.date)
      }
    }

    const result = new Map<string, EmployeeMonthlyStats>()
    employees.forEach((employee) => {
      const s = summary.get(employee.employee_id)
      result.set(employee.employee_id, {
        leaveDays: s?.leaveDays.size ?? 0,
        overtimeDays: s?.overtimeDays.size ?? 0,
      })
    })
    return result
  }, [assignments, monthDateSet, leaveTypeMapByName, employees])

  // 根據日期的班別標籤過濾可用的請假類型
  const getAvailableLeaveTypesForDate = (dateString: string) => {
    const tag = monthTagMap[dateString]

    if (!tag?.pattern) return leaveTypes

    const userShift = user?.shift_type || 'A'
    const isSameShift = userShift === tag.pattern

    console.log('Debug getAvailableLeaveTypesForDate:', {
      dateString,
      userShift,
      tagPattern: tag.pattern,
      isSameShift,
      user: user
    })

    // 如果用戶班別與當天班別相同，顯示工作日相關的請假類型 (is_not_workday = 1)
    // 如果不同，顯示非工作日相關的請假類型 (is_not_workday = 0，如加班)
    let filteredTypes
    if (isSameShift) {
      filteredTypes = leaveTypes.filter(type => type.is_not_workday === 0)
    } else {
      filteredTypes = leaveTypes.filter(type => type.is_not_workday === 1)
    }

    console.log('Filtered leave types:', filteredTypes.map(t => ({ name: t.name, is_not_workday: t.is_not_workday })))

    return { filteredTypes, leaveTypes } // Return both for scheduler (show all) but we might want to highlight working/non-working
  }

  // Calculate Attendance Rate
  const calculateAttendance = (dateString: string, targetShiftPattern: 'A' | 'B'): { rate: number, target: number, actual: number, absent: number, overtime: number } => {
    // Determine which day_night values are active for this shift pattern
    const checkedDayNights = ['D', 'N'].filter(dn => shiftDayNightFilter[`${dn}${targetShiftPattern}`])

    // 1. Target: Users with matching checked day_nights and shift_type (excluding admin)
    const targetUsers = activeGroupEmployees.filter(e => 
      e.role !== 'admin' && 
      e.shift_type === targetShiftPattern && 
      e.day_night !== null && checkedDayNights.includes(e.day_night)
    )
    const targetCount = targetUsers.length

    if (targetCount === 0) return { rate: 0, target: 0, actual: 0, absent: 0, overtime: 0 }

    // 2. Absence: Target users with leave (is_not_workday == 0) on this date
    let absentCount = 0
    targetUsers.forEach(u => {
      const assignment = assignments.find(a => a.employee_id === u.employee_id && a.date === dateString)
      if (assignment) {
        const leaveType = leaveTypes.find(lt => lt.name === assignment.shift_type)
        // If leave type is "workday leave" (is_not_workday == 0), they are absent
        if (leaveType && leaveType.is_not_workday === 0) {
          absentCount++
        }
      }
    })

    // 3. Overtime: Users from OPPOSITE shift (same active day_nights) working on this date (is_not_workday == 1)
    const oppositeShift = targetShiftPattern === 'A' ? 'B' : 'A'
    const supportUsers = activeGroupEmployees.filter(e => 
      e.role !== 'admin' && 
      e.shift_type === oppositeShift && 
      e.day_night !== null && checkedDayNights.includes(e.day_night)
    )
    let overtimeCount = 0
    supportUsers.forEach(u => {
      const assignment = assignments.find(a => a.employee_id === u.employee_id && a.date === dateString)
      if (assignment) {
        const leaveType = leaveTypes.find(lt => lt.name === assignment.shift_type)
        // If leave type is "non-workday leave" (is_not_workday == 1), they are supporting/overtime
        if (leaveType && leaveType.is_not_workday === 1) {
          overtimeCount++
        }
      }
    })

    // 4. Actual = Target - Absent + Overtime
    const actual = targetCount - absentCount + overtimeCount
    const rate = (actual / targetCount) * 100

    return { rate, target: targetCount, actual, absent: absentCount, overtime: overtimeCount }
  }

  // 获取星期几
  const getDayName = (date: Date): string => {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    return days[date.getDay()]
  }

  // 导航到上一个月
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  // 导航到下一个月
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  // 导航到今天
  const goToToday = () => {
    const today = new Date()
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1))

    setTimeout(() => {
      if (calendarContainerRef.current) {
        const todayEl = calendarContainerRef.current.querySelector('.day-number.today')
        if (todayEl) {
          todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        }
      }
    }, 100)
  }

  // 初次加载如果本月有Today则自动滚动到Today
  useEffect(() => {
    const now = new Date()
    if (year === now.getFullYear() && month === now.getMonth()) {
      setTimeout(() => {
        if (calendarContainerRef.current) {
          const todayEl = calendarContainerRef.current.querySelector('.day-number.today')
          if (todayEl) {
            todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
          }
        }
      }, 300)
    }
  }, [year, month])

  // 水平滚动快捷方法
  const scrollLeftBy = (amount: number) => {
    if (calendarContainerRef.current) {
      calendarContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' })
    }
  }

  // 选择月份和年份
  const selectMonth = (newMonth: number) => {
    setCurrentDate(new Date(year, newMonth, 1))
    setShowMonthPicker(false)
  }

  const selectYear = (newYear: number) => {
    setCurrentDate(new Date(newYear, month, 1))
  }

  // 获取某个员工在某一天的排班类型
  const getShiftForDate = (employeeId: string, date: string): ShiftType | null => {
    const assignedType = assignmentTypeByEmployeeDate.get(`${employeeId}::${date}`)
    if (!assignedType) return null
    const leaveType = leaveTypeMapByName.get(assignedType)
    if (leaveType) {
      return { id: leaveType.name, label: leaveType.name, color: leaveType.color || '#ff9800' }
    }
    const shiftType = shiftTypes.find(t => t.id === assignedType)
    if (shiftType) {
      return shiftType
    }
    return null
  }

  const visibleEmployees = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    const filtered = activeGroupEmployees.filter((employee) => {
      if (employee.role === 'admin') return false
      if (shiftDayNightFilter[`${employee.day_night}${employee.shift_type}`] !== true) return false
      if (!keyword) return true
      return (
        employee.name.toLowerCase().includes(keyword) ||
        employee.employee_id.toLowerCase().includes(keyword)
      )
    })

    return filtered.sort((a, b) => {
      if (sortDate) {
        const hasShiftA = assignmentTypeByEmployeeDate.has(`${a.employee_id}::${sortDate}`)
        const hasShiftB = assignmentTypeByEmployeeDate.has(`${b.employee_id}::${sortDate}`)
        if (hasShiftA !== hasShiftB) return hasShiftA ? -1 : 1
      } else if (employeeSortMode) {
        const statsA = employeeMonthlyStats.get(a.employee_id) ?? { leaveDays: 0, overtimeDays: 0 }
        const statsB = employeeMonthlyStats.get(b.employee_id) ?? { leaveDays: 0, overtimeDays: 0 }
        const diff =
          employeeSortMode === 'leave'
            ? statsB.leaveDays - statsA.leaveDays
            : statsB.overtimeDays - statsA.overtimeDays
        if (diff !== 0) return diff
      }

      const nameDiff = a.name.localeCompare(b.name, 'zh-Hant')
      if (nameDiff !== 0) return nameDiff
      return a.employee_id.localeCompare(b.employee_id)
    })
  }, [
    searchQuery,
    activeGroupEmployees,
    shiftDayNightFilter,
    sortDate,
    employeeSortMode,
    employeeMonthlyStats,
    assignmentTypeByEmployeeDate,
  ])

  // 处理日期单元格点击
  const handleDateClick = (employeeId: string, date: string, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Calculate position: center horizontally relative to cell, below cell
    // Adjust for scroll and viewport
    setMenuPosition({
      top: rect.bottom + window.scrollY,
      left: rect.left + rect.width / 2 + window.scrollX
    })
    setSelectedCell({ employeeId, date })
  }

  // 删除排班
  const handleDeleteShift = async (employeeId: string, date: string) => {
    try {
      await deleteShiftAssignment(employeeId, date)
      setAssignments(assignments.filter(a => !(a.employee_id === employeeId && a.date === date)))
      removeCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(employeeId))
      setSelectedCell(null)
      setError(null)
    } catch (error) {
      console.error('Failed to delete shift assignment:', error)
      setError(error instanceof Error ? error.message : '刪除排班失敗')
    }
  }


  // 拖拽开始
  // const handleDragStart = (e: React.DragEvent, employeeId: string, date: string, shiftType: string) => {
  //   e.dataTransfer.effectAllowed = 'move'
  //   e.dataTransfer.setData('text/plain', '') // 某些浏览器需要
  //   setDraggedShift({ employeeId, date, type: shiftType })
  //   const img = new Image()
  //   e.dataTransfer.setDragImage(img, 0, 0)
  // }

  // 拖拽悬停
  // const handleDragOver = (e: React.DragEvent, employeeId: string, date: string) => {
  //   e.preventDefault()
  //   e.dataTransfer.dropEffect = 'move'
  //   setHoveredCell({ employeeId, date })
  // }

  // 拖拽离开
  // const handleDragLeave = () => {
  //   setHoveredCell(null)
  // }

  // 拖拽放下
  // const handleDrop = async (e: React.DragEvent, targetEmployeeId: string, targetDate: string) => {
  //   e.preventDefault()
  //   if (!draggedShift) return
  //   if (draggedShift.employeeId === targetEmployeeId && draggedShift.date === targetDate) {
  //     setDraggedShift(null)
  //     setHoveredCell(null)
  //     return
  //   }

  //   try {
  //     await moveShiftAssignment(draggedShift.employeeId, draggedShift.date, targetEmployeeId, targetDate)
  //     // Reload assignments after move
  //     const updatedAssignments = await getShiftAssignments(draggedShift.employeeId)
  //     setAssignments(updatedAssignments)
  //     setError(null)
  //   } catch (error) {
  //     console.error('Failed to move shift assignment:', error)
  //     setError(error instanceof Error ? error.message : '移動排班失敗')
  //   }

  //   setDraggedShift(null)
  //   setHoveredCell(null)
  // }

  // 拖拽结束
  // const handleDragEnd = () => {
  //   setDraggedShift(null)
  //   setHoveredCell(null)
  // }


  // 处理排班类型选择
  const handleShiftSelect = async (shiftType: string) => {
    if (!selectedCell) return
    if (!user) return

    try {
      const existing = assignments.find(a => a.employee_id === selectedCell.employeeId && a.date === selectedCell.date)

      // Auto-append proxy name to comment
      let finalComment = comment
      if (user) {
        const suffix = ` (填寫人: ${user.name})`
        if (!finalComment.includes(suffix)) {
          finalComment += suffix
        }
      }

      if (existing) {
        if (existing.shift_type === shiftType) {
          await saveShiftAssignment(
            selectedCell.employeeId,
            selectedCell.date,
            shiftType,
            finalComment,
            existing.overtime_shift ?? null,
            existing.work_hours ?? null
          )
          setAssignments(assignments.map(a =>
            a.employee_id === selectedCell.employeeId && a.date === selectedCell.date
              ? { ...a, shift_type: shiftType, comment: finalComment, work_hours: existing.work_hours ?? null }
              : a
          ))
        } else {
          await saveShiftAssignment(
            selectedCell.employeeId,
            selectedCell.date,
            shiftType,
            finalComment,
            null,
            existing.work_hours ?? null
          )
          setAssignments(assignments.map(a =>
            a.employee_id === selectedCell.employeeId && a.date === selectedCell.date
              ? { ...a, shift_type: shiftType, comment: finalComment, overtime_shift: null, work_hours: existing.work_hours ?? null }
              : a
          ))
        }
      } else {
        await saveShiftAssignment(selectedCell.employeeId, selectedCell.date, shiftType, finalComment, null, null)
        setAssignments([...assignments, {
          employee_id: selectedCell.employeeId,
          date: selectedCell.date,
          shift_type: shiftType,
          comment: finalComment,
          overtime_shift: null,
          work_hours: null,
        }])
      }
      removeCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(selectedCell.employeeId))
      setSelectedCell(null)
      setComment('') // Clear comment
      setError(null)
    } catch (error) {
      console.error('Failed to save shift assignment:', error)
      setError(error instanceof Error ? error.message : '保存排班失敗')
    }
  }

  // 生成日期字符串
  const formatDateString = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const openExportModal = () => {
    setExportStartStr(formatDateString(new Date(year, month, 1)))
    setExportEndStr(formatDateString(new Date(year, month + 1, 0)))
    setExportModalOpen(true)
  }

  const handleDateSortToggle = (dateString: string) => {
    setEmployeeSortMode(null)
    setSortDate((prev) => (prev === dateString ? null : dateString))
  }

  const handleEmployeeSortToggle = (mode: 'leave' | 'overtime') => {
    setSortDate(null)
    setEmployeeSortMode((prev) => (prev === mode ? null : mode))
  }

  const exportPreviewCount = useMemo(() => {
    if (!exportStartStr || !exportEndStr || exportStartStr > exportEndStr) return 0
    return buildShiftAssignmentExportRows(
      assignments,
      employees,
      leaveTypes,
      exportStartStr,
      exportEndStr,
      getMonthMap
    ).length
  }, [exportStartStr, exportEndStr, assignments, employees, leaveTypes, getMonthMap])

  const runExportCsv = useCallback(() => {
    if (exportStartStr > exportEndStr) {
      alert('開始日期不可晚於結束日期')
      return
    }
    const rows = buildShiftAssignmentExportRows(
      assignments,
      employees,
      leaveTypes,
      exportStartStr,
      exportEndStr,
      getMonthMap
    )
    if (rows.length === 0) {
      alert('此範圍內無資料（無排班且日曆無對應班別，或尚未載入）')
      return
    }
    downloadShiftAssignmentsCsv(rows, `shift_assignments_${exportStartStr}_${exportEndStr}`)
    setExportModalOpen(false)
  }, [assignments, employees, leaveTypes, exportStartStr, exportEndStr, getMonthMap])

  const runExportXlsx = useCallback(() => {
    if (exportStartStr > exportEndStr) {
      alert('開始日期不可晚於結束日期')
      return
    }
    const rows = buildShiftAssignmentExportRows(
      assignments,
      employees,
      leaveTypes,
      exportStartStr,
      exportEndStr,
      getMonthMap
    )
    if (rows.length === 0) {
      alert('此範圍內無資料（無排班且日曆無對應班別，或尚未載入）')
      return
    }
    downloadShiftAssignmentsXlsx(rows, `shift_assignments_${exportStartStr}_${exportEndStr}`)
    setExportModalOpen(false)
  }, [assignments, employees, leaveTypes, exportStartStr, exportEndStr, getMonthMap])

  // 检查是否为今天
  const isToday = (date: Date): boolean => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  if (loading) {
    return <div className="shift-scheduler">Loading...</div>
  }

  return (
    <div className="shift-scheduler">
      {/* 头部控制栏 */}
      <div className="scheduler-header">
        <div className="month-navigation">
          <button className="nav-arrow" onClick={goToPreviousMonth}>‹</button>
          <div className="month-display" onClick={() => setShowMonthPicker(!showMonthPicker)}>
            <span className="month-year">{monthNameZh}, {year}</span>
            {showMonthPicker && (
              <div className="month-picker-dropdown">
                <div className="picker-section">
                  <div className="picker-title">选择月份</div>
                  <div className="month-grid">
                    {MONTHS_ZH.map((m, index) => (
                      <button key={index} className={`month-option ${index === month ? 'selected' : ''}`} onClick={() => selectMonth(index)}>{m}</button>
                    ))}
                  </div>
                </div>
                <div className="picker-section">
                  <div className="picker-title">选择年份</div>
                  <div className="year-input-group">
                    <input type="number" value={year} onChange={(e) => selectYear(parseInt(e.target.value) || year)} className="year-input" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <button className="nav-arrow" onClick={goToNextMonth}>›</button>
        </div>
        <div className="group-filters" style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
          {availableGroups.map(g => (
            <label key={g} className="group-filter-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: '#333', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={groupFilter[g] || false}
                onChange={(e) => setGroupFilter(prev => ({ ...prev, [g]: e.target.checked }))}
                style={{ cursor: 'pointer' }}
              />
              {g}
            </label>
          ))}
        </div>
        <div className="group-filters" style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
          {['DA', 'DB', 'NA', 'NB'].map(k => (
            <label key={k} className="group-filter-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: '#333', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={shiftDayNightFilter[k] || false}
                onChange={(e) => setShiftDayNightFilter(prev => ({ ...prev, [k]: e.target.checked }))}
                style={{ cursor: 'pointer' }}
              />
              {k}
            </label>
          ))}
        </div>
        <button className="export-button" onClick={openExportModal}>輸出排班</button>
        <button className="today-button" onClick={goToToday}>Today</button>
      </div>

      {/* 错误消息显示 */}
      {error && (
        <div className="error-banner">
          <div className="error-content">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
            <button
              className="error-close"
              onClick={() => setError(null)}
              title="關閉"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {exportModalOpen &&
        createPortal(
          <div
            className="scheduler-export-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setExportModalOpen(false)
            }}
          >
            <div className="scheduler-export-modal-panel" role="dialog" aria-labelledby="scheduler-export-modal-title">
              <h2 id="scheduler-export-modal-title" className="scheduler-export-modal-title">
                匯出排班資料
              </h2>
              <div className="scheduler-export-modal-fields">
                <label className="scheduler-export-modal-label">
                  開始日期
                  <input
                    type="date"
                    className="scheduler-export-modal-date"
                    value={exportStartStr}
                    onChange={(e) => setExportStartStr(e.target.value)}
                  />
                </label>
                <label className="scheduler-export-modal-label">
                  結束日期
                  <input
                    type="date"
                    className="scheduler-export-modal-date"
                    value={exportEndStr}
                    onChange={(e) => setExportEndStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="scheduler-export-modal-count">符合範圍筆數：<strong>{exportPreviewCount}</strong></p>
              <div className="scheduler-export-modal-actions">
                <button type="button" className="scheduler-export-modal-btn scheduler-export-modal-btn-primary" onClick={runExportCsv}>
                  下載 CSV
                </button>
                <button type="button" className="scheduler-export-modal-btn scheduler-export-modal-btn-primary" onClick={runExportXlsx}>
                  下載 Excel
                </button>
                <button type="button" className="scheduler-export-modal-btn" onClick={() => setExportModalOpen(false)}>
                  關閉
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 日历表格 */}
      <div className="calendar-wrapper">
        <button className="scroll-arrow left" onClick={() => scrollLeftBy(-300)}>‹</button>
        <button className="scroll-arrow right" onClick={() => scrollLeftBy(300)}>›</button>

        <div
          className={`calendar-container ${isDragging ? 'dragging' : ''}`}
          ref={calendarContainerRef}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
        >
          <div className="shift-calendar-grid">
            {/* Header Row */}
            <div className="calendar-row header-row">
              <div className="employee-cell-sticky employee-header">
                <div className="search-box">
                  <input
                    type="text"
                    placeholder="搜尋姓名/工號..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div className="employee-summary-sort">
                  <button
                    type="button"
                    className={`employee-summary-sort-btn ${employeeSortMode === 'leave' ? 'active' : ''}`}
                    onClick={() => handleEmployeeSortToggle('leave')}
                  >
                    請假天數
                  </button>
                  <button
                    type="button"
                    className={`employee-summary-sort-btn ${employeeSortMode === 'overtime' ? 'active' : ''}`}
                    onClick={() => handleEmployeeSortToggle('overtime')}
                  >
                    加班天數
                  </button>
                </div>
              </div>
              <div className="dates-header">
                {dates.map((date) => {
                  const ds = formatDateString(date)
                  const tag = monthTagMap[ds]
                  const targetPattern = (tag?.pattern as 'A' | 'B') || 'A'
                  const attendance = calculateAttendance(ds, targetPattern)
                  return (
                    <div
                      key={date.getTime()}
                      className={`date-header-cell ${sortDate === ds ? 'sorted' : ''}`}
                      onClick={() => handleDateSortToggle(ds)}
                      style={{ cursor: 'pointer', backgroundColor: sortDate === ds ? '#e3f2fd' : 'transparent' }}
                      title="點擊排序"
                    >
                      <div className="day-name">{getDayName(date)}</div>
                      <div className={`day-number ${isToday(date) ? 'today' : ''}`}>
                        {date.getDate()}
                      </div>
                      {tag?.isHoliday && <div style={{ marginTop: 4, fontSize: 10, color: '#c62828' }}>假</div>}
                      {tag?.pattern && <div style={{ marginTop: 2, fontSize: 10, color: '#1976d2' }}>{tag.pattern}</div>}

                      {/* Attendance Rate Display */}
                      <div className="attendance-rate" title={`應到:${attendance.target} 請假:${attendance.absent} 加班:${attendance.overtime}`}>
                        <div style={{ fontSize: 10, marginTop: 4, fontWeight: 'bold', color: attendance.rate < 100 ? '#e65100' : '#2e7d32' }}>
                          {attendance.rate.toFixed(0)}%
                        </div>
                        <div style={{ fontSize: 9, color: '#666' }}>
                          {attendance.actual}/{attendance.target}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Employee Rows */}
            {visibleEmployees.map((employee) => {
              const monthlyStats = employeeMonthlyStats.get(employee.employee_id) ?? { leaveDays: 0, overtimeDays: 0 }
              return (
                <div key={employee.employee_id} className="calendar-row body-row">
                  <div className="employee-cell-sticky employee-row">
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{employee.name} {employee.group ? <span style={{ fontSize: '11px', color: '#888' }}>({employee.group})</span> : null}</span>
                      <span style={{ fontSize: '10px', color: '#888' }}>班別 {employee.shift_type}</span>
                      <div className="employee-monthly-stats">
                        <button
                          type="button"
                          className={`employee-monthly-stat-btn ${employeeSortMode === 'leave' ? 'active' : ''}`}
                          onClick={() => handleEmployeeSortToggle('leave')}
                          title="點擊依當月請假天數排序"
                        >
                          請假 {monthlyStats.leaveDays} 天
                        </button>
                        <button
                          type="button"
                          className={`employee-monthly-stat-btn ${employeeSortMode === 'overtime' ? 'active' : ''}`}
                          onClick={() => handleEmployeeSortToggle('overtime')}
                          title="點擊依當月加班天數排序"
                        >
                          加班 {monthlyStats.overtimeDays} 天
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="employee-shifts-row">
                    {dates.map((date) => {
                      const dateString = formatDateString(date)
                      const tag = monthTagMap[dateString]
                      const shift = getShiftForDate(employee.employee_id, dateString)
                      const isSelected = selectedCell?.employeeId === employee.employee_id && selectedCell?.date === dateString

                      return (
                        <div
                          key={dateString}
                          className={`shift-cell ${tag?.pattern === 'A' ? 'pattern-b' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={(e) => handleDateClick(employee.employee_id, dateString, e)}
                        >
                          {shift && (
                            <div
                              className="shift-badge"
                              style={{ backgroundColor: shift.color }}
                              onClick={(e) => { e.stopPropagation(); handleDateClick(employee.employee_id, dateString, e); }}
                            >
                              {shift.label}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Portal for Shift Menu */}
      {
        selectedCell && menuPosition && createPortal(
          <>
            <div className="menu-overlay" onClick={() => { setSelectedCell(null); setComment(''); }}></div>
            <div
              className="shift-menu-portal"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
              }}
              onClick={e => e.stopPropagation()}
            >
              {(() => {
                const shift = getShiftForDate(selectedCell.employeeId, selectedCell.date)
                return (
                  <>
                    <div className="menu-title">{shift ? '編輯排班' : '選擇類型'}</div>

                    {/* Comment Input */}
                    <div className="comment-input-section">
                      <input
                        type="text"
                        className="comment-input"
                        placeholder="備註 (最多100字)"
                        maxLength={100}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        autoFocus
                      />
                    </div>

                    <div className="shift-options-grid">
                      {leaveTypes.map((type) => (
                        <button
                          key={type.leave_id}
                          className={`shift-option ${shift && type.name === shift.id ? 'current' : ''}`}
                          style={{ backgroundColor: type.color || '#ff9800' }}
                          onClick={() => handleShiftSelect(type.name)}
                        >
                          {type.name}
                        </button>
                      ))}
                    </div>

                    {shift && (
                      <>
                        <div className="menu-divider"></div>
                        <button className="shift-option delete" onClick={() => handleDeleteShift(selectedCell.employeeId, selectedCell.date)}>🗑️ 刪除</button>
                      </>
                    )}
                    <button className="shift-option cancel" onClick={() => { setSelectedCell(null); setComment(''); }}>取消</button>
                  </>
                )
              })()}
            </div>
          </>,
          document.body
        )
      }


      {/* 排班类型图例 */}
      < div className="legend" >
        <div className="legend-title">請假類型</div>
        <div className="legend-items">
          {leaveTypes.map((type) => (
            <div key={type.leave_id} className="legend-item">
              <div className="legend-color" style={{ backgroundColor: type.color || '#ff9800' }}></div>
              <span>{type.name}</span>
            </div>
          ))}
        </div>
      </div >
    </div >
  )
}

export default ShiftScheduler
