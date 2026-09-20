import type { LeaveType } from '../hooks/useShiftSettingAPI'

export type Rolling30AssignmentEntry = {
  shiftType: string
  workHours?: number | null
}

export function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function estimateHoursForSingleDate(
  userShiftType: string,
  assignment: Rolling30AssignmentEntry | undefined,
  leaveTypeByName: Map<string, LeaveType>,
  calendarTag: { pattern?: string | null; shift_type?: string | null } | undefined
): { hours: number; type: 'overtime' | 'leave' | 'regular' | 'none' } {
  if (assignment) {
    const leaveType = leaveTypeByName.get(assignment.shiftType)
    const manualHours = assignment.workHours ?? null
    if (leaveType?.is_not_workday === 1) {
      return { hours: manualHours ?? 12, type: 'overtime' }
    }
    if (leaveType?.is_not_workday === 0) {
      const leaveHours = manualHours ?? 10.5
      return { hours: Math.max(0, 10.5 - leaveHours), type: 'leave' }
    }
    return { hours: 0, type: 'none' }
  }
  if ((calendarTag?.shift_type ?? calendarTag?.pattern) === userShiftType) {
    return { hours: 10.5, type: 'regular' }
  }
  return { hours: 0, type: 'none' }
}

/** 不含今天，往前回算 30 天的估算工時（與 LeaveOverview 相同規則） */
export function computePrevious30DaysEstimatedHours(
  userShiftType: string,
  employeeId: string,
  assignments: Array<{ employee_id: string; date: string; shift_type: string; work_hours?: number | null }>,
  leaveTypeByName: Map<string, LeaveType>,
  getMonthMap: (year: number, month: number) => Record<string, { pattern?: string | null; shift_type?: string | null }>
): { hours: number; start: string; end: string; breakdown: { overtime: number; leave: number; regular: number } } {
  const end = new Date()
  end.setHours(12, 0, 0, 0)
  end.setDate(end.getDate() - 1)

  const start = new Date(end)
  start.setDate(start.getDate() - 29)

  const startStr = formatDateString(start)
  const endStr = formatDateString(end)

  const assignmentMap = new Map<string, Rolling30AssignmentEntry>()
  assignments
    .filter((a) => a.employee_id === employeeId)
    .forEach((a) => assignmentMap.set(a.date, { shiftType: a.shift_type, workHours: a.work_hours ?? null }))

  const monthTagCache = new Map<string, Record<string, { pattern?: string | null; shift_type?: string | null }>>()
  const getTag = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`
    if (!monthTagCache.has(monthKey)) {
      monthTagCache.set(monthKey, getMonthMap(d.getFullYear(), d.getMonth()))
    }
    return monthTagCache.get(monthKey)?.[dateStr]
  }

  let hours = 0
  const breakdown = { overtime: 0, leave: 0, regular: 0 }
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    const dateStr = formatDateString(cursor)
    const result = estimateHoursForSingleDate(
      userShiftType,
      assignmentMap.get(dateStr),
      leaveTypeByName,
      getTag(dateStr)
    )
    hours += result.hours
    if (result.type !== 'none') {
      breakdown[result.type] += result.hours
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return { hours, start: startStr, end: endStr, breakdown }
}

export function getSundayWeek(date: Date): { weekYear: number; week: number } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const firstSunday = new Date(yearStart)
  firstSunday.setDate(yearStart.getDate() - yearStart.getDay())
  const diffDays = Math.floor((d.getTime() - firstSunday.getTime()) / 86400000)
  return { weekYear: d.getFullYear(), week: Math.floor(diffDays / 7) + 1 }
}

export function formatWeekCode(date: Date): string {
  const { weekYear, week } = getSundayWeek(date)
  return `${weekYear % 10}${String(week).padStart(2, '0')}`
}

export function isWeekStart(date: Date): boolean {
  return date.getDay() === 0 || date.getDate() === 1
}

export function employeeShiftLineLabel(e: { day_night?: string | null; shift_type?: string | null }): string {
  const dn = e.day_night ?? ''
  const st = e.shift_type ?? ''
  return `${dn}${st}`.trim() || '—'
}

export const SHIFT_LINES = ['DA', 'DB', 'NA', 'NB'] as const
export type ShiftLine = (typeof SHIFT_LINES)[number]

export function buildDateRange(startStr: string, endStr: string): Date[] {
  if (!startStr || !endStr || startStr > endStr) return []
  const dates: Date[] = []
  const cursor = new Date(startStr + 'T12:00:00')
  const end = new Date(endStr + 'T12:00:00')
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}
