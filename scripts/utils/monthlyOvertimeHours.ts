import type { ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import type { LeaveType } from '../hooks/useShiftSettingAPI'

export type CalendarTagLike = {
  pattern?: 'A' | 'B' | null
  shift_type?: 'A' | 'B' | null
  isHoliday?: boolean
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function tagPattern(tag: CalendarTagLike | undefined): 'A' | 'B' | null | undefined {
  if (!tag) return undefined
  const p = tag.pattern ?? tag.shift_type
  return p === 'A' || p === 'B' ? p : p ?? undefined
}

function getWeekStart(date: Date): Date {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() - d.getDay())
  return d
}

/**
 * 與 LeaveOverview「46/54 HR」區塊相同之當月加班時數合計（僅計入 is_not_workday===1 之假別日期）。
 */
export function computeMonthlyOvertimeTotalHours(params: {
  year: number
  month: number
  employeeId: string
  userShift: 'A' | 'B'
  assignments: ShiftAssignment[]
  leaveTypes: LeaveType[]
  overtimeLeaveTypeNames: Set<string>
  getMonthMap: (y: number, m: number) => Record<string, CalendarTagLike>
}): {
  total: number
  regularOvertime10hr: number
  holidayOnDuty2hr: number
  holidayOvertime2hr: number
} {
  const { year, month, employeeId, userShift, assignments, leaveTypes, overtimeLeaveTypeNames, getMonthMap } =
    params

  const getTag = (dateStr: string): CalendarTagLike | undefined => {
    const d = new Date(dateStr + 'T12:00:00')
    const map = getMonthMap(d.getFullYear(), d.getMonth())
    return map[dateStr]
  }

  const isHoliday = (dateStr: string) => getTag(dateStr)?.isHoliday === true

  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const monthDates: string[] = []
  for (let d = new Date(monthStart.getTime()); d.getTime() <= monthEnd.getTime(); d.setDate(d.getDate() + 1)) {
    monthDates.push(formatDateString(new Date(d.getTime())))
  }

  const userOvertimeDates = new Set(
    assignments.filter((a) => a.employee_id === employeeId && overtimeLeaveTypeNames.has(a.shift_type)).map((a) => a.date)
  )

  const weekStarts = new Set<string>()
  monthDates.forEach((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    weekStarts.add(formatDateString(getWeekStart(d)))
  })

  let regularOvertime10hr = 0
  let holidayOnDuty2hr = 0
  let holidayOvertime2hr = 0

  weekStarts.forEach((weekStartStr) => {
    const weekStart = new Date(weekStartStr + 'T00:00:00')
    const weekDates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime())
      d.setDate(weekStart.getDate() + i)
      weekDates.push(formatDateString(d))
    }
    const inMonthDates = weekDates.filter((d) => monthDates.includes(d))
    const workDays = inMonthDates.filter((d) => tagPattern(getTag(d)) === userShift).length
    const maxOvertimeDays = Math.max(0, Math.min(2, 5 - workDays))
    const overtimeInWeek = inMonthDates.filter((d) => userOvertimeDates.has(d))
    const overtimeNonHoliday: string[] = []
    overtimeInWeek.forEach((d) => {
      if (isHoliday(d)) holidayOvertime2hr += 2
      else overtimeNonHoliday.push(d)
    })
    const n = Math.min(overtimeNonHoliday.length, maxOvertimeDays)
    if (maxOvertimeDays === 1) regularOvertime10hr += n * 10
    else if (maxOvertimeDays === 2 && n >= 1) regularOvertime10hr += (n - 1) * 10
  })

  const userAssignments = assignments.filter((a) => a.employee_id === employeeId)
  monthDates.forEach((dateStr) => {
    const tag = getTag(dateStr)
    if (tag?.isHoliday && tagPattern(tag) === userShift) {
      const assignment = userAssignments.find((a) => a.date === dateStr)
      let isLeave = false
      if (assignment) {
        const leaveType = leaveTypes.find((lt) => lt.name === assignment.shift_type)
        if (leaveType && leaveType.is_not_workday === 0) isLeave = true
      }
      if (!isLeave) holidayOnDuty2hr += 2
    }
  })

  const total = regularOvertime10hr + holidayOnDuty2hr + holidayOvertime2hr
  return { total, regularOvertime10hr, holidayOnDuty2hr, holidayOvertime2hr }
}
