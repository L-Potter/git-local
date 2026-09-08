import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useShiftAssignmentsAPI, ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import { useShiftSettingAPI, LeaveType } from '../hooks/useShiftSettingAPI'
import { useUsersAPI, User } from '../hooks/useUsersAPI'
import { useCalendarTags } from '../hooks/useCalendarTags'
import { useAuth } from '../hooks/useAuth'
import { useMemoryCache, CACHE_KEYS, CACHE_TTL } from '../hooks/useMemoryCache'
import {
  SHIFT_LINES,
  ShiftLine,
  buildDateRange,
  computePrevious30DaysEstimatedHours,
  employeeShiftLineLabel,
  formatDateString,
  formatWeekCode,
  getSundayWeek,
  isWeekStart,
} from '../utils/workHoursEstimate'
import {
  getProductionMonthInfo,
  downloadShiftStatsWorkbook,
} from '../utils/shiftStatsExcelExport'
import './ShiftStatsReport.css'

type DailyShiftRates = {
  leaveRate: number
  overtimeRate: number
  netRate: number
  leaveCount: number
  overtimeCount: number
  headcount: number
}

type WeeklyShiftRates = DailyShiftRates & { dayCount: number }

type RateKind = 'leave' | 'overtime' | 'net'

type ReportCategory = {
  id: string
  name: string
  groupNames: string[]
}


const REPORT_CATEGORY_STORAGE_KEY = 'shift-stats-report-categories-v1'

const RATE_LABELS: Record<RateKind, string> = {
  leave: '請假率',
  overtime: '加班率',
  net: '淨出席率',
}

/** 加班：各班別計數來源為對班人員（DB←DA、DA←DB、NA←NB、NB←NA） */
const OPPOSITE_SHIFT_LINE: Record<ShiftLine, ShiftLine> = {
  DA: 'DB',
  DB: 'DA',
  NA: 'NB',
  NB: 'NA',
}

const NET_RATE_WARNING_THRESHOLD = 0.95

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatCountRate(count: number, headcount: number, rate: number): string {
  return `${formatRate(rate)} (${count}/${headcount})`
}

function getRateFromDaily(r: DailyShiftRates, kind: RateKind): number {
  if (kind === 'leave') return r.leaveRate
  if (kind === 'overtime') return r.overtimeRate
  return r.netRate
}

function DailyRateTooltipContent({
  dateStr,
  shiftLine,
  rates,
  kind,
  rangeStart,
  rangeEnd,
  groupLabel,
}: {
  dateStr: string
  shiftLine: string
  rates: DailyShiftRates
  kind: RateKind
  rangeStart: string
  rangeEnd: string
  groupLabel?: string
}) {
  const label = RATE_LABELS[kind]
  const focused =
    kind === 'leave'
      ? formatCountRate(rates.leaveCount, rates.headcount, rates.leaveRate)
      : kind === 'overtime'
        ? formatCountRate(rates.overtimeCount, rates.headcount, rates.overtimeRate)
        : `${formatRate(rates.netRate)} ((${rates.headcount}+${rates.overtimeCount}-${rates.leaveCount})/${rates.headcount})`

  return (
    <div className="shift-stats-tooltip-inner">
      <div className="shift-stats-tooltip-title">{label} · 來源驗證</div>
      <div className="shift-stats-tooltip-meta">
        <div>篩選範圍：{rangeStart} ～ {rangeEnd}</div>
        <div>
          日期：{dateStr}｜班別：{shiftLine}
          {groupLabel ? `｜群組：${groupLabel}` : ''}
        </div>
      </div>
      <div className="shift-stats-tooltip-highlight">
        {label}：{focused}
      </div>
      <div className="shift-stats-tooltip-note">computeDailyShiftRates 當日數值</div>
      <ul className="shift-stats-tooltip-list">
        <li>
          當班人數：{rates.headcount}（users day_night + shift_type
          {groupLabel ? `，群組：${groupLabel}` : ''}）
        </li>
        <li>
          請假人數：{rates.leaveCount}（{shiftLine} 班
          {groupLabel ? ` [${groupLabel}]` : ''} is_not_workday=0 且非國定假日）
        </li>
        <li>
          加班人數：{rates.overtimeCount}（
          {OPPOSITE_SHIFT_LINE[shiftLine as ShiftLine] ?? '對班'} 班
          {groupLabel ? ` [${groupLabel}]` : ''} is_not_workday=1）
        </li>
        <li>請假率：{formatCountRate(rates.leaveCount, rates.headcount, rates.leaveRate)}</li>
        <li>加班率：{formatCountRate(rates.overtimeCount, rates.headcount, rates.overtimeRate)}</li>
        <li>
          淨出席率：{formatRate(rates.netRate)} ((
          {rates.headcount}+{rates.overtimeCount}-{rates.leaveCount})/{rates.headcount})
        </li>
      </ul>
    </div>
  )
}

function WeeklyRateTooltipContent({
  weekCode,
  weekDates,
  shiftLine,
  dailyRatesList,
  aggregated,
  kind,
  rangeStart,
  rangeEnd,
  groupLabel,
}: {
  weekCode: string
  weekDates: string[]
  shiftLine: string
  dailyRatesList: DailyShiftRates[]
  aggregated: WeeklyShiftRates
  kind: RateKind
  rangeStart: string
  rangeEnd: string
  groupLabel?: string
}) {
  const label = RATE_LABELS[kind]
  const weekStart = weekDates[0] ?? '—'
  const weekEnd = weekDates[weekDates.length - 1] ?? '—'
  const avgRate = getRateFromDaily(aggregated, kind)

  return (
    <div className="shift-stats-tooltip-inner">
      <div className="shift-stats-tooltip-title">{label} · 週彙總驗證</div>
      <div className="shift-stats-tooltip-meta">
        <div>篩選範圍：{rangeStart} ～ {rangeEnd}</div>
        <div>
          本週 w{weekCode}：{weekStart} ～ {weekEnd}（{aggregated.dayCount} 天）
        </div>
        <div>
          班別：{shiftLine}
          {groupLabel ? `｜群組：${groupLabel}` : ''}
        </div>
      </div>
      <div className="shift-stats-tooltip-highlight">
        週平均{label}：{formatRate(avgRate)}
      </div>
      <div className="shift-stats-tooltip-note">算法：各日 {label} 加總 ÷ 出現天數</div>
      <div className="shift-stats-tooltip-subtitle">每日明細（computeDailyShiftRates）</div>
      <ul className="shift-stats-tooltip-list shift-stats-tooltip-list-daily">
        {weekDates.map((dateStr, idx) => {
          const r = dailyRatesList[idx]
          if (!r || r.headcount === 0) {
            return (
              <li key={dateStr}>
                {dateStr} —（非當班日或該群組當班人數為0）
              </li>
            )
          }
          const dayValue =
            kind === 'leave'
              ? formatCountRate(r.leaveCount, r.headcount, r.leaveRate)
              : kind === 'overtime'
                ? formatCountRate(r.overtimeCount, r.headcount, r.overtimeRate)
                : `${formatRate(r.netRate)} ((${r.headcount}+${r.overtimeCount}-${r.leaveCount})/${r.headcount})`
          return (
            <li key={dateStr}>
              {dateStr} {label} {dayValue}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const RateTooltipLine: React.FC<{
  kind: RateKind
  displayValue: string
  suffix?: React.ReactNode
  tooltip: React.ReactNode
  valueClassName?: string
}> = ({ kind, displayValue, suffix, tooltip, valueClassName }) => (
  <span className="shift-stats-rate-tooltip-wrap">
    <span className="shift-stats-rate-line">
      {RATE_LABELS[kind]} <strong className={valueClassName}>{displayValue}</strong>
      {suffix}
    </span>
    <span className="shift-stats-rate-tooltip" role="tooltip">
      {tooltip}
    </span>
  </span>
)

function getShiftHeadcount(employees: User[], shiftLine: ShiftLine): number {
  return employees.filter(
    (e) => e.role !== 'admin' && employeeShiftLineLabel(e) === shiftLine
  ).length
}

function loadReportCategories(): ReportCategory[] {
  try {
    const stored = localStorage.getItem(REPORT_CATEGORY_STORAGE_KEY)
    if (!stored) return []

    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return []
      const category = item as Partial<ReportCategory>
      if (typeof category.name !== 'string' || !Array.isArray(category.groupNames)) return []

      return [{
        id: typeof category.id === 'string' && category.id ? category.id : `saved-category-${index}`,
        name: category.name,
        groupNames: category.groupNames.filter((groupName): groupName is string => typeof groupName === 'string'),
      }]
    })
  } catch (error) {
    console.warn('Failed to load report categories:', error)
    return []
  }
}

function createReportCategory(sequence: number): ReportCategory {
  return {
    id: `report-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `分類 ${sequence}`,
    groupNames: [],
  }
}

function computeDailyShiftRates(
  dateStr: string,
  shiftLine: ShiftLine,
  assignments: ShiftAssignment[],
  employees: User[],
  employeeMap: Map<string, User>,
  leaveTypeMap: Map<string, LeaveType>,
  calendarTag: { isHoliday?: boolean; shift_type?: string | null } | undefined,
  memberFilter?: (employee: User) => boolean
): DailyShiftRates {
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

function aggregateWeeklyRates(dailyRates: DailyShiftRates[]): WeeklyShiftRates {
  const valid = dailyRates.filter((d) => d.headcount > 0)
  if (valid.length === 0) {
    return { leaveRate: 0, overtimeRate: 0, netRate: 0, leaveCount: 0, overtimeCount: 0, headcount: 0, dayCount: 0 }
  }
  const leaveRate = valid.reduce((s, d) => s + d.leaveRate, 0) / valid.length
  const overtimeRate = valid.reduce((s, d) => s + d.overtimeRate, 0) / valid.length
  const netRate = valid.reduce((s, d) => s + d.netRate, 0) / valid.length
  const leaveCount = valid.reduce((s, d) => s + d.leaveCount, 0)
  const overtimeCount = valid.reduce((s, d) => s + d.overtimeCount, 0)
  const headcount = valid[0].headcount
  return { leaveRate, overtimeRate, netRate, leaveCount, overtimeCount, headcount, dayCount: valid.length }
}

const ShiftStatsReport: React.FC = () => {
  const { getShiftAssignments } = useShiftAssignmentsAPI()
  const { getLeaveTypes } = useShiftSettingAPI()
  const { getUsers } = useUsersAPI()
  const { getMonthMap } = useCalendarTags()
  const { user } = useAuth()
  const { get: getCache, set: setCache } = useMemoryCache()

  const today = new Date()
  const defaultStart = formatDateString(new Date(today.getFullYear(), today.getMonth(), 1))
  const defaultEnd = formatDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0))

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [shiftFilter, setShiftFilter] = useState<Record<ShiftLine, boolean>>({
    DA: true,
    DB: true,
    NA: true,
    NB: true,
  })
  const [groupFilter, setGroupFilter] = useState<string>('ALL')
  const [showCategoryManager, setShowCategoryManager] = useState<boolean>(false)

  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [reportCategories, setReportCategories] = useState<ReportCategory[]>(loadReportCategories)

  const [searchQuery, setSearchQuery] = useState('')
  const [columnFilters, setColumnFilters] = useState({
    shiftLine: '',
    name: '',
    group: '',
    overtimeCount: '',
    leaveCount: '',
  })

  type SortKey = 'shiftLine' | 'name' | 'group' | 'overtimeCount' | 'leaveCount' | 'previous30Hours'
  const [sortConfig, setSortConfig] = useState<{ key: SortKey | null, direction: 'asc' | 'desc' | null }>({
    key: null,
    direction: null,
  })

  // 匯出 Excel 彈窗狀態
  const [showExportModal, setShowExportModal] = useState(false)
  const initialExportYear = useMemo(() => {
    const d = new Date(startDate + 'T12:00:00')
    return !Number.isNaN(d.getTime()) ? d.getFullYear() : new Date().getFullYear()
  }, [startDate])
  const initialExportMonth = useMemo(() => {
    const d = new Date(startDate + 'T12:00:00')
    return !Number.isNaN(d.getTime()) ? d.getMonth() + 1 : new Date().getMonth() + 1
  }, [startDate])

  const [exportYear, setExportYear] = useState<number>(initialExportYear)
  const [exportMonth, setExportMonth] = useState<number>(initialExportMonth)
  const [exportScopeMode, setExportScopeMode] = useState<'CATEGORIES' | 'GROUPS'>('CATEGORIES')
  const [selectedExportCategoryIds, setSelectedExportCategoryIds] = useState<string[]>([])
  const [selectedExportGroups, setSelectedExportGroups] = useState<string[]>([])
  const [includeGrandTotal, setIncludeGrandTotal] = useState<boolean>(true)
  const [exporting, setExporting] = useState(false)
  const hasInitializedExportGroupsRef = useRef(false)
  const hasInitializedExportCategoryIdsRef = useRef(false)

  useEffect(() => {
    const d = new Date(startDate + 'T12:00:00')
    if (!Number.isNaN(d.getTime())) {
      setExportYear(d.getFullYear())
      setExportMonth(d.getMonth() + 1)
    }
  }, [startDate])

  const exportMonthInfo = useMemo(() => {
    return getProductionMonthInfo(exportYear, exportMonth)
  }, [exportYear, exportMonth])

  const handleExportExcel = () => {
    const isCategory = exportScopeMode === 'CATEGORIES' && reportCategories.length > 0
    if (isCategory && selectedExportCategoryIds.length === 0 && !includeGrandTotal) {
      alert('請至少勾選一個自定義分類，或勾選包含全廠 Total！')
      return
    }
    if (!isCategory && selectedExportGroups.length === 0 && !includeGrandTotal) {
      alert('請至少勾選一個群組，或勾選包含全廠 Total！')
      return
    }

    try {
      setExporting(true)
      downloadShiftStatsWorkbook({
        monthInfo: exportMonthInfo,
        assignments,
        employees,
        leaveTypes,
        calendarTagGetter,
        categories: reportCategories,
        selectedCategoryIds: selectedExportCategoryIds,
        selectedGroups: selectedExportGroups,
        exportScopeMode,
        includeGrandTotal,
      })
      setShowExportModal(false)
    } catch (err) {
      console.error('Export error:', err)
      alert('匯出 Excel 失敗: ' + (err instanceof Error ? err.message : '未知錯誤'))
    } finally {
      setExporting(false)
    }
  }

  const handleOpenExportModal = () => {
    if (reportCategories.length > 0) {
      setExportScopeMode('CATEGORIES')
      if (selectedExportCategoryIds.length === 0) {
        setSelectedExportCategoryIds(reportCategories.map((c) => c.id))
      }
    } else {
      setExportScopeMode('GROUPS')
      if (selectedExportGroups.length === 0 && availableUserGroups.length > 0) {
        setSelectedExportGroups(availableUserGroups.map((g) => g.name))
      }
    }
    setShowExportModal(true)
  }

  useEffect(() => {
    if (!user?.user_id) return

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

        const allAssignments: ShiftAssignment[] = []
        for (const u of users) {
          if (u.role === 'admin') continue
          try {
            const cacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(u.employee_id)
            let userAssignments = getCache<ShiftAssignment[]>(cacheKey)
            if (!userAssignments) {
              userAssignments = await getShiftAssignments(u.employee_id)
              setCache(cacheKey, userAssignments, CACHE_TTL.SHIFT_ASSIGNMENTS)
            }
            allAssignments.push(...userAssignments)
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
  }, [user?.user_id])

  useEffect(() => {
    try {
      localStorage.setItem(REPORT_CATEGORY_STORAGE_KEY, JSON.stringify(reportCategories))
    } catch (error) {
      console.warn('Failed to save report categories:', error)
    }
  }, [reportCategories])

  const leaveTypeMap = useMemo(
    () => new Map(leaveTypes.map((lt) => [lt.name, lt])),
    [leaveTypes]
  )

  const employeeMap = useMemo(
    () => new Map(employees.map((e) => [e.employee_id, e])),
    [employees]
  )

  const selectedShiftLines = useMemo(
    () => SHIFT_LINES.filter((s) => shiftFilter[s]),
    [shiftFilter]
  )

  const availableUserGroups = useMemo(() => {
    const groupCounts = new Map<string, number>()
    for (const employee of employees) {
      if (employee.role === 'admin') continue
      const groupName = employee.group?.trim() || '未定義'
      groupCounts.set(groupName, (groupCounts.get(groupName) ?? 0) + 1)
    }
    return [...groupCounts.entries()]
      .map(([name, memberCount]) => ({ name, memberCount }))
      .sort((a, b) => {
        if (a.name === 'G1') return -1
        if (b.name === 'G1') return 1
        if (a.name === 'G2') return -1
        if (b.name === 'G2') return 1
        return a.name.localeCompare(b.name, 'zh-Hant')
      })
  }, [employees])

  useEffect(() => {
    if (!hasInitializedExportGroupsRef.current && availableUserGroups.length > 0) {
      setSelectedExportGroups(availableUserGroups.map((g) => g.name))
      hasInitializedExportGroupsRef.current = true
    }
  }, [availableUserGroups])

  useEffect(() => {
    if (!hasInitializedExportCategoryIdsRef.current && reportCategories.length > 0) {
      setSelectedExportCategoryIds(reportCategories.map((c) => c.id))
      hasInitializedExportCategoryIdsRef.current = true
    }
  }, [reportCategories])

  const addReportCategory = () => {
    setReportCategories((current) => [...current, createReportCategory(current.length + 1)])
    setShowCategoryManager(true)
  }

  const updateReportCategoryName = (categoryId: string, name: string) => {
    setReportCategories((current) =>
      current.map((category) => category.id === categoryId ? { ...category, name } : category)
    )
  }

  const toggleReportCategoryGroup = (categoryId: string, groupName: string) => {
    setReportCategories((current) =>
      current.map((category) => {
        if (category.id !== categoryId) return category
        const isSelected = category.groupNames.includes(groupName)
        return {
          ...category,
          groupNames: isSelected
            ? category.groupNames.filter((name) => name !== groupName)
            : [...category.groupNames, groupName],
        }
      })
    )
  }

  const removeReportCategory = (categoryId: string) => {
    setReportCategories((current) => current.filter((category) => category.id !== categoryId))
  }

  type ReportColumn = {
    id: string
    shiftLine: ShiftLine
    groupLabel?: string
    columnTitle: string
    memberFilter: (employee: User) => boolean
  }

  const reportColumns = useMemo<ReportColumn[]>(() => {
    // 1. ALL: 全部群組 (全員)
    if (groupFilter === 'ALL') {
      return selectedShiftLines.map((sl) => ({
        id: sl,
        shiftLine: sl,
        columnTitle: sl,
        memberFilter: () => true,
      }))
    }

    // 2. Specific custom category (e.g. "category:id", 如「一課」)
    if (groupFilter.startsWith('category:')) {
      const catId = groupFilter.replace('category:', '')
      const cat = reportCategories.find((c) => c.id === catId)
      const catName = cat?.name.trim() || '自訂分類'
      const groupSet = new Set(cat?.groupNames ?? [])
      return selectedShiftLines.map((sl) => ({
        id: `${sl}-cat-${catId}`,
        shiftLine: sl,
        groupLabel: catName,
        columnTitle: `${sl}-${catName}`,
        memberFilter: (emp: User) => groupSet.has(emp.group?.trim() || '未定義'),
      }))
    }

    // 3. Specific user group (e.g. "group:G1")
    if (groupFilter.startsWith('group:')) {
      const groupName = groupFilter.replace('group:', '')
      return selectedShiftLines.map((sl) => ({
        id: `${sl}-grp-${groupName}`,
        shiftLine: sl,
        groupLabel: groupName,
        columnTitle: `${sl}-${groupName}`,
        memberFilter: (emp: User) => (emp.group?.trim() || '未定義') === groupName,
      }))
    }

    // 4. EXPAND_CATEGORIES: 各自訂分類展開 (如 DA-一課, DB-一課, NA-一課, NB-一課, DA-二課...)
    if (groupFilter === 'EXPAND_CATEGORIES' && reportCategories.length > 0) {
      const cols: ReportColumn[] = []
      for (const cat of reportCategories) {
        const catName = cat.name.trim() || '未命名分類'
        const groupSet = new Set(cat.groupNames)
        for (const sl of selectedShiftLines) {
          cols.push({
            id: `${sl}-cat-${cat.id}`,
            shiftLine: sl,
            groupLabel: catName,
            columnTitle: `${sl}-${catName}`,
            memberFilter: (emp: User) => groupSet.has(emp.group?.trim() || '未定義'),
          })
        }
      }
      return cols
    }

    // 5. EXPAND_GROUPS: 各 users.group 展開 (如 DA-G1, NB-G1, DA-G2, NB-G2...)
    if (groupFilter === 'EXPAND_GROUPS' && availableUserGroups.length > 0) {
      const cols: ReportColumn[] = []
      for (const g of availableUserGroups) {
        for (const sl of selectedShiftLines) {
          cols.push({
            id: `${sl}-grp-${g.name}`,
            shiftLine: sl,
            groupLabel: g.name,
            columnTitle: `${sl}-${g.name}`,
            memberFilter: (emp: User) => (emp.group?.trim() || '未定義') === g.name,
          })
        }
      }
      return cols
    }

    return selectedShiftLines.map((sl) => ({
      id: sl,
      shiftLine: sl,
      columnTitle: sl,
      memberFilter: () => true,
    }))
  }, [groupFilter, selectedShiftLines, reportCategories, availableUserGroups])

  const rangeDates = useMemo(() => buildDateRange(startDate, endDate), [startDate, endDate])

  const calendarTagGetter = useMemo(() => {
    const cache = new Map<string, Record<string, { isHoliday?: boolean; pattern?: string | null; shift_type?: string | null }>>()
    return (dateStr: string) => {
      const d = new Date(dateStr + 'T12:00:00')
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!cache.has(key)) {
        cache.set(key, getMonthMap(d.getFullYear(), d.getMonth()))
      }
      return cache.get(key)?.[dateStr]
    }
  }, [getMonthMap, startDate, endDate])

  /** 區域一：各人員統計（支援依群組篩選） */
  const employeeSummaryRows = useMemo(() => {
    const rows: Array<{
      shiftLine: string
      name: string
      group: string
      employeeId: string
      overtimeCount: number
      leaveCount: number
      previous30Hours: number | null
    }> = []

    const groupMatcher = (emp: User): boolean => {
      if (groupFilter === 'ALL' || groupFilter.startsWith('EXPAND_')) return true
      if (groupFilter.startsWith('group:')) {
        const gName = groupFilter.replace('group:', '')
        return (emp.group?.trim() || '未定義') === gName
      }
      if (groupFilter.startsWith('category:')) {
        const catId = groupFilter.replace('category:', '')
        const cat = reportCategories.find((c) => c.id === catId)
        const set = new Set(cat?.groupNames ?? [])
        return set.has(emp.group?.trim() || '未定義')
      }
      return true
    }

    const filteredEmployees = employees.filter((e) => {
      if (e.role === 'admin') return false
      const line = employeeShiftLineLabel(e) as ShiftLine
      if (!selectedShiftLines.includes(line)) return false
      if (!groupMatcher(e)) return false
      return true
    })

    for (const emp of filteredEmployees) {
      const empAssignments = assignments.filter(
        (a) =>
          a.employee_id === emp.employee_id &&
          a.date >= startDate &&
          a.date <= endDate
      )

      let overtimeCount = 0
      let leaveCount = 0

      for (const a of empAssignments) {
        const lt = leaveTypeMap.get(a.shift_type)
        if (!lt) continue
        if (lt.is_not_workday === 1) overtimeCount++
        else if (lt.is_not_workday === 0) leaveCount++
      }

      let previous30Hours: number | null = null
      if (emp.shift_type) {
        const est = computePrevious30DaysEstimatedHours(
          emp.shift_type,
          emp.employee_id,
          assignments,
          leaveTypeMap,
          getMonthMap
        )
        previous30Hours = est.hours
      }

      rows.push({
        shiftLine: employeeShiftLineLabel(emp),
        name: emp.name,
        group: emp.group?.trim() || '未定義',
        employeeId: emp.employee_id,
        overtimeCount,
        leaveCount,
        previous30Hours,
      })
    }

    return rows.sort((a, b) => {
      const lineCmp = a.shiftLine.localeCompare(b.shiftLine, 'en')
      if (lineCmp !== 0) return lineCmp
      return a.name.localeCompare(b.name, 'zh-Hant')
    })
  }, [employees, assignments, leaveTypeMap, startDate, endDate, selectedShiftLines, getMonthMap, groupFilter, reportCategories])

  const filteredAndSearchedRows = useMemo(() => {
    let result = employeeSummaryRows.filter(row => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!row.name.toLowerCase().includes(q) && !row.shiftLine.toLowerCase().includes(q) && !row.group.toLowerCase().includes(q)) {
          return false
        }
      }
      if (columnFilters.shiftLine && !row.shiftLine.toLowerCase().includes(columnFilters.shiftLine.toLowerCase())) return false;
      if (columnFilters.name && !row.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.group && !row.group.toLowerCase().includes(columnFilters.group.toLowerCase())) return false;
      if (columnFilters.overtimeCount && row.overtimeCount.toString() !== columnFilters.overtimeCount) return false;
      if (columnFilters.leaveCount && row.leaveCount.toString() !== columnFilters.leaveCount) return false;
      return true
    })

    if (sortConfig.key && sortConfig.direction) {
      result = [...result].sort((a, b) => {
        let valA: any = a[sortConfig.key!]
        let valB: any = b[sortConfig.key!]

        if (valA === null) valA = 0
        if (valB === null) valB = 0

        if (valA < valB) {
          return sortConfig.direction === 'asc' ? -1 : 1
        }
        if (valA > valB) {
          return sortConfig.direction === 'asc' ? 1 : -1
        }
        return 0
      })
    }

    return result
  }, [employeeSummaryRows, searchQuery, columnFilters, sortConfig])

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' }
        if (prev.direction === 'desc') return { key: null, direction: null }
      }
      return { key, direction: 'asc' }
    })
  }

  const getSortIcon = (key: SortKey) => {
    if (sortConfig.key !== key || !sortConfig.direction) {
      return <span className="sort-icon inactive">↕</span>
    }
    return sortConfig.direction === 'asc' ? <span className="sort-icon">↑</span> : <span className="sort-icon">↓</span>
  }

  /** 區域二：每日各班別比率（依 reportColumns 計算，支援群組過濾） */
  const dailyRatesByDate = useMemo(() => {
    const map = new Map<string, Record<string, DailyShiftRates>>()
    for (const date of rangeDates) {
      const dateStr = formatDateString(date)
      const tag = calendarTagGetter(dateStr)
      const dayRates: Record<string, DailyShiftRates> = {}
      for (const col of reportColumns) {
        dayRates[col.id] = computeDailyShiftRates(
          dateStr,
          col.shiftLine,
          assignments,
          employees,
          employeeMap,
          leaveTypeMap,
          tag,
          col.memberFilter
        )
      }
      map.set(dateStr, dayRates)
    }
    return map
  }, [rangeDates, reportColumns, assignments, employees, employeeMap, leaveTypeMap, calendarTagGetter])

  /** 區域二：週彙總（依週碼分組，各班別平均日比率） */
  const weeklyRatesByCode = useMemo(() => {
    const weekMap = new Map<
      string,
      {
        weekYear: number
        week: number
        dates: string[]
        rates: Record<string, DailyShiftRates[]>
      }
    >()

    for (const date of rangeDates) {
      const dateStr = formatDateString(date)
      const { weekYear, week } = getSundayWeek(date)
      const key = `${weekYear}-${week}`

      if (!weekMap.has(key)) {
        weekMap.set(key, {
          weekYear,
          week,
          dates: [],
          rates: {},
        })
      }
      const entry = weekMap.get(key)!
      entry.dates.push(dateStr)
      const dayRates = dailyRatesByDate.get(dateStr)!
      for (const col of reportColumns) {
        if (!entry.rates[col.id]) {
          entry.rates[col.id] = []
        }
        entry.rates[col.id].push(dayRates[col.id])
      }
    }

    return [...weekMap.entries()]
      .sort((a, b) => {
        if (a[1].weekYear !== b[1].weekYear) return a[1].weekYear - b[1].weekYear
        return a[1].week - b[1].week
      })
      .map(([key, entry]) => {
        const weekCode = `${entry.weekYear % 10}${String(entry.week).padStart(2, '0')}`
        const aggregated: Record<string, WeeklyShiftRates> = {}
        for (const col of reportColumns) {
          aggregated[col.id] = aggregateWeeklyRates(entry.rates[col.id] ?? [])
        }
        return { key, weekCode, ...entry, aggregated }
      })
  }, [rangeDates, dailyRatesByDate, reportColumns])

  const getDayName = (date: Date): string => {
    const days = ['日', '一', '二', '三', '四', '五', '六']
    return days[date.getDay()]
  }

  if (loading) {
    return <div className="shift-stats-report shift-stats-loading">載入中...</div>
  }

  return (
    <div className="shift-stats-report">
      <div className="shift-stats-header">
        <h1 className="shift-stats-title">班別統計報表</h1>
        <div className="shift-stats-filters">
          <div className="group-filters">
            {SHIFT_LINES.map((k) => (
              <label key={k} className="group-filter-label">
                <input
                  type="checkbox"
                  checked={shiftFilter[k]}
                  onChange={(e) => setShiftFilter((prev) => ({ ...prev, [k]: e.target.checked }))}
                />
                {k}
              </label>
            ))}
          </div>
          <label className="shift-stats-date-field">
            群組篩選
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="ALL">全部群組 (全員)</option>
              {availableUserGroups.length > 0 && (
                <optgroup label="人員群組 (users.group)">
                  {availableUserGroups.map((g) => (
                    <option key={g.name} value={`group:${g.name}`}>
                      {g.name} ({g.memberCount} 人)
                    </option>
                  ))}
                </optgroup>
              )}
              {reportCategories.length > 0 && (
                <optgroup label="自訂分類">
                  {reportCategories.map((c) => (
                    <option key={c.id} value={`category:${c.id}`}>
                      {c.name} ({c.groupNames.join('、') || '未設定群組'})
                    </option>
                  ))}
                </optgroup>
              )}
              {(availableUserGroups.length > 1 || reportCategories.length > 1) && (
                <optgroup label="多欄展開">
                  {reportCategories.length > 0 ? (
                    <option value="EXPAND_CATEGORIES">依自訂分類展開所有班別 (如：NB-一課)</option>
                  ) : (
                    <option value="EXPAND_GROUPS">依各群組展開所有班別 (如：NB-G1)</option>
                  )}
                </optgroup>
              )}
            </select>
          </label>
          <label className="shift-stats-date-field">
            起始日期
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="shift-stats-date-field">
            終止日期
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="shift-stats-export-btn"
            onClick={handleOpenExportModal}
            title="匯出符合指定格式的 Excel 活頁簿（含月份總結與各週獨立 Sheet）"
          >
            📊 匯出出勤統計 Excel
          </button>
        </div>
      </div>

      {/* 區域一：人員統計表 */}
      <section className="shift-stats-section">
        <h2 className="shift-stats-section-title">
          區域一 · 人員排班統計（{startDate} ～ {endDate}）
        </h2>
        <div className="table-search-panel">
          <input
            type="text"
            placeholder="全域搜尋 (姓名、班別、群組)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="shift-stats-table-wrap">
          <table className="shift-stats-table">
            <thead>
              <tr>
                <th className="sortable-header" onClick={() => handleSort('shiftLine')}>
                  班別 {getSortIcon('shiftLine')}
                </th>
                <th className="sortable-header" onClick={() => handleSort('name')}>
                  姓名 {getSortIcon('name')}
                </th>
                <th className="sortable-header" onClick={() => handleSort('group')}>
                  群組 {getSortIcon('group')}
                </th>
                <th className="num-cell sortable-header" onClick={() => handleSort('overtimeCount')}>
                  加班次數 {getSortIcon('overtimeCount')}
                </th>
                <th className="num-cell sortable-header" onClick={() => handleSort('leaveCount')}>
                  請假次數 {getSortIcon('leaveCount')}
                </th>
                <th className="sortable-header" onClick={() => handleSort('previous30Hours')}>
                  30日內(不含今日)估算 {getSortIcon('previous30Hours')}
                </th>
              </tr>
              <tr className="filter-row">
                <th>
                  <input type="text" placeholder="過濾..." value={columnFilters.shiftLine} onChange={e => setColumnFilters({ ...columnFilters, shiftLine: e.target.value })} />
                </th>
                <th>
                  <input type="text" placeholder="過濾..." value={columnFilters.name} onChange={e => setColumnFilters({ ...columnFilters, name: e.target.value })} />
                </th>
                <th>
                  <input type="text" placeholder="過濾..." value={columnFilters.group} onChange={e => setColumnFilters({ ...columnFilters, group: e.target.value })} />
                </th>
                <th className="num-cell">
                  <input type="text" placeholder="過濾..." value={columnFilters.overtimeCount} onChange={e => setColumnFilters({ ...columnFilters, overtimeCount: e.target.value })} className="num-filter" />
                </th>
                <th className="num-cell">
                  <input type="text" placeholder="過濾..." value={columnFilters.leaveCount} onChange={e => setColumnFilters({ ...columnFilters, leaveCount: e.target.value })} className="num-filter" />
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSearchedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="shift-stats-empty-row">查無相符資料</td>
                </tr>
              ) : (
                filteredAndSearchedRows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>{row.shiftLine}</td>
                    <td>{row.name}</td>
                    <td>{row.group}</td>
                    <td className="num-cell">{row.overtimeCount}</td>
                    <td className="num-cell">{row.leaveCount}</td>
                    <td className="hours-cell">
                      {row.previous30Hours != null ? `${row.previous30Hours}h` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 區域二：週彙總 */}
      <section className="shift-stats-section">
        <h2 className="shift-stats-section-title">區域二 · 週別出勤比率（w601 等週碼）</h2>
        {weeklyRatesByCode.length === 0 ? (
          <div className="shift-stats-empty">請選擇有效日期範圍</div>
        ) : (
          <div className="shift-stats-weekly-grid">
            {weeklyRatesByCode.map((week) => (
              <div key={week.key} className="shift-stats-week-card">
                <div
                  className="shift-stats-week-card-head"
                  title={`第 ${week.week} 週 / ${week.weekYear}`}
                >
                  w{week.weekCode}
                </div>
                {reportColumns.map((col) => {
                  const r = week.aggregated[col.id]
                  if (!r || r.dayCount === 0) return null
                  const dailyList = week.rates[col.id] ?? []
                  return (
                    <div key={col.id}>
                      <div className="shift-stats-week-card-shift">{col.columnTitle}</div>
                      <RateTooltipLine
                        kind="leave"
                        displayValue={formatRate(r.leaveRate)}
                        tooltip={
                          <WeeklyRateTooltipContent
                            weekCode={week.weekCode}
                            weekDates={week.dates}
                            shiftLine={col.columnTitle}
                            groupLabel={col.groupLabel}
                            dailyRatesList={dailyList}
                            aggregated={r}
                            kind="leave"
                            rangeStart={startDate}
                            rangeEnd={endDate}
                          />
                        }
                      />
                      <RateTooltipLine
                        kind="overtime"
                        displayValue={formatRate(r.overtimeRate)}
                        tooltip={
                          <WeeklyRateTooltipContent
                            weekCode={week.weekCode}
                            weekDates={week.dates}
                            shiftLine={col.columnTitle}
                            groupLabel={col.groupLabel}
                            dailyRatesList={dailyList}
                            aggregated={r}
                            kind="overtime"
                            rangeStart={startDate}
                            rangeEnd={endDate}
                          />
                        }
                      />
                      <RateTooltipLine
                        kind="net"
                        displayValue={formatRate(r.netRate)}
                        valueClassName={r.netRate < NET_RATE_WARNING_THRESHOLD ? 'shift-stats-rate-low' : undefined}
                        tooltip={
                          <WeeklyRateTooltipContent
                            weekCode={week.weekCode}
                            weekDates={week.dates}
                            shiftLine={col.columnTitle}
                            groupLabel={col.groupLabel}
                            dailyRatesList={dailyList}
                            aggregated={r}
                            kind="net"
                            rangeStart={startDate}
                            rangeEnd={endDate}
                          />
                        }
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 區域二：每日明細（週碼條 + 各班別） */}
      <section className="shift-stats-section">
        <h2 className="shift-stats-section-title">區域二 · 每日各班別比率明細</h2>
        <div className="shift-stats-category-manager">
          <div>
            <h3 className="shift-stats-category-manager-title">自訂人員分類管理</h3>
            <p className="shift-stats-category-manager-hint">
              可依 users.group 建立分類（例如建立「一課」並勾選 G1、G2）。上方「群組篩選」即可直接選擇「一課」，查看如 NB-一課 的各班別出勤率、請假人數與加班人數。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              className="shift-stats-category-add-button"
              onClick={() => setShowCategoryManager((prev) => !prev)}
            >
              {showCategoryManager ? '收合設定' : '管理分類'}
            </button>
            {showCategoryManager && (
              <button type="button" className="shift-stats-category-add-button" onClick={addReportCategory}>
                + 新增分類
              </button>
            )}
          </div>
        </div>

        {showCategoryManager && reportCategories.length > 0 && (
          <div className="shift-stats-category-editor-list">
            {reportCategories.map((category) => (
              <div key={category.id} className="shift-stats-category-editor">
                <div className="shift-stats-category-editor-head">
                  <label className="shift-stats-category-name-field">
                    分類名稱
                    <input
                      type="text"
                      value={category.name}
                      onChange={(event) => updateReportCategoryName(category.id, event.target.value)}
                      placeholder="例如：一課"
                      aria-label="分類名稱"
                    />
                  </label>
                  <button
                    type="button"
                    className="shift-stats-category-remove-button"
                    onClick={() => removeReportCategory(category.id)}
                  >
                    刪除分類
                  </button>
                </div>
                <div className="shift-stats-category-groups" aria-label={`${category.name || '未命名分類'} 的 users 群組`}>
                  {availableUserGroups.length === 0 ? (
                    <span className="shift-stats-category-no-groups">目前沒有可選的 users.group</span>
                  ) : (
                    availableUserGroups.map(({ name, memberCount }) => (
                      <label key={name} className="shift-stats-category-group-option">
                        <input
                          type="checkbox"
                          checked={category.groupNames.includes(name)}
                          onChange={() => toggleReportCategoryGroup(category.id, name)}
                        />
                        <span>{name}</span>
                        <small>{memberCount} 人</small>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {rangeDates.length === 0 ? (
          <div className="shift-stats-empty">請選擇有效日期範圍</div>
        ) : (
          <div className="shift-stats-daily-table">
            <div className="shift-stats-daily-header">
              <div className="week-rail" />
              <div className="shift-stats-date-col">日期</div>
              <div className="shift-stats-shift-cols">
                {reportColumns.map((col) => (
                  <div key={col.id} className="shift-stats-shift-cell">
                    {col.columnTitle}
                  </div>
                ))}
              </div>
            </div>
            {rangeDates.map((date) => {
              const dateStr = formatDateString(date)
              const dayRates = dailyRatesByDate.get(dateStr)!
              const tag = calendarTagGetter(dateStr)
              const rowClass = `shift-stats-date-row ${tag?.shift_type === 'A' ? 'shift-type-a' : ''}`
              return (
                <div key={dateStr} className={rowClass}>
                  <div
                    className={`week-rail ${isWeekStart(date) ? 'is-week-start' : ''}`}
                    title={`第 ${getSundayWeek(date).week} 週 / ${getSundayWeek(date).weekYear}`}
                  >
                    <span className="week-rail-code">{formatWeekCode(date)}</span>
                  </div>
                  <div className="shift-stats-date-col">
                    <span className="day-name">{getDayName(date)}</span>
                    <span className="day-number">{date.getDate()}</span>
                  </div>
                  <div className="shift-stats-shift-cols">
                    {reportColumns.map((col) => {
                      const r = dayRates[col.id]
                      if (!r || r.headcount === 0) {
                        return (
                          <div key={col.id} className="shift-stats-shift-cell">
                            <div className="shift-stats-shift-cell-head">{col.columnTitle}</div>
                            <span className="shift-stats-rate-line">—</span>
                          </div>
                        )
                      }
                      return (
                        <div key={col.id} className="shift-stats-shift-cell">
                          <div className="shift-stats-shift-cell-head">{col.columnTitle}</div>
                          <RateTooltipLine
                            kind="leave"
                            displayValue={formatRate(r.leaveRate)}
                            suffix={
                              <span className="shift-stats-rate-count">
                                {' '}({r.leaveCount}/{r.headcount})
                              </span>
                            }
                            tooltip={
                              <DailyRateTooltipContent
                                dateStr={dateStr}
                                shiftLine={col.shiftLine}
                                groupLabel={col.groupLabel}
                                rates={r}
                                kind="leave"
                                rangeStart={startDate}
                                rangeEnd={endDate}
                              />
                            }
                          />
                          <RateTooltipLine
                            kind="overtime"
                            displayValue={formatRate(r.overtimeRate)}
                            suffix={
                              <span className="shift-stats-rate-count">
                                {' '}({r.overtimeCount}/{r.headcount})
                              </span>
                            }
                            tooltip={
                              <DailyRateTooltipContent
                                dateStr={dateStr}
                                shiftLine={col.shiftLine}
                                groupLabel={col.groupLabel}
                                rates={r}
                                kind="overtime"
                                rangeStart={startDate}
                                rangeEnd={endDate}
                              />
                            }
                          />
                          <RateTooltipLine
                            kind="net"
                            displayValue={formatRate(r.netRate)}
                            valueClassName={r.netRate < NET_RATE_WARNING_THRESHOLD ? 'shift-stats-rate-low' : undefined}
                            tooltip={
                              <DailyRateTooltipContent
                                dateStr={dateStr}
                                shiftLine={col.shiftLine}
                                groupLabel={col.groupLabel}
                                rates={r}
                                kind="net"
                                rangeStart={startDate}
                                rangeEnd={endDate}
                              />
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 匯出出勤統計 Excel 彈窗 */}
      {showExportModal && (
        <div className="shift-stats-modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="shift-stats-modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="shift-stats-modal-title">
              <span>📊</span> 匯出出勤統計 Excel（週 / 月報表）
            </h2>

            <div className="shift-stats-modal-fields">
              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="shift-stats-modal-field" style={{ flex: 1 }}>
                  <label>年份</label>
                  <select
                    value={exportYear}
                    onChange={(e) => setExportYear(Number(e.target.value))}
                  >
                    {[2024, 2025, 2026, 2027, 2028].map((y) => (
                      <option key={y} value={y}>
                        {y} 年
                      </option>
                    ))}
                  </select>
                </div>
                <div className="shift-stats-modal-field" style={{ flex: 1 }}>
                  <label>月份（生產月）</label>
                  <select
                    value={exportMonth}
                    onChange={(e) => setExportMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m} 月
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="shift-stats-modal-field">
                <div className="shift-stats-scope-tabs">
                  <button
                    type="button"
                    className={`shift-stats-scope-tab ${exportScopeMode === 'CATEGORIES' ? 'active' : ''}`}
                    onClick={() => setExportScopeMode('CATEGORIES')}
                  >
                    🏷️ 自定義分類（{reportCategories.length}）
                  </button>
                  <button
                    type="button"
                    className={`shift-stats-scope-tab ${exportScopeMode === 'GROUPS' ? 'active' : ''}`}
                    onClick={() => setExportScopeMode('GROUPS')}
                  >
                    👥 原始群組（{availableUserGroups.length}）
                  </button>
                </div>

                {exportScopeMode === 'CATEGORIES' ? (
                  reportCategories.length === 0 ? (
                    <div className="shift-stats-category-empty-notice">
                      <div>💡 <strong>尚未建立自定義分類</strong></div>
                      <div>
                        您可以在報表的「管理分類」中新增自定義分類（例如：一課、二課，並於 <code>shift-stats-category-name-field</code> 輸入名稱及挑選群組），各分類名稱將作為 Excel 的「分類」列。
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          addReportCategory()
                        }}
                      >
                        + 立即新增第一個分類
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="shift-stats-group-selector-header">
                        <label style={{ margin: 0, fontWeight: 600 }}>
                          自定義分類（已選 {selectedExportCategoryIds.length} / {reportCategories.length} 個分類
                          {includeGrandTotal ? ' ＋ 全廠 Total' : ''}）
                        </label>
                        <div className="shift-stats-group-quick-actions">
                          <button
                            type="button"
                            className="shift-stats-group-quick-btn"
                            onClick={() =>
                              setSelectedExportCategoryIds(reportCategories.map((c) => c.id))
                            }
                            title="勾選全部自定義分類"
                          >
                            全選
                          </button>
                          <button
                            type="button"
                            className="shift-stats-group-quick-btn"
                            onClick={() => setSelectedExportCategoryIds([])}
                            title="清除選取的分類"
                          >
                            清空
                          </button>
                        </div>
                      </div>

                      <div className="shift-stats-group-checkbox-grid">
                        {reportCategories.map((cat) => {
                          const checked = selectedExportCategoryIds.includes(cat.id)
                          const groupSet = new Set(cat.groupNames)
                          const count = employees.filter(
                            (e) => e.role !== 'admin' && groupSet.has(e.group?.trim() || '未定義')
                          ).length
                          const catName = cat.name.trim() || '未命名分類'
                          const groupDesc = cat.groupNames.length > 0 ? cat.groupNames.join(', ') : '未設定群組'
                          return (
                            <label
                              key={cat.id}
                              className="shift-stats-group-checkbox-item"
                              title={`包含群組: ${groupDesc} (${count}人)`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedExportCategoryIds((prev) => [...prev, cat.id])
                                  } else {
                                    setSelectedExportCategoryIds((prev) =>
                                      prev.filter((id) => id !== cat.id)
                                    )
                                  }
                                }}
                              />
                              <strong>{catName}</strong>
                              <span className="shift-stats-group-checkbox-badge">
                                ({count}人 · {groupDesc})
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <div className="shift-stats-group-selector-header">
                      <label style={{ margin: 0, fontWeight: 600 }}>
                        原始群組範圍（已選 {selectedExportGroups.length} 個群組
                        {includeGrandTotal ? ' ＋ 全廠 Total' : ''}）
                      </label>
                      <div className="shift-stats-group-quick-actions">
                        <button
                          type="button"
                          className="shift-stats-group-quick-btn"
                          onClick={() =>
                            setSelectedExportGroups(availableUserGroups.map((g) => g.name))
                          }
                          title="勾選全部群組"
                        >
                          全選
                        </button>
                        <button
                          type="button"
                          className="shift-stats-group-quick-btn"
                          onClick={() => setSelectedExportGroups([])}
                          title="清除勾選群組"
                        >
                          清空
                        </button>
                        {availableUserGroups.some((g) => g.name === 'G1' || g.name === 'G2') && (
                          <button
                            type="button"
                            className="shift-stats-group-quick-btn"
                            onClick={() =>
                              setSelectedExportGroups(
                                availableUserGroups
                                  .filter((g) => ['G1', 'G2'].includes(g.name))
                                  .map((g) => g.name)
                              )
                            }
                            title="僅選 G1 和 G2 群組"
                          >
                            僅 G1/G2
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="shift-stats-group-checkbox-grid">
                      {availableUserGroups.length === 0 ? (
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>暫無群組資料</span>
                      ) : (
                        availableUserGroups.map(({ name, memberCount }) => {
                          const checked = selectedExportGroups.includes(name)
                          return (
                            <label key={name} className="shift-stats-group-checkbox-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedExportGroups((prev) => [...prev, name])
                                  } else {
                                    setSelectedExportGroups((prev) =>
                                      prev.filter((g) => g !== name)
                                    )
                                  }
                                }}
                              />
                              <span>{name}</span>
                              <span className="shift-stats-group-checkbox-badge">
                                ({memberCount}人)
                              </span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </>
                )}

                <label className="shift-stats-grand-total-option">
                  <input
                    type="checkbox"
                    checked={includeGrandTotal}
                    onChange={(e) => setIncludeGrandTotal(e.target.checked)}
                  />
                  <span>
                    包含<strong>全廠 Total</strong>（含日班 Total D、夜班 Total N 小計匯總行）
                  </span>
                </label>
              </div>

              <div className="shift-stats-preview-card">
                <div>
                  <strong>月份 Sheet：</strong>
                  <span className="shift-stats-preview-tag">{exportMonthInfo.sheetName}</span>
                  <span>（計算區間：{exportMonthInfo.rangeLabel}）</span>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <strong>週別 Sheets：</strong>
                  {exportMonthInfo.weeks.map((w) => (
                    <span key={w.sheetName} className="shift-stats-preview-tag">
                      {w.sheetName}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: '8px' }}>
                  <strong>匯出範圍：</strong>
                  {exportScopeMode === 'CATEGORIES' && reportCategories.length > 0 ? (
                    selectedExportCategoryIds.length === 0 && !includeGrandTotal ? (
                      <span style={{ color: '#ef4444', fontSize: '12px' }}>
                        ⚠️ 尚未勾選任何自定義分類或 Total，請至少選取一項
                      </span>
                    ) : (
                      <>
                        {selectedExportCategoryIds.map((id) => {
                          const cat = reportCategories.find((c) => c.id === id)
                          return (
                            <span key={id} className="shift-stats-preview-tag">
                              🏷️ {cat?.name.trim() || '自訂分類'}
                            </span>
                          )
                        })}
                        {includeGrandTotal && (
                          <span
                            className="shift-stats-preview-tag"
                            style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
                          >
                            Total (全廠)
                          </span>
                        )}
                      </>
                    )
                  ) : (
                    selectedExportGroups.length === 0 && !includeGrandTotal ? (
                      <span style={{ color: '#ef4444', fontSize: '12px' }}>
                        ⚠️ 尚未勾選任何群組或 Total，請至少選取一項
                      </span>
                    ) : (
                      <>
                        {selectedExportGroups.map((g) => (
                          <span key={g} className="shift-stats-preview-tag">
                            👥 {g}
                          </span>
                        ))}
                        {includeGrandTotal && (
                          <span
                            className="shift-stats-preview-tag"
                            style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}
                          >
                            Total (全廠)
                          </span>
                        )}
                      </>
                    )
                  )}
                </div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
                  💡 說明：
                  <br />• 每一週包含 <strong>{exportMonthInfo.weeks[0]?.sheetName || 'W'}</strong> 等獨立 Sheet，最左側呈現該週總結，右側依序展開第 1 天至第 7 天每日明細。
                  <br />• 另含 <strong>{exportMonthInfo.sheetName}</strong> 月份 Sheet，最左側呈現月總結，右側依序展開 {exportMonthInfo.weeks.map(w => `w${w.weekCode}`).join('、')}。
                  <br />• 資料格式：分類、班別（DB, DA, Total D, NB, NA, Total N），每區塊皆有請假人數、加班人數、當班人數、請假率、加班率、淨出勤率。
                </div>
              </div>
            </div>

            <div className="shift-stats-modal-actions">
              <button
                type="button"
                className="shift-stats-modal-btn"
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
              >
                取消
              </button>
              <button
                type="button"
                className="shift-stats-modal-btn shift-stats-modal-btn-primary"
                onClick={handleExportExcel}
                disabled={exporting}
              >
                {exporting ? '產生 Excel 中…' : '開始下載 Excel (.xlsx)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ShiftStatsReport
