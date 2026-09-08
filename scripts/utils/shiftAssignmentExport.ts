import * as XLSX from 'xlsx'
import type { ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import type { User } from '../hooks/useUsersAPI'
import type { LeaveType } from '../hooks/useShiftSettingAPI'

/** 日曆單日標籤（與 useCalendarTags 之 getMonthMap 值相容） */
export type CalendarTagLike = {
  pattern?: 'A' | 'B' | null
  shift_type?: 'A' | 'B' | null
  isHoliday?: boolean
}

export interface ShiftAssignmentExportRow {
  date: string
  工號: string
  姓名: string
  群組: string
  /** users.day_night + users.shift_type，例 DA、NB */
  班別: string
  /** 假別名稱；日曆「上班」列為空白 */
  詳細假別: string
  /** 上班 | 請假 | 加班 */
  請假加班: string
  comment: string
  /** 跨班加班代碼；非加班列為空白 */
  跨班加班: string
}

function categoryFromLeaveTypes(leaveTypes: LeaveType[], shiftType: string): '請假' | '加班' | '未對應' {
  const lt = leaveTypes.find((l) => l.name === shiftType)
  if (!lt) return '未對應'
  if (lt.is_not_workday === 1) return '加班'
  return '請假'
}

function userShiftLabel(u: User): string {
  const dn = u.day_night ?? ''
  const st = u.shift_type ?? ''
  if (dn && st) return `${dn}${st}`
  return `${dn}${st}`.trim()
}

function calendarPattern(tag: CalendarTagLike | undefined): 'A' | 'B' | null | undefined {
  if (!tag) return undefined
  const p = tag.pattern ?? tag.shift_type
  return p === 'A' || p === 'B' ? p : p ?? undefined
}

function enumerateDateStrings(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const cur = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  if (cur > end) return out
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  while (cur.getTime() <= end.getTime()) {
    out.push(fmt(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * 匯出排班：含 shift_assignments，並可選依 calendar_tags 補上「上班」列。
 * 規則：該日若有請假（is_not_workday===0）僅輸出請假、不另輸出上班；加班列同理不併出上班。
 */
export function buildShiftAssignmentExportRows(
  assignments: ShiftAssignment[],
  employees: User[],
  leaveTypes: LeaveType[],
  startDate: string,
  endDate: string,
  getMonthMap?: (year: number, month: number) => Record<string, CalendarTagLike>
): ShiftAssignmentExportRow[] {
  if (!startDate || !endDate || startDate > endDate) return []

  const resolveTag = (dateStr: string): CalendarTagLike | undefined => {
    if (!getMonthMap) return undefined
    const d = new Date(dateStr + 'T12:00:00')
    const map = getMonthMap(d.getFullYear(), d.getMonth())
    return map[dateStr]
  }

  const exportEmployees = employees.filter((e) => e.role !== 'admin')
  const dates = enumerateDateStrings(startDate, endDate)

  const assignmentRows: ShiftAssignmentExportRow[] = assignments
    .filter((a) => a.date >= startDate && a.date <= endDate)
    .map((a) => {
      const emp = employees.find((e) => e.employee_id === a.employee_id)
      const comment = (a.comment ?? '').replace(/\r?\n/g, ' ')
      const cat = categoryFromLeaveTypes(leaveTypes, a.shift_type)
      const ot = a.overtime_shift && ['DA', 'DB', 'NA', 'NB'].includes(a.overtime_shift) ? a.overtime_shift : ''
      return {
        date: a.date,
        工號: a.employee_id,
        姓名: emp?.name ?? '',
        群組: emp?.group ?? '',
        班別: emp ? userShiftLabel(emp) : '',
        詳細假別: a.shift_type,
        請假加班: cat === '未對應' ? '未對應' : cat,
        comment,
        跨班加班: cat === '加班' ? ot : '',
      }
    })

  const workRows: ShiftAssignmentExportRow[] = []
  if (getMonthMap) {
    for (const emp of exportEmployees) {
      if (!emp.shift_type) continue
      const userSt = emp.shift_type
      for (const dateStr of dates) {
        const a = assignments.find((x) => x.employee_id === emp.employee_id && x.date === dateStr)
        if (a) continue
        const tag = resolveTag(dateStr)
        const pat = calendarPattern(tag)
        if (pat !== undefined && pat === userSt) {
          workRows.push({
            date: dateStr,
            工號: emp.employee_id,
            姓名: emp.name,
            群組: emp.group ?? '',
            班別: userShiftLabel(emp),
            詳細假別: '',
            請假加班: '上班',
            comment: '',
            跨班加班: '',
          })
        }
      }
    }
  }

  const merged = [...assignmentRows, ...workRows].sort((x, y) => {
    const g = (x.群組 || '').localeCompare(y.群組 || '', 'zh-Hant')
    if (g !== 0) return g
    const e = x.工號.localeCompare(y.工號)
    if (e !== 0) return e
    const d = x.date.localeCompare(y.date)
    if (d !== 0) return d
    const order = (r: ShiftAssignmentExportRow) => (r.請假加班 === '請假' ? 0 : r.請假加班 === '加班' ? 1 : 2)
    return order(x) - order(y)
  })

  return merged
}

function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const EXPORT_HEADERS: (keyof ShiftAssignmentExportRow)[] = [
  'date',
  '工號',
  '姓名',
  '群組',
  '班別',
  '詳細假別',
  '請假加班',
  'comment',
  '跨班加班',
]

export function downloadShiftAssignmentsCsv(rows: ShiftAssignmentExportRow[], filename: string): void {
  const lines = [
    EXPORT_HEADERS.join(','),
    ...rows.map((r) => EXPORT_HEADERS.map((h) => csvEscapeCell(String(r[h] ?? ''))).join(',')),
  ]
  const bom = '\ufeff'
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  triggerBlobDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

const XLSX_HEADER_ROW = [...EXPORT_HEADERS]

export function downloadShiftAssignmentsXlsx(rows: ShiftAssignmentExportRow[], filename: string): void {
  const sheetRows = rows.map((r) => ({ ...r }))
  const ws =
    sheetRows.length > 0
      ? XLSX.utils.json_to_sheet(sheetRows)
      : XLSX.utils.aoa_to_sheet([XLSX_HEADER_ROW])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'shift_assignments')
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  XLSX.writeFile(wb, name)
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export {
  downloadShiftStatsWorkbook,
  generateShiftStatsWorkbook,
  getProductionMonthInfo,
} from './shiftStatsExcelExport'
export type {
  ShiftStatsExportOptions,
  ProductionMonthInfo,
  ProductionMonthWeek,
} from './shiftStatsExcelExport'

