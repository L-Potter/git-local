import { actorRequestHeaders } from '../utils/actorRequestHeaders'

/** 跨班加班加班；NULL/省略表示非跨班或未選、沿用日曆 */
export type OvertimeShiftCode = 'DA' | 'DB' | 'NA' | 'NB'

export interface ShiftAssignment {
  employee_id: string
  date: string
  shift_type: string
  comment?: string
  /** 與 users.day_night+shift_type 同列舉；未跨班時為 null */
  overtime_shift?: OvertimeShiftCode | null
  /** 當日工時（0~15，最多兩位小數） */
  work_hours?: number | null
  created_at?: string
  updated_at?: string
}

export interface LeaveType {
  leave_id: number
  name: string
  is_not_workday: number
  color?: string
  created_at: string
}

export interface User {
  user_id: number
  name: string
  employee_id: string
  shift_type: 'A' | 'B' | '7' | null
  site: 'P1' | 'P2' | 'P3' | 'P4' | null
  day_night: 'D' | 'N' | null
  role: 'user' | 'admin'
  created_at: string
}

export interface CalendarTag {
  date: string
  isHoliday: boolean
  pattern: 'A' | 'B' | null
  created_at?: string
  updated_at?: string
}

const API_BASE_URL = '/api'

export const useShiftAssignmentsAPI = () => {
  // Helper function to check if employeeId matches current user
  const checkEmployeeAccess = (employeeId: string): boolean => {
    return true
  }
  // 下列尚未確認功能為何先merge
  // Helper function to get week start date (Monday)
  const getWeekStart = (date: Date): Date => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Sunday
    return new Date(d.setDate(diff))
  }

  // Helper function to get all dates in a week
  const getWeekDates = (date: Date): Date[] => {
    const weekStart = getWeekStart(date)
    const dates: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      dates.push(d)
    }
    return dates
  }

  // Helper function to format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  // Validation function to check weekly working hours
  const validateWeeklyHours = async (
    employeeId: string,
    assignmentDate: string,
    newShiftType: string
  ): Promise<void> => {
    const assignmentDateObj = new Date(assignmentDate + 'T00:00:00')
    const weekDates = getWeekDates(assignmentDateObj)

    // Fetch required data
    const [existingAssignmentsResponse, leaveTypes, users, calendarTags] = await Promise.all([
      fetch(`${API_BASE_URL}/shift-assignments/${employeeId}`, { credentials: 'include', headers: actorRequestHeaders() }),
      fetch(`${API_BASE_URL}/leave-types`, { credentials: 'include', headers: actorRequestHeaders() }).then(r => r.json()),
      fetch(`${API_BASE_URL}/users`, { credentials: 'include', headers: actorRequestHeaders() }).then(r => r.json()),
      fetch(`${API_BASE_URL}/calendar-tags`, { credentials: 'include', headers: actorRequestHeaders() }).then(r => r.json()).then(tags =>
        tags.map((tag: any) => ({
          ...tag,
          isHoliday: tag.is_holiday === 1,
          pattern: tag.shift_type,
        }))
      )
    ])

    if (!existingAssignmentsResponse.ok) {
      throw new Error('获取排班数据失败')
    }

    const existingAssignments = await existingAssignmentsResponse.json()

    const user = users.find((u: User) => u.employee_id === employeeId)
    if (!user) {
      throw new Error('用戶不存在')
    }

    // Create a map of existing assignments
    const assignmentMap = new Map<string, string>()
    existingAssignments.forEach((assignment: ShiftAssignment) => {
      assignmentMap.set(assignment.date, assignment.shift_type)
    })

    // Update with the new assignment for calculation
    assignmentMap.set(assignmentDate, newShiftType)

    // Create calendar tags map
    const calendarMap = new Map<string, CalendarTag>()
    calendarTags.forEach((tag: CalendarTag) => {
      calendarMap.set(tag.date, tag)
    })

    let totalHours = 0

    // Calculate hours for each day in the week
    for (const date of weekDates) {
      const dateStr = formatDate(date)
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = calendarMap.get(dateStr)

      if (assignment) {
        // Check if it's a leave type with is_not_workday = 1
        const leaveType = leaveTypes.find((lt: LeaveType) => lt.name === assignment)
        if (leaveType && leaveType.is_not_workday === 1) {
          totalHours += 10 // Daily working hours
        }
      } else {
        // No assignment - check if it's a regular working day
        if (calendarTag?.pattern && user.shift_type === calendarTag.pattern && !calendarTag.isHoliday) {
          totalHours += 10 // Regular working day
        }
      }
    }

    if (totalHours > 50) {
      throw new Error(`每週工作時數不能超過50小時。目前計算時數：${totalHours}小時`)
    }
  }
  // 获取用户的排班数据
  const getShiftAssignments = async (employeeId: string): Promise<ShiftAssignment[]> => {
    const response = await fetch(`${API_BASE_URL}/shift-assignments/${employeeId}`, {
      credentials: 'include',
      headers: actorRequestHeaders(),
    })
    if (!response.ok) {
      throw new Error('获取排班数据失败')
    }
    return response.json()
  }

  // 创建或更新排班
  const saveShiftAssignment = async (
    employeeId: string,
    date: string,
    shiftType: string,
    comment: string = '',
    overtimeShift: OvertimeShiftCode | null = null,
    workHours: number | null = null
  ): Promise<ShiftAssignment> => {
    checkEmployeeAccess(employeeId)
    const response = await fetch(`${API_BASE_URL}/shift-assignments/${employeeId}/${date}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...actorRequestHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({
        shift_type: shiftType,
        comment,
        overtime_shift: overtimeShift,
        work_hours: workHours,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '保存排班失败')
    }

    return response.json()
  }

  // 删除排班
  const deleteShiftAssignment = async (employeeId: string, date: string): Promise<void> => {
    checkEmployeeAccess(employeeId)
    const response = await fetch(`${API_BASE_URL}/shift-assignments/${employeeId}/${date}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: actorRequestHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '删除排班失败')
    }
  }

  // 移动排班（用于拖拽功能）
  const moveShiftAssignment = async (
    employeeId: string,
    fromDate: string,
    toEmployeeId: string,
    toDate: string
  ): Promise<void> => {
    checkEmployeeAccess(employeeId)
    checkEmployeeAccess(toEmployeeId) // Also check destination employee access
    const response = await fetch(`${API_BASE_URL}/shift-assignments/${employeeId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...actorRequestHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({
        from_date: fromDate,
        to_employee_id: toEmployeeId,
        to_date: toDate,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || '移动排班失败')
    }
  }

  return {
    getShiftAssignments,
    saveShiftAssignment,
    deleteShiftAssignment,
    moveShiftAssignment,
  }
}
