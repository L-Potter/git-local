import * as XLSX from 'xlsx'
import type { ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import type { User } from '../hooks/useUsersAPI'
import type { LeaveType } from '../hooks/useShiftSettingAPI'
import {
  SHIFT_LINES,
  ShiftLine,
  formatDateString,
  getSundayWeek,
  employeeShiftLineLabel,
} from './workHoursEstimate'

export type RateKind = 'leave' | 'overtime' | 'net'

export interface ShiftMetrics {
  leaveCount: number
  overtimeCount: number
  headcount: number
  leaveRate: number
  overtimeRate: number
  netRate: number
}

const OPPOSITE_SHIFT_LINE: Record<ShiftLine, ShiftLine> = {
  DA: 'DB',
  DB: 'DA',
  NA: 'NB',
  NB: 'NA',
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function getShiftHeadcount(employees: User[], shiftLine: ShiftLine): number {
  return employees.filter(
    (e) => e.role !== 'admin' && employeeShiftLineLabel(e) === shiftLine
  ).length
}

export function computeDailyShiftRatesForExport(
  dateStr: string,
  shiftLine: ShiftLine,
  assignments: ShiftAssignment[],
  employees: User[],
  employeeMap: Map<string, User>,
  leaveTypeMap: Map<string, LeaveType>,
  calendarTag: { isHoliday?: boolean; shift_type?: string | null } | undefined,
  memberFilter?: (employee: User) => boolean
): ShiftMetrics {
  const eligibleEmployees = memberFilter ? employees.filter(memberFilter) : employees
  let headcount = getShiftHeadcount(eligibleEmployees, shiftLine)

  if (calendarTag?.shift_type === 'A') {
    if (shiftLine !== 'DA' && shiftLine !== 'NA') headcount = 0
  } else if (calendarTag?.shift_type === 'B') {
    if (shiftLine !== 'DB' && shiftLine !== 'NB') headcount = 0
  }

  if (headcount === 0) {
    return { leaveRate: 0, overtimeRate: 0, netRate: 0, leaveCount: 0, overtimeCount: 0, headcount: 0 }
  }

  const oppositeShiftLine = OPPOSITE_SHIFT_LINE[shiftLine]
  const leaveIds = new Set<string>()
  const overtimeIds = new Set<string>()
  const isHoliday = calendarTag?.isHoliday === true

  for (const a of assignments) {
    if (a.date !== dateStr) continue
    const emp = employeeMap.get(a.employee_id)
    if (!emp || emp.role === 'admin') continue
    if (memberFilter && !memberFilter(emp)) continue

    const lt = leaveTypeMap.get(a.shift_type)
    if (!lt) continue

    const empLine = employeeShiftLineLabel(emp)

    if (empLine === shiftLine && lt.is_not_workday === 0 && !isHoliday) {
      leaveIds.add(a.employee_id)
    }

    if (empLine === oppositeShiftLine && lt.is_not_workday === 1) {
      overtimeIds.add(a.employee_id)
    }
  }

  const leaveCount = leaveIds.size
  const overtimeCount = overtimeIds.size
  const leaveRate = leaveCount / headcount
  const overtimeRate = overtimeCount / headcount
  const netRate = (headcount + overtimeCount - leaveCount) / headcount

  return { leaveRate, overtimeRate, netRate, leaveCount, overtimeCount, headcount }
}

export function combineMetrics(m1: ShiftMetrics, m2: ShiftMetrics): ShiftMetrics {
  const leaveCount = m1.leaveCount + m2.leaveCount
  const overtimeCount = m1.overtimeCount + m2.overtimeCount
  const headcount = m1.headcount + m2.headcount
  const leaveRate = headcount > 0 ? leaveCount / headcount : 0
  const overtimeRate = headcount > 0 ? overtimeCount / headcount : 0
  const netRate = headcount > 0 ? (headcount + overtimeCount - leaveCount) / headcount : 0

  return { leaveCount, overtimeCount, headcount, leaveRate, overtimeRate, netRate }
}

export function sumMetricsList(list: ShiftMetrics[]): ShiftMetrics {
  const leaveCount = list.reduce((sum, m) => sum + m.leaveCount, 0)
  const overtimeCount = list.reduce((sum, m) => sum + m.overtimeCount, 0)
  const headcount = list.reduce((sum, m) => sum + m.headcount, 0)
  const leaveRate = headcount > 0 ? leaveCount / headcount : 0
  const overtimeRate = headcount > 0 ? overtimeCount / headcount : 0
  const netRate = headcount > 0 ? (headcount + overtimeCount - leaveCount) / headcount : 0

  return { leaveCount, overtimeCount, headcount, leaveRate, overtimeRate, netRate }
}

export type ShiftTypeRowKey = 'DB' | 'DA' | 'D' | 'NB' | 'NA' | 'N'

export type GroupShiftRowResults = Record<ShiftTypeRowKey, ShiftMetrics>

export function computeGroupDailyShiftRows(
  dateStr: string,
  assignments: ShiftAssignment[],
  employees: User[],
  employeeMap: Map<string, User>,
  leaveTypeMap: Map<string, LeaveType>,
  calendarTag: { isHoliday?: boolean; shift_type?: string | null } | undefined,
  memberFilter?: (employee: User) => boolean
): GroupShiftRowResults {
  const db = computeDailyShiftRatesForExport(dateStr, 'DB', assignments, employees, employeeMap, leaveTypeMap, calendarTag, memberFilter)
  const da = computeDailyShiftRatesForExport(dateStr, 'DA', assignments, employees, employeeMap, leaveTypeMap, calendarTag, memberFilter)
  const dTotal = combineMetrics(db, da)

  const nb = computeDailyShiftRatesForExport(dateStr, 'NB', assignments, employees, employeeMap, leaveTypeMap, calendarTag, memberFilter)
  const na = computeDailyShiftRatesForExport(dateStr, 'NA', assignments, employees, employeeMap, leaveTypeMap, calendarTag, memberFilter)
  const nTotal = combineMetrics(nb, na)

  return {
    DB: db,
    DA: da,
    D: dTotal,
    NB: nb,
    NA: na,
    N: nTotal,
  }
}

export interface ProductionMonthWeek {
  weekYear: number
  week: number
  weekCode: string // e.g. "632"
  sheetName: string // e.g. "W632"
  startDate: string // Sunday
  endDate: string // Saturday
  dates: string[] // 7 dates
}

export interface ProductionMonthInfo {
  year: number
  month: number // 1..12
  monthCode: string // e.g. "M608"
  sheetName: string // e.g. "M608"
  startDate: string // e.g. "2026-08-02"
  endDate: string // e.g. "2026-09-05"
  rangeLabel: string // e.g. "8/2 -> 9/5"
  weeks: ProductionMonthWeek[]
}

/**
 * 依工廠生產月規則取得某月份所屬的週別：
 * 尋找該月份內所有的星期日，每個星期日對應一週（週日到週六）。
 * 例：2026年8月之星期日為 8/2, 8/9, 8/16, 8/23, 8/30
 * 涵蓋範圍為 8/2 -> 9/5，週別為 W632, W633, W634, W635, W636，代碼 M608。
 */
export function getProductionMonthInfo(year: number, month: number): ProductionMonthInfo {
  const lastDay = new Date(year, month, 0).getDate()
  const sundays: Date[] = []

  for (let day = 1; day <= lastDay; day++) {
    const cur = new Date(year, month - 1, day, 12, 0, 0)
    if (cur.getDay() === 0) {
      sundays.push(cur)
    }
  }

  const weeks: ProductionMonthWeek[] = sundays.map((sun) => {
    const { weekYear, week } = getSundayWeek(sun)
    const weekCode = `${weekYear % 10}${String(week).padStart(2, '0')}`
    const sheetName = `W${weekCode}`
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(sun)
      date.setDate(sun.getDate() + i)
      dates.push(formatDateString(date))
    }
    return {
      weekYear,
      week,
      weekCode,
      sheetName,
      startDate: dates[0],
      endDate: dates[6],
      dates,
    }
  })

  const firstSun = sundays[0] ?? new Date(year, month - 1, 1)
  const lastWeekEnd = weeks.length > 0 ? weeks[weeks.length - 1].endDate : formatDateString(new Date(year, month, 0))
  const startMonthDay = `${firstSun.getMonth() + 1}/${firstSun.getDate()}`
  const endD = new Date(lastWeekEnd + 'T12:00:00')
  const endMonthDay = `${endD.getMonth() + 1}/${endD.getDate()}`
  const monthCode = `M${year % 10}${String(month).padStart(2, '0')}`

  return {
    year,
    month,
    monthCode,
    sheetName: monthCode,
    startDate: weeks.length > 0 ? weeks[0].startDate : formatDateString(firstSun),
    endDate: lastWeekEnd,
    rangeLabel: `${startMonthDay} -> ${endMonthDay}`,
    weeks,
  }
}

export interface GroupConfig {
  name: string
  label: string
  memberFilter: (employee: User) => boolean
}

const DAY_NAMES_ZH = ['日', '一', '二', '三', '四', '五', '六']

const SHIFT_ROW_SPECS: Array<{
  categoryPrefix: (grp: string) => string
  shift: string
  key: ShiftTypeRowKey
}> = [
  { categoryPrefix: (grp) => grp, shift: 'DB', key: 'DB' },
  { categoryPrefix: () => '', shift: 'DA', key: 'DA' },
  { categoryPrefix: () => 'Total', shift: 'D', key: 'D' },
  { categoryPrefix: () => '', shift: 'NB', key: 'NB' },
  { categoryPrefix: () => '', shift: 'NA', key: 'NA' },
  { categoryPrefix: () => 'Total', shift: 'N', key: 'N' },
]

interface TimeSectionData {
  title: string
  groupResults: Map<string, GroupShiftRowResults>
}

function buildSheetAoaAndMerges(
  sections: TimeSectionData[],
  groups: GroupConfig[]
): { aoa: (string | number)[][]; merges: XLSX.Range[]; cols: { wch: number }[] } {
  const aoa: (string | number)[][] = []
  const merges: XLSX.Range[] = []

  // Row 0: Period / Section headers
  const row0: (string | number)[] = ['分類', '班別']
  // Row 1: Column metric sub-headers
  const row1: (string | number)[] = ['分類', '班別']

  sections.forEach((sec, secIdx) => {
    const startCol = 2 + secIdx * 6
    row0.push(sec.title, '', '', '', '', '')
    merges.push({
      s: { r: 0, c: startCol },
      e: { r: 0, c: startCol + 5 },
    })

    row1.push('請假人數', '加班人數', '當班人數', '請假率', '加班率', '淨出勤率')
  })

  // Merge '分類' & '班別' across row 0 and 1
  merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } })
  merges.push({ s: { r: 0, c: 1 }, e: { r: 1, c: 1 } })

  aoa.push(row0)
  aoa.push(row1)

  // Data Rows
  groups.forEach((grp) => {
    SHIFT_ROW_SPECS.forEach((spec) => {
      const row: (string | number)[] = [
        spec.categoryPrefix(grp.label),
        spec.shift,
      ]

      sections.forEach((sec) => {
        const grpRes = sec.groupResults.get(grp.name)
        const metrics = grpRes ? grpRes[spec.key] : undefined
        if (metrics) {
          row.push(
            metrics.leaveCount,
            metrics.overtimeCount,
            metrics.headcount,
            formatRate(metrics.leaveRate),
            formatRate(metrics.overtimeRate),
            formatRate(metrics.netRate)
          )
        } else {
          row.push(0, 0, 0, '0.0%', '0.0%', '0.0%')
        }
      })

      aoa.push(row)
    })
  })

  const cols = [
    { wch: 12 }, // 分類
    { wch: 8 },  // 班別
    ...Array(sections.length * 6).fill({ wch: 10 }),
  ]

  return { aoa, merges, cols }
}

export interface ShiftStatsCategory {
  id: string
  name: string
  groupNames: string[]
}

export interface ShiftStatsExportOptions {
  monthInfo: ProductionMonthInfo
  assignments: ShiftAssignment[]
  employees: User[]
  leaveTypes: LeaveType[]
  calendarTagGetter: (dateStr: string) => { isHoliday?: boolean; shift_type?: string | null } | undefined
  categories?: ShiftStatsCategory[]
  selectedCategoryIds?: string[]
  selectedGroups?: string[]
  exportScopeMode?: 'CATEGORIES' | 'GROUPS'
  includeGrandTotal?: boolean
}

/**
 * 建立完整符合格式之 Excel 活頁簿：
 * 1. 包含一個月份 Sheet（例 M608，範圍 8/2 -> 9/5，左側月總結，依序 w632～w636）
 * 2. 包含該月份中每一週的獨立 Sheet（例 W632, W633, W634, W635, W636，左側週總結，依序第 1 天至第 7 天）
 */
export function generateShiftStatsWorkbook(options: ShiftStatsExportOptions): XLSX.WorkBook {
  const {
    monthInfo,
    assignments,
    employees,
    leaveTypes,
    calendarTagGetter,
    categories = [],
    selectedCategoryIds,
    selectedGroups,
    exportScopeMode,
    includeGrandTotal = true,
  } = options

  const employeeMap = new Map(employees.map((e) => [e.employee_id, e]))
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.name, lt]))

  const isCategoryMode =
    exportScopeMode === 'CATEGORIES' ||
    (exportScopeMode === undefined && categories.length > 0)

  const groups: GroupConfig[] = []

  if (isCategoryMode && categories.length > 0) {
    const targetCats =
      selectedCategoryIds !== undefined
        ? categories.filter((c) => selectedCategoryIds.includes(c.id))
        : categories

    targetCats.forEach((cat) => {
      const groupSet = new Set(cat.groupNames)
      const label = cat.name.trim() || '未命名分類'
      groups.push({
        name: cat.id,
        label,
        memberFilter: (emp: User) => groupSet.has(emp.group?.trim() || '未定義'),
      })
    })
  } else {
    // 整理要輸出的原始群組清單
    const allGroupsInDb = Array.from(
      new Set(
        employees
          .filter((e) => e.role !== 'admin')
          .map((e) => e.group?.trim() || '未定義')
      )
    ).sort((a, b) => a.localeCompare(b, 'zh-Hant'))

    // 確保 G1 優先排在最前
    const sortedGroupNames = allGroupsInDb.sort((a, b) => {
      if (a === 'G1') return -1
      if (b === 'G1') return 1
      if (a === 'G2') return -1
      if (b === 'G2') return 1
      return a.localeCompare(b, 'zh-Hant')
    })

    const targetGroupNames =
      selectedGroups !== undefined
        ? sortedGroupNames.filter((g) => selectedGroups.includes(g))
        : sortedGroupNames

    targetGroupNames.forEach((gName) => {
      groups.push({
        name: gName,
        label: gName,
        memberFilter: (emp: User) => (emp.group?.trim() || '未定義') === gName,
      })
    })
  }

  // 增加「全廠 Total」群組
  if (includeGrandTotal) {
    groups.push({
      name: '__ALL__',
      label: 'Total',
      memberFilter: () => true,
    })
  }

  const wb = XLSX.utils.book_new()

  // 預先計算每一天所有群組的 metrics，方便週和月彙總
  const dailyResultsCache = new Map<string, Map<string, GroupShiftRowResults>>()

  const getDayGroupResults = (dateStr: string): Map<string, GroupShiftRowResults> => {
    if (!dailyResultsCache.has(dateStr)) {
      const tag = calendarTagGetter(dateStr)
      const map = new Map<string, GroupShiftRowResults>()
      groups.forEach((grp) => {
        const res = computeGroupDailyShiftRows(
          dateStr,
          assignments,
          employees,
          employeeMap,
          leaveTypeMap,
          tag,
          grp.memberFilter
        )
        map.set(grp.name, res)
      })
      dailyResultsCache.set(dateStr, map)
    }
    return dailyResultsCache.get(dateStr)!
  }

  // 輔助函式：將多天的 GroupShiftRowResults 聚合
  const aggregateDays = (dateList: string[]): Map<string, GroupShiftRowResults> => {
    const out = new Map<string, GroupShiftRowResults>()
    groups.forEach((grp) => {
      const combined: GroupShiftRowResults = {
        DB: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.DB)),
        DA: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.DA)),
        D: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.D)),
        NB: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.NB)),
        NA: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.NA)),
        N: sumMetricsList(dateList.map((d) => getDayGroupResults(d).get(grp.name)!.N)),
      }
      out.set(grp.name, combined)
    })
    return out
  }

  // ==========================================
  // 1. 月份 Sheet (例 M608)
  // ==========================================
  const allMonthDates: string[] = []
  monthInfo.weeks.forEach((w) => {
    allMonthDates.push(...w.dates)
  })

  const monthSections: TimeSectionData[] = [
    {
      title: `月總結 (${monthInfo.monthCode}: ${monthInfo.rangeLabel})`,
      groupResults: aggregateDays(allMonthDates),
    },
  ]

  // 各週別區塊 (w632, w633, ...)
  monthInfo.weeks.forEach((w) => {
    monthSections.push({
      title: `w${w.weekCode} (${w.startDate.slice(5).replace('-', '/')} ~ ${w.endDate.slice(5).replace('-', '/')})`,
      groupResults: aggregateDays(w.dates),
    })
  })

  const monthSheetData = buildSheetAoaAndMerges(monthSections, groups)
  const wsMonth = XLSX.utils.aoa_to_sheet(monthSheetData.aoa)
  wsMonth['!merges'] = monthSheetData.merges
  wsMonth['!cols'] = monthSheetData.cols
  wsMonth['!views'] = [{ xSplit: 2, ySplit: 2, state: 'frozen' }]
  XLSX.utils.book_append_sheet(wb, wsMonth, monthInfo.sheetName)

  // ==========================================
  // 2. 週別 Sheets (例 W632, W633, ..., W640)
  // ==========================================
  monthInfo.weeks.forEach((w) => {
    const weekSections: TimeSectionData[] = [
      {
        title: `週總結 (${w.sheetName})`,
        groupResults: aggregateDays(w.dates),
      },
    ]

    // 每日第 1 天至第 7 天明細
    w.dates.forEach((dateStr) => {
      const d = new Date(dateStr + 'T12:00:00')
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()} (${DAY_NAMES_ZH[d.getDay()]})`
      weekSections.push({
        title: dayLabel,
        groupResults: getDayGroupResults(dateStr),
      })
    })

    const weekSheetData = buildSheetAoaAndMerges(weekSections, groups)
    const wsWeek = XLSX.utils.aoa_to_sheet(weekSheetData.aoa)
    wsWeek['!merges'] = weekSheetData.merges
    wsWeek['!cols'] = weekSheetData.cols
    wsWeek['!views'] = [{ xSplit: 2, ySplit: 2, state: 'frozen' }]
    XLSX.utils.book_append_sheet(wb, wsWeek, w.sheetName)
  })

  return wb
}

/**
 * 匯出出勤統計 Excel 並觸發瀏覽器下載
 */
export function downloadShiftStatsWorkbook(
  options: ShiftStatsExportOptions,
  customFilename?: string
): void {
  const wb = generateShiftStatsWorkbook(options)
  const defaultName = `出勤統計_${options.monthInfo.sheetName}_${options.monthInfo.startDate}_${options.monthInfo.endDate}.xlsx`
  const filename = customFilename || defaultName
  XLSX.writeFile(wb, filename)
}
