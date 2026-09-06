import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Select from 'react-select'
import { useShiftAssignmentsAPI, ShiftAssignment, OvertimeShiftCode } from '../hooks/useShiftAssignmentsAPI'
import { useShiftSettingAPI, LeaveType } from '../hooks/useShiftSettingAPI'
import { useUsersAPI, User } from '../hooks/useUsersAPI'
import { useCalendarTags } from '../hooks/useCalendarTags'
import { useAuth } from '../hooks/useAuth'
import { useMemoryCache, CACHE_KEYS, CACHE_TTL } from '../hooks/useMemoryCache'
import { useGroupsAPI, UserGroup } from '../hooks/useGroupsAPI'
import './LeaveOverview.css'
import {
  buildShiftAssignmentExportRows,
  downloadShiftAssignmentsCsv,
  downloadShiftAssignmentsXlsx,
} from '../utils/shiftAssignmentExport'
import {
  DEFAULT_MONTHLY_OVERTIME_CAP_HOURS,
  DEFAULT_WEEKLY_WORK_HOURS_CAP,
  MONTHLY_OVERTIME_REFERENCE_SOFT_LIMIT,
  resolveMonthlyOvertimeCapHours,
} from '../constants/workLimits'
import { computeMonthlyOvertimeTotalHours } from '../utils/monthlyOvertimeHours'

/** 非 manager：某月 25 日～次月月底不可填寫 */
function isDateInLockedRange25ToNextMonthEnd(dateStr: string): boolean {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
  
    const d = new Date(dateStr + 'T12:00:00')
  
    const year = today.getFullYear()
    const month = today.getMonth()
  
    let start: Date
    let end: Date
  
    if (today.getDate() >= 25) {
      // 👉 本月 25 ～ 下月月底
      start = new Date(year, month, 25)
      end = new Date(year, month + 2, 1) // 半開區間
    } else {
      // 👉 上月 25 ～ 本月月底
      start = new Date(year, month - 1, 25)
      end = new Date(year, month + 1, 1)
    }
    return d >= start && d < end
}

function isDateInOpenThreeMonthWindowAfterLock(dateStr: string): boolean {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  const d = new Date(dateStr + 'T12:00:00')

  const year = today.getFullYear()
  const month = today.getMonth()

  let start: Date
  let end: Date

  if (today.getDate() >= 25) {
    // 👉 +2 ～ +4 月（共三個月）
    start = new Date(year, month + 2, 1)
    end = new Date(year, month + 5, 1) // 半開區間
  } else {
    // 👉 +1 ～ +3 月
    start = new Date(year, month + 1, 1)
    end = new Date(year, month + 4, 1)
  }

  return d >= start && d < end
}

function canNonManagerEditAssignmentDate(dateStr: string): boolean {
  if (isDateInLockedRange25ToNextMonthEnd(dateStr)) return false
  return isDateInOpenThreeMonthWindowAfterLock(dateStr)
}

/** manager：今日前後三個月內可調整 */
function isWithinThreeMonthsFromTodayForManager(dateStr: string): boolean {
  const targetDate = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const monthsDiff = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth())
  return monthsDiff >= -5 && monthsDiff <= 5
}

/** 與 validateRolling30DaysHours 相同之擴展日曆範圍（當前檢視月 ±2 月） */
function buildRolling30AllDates(year: number, month: number): string[] {
  const dates: string[] = []
  for (let monthOffset = -2; monthOffset <= 2; monthOffset++) {
    let adjustedYear = year
    let adjustedMonth = month + monthOffset
    if (adjustedMonth < 0) {
      adjustedYear--
      adjustedMonth += 12
    } else if (adjustedMonth > 11) {
      adjustedYear++
      adjustedMonth -= 12
    }
    const lastDay = new Date(adjustedYear, adjustedMonth + 1, 0)
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const date = new Date(adjustedYear, adjustedMonth, i)
      dates.push(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      )
    }
  }
  return dates
}

/** 班別列顯示順序（與勾選 DA/DB/NA/NB 一致） */
const SHIFT_LINE_DISPLAY_ORDER = ['DA', 'DB', 'NA', 'NB', '早上加班'] as const

/** 跨班早班加班（overtime_shift 為 DA/DB）之顯示群組名稱 */
const MORNING_SUPPORT_LABEL = '早上加班'

function employeeShiftLineLabel(e: { day_night?: string | null; shift_type?: string | null }): string {
  const dn = e.day_night ?? ''
  const st = e.shift_type ?? ''
  const s = `${dn}${st}`.trim()
  return s || '—'
}

/**
 * 日班／夜班使用者勾選「跨班早班加班」時寫入 overtime_shift 的碼（與後端 DA/DB/NA/NB 一致）：
 * - B 班（DB／NB）→ DA
 * - A 班（DA／NA）→ DB
 * shift_type 非 A/B 時不適用。
 */
function morningSupportCodeFor(e: { day_night?: string | null; shift_type?: string | null }): 'DA' | 'DB' | null {
  if (e.shift_type === 'B') return 'DA'
  if (e.shift_type === 'A') return 'DB'
  return null
}

/** 判斷某筆加班是否為跨班早班（DA/DB overtime_shift） */
function isMorningSupportAssignment(
  employee: { day_night?: string | null; shift_type?: string | null },
  overtimeShift?: string | null
): boolean {
  const expected = morningSupportCodeFor(employee)
  return expected !== null && overtimeShift === expected
}

/** 日期字串 +/- N 天 */
function shiftDateString(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + deltaDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatWorkHoursInput(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return ''
  if (Number.isInteger(hours)) return String(hours)
  return hours.toFixed(2).replace(/\.?0+$/, '')
}

function groupLeavePeopleByShiftLine<T extends { shiftLine: string }>(people: T[]): Array<{ shiftLine: string; people: T[] }> {
  const m = new Map<string, T[]>()
  for (const p of people) {
    const k = p.shiftLine
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(p)
  }
  const keys = [...m.keys()].sort((a, b) => {
    const ia = SHIFT_LINE_DISPLAY_ORDER.indexOf(a as (typeof SHIFT_LINE_DISPLAY_ORDER)[number])
    const ib = SHIFT_LINE_DISPLAY_ORDER.indexOf(b as (typeof SHIFT_LINE_DISPLAY_ORDER)[number])
    const unkA = ia === -1
    const unkB = ib === -1
    if (!unkA && !unkB) return ia - ib
    if (!unkA && unkB) return -1
    if (unkA && !unkB) return 1
    return a.localeCompare(b, 'en')
  })
  return keys.map((shiftLine) => ({ shiftLine, people: m.get(shiftLine)! }))
}

/** 滾動 30 天工時：加班用手填時數；請假用 10.5 - 手填時數；無 assignment 且當班日 +11h */
function computeRolling30DayStats(
  year: number,
  month: number,
  getMonthMap: (y: number, m: number) => Record<string, any>,
  leaveTypes: LeaveType[],
  userShiftType: string,
  assignmentMap: Map<string, Rolling30AssignmentEntry>
): {
  maxRollingHours: number
  maxWindowStart: string
  maxWindowEnd: string
  /** 所有連續 30 日工時嚴格大於 236 的視窗（非僅最大值） */
  over236Windows: Array<{ windowStart: string; windowEnd: string; hours: number }>
} {
  const allDates = buildRolling30AllDates(year, month)
  const leaveTypeByName = new Map(leaveTypes.map((lt) => [lt.name, lt]))
  const calendarMap = new Map<string, any>()
  for (let monthOffset = -2; monthOffset <= 2; monthOffset++) {
    const monthMap = getMonthMap(year, month + monthOffset)
    Object.entries(monthMap).forEach(([date, tag]) => {
      calendarMap.set(date, tag)
    })
  }

  let maxRollingHours = 0
  let maxWindowStart = ''
  let maxWindowEnd = ''
  const over236Windows: Array<{ windowStart: string; windowEnd: string; hours: number }> = []

  for (let windowStart = 0; windowStart <= allDates.length - 30; windowStart++) {
    const windowEnd = windowStart + 29
    let windowHours = 0

    for (let i = windowStart; i <= windowEnd; i++) {
      const dateStr = allDates[i]
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = calendarMap.get(dateStr)

      windowHours += estimateHoursForSingleDate(userShiftType, assignment, leaveTypeByName, calendarTag)
    }

    if (windowHours > maxRollingHours) {
      maxRollingHours = windowHours
      maxWindowStart = allDates[windowStart]
      maxWindowEnd = allDates[windowEnd]
    }

    if (windowHours > 236) {
      over236Windows.push({
        windowStart: allDates[windowStart],
        windowEnd: allDates[windowEnd],
        hours: windowHours,
      })
    }
  }

  return { maxRollingHours, maxWindowStart, maxWindowEnd, over236Windows }
}

function estimateHoursForSingleDate(
  userShiftType: string,
  assignment: Rolling30AssignmentEntry | undefined,
  leaveTypeByName: Map<string, LeaveType>,
  calendarTag: any
): number {
  if (assignment) {
    const leaveType = leaveTypeByName.get(assignment.shiftType)
    const manualHours = assignment.workHours ?? null
    if (leaveType?.is_not_workday === 1) {
      return manualHours ?? 12
    }
    if (leaveType?.is_not_workday === 0) {
      const leaveHours = manualHours ?? 10.5
      return Math.max(0, 10.5 - leaveHours)
    }
    return 0
  }
  if ((calendarTag?.shift_type ?? calendarTag?.pattern) === userShiftType) {
    return 11
  }
  return 0
}

type ShiftLineDailyCategoryStats = {
  shiftLine: string
  leave: number
  overtime: number
  training: number
}

type DateLeaveStats = {
  totalLeave: number
  totalOvertime: number
  totalTraining: number
  byShiftLine: ShiftLineDailyCategoryStats[]
}

type Rolling30AssignmentEntry = {
  shiftType: string
  workHours?: number | null
}

const LeaveOverview: React.FC = () => {
  const {
    getShiftAssignments,
    saveShiftAssignment,
    deleteShiftAssignment,
  } = useShiftAssignmentsAPI()
  const { getLeaveTypes } = useShiftSettingAPI()
  const { getUsers, getUser } = useUsersAPI()
  const { getMonthMap } = useCalendarTags()
  const { user } = useAuth()
  const { get: getCache, set: setCache } = useMemoryCache()
  const { getGroups } = useGroupsAPI()
  const [dbGroups, setDbGroups] = useState<UserGroup[]>([])

  const [currentDate, setCurrentDate] = useState(new Date())
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [selectedDateRow, setSelectedDateRow] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
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
  const [userProfile, setUserProfile] = useState<User | null>(null)

  const [proxyUser, setProxyUser] = useState<User | null>(null)
  const [comment, setComment] = useState('')
  const [workHoursInput, setWorkHoursInput] = useState('')
  const [updateNotice, setUpdateNotice] = useState('')
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState('')
  /** 日／夜班：當天加班且前一日為非本班工作日時，可勾選跨班早班加班，自動帶入 DA 或 DB 並存進排班 */
  const [morningSupport, setMorningSupport] = useState<boolean>(false)
  /** 開啟後：本職加班（如 NB）未勾選時，若該筆 overtime_shift 對應加班有勾選，仍顯示於列表 */
  const [includeByOvertimeShiftLine, setIncludeByOvertimeShiftLine] = useState(false)
  /** 46/54 HR 加班區塊收折 */
  const [hrOvertimeSectionOpen, setHrOvertimeSectionOpen] = useState(true)
  /** 月工時／滾動 30 日區塊收折 */
  const [rolling30SectionOpen, setRolling30SectionOpen] = useState(true)
  /** 匯出 CSV / Excel 彈窗與日期範圍 */
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportStartStr, setExportStartStr] = useState('')
  const [exportEndStr, setExportEndStr] = useState('')

  useEffect(() => {
    if (!updateNotice) return
    const timeoutId = window.setTimeout(() => setUpdateNotice(''), 2500)
    return () => window.clearTimeout(timeoutId)
  }, [updateNotice])

  // 依登入使用者重新載入列表與排班（login/logout 後會更新）
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

        try {
          const gList = await getGroups()
          setDbGroups(gList)
        } catch (err) {
          console.error('Failed to load groups in LeaveOverview:', err)
        }

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

  // 依登入使用者取得 profile；登出或換人時清空，避免殘留上一位的資料
  useEffect(() => {
    if (!user?.user_id) {
      setUserProfile(null)
      setProxyUser(null)
      return
    }

    const fetchUserProfile = async () => {
      try {
        const cacheKey = CACHE_KEYS.USER_PROFILE(user.user_id)
        let profile = getCache<User>(cacheKey)
        if (!profile) {
          profile = await getUser(user.user_id)
          setCache(cacheKey, profile, CACHE_TTL.USER_PROFILE)
        }
        // if (profile.day_night) setDayNightFilter(profile.day_night)
        setUserProfile(profile)
      } catch (error) {
        console.error('Failed to fetch user profile:', error)
      }
    }
    fetchUserProfile()
  }, [user?.user_id])
  // 代理填寫時的操作對象：若有選擇代理對象則為該用戶，否則為當前登入用戶
  const effectiveUser = proxyUser ?? userProfile
  const targetEmployeeId = effectiveUser?.employee_id ?? user?.employee_id ?? ''
  // 與勾選班別/日夜選項相符的用戶列表（供 manager 代理下拉選單使用）
  const proxyEligibleUsers = useMemo(() => {
    return employees.filter(e => {
      if (e.role === 'admin') return false
      const key = `${e.day_night}${e.shift_type}`
      return shiftDayNightFilter[key] === true
    })
  }, [employees, shiftDayNightFilter])

  // 代理填寫下拉選單選項
  const proxyOptions = useMemo(() => {
    const options = [{ value: 0, label: '自己' }]
    if (proxyEligibleUsers) {
      options.push(...proxyEligibleUsers.map(u => ({
        value: u.user_id,
        label: `${u.name} (${u.group})`
      })))
    }
    return options
  }, [proxyEligibleUsers])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

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

  // 生成日期字符串（需在 overtime46_54 之前定義，供 useMemo 使用）
  const formatDateString = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const openExportModal = () => {
    setExportStartStr(formatDateString(new Date(year, month, 1)))
    setExportEndStr(formatDateString(new Date(year, month + 1, 0)))
    setExportModalOpen(true)
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

  // 加班假別名稱集合（is_not_workday === 1）
  const overtimeLeaveTypeNames = useMemo(
    () => new Set(leaveTypes.filter(lt => lt.is_not_workday === 1).map(lt => lt.name)),
    [leaveTypes]
  )

  // 46/54 HR：當月／季加班時數；單月上線為 resolveMonthlyOvertimeCapHours（全站預設或 users 覆寫）
  const overtime46_54 = useMemo(() => {
    const safeDefault = {
      monthly: {
        total: 0,
        regularOvertime10hr: 0,
        holidayOnDuty2hr: 0,
        holidayOvertime2hr: 0,
        limit46: MONTHLY_OVERTIME_REFERENCE_SOFT_LIMIT,
        limitCap: DEFAULT_MONTHLY_OVERTIME_CAP_HOURS,
      },
      quarterly: { total: 0, limit138: 138, limit146: 146 },
      quarterMonths: [] as { y: number; m: number }[],
    }
    safeDefault.monthly.limitCap = resolveMonthlyOvertimeCapHours(effectiveUser ?? undefined)
    try {
      const userShift = (effectiveUser?.shift_type ?? user?.shift_type ?? 'A') as 'A' | 'B'
      const monthlyCapResolved = resolveMonthlyOvertimeCapHours(effectiveUser ?? undefined)
      const monthTotals = computeMonthlyOvertimeTotalHours({
        year,
        month,
        employeeId: targetEmployeeId,
        userShift,
        assignments,
        leaveTypes,
        overtimeLeaveTypeNames,
        getMonthMap,
      })
      const quarterMonths =
        month <= 2
          ? [
              { y: year, m: 0 },
              { y: year, m: 1 },
              { y: year, m: 2 },
            ]
          : month <= 5
            ? [
                { y: year, m: 3 },
                { y: year, m: 4 },
                { y: year, m: 5 },
              ]
            : month <= 8
              ? [
                  { y: year, m: 6 },
                  { y: year, m: 7 },
                  { y: year, m: 8 },
                ]
              : [
                  { y: year, m: 9 },
                  { y: year, m: 10 },
                  { y: year, m: 11 },
                ]
      let quarterTotal = 0
      quarterMonths.forEach(({ y, m }) => {
        const { total } = computeMonthlyOvertimeTotalHours({
          year: y,
          month: m,
          employeeId: targetEmployeeId,
          userShift,
          assignments,
          leaveTypes,
          overtimeLeaveTypeNames,
          getMonthMap,
        })
        quarterTotal += total
      })
      return {
        monthly: {
          total: monthTotals.total,
          regularOvertime10hr: monthTotals.regularOvertime10hr,
          holidayOnDuty2hr: monthTotals.holidayOnDuty2hr,
          holidayOvertime2hr: monthTotals.holidayOvertime2hr,
          limit46: MONTHLY_OVERTIME_REFERENCE_SOFT_LIMIT,
          limitCap: monthlyCapResolved,
        },
        quarterly: { total: quarterTotal, limit138: 138 },
        quarterMonths,
      }
    } catch (err) {
      console.error('overtime46_54 calculation error:', err)
      return safeDefault
    }
  }, [
    year,
    month,
    getMonthMap,
    assignments,
    targetEmployeeId,
    overtimeLeaveTypeNames,
    effectiveUser,
    user?.shift_type,
    leaveTypes,
  ])

  /** 滾動 30 天最大工時（與校驗邏輯一致；依登入／代理對象與目前列表即時重算） */
  const rolling30WorkHours = useMemo(() => {
    if (!effectiveUser?.shift_type || !targetEmployeeId) return null
    const assignmentMap = new Map<string, Rolling30AssignmentEntry>()
    assignments
      .filter(a => a.employee_id === targetEmployeeId)
      .forEach(a => assignmentMap.set(a.date, { shiftType: a.shift_type, workHours: a.work_hours ?? null }))
    return computeRolling30DayStats(year, month, getMonthMap, leaveTypes, effectiveUser.shift_type, assignmentMap)
  }, [year, month, getMonthMap, leaveTypes, effectiveUser?.shift_type, targetEmployeeId, assignments])

  const leaveTypeMapByName = useMemo(
    () => new Map(leaveTypes.map((lt) => [lt.name, lt])),
    [leaveTypes]
  )

  /** 不含今天，往前回算 30 天的估算工時（與任意連續30日相同估算規則） */
  const previous30DaysEstimatedHours = useMemo(() => {
    if (!effectiveUser?.shift_type || !targetEmployeeId) return null

    const end = new Date()
    end.setHours(12, 0, 0, 0)
    end.setDate(end.getDate() - 1) // 不含今天

    const start = new Date(end)
    start.setDate(start.getDate() - 29) // 含訖共 30 天

    const startStr = formatDateString(start)
    const endStr = formatDateString(end)

    const assignmentMap = new Map<string, Rolling30AssignmentEntry>()
    assignments
      .filter((a) => a.employee_id === targetEmployeeId)
      .forEach((a) => assignmentMap.set(a.date, { shiftType: a.shift_type, workHours: a.work_hours ?? null }))

    const monthTagCache = new Map<string, Record<string, any>>()
    const getTag = (dateStr: string) => {
      const d = new Date(dateStr + 'T12:00:00')
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`
      if (!monthTagCache.has(monthKey)) {
        monthTagCache.set(monthKey, getMonthMap(d.getFullYear(), d.getMonth()))
      }
      return monthTagCache.get(monthKey)?.[dateStr]
    }

    let hours = 0
    const cursor = new Date(start)
    while (cursor.getTime() <= end.getTime()) {
      const dateStr = formatDateString(cursor)
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = getTag(dateStr)
      hours += estimateHoursForSingleDate(effectiveUser.shift_type, assignment, leaveTypeMapByName, calendarTag)
      cursor.setDate(cursor.getDate() + 1)
    }

    return {
      hours,
      start: startStr,
      end: endStr,
    }
  }, [effectiveUser?.shift_type, targetEmployeeId, assignments, leaveTypeMapByName, getMonthMap])

  // 根據日期的班別標籤過濾可用的請假類型
  const getAvailableLeaveTypesForDate = (dateString: string) => {
    const tag = monthTagMap[dateString]

    if (!tag?.pattern) return leaveTypes

    const userShift = effectiveUser?.shift_type ?? user?.shift_type ?? 'A'
    const isSameShift = userShift === tag.pattern

    console.log('Debug getAvailableLeaveTypesForDate:', {
      dateString,
      userShift,
      tagPattern: tag.pattern,
      isSameShift,
      user: user
    })

    // 如果用戶班別與當天班別相同，顯示工作日相關的請假類型 (is_not_workday = 0)
    // 如果不同，顯示非工作日相關的請假類型 (is_not_workday = 1，如加班)
    let filteredTypes
    if (isSameShift) {
      filteredTypes = leaveTypes.filter(type => type.is_not_workday === 0)
    } else {
      filteredTypes = leaveTypes.filter(type => type.is_not_workday === 1)
    }

    console.log('Filtered leave types:', filteredTypes.map(t => ({ name: t.name, is_not_workday: t.is_not_workday })))

    return filteredTypes
  }

  // 按is_not_workday分组假别类型
  const groupedLeaveTypes = useMemo(() => {
    // 依照新增時間做排序 (created_at 升冪)
    const sortedLeaveTypes = [...leaveTypes].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB;
    });

    const groups = {
      workday: sortedLeaveTypes.filter(lt => lt.is_not_workday === 0), // 工作日假别
      nonWorkday: sortedLeaveTypes.filter(lt => lt.is_not_workday === 1) // 非工作日假别
    }
    return groups
  }, [leaveTypes])

  const employeeMapById = useMemo(() => {
    return new Map(employees.map((e) => [e.employee_id, e]))
  }, [employees])

  const selectedAssignment = useMemo(() => {
    if (!selectedDateRow || !targetEmployeeId) return null
    return assignments.find(
      (a) => a.employee_id === targetEmployeeId && a.date === selectedDateRow
    ) ?? null
  }, [assignments, selectedDateRow, targetEmployeeId])

  const parseWorkHoursValue = useCallback((raw: string): { valid: true; value: number | null } | { valid: false; message: string } => {
    const value = raw.trim()
    if (value === '') return { valid: true, value: null }
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      return { valid: false, message: '工時格式錯誤，請輸入 0~13，最多小數點兩位。' }
    }
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 13) {
      return { valid: false, message: '工時必須在 0~13 之間。' }
    }
    return { valid: true, value: Math.round(n * 100) / 100 }
  }, [])

  const substituteCandidatesForSelectedDate = useMemo(() => {
    if (!selectedDateRow || !effectiveUser?.group) return [] as Array<{ employee_id: string; name: string }>
    const found = new Map<string, string>()
    assignments.forEach((a) => {
      if (a.date !== selectedDateRow) return
      if (a.employee_id === targetEmployeeId) return
      const lt = leaveTypeMapByName.get(a.shift_type)
      if (!lt || lt.is_not_workday !== 0) return
      const emp = employeeMapById.get(a.employee_id)
      if (!emp) return
      if ((emp.group || '') !== effectiveUser.group) return
      found.set(emp.employee_id, emp.name)
    })
    return [...found.entries()]
      .map(([employee_id, name]) => ({ employee_id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [selectedDateRow, effectiveUser?.group, assignments, targetEmployeeId, leaveTypeMapByName, employeeMapById])

  const dailyLeaveStatsByDate = useMemo(() => {
    const monthDateSet = new Set(dates.map((d) => formatDateString(d)))

    const byDate = new Map<
      string,
      {
        leave: Set<string>
        overtime: Set<string>
        training: Set<string>
        byShiftLine: Map<string, { leave: Set<string>; overtime: Set<string>; training: Set<string> }>
      }
    >()

    const ensureDateStats = (dateStr: string) => {
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          leave: new Set<string>(),
          overtime: new Set<string>(),
          training: new Set<string>(),
          byShiftLine: new Map(),
        })
      }
      return byDate.get(dateStr)!
    }

    const ensureLineStats = (
      dateStats: {
        leave: Set<string>
        overtime: Set<string>
        training: Set<string>
        byShiftLine: Map<string, { leave: Set<string>; overtime: Set<string>; training: Set<string> }>
      },
      shiftLine: string
    ) => {
      if (!dateStats.byShiftLine.has(shiftLine)) {
        dateStats.byShiftLine.set(shiftLine, {
          leave: new Set<string>(),
          overtime: new Set<string>(),
          training: new Set<string>(),
        })
      }
      return dateStats.byShiftLine.get(shiftLine)!
    }

    for (const assignment of assignments) {
      if (!monthDateSet.has(assignment.date)) continue

      const employee = employeeMapById.get(assignment.employee_id)
      if (!employee || employee.role === 'admin') continue

      const groupName = employee.group || ''
      const groupMatched =
        !groupName || groupName === '未定義' ? groupFilter['未定義'] === true : groupFilter[groupName] === true
      if (!groupMatched) continue

      const homeKey = `${employee.day_night}${employee.shift_type}`
      const shiftLineMatched =
        shiftDayNightFilter[homeKey] === true ||
        (includeByOvertimeShiftLine &&
          assignment.overtime_shift != null &&
          shiftDayNightFilter[assignment.overtime_shift] === true)
      if (!shiftLineMatched) continue

      const leaveType = leaveTypeMapByName.get(assignment.shift_type)
      const shiftLine = isMorningSupportAssignment(employee, assignment.overtime_shift)
        ? MORNING_SUPPORT_LABEL
        : employeeShiftLineLabel(employee)
      const isTraining = assignment.shift_type.includes('上課')

      const dateStats = ensureDateStats(assignment.date)
      const lineStats = ensureLineStats(dateStats, shiftLine)

      if (isTraining) {
        dateStats.training.add(employee.employee_id)
        lineStats.training.add(employee.employee_id)
      } else if (leaveType?.is_not_workday === 1) {
        dateStats.overtime.add(employee.employee_id)
        lineStats.overtime.add(employee.employee_id)
      } else {
        dateStats.leave.add(employee.employee_id)
        lineStats.leave.add(employee.employee_id)
      }
    }

    const output = new Map<string, DateLeaveStats>()
    for (const [dateStr, stats] of byDate.entries()) {
      const shiftLines = [...stats.byShiftLine.entries()]
        .map(([shiftLine, lineStats]) => ({
          shiftLine,
          leave: lineStats.leave.size,
          overtime: lineStats.overtime.size,
          training: lineStats.training.size,
        }))
        .sort((a, b) => {
          const ia = SHIFT_LINE_DISPLAY_ORDER.indexOf(a.shiftLine as (typeof SHIFT_LINE_DISPLAY_ORDER)[number])
          const ib = SHIFT_LINE_DISPLAY_ORDER.indexOf(b.shiftLine as (typeof SHIFT_LINE_DISPLAY_ORDER)[number])
          const unkA = ia === -1
          const unkB = ib === -1
          if (!unkA && !unkB) return ia - ib
          if (!unkA && unkB) return -1
          if (unkA && !unkB) return 1
          return a.shiftLine.localeCompare(b.shiftLine, 'en')
        })

      output.set(dateStr, {
        totalLeave: stats.leave.size,
        totalOvertime: stats.overtime.size,
        totalTraining: stats.training.size,
        byShiftLine: shiftLines,
      })
    }

    return output
  }, [dates, assignments, employeeMapById, leaveTypeMapByName, groupFilter, shiftDayNightFilter, includeByOvertimeShiftLine])

  const normOvertimeShiftLabel = (s?: OvertimeShiftCode | null): string =>
    s === 'DA' || s === 'DB' || s === 'NA' || s === 'NB' ? s : ''

  /** 群組通過 +（本職加班勾選，或開啟跨班納入且 overtime_shift 加班有勾選） */
  const employeeVisibleInOverview = (employee: User | undefined, assignment: ShiftAssignment): boolean => {
    if (!employee || employee.role === 'admin') return false
    const g = employee.group || ''
    const groupOk = !g || g === '未定義' ? groupFilter['未定義'] === true : groupFilter[g] === true
    if (!groupOk) return false
    const homeKey = `${employee.day_night}${employee.shift_type}`
    if (shiftDayNightFilter[homeKey] === true) return true
    if (
      includeByOvertimeShiftLine &&
      assignment.overtime_shift &&
      shiftDayNightFilter[assignment.overtime_shift] === true
    ) {
      return true
    }
    return false
  }

  /** 指定日期、假別下的人員（依填寫時間由舊到新；含班別 shiftLine 供分組顯示） */
  const getPeopleForLeaveType = (
    dateString: string,
    leaveTypeName: string
  ): Array<{
    employee_id: string
    name: string
    created_at?: string
    comment?: string
    group?: string
    overtime_shift?: OvertimeShiftCode | null
    work_hours?: number | null
    shiftLine: string
  }> => {
    const result: Array<{
      employee_id: string
      name: string
      created_at?: string
      comment?: string
      group?: string
      overtime_shift?: OvertimeShiftCode | null
      work_hours?: number | null
      shiftLine: string
    }> = []
    assignments
      .filter(a => a.date === dateString && a.shift_type === leaveTypeName)
      .forEach(a => {
        const employee = employees.find(e => e.employee_id === a.employee_id)
        if (employee && employeeVisibleInOverview(employee, a)) {
          const line = isMorningSupportAssignment(employee, a.overtime_shift)
            ? MORNING_SUPPORT_LABEL
            : employeeShiftLineLabel(employee)
          result.push({
            employee_id: employee.employee_id,
            name: employee.name,
            created_at: a.created_at,
            comment: a.comment,
            group: employee.group,
            overtime_shift: a.overtime_shift,
            work_hours: a.work_hours ?? null,
            shiftLine: line,
          })
        }
      })
    result.sort((a, b) => {
      const groupA = a.group || ''
      const groupB = b.group || ''
      const groupDiff = groupA.localeCompare(groupB, 'zh-Hant')
      if (groupDiff !== 0) return groupDiff
      const timeA = a.created_at ? new Date(a.created_at).getTime() : Infinity
      const timeB = b.created_at ? new Date(b.created_at).getTime() : Infinity
      if (timeA !== timeB) return timeA - timeB
      return a.name.localeCompare(b.name, 'zh-Hant')
    })

    return result
  }

  const renderPeopleGroupedByShiftLine = (
    people: ReturnType<typeof getPeopleForLeaveType>
  ) => (
    <div className="people-names people-names-by-shift">
      {groupLeavePeopleByShiftLine(people).map(({ shiftLine, people: linePeople }) => (
        <div key={shiftLine} className="people-by-shift-line">
          <span
            className={`shift-line-label${shiftLine === MORNING_SUPPORT_LABEL ? ' shift-line-morning-support' : ''}`}
          >
            {shiftLine}：
          </span>
          <span className="shift-line-names">
            {linePeople.map((p, idx) => (
              <span
                key={p.employee_id}
                className="person-name"
                title={
                  (p.created_at ? `建立時間：${p.created_at}` : '') +
                  (p.created_at && (p.comment || p.overtime_shift) ? '\n' : '') +
                  (p.overtime_shift ? `跨班加班：${p.overtime_shift}` : '') +
                  (p.overtime_shift && (p.comment || p.work_hours != null) ? '\n' : '') +
                  (p.work_hours != null ? `工時：${p.work_hours}` : '') +
                  (p.work_hours != null && p.comment ? '\n' : '') +
                  (p.comment ? `備註：${p.comment}` : '') || undefined
                }
              >
                {p.name}
                {p.group && <span className="person-group">({p.group})</span>}
                {idx < linePeople.length - 1 ? ', ' : null}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )

  // 获取星期几（中文顯示）
  const getDayName = (date: Date): string => {
    const days = ['日', '一', '二', '三', '四', '五', '六']
    return days[date.getDay()]
  }

  // 检查是否为星期六
  const isSaturday = (date: Date): boolean => {
    return date.getDay() === 6 // 星期六是 6
  }

  /**
   * 計算 Sunday-based 週序（與本檔其他 getWeekDates 邏輯一致：週日為一週起始）
   * 規則：以該日所屬年份的「1/1 之前最近的週日」為錨點，每 7 天為一週
   */
  const getSundayWeek = (date: Date): { weekYear: number; week: number } => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const yearStart = new Date(d.getFullYear(), 0, 1)
    const firstSunday = new Date(yearStart)
    firstSunday.setDate(yearStart.getDate() - yearStart.getDay())
    const diffDays = Math.floor((d.getTime() - firstSunday.getTime()) / 86400000)
    return { weekYear: d.getFullYear(), week: Math.floor(diffDays / 7) + 1 }
  }

  /** 週數編碼：年份末位 + 兩位週數，例如 2026 第 1 週 → "601"、第 18 週 → "618" */
  const formatWeekCode = (date: Date): string => {
    const { weekYear, week } = getSundayWeek(date)
    return `${weekYear % 10}${String(week).padStart(2, '0')}`
  }

  /** 該列是否為一週起始（週日 或 當月第一天）— 用來決定是否顯示週碼文字 */
  const isWeekStart = (date: Date): boolean => {
    return date.getDay() === 0 || date.getDate() === 1
  }

  // 检查是否为今天
  const isToday = (date: Date): boolean => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  // 导航到上一个月
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  // 导航到下一个月
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  // 选择月份和年份
  const selectMonth = (newMonth: number) => {
    setCurrentDate(new Date(year, newMonth, 1))
    setShowMonthPicker(false)
  }

  const selectYear = (newYear: number) => {
    setCurrentDate(new Date(newYear, month, 1))
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1))

    setTimeout(() => {
      const todayEl = document.querySelector('.date-column .day-number.today')
      if (todayEl) {
        todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }

  // 初次加载如果本月有Today则自动滚动到Today
  useEffect(() => {
    const now = new Date()
    if (year === now.getFullYear() && month === now.getMonth()) {
      setTimeout(() => {
        const todayEl = document.querySelector('.date-column .day-number.today')
        if (todayEl) {
          todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 300)
    }
  }, [year, month])

  const closeDateLeaveMenu = () => {
    setSelectedDateRow(null)
    setComment('')
    setWorkHoursInput('')
    setSubstituteEmployeeId('')
    setMorningSupport(false)
  }

  // 处理日期行双击
  const handleDateRowDoubleClick = (dateString: string) => {
    const isManager = userProfile?.role === 'manager'
    if (isManager) {
      if (!isWithinThreeMonthsFromTodayForManager(dateString)) {
        alert('只能調整今日前後 3 個月內的資料')
        return
      }
    } else {
      if (!canNonManagerEditAssignmentDate(dateString)) {
        alert(
          '此日期不在開放填寫區間：非主管僅能填寫「每月 25 日～次月底」鎖定期以外的日期，且須落在鎖定後連續三個日曆月內（例：3/25～4 月底鎖定後，開放 5、6、7 月）。'
        )
        return
      }
    }

    if (selectedDateRow === dateString) {
      closeDateLeaveMenu()
      return
    }
    setSelectedDateRow(dateString)
    const existing = assignments.find(a => a.employee_id === targetEmployeeId && a.date === dateString)
    setComment(existing?.comment ?? '')
    setWorkHoursInput(formatWorkHoursInput(existing?.work_hours))
    setSubstituteEmployeeId('')
    setMorningSupport(isMorningSupportAssignment(effectiveUser ?? {}, existing?.overtime_shift))
  }

  // 验证每周工作时数不超过50小时（可傳入 targetUser 做代理驗證）
  const validateWeeklyHours = async (assignmentDate: string, newShiftType: string, targetUser?: User | null): Promise<{ isValid: boolean, message?: string }> => {
    const profileToUse = targetUser ?? (() => {
      const cacheKey = CACHE_KEYS.USER_PROFILE(user?.user_id || 0)
      return getCache<User>(cacheKey)
    })()
    let resolvedProfile = profileToUse

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      try {
        const uid = targetUser?.user_id ?? user?.user_id ?? 0
        const cacheKey = CACHE_KEYS.USER_PROFILE(uid)
        console.log('User profile cache expired, fetching fresh data...')
        resolvedProfile = await getUser(uid)
        if (resolvedProfile) {
          setCache(cacheKey, resolvedProfile, CACHE_TTL.USER_PROFILE)
        }
      } catch (error) {
        console.error('Failed to refresh user profile:', error)
        return { isValid: false, message: '无法获取用户信息，请刷新页面重试' }
      }
    }

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      return { isValid: false, message: '无法获取用户信息' }
    }

    const userShiftType = resolvedProfile.shift_type

    // 使用组件中的 monthTagMap 变量
    console.log('📅 月曆標籤數據:', monthTagMap)

    // 获取用户的排班分配缓存
    const assignmentsCacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(resolvedProfile.employee_id)
    const existingAssignments = getCache<ShiftAssignment[]>(assignmentsCacheKey) || []

    // 获取假别类型缓存
    const leaveTypesCache = getCache<LeaveType[]>(CACHE_KEYS.LEAVE_TYPES) || []

    // 创建假别类型名称到is_not_workday的映射
    const leaveTypeMap = new Map<string, number>()
    leaveTypesCache.forEach(lt => leaveTypeMap.set(lt.name, lt.is_not_workday))

    // 解析分配日期
    const assignmentDateObj = new Date(assignmentDate + 'T00:00:00')

    // 获取本周的日期范围（从星期天开始）
    const getWeekDates = (date: Date): Date[] => {
      const d = new Date(date)
      const day = d.getDay() // 0 = 星期天, 6 = 星期六
      const diff = d.getDate() - day
      const weekStart = new Date(d.setDate(diff))

      const dates: Date[] = []
      for (let i = 0; i < 7; i++) {
        const weekDate = new Date(weekStart)
        weekDate.setDate(weekStart.getDate() + i)
        dates.push(weekDate)
      }
      return dates
    }

    const weekDates = getWeekDates(assignmentDateObj)

    // 创建日历标签映射（包含前后月，避免遇到跨月周時找不到標籤而算做0小時）
    const calendarMap = new Map<string, any>()
    const targetY = assignmentDateObj.getFullYear()
    const targetM = assignmentDateObj.getMonth()

    const pTagMap = getMonthMap(targetY, targetM - 1)
    const cTagMap = getMonthMap(targetY, targetM)
    const nTagMap = getMonthMap(targetY, targetM + 1)

    Object.entries(pTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))
    Object.entries(cTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))
    Object.entries(nTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))

    // 创建现有分配映射
    const assignmentMap = new Map<string, string>()
    existingAssignments.forEach(assignment => {
      assignmentMap.set(assignment.date, assignment.shift_type)
    })

    // 更新分配映射（包含新的分配）
    assignmentMap.set(assignmentDate, newShiftType)

    let totalHours = 0

    // Debug: 顯示計算的周別範圍
    const weekStartStr = formatDateString(weekDates[0])
    const weekEndStr = formatDateString(weekDates[6])
    console.log(`🔍 計算周別: ${weekStartStr} ~ ${weekEndStr}`)
    console.log(`👤 用戶班別: ${userShiftType}`)

    // 计算每周的时数
    for (const date of weekDates) {
      const dateStr = formatDateString(date)
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = calendarMap.get(dateStr)

      let hoursAdded = 0

      if (assignment) {
        // 检查是否是非工作日假别类型 (is_not_workday = 1)
        const leaveType = leaveTypesCache.find(lt => lt.name === assignment)
        if (leaveType && leaveType.is_not_workday === 1) {
          hoursAdded = 10
          totalHours += hoursAdded
        } else {
          hoursAdded = 10
          totalHours += hoursAdded
        }
      } else {
        // 没有分配，检查是否是正常工作日
        const calPat = calendarTag?.pattern ?? calendarTag?.shift_type
        if (calPat === userShiftType) {
          hoursAdded = 10
          totalHours += hoursAdded
        } else if (calPat !== userShiftType) {
          // 非當班日
        } else {
          // 無排班資料
        }
      }

      //console.log(`📅 ${dateStr}: ${reason} ${hoursAdded > 0 ? `+${hoursAdded}小時` : ''}`)
    }

    console.log(`💼 本週總工時: ${totalHours}小時`)

    if (totalHours > DEFAULT_WEEKLY_WORK_HOURS_CAP) {
      return {
        isValid: false,
        message: `每週工作時數不能超過${DEFAULT_WEEKLY_WORK_HOURS_CAP}小時。目前計算時數：${totalHours}小時`,
      }
    }

    return { isValid: true }
  }

  // 验证一週當中一定有兩天休息不上班且不能是國定假日（可傳入 targetUser 做代理驗證）
  const validateWeeklyRestDays = async (assignmentDate: string, newShiftType: string, targetUser?: User | null): Promise<{ isValid: boolean, message?: string }> => {
    const profileToUse = targetUser ?? (() => {
      const cacheKey = CACHE_KEYS.USER_PROFILE(user?.user_id || 0)
      return getCache<User>(cacheKey)
    })()
    let resolvedProfile = profileToUse

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      try {
        const uid = targetUser?.user_id ?? user?.user_id ?? 0
        const cacheKey = CACHE_KEYS.USER_PROFILE(uid)
        resolvedProfile = await getUser(uid)
        if (resolvedProfile) {
          setCache(cacheKey, resolvedProfile, CACHE_TTL.USER_PROFILE)
        }
      } catch (error) {
        return { isValid: false, message: '无法获取用户信息，请刷新页面重试' }
      }
    }

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      return { isValid: false, message: '无法获取用户信息' }
    }

    const userShiftType = resolvedProfile.shift_type
    const assignmentsCacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(resolvedProfile.employee_id)
    const existingAssignments = getCache<ShiftAssignment[]>(assignmentsCacheKey) || []

    const assignmentDateObj = new Date(assignmentDate + 'T00:00:00')

    const getWeekDates = (date: Date): Date[] => {
      const d = new Date(date)
      const day = d.getDay()
      const diff = d.getDate() - day
      const weekStart = new Date(d.setDate(diff))

      const dates: Date[] = []
      for (let i = 0; i < 7; i++) {
        const weekDate = new Date(weekStart)
        weekDate.setDate(weekStart.getDate() + i)
        dates.push(weekDate)
      }
      return dates
    }

    const weekDates = getWeekDates(assignmentDateObj)

    const calendarMap = new Map<string, any>()
    const targetY = assignmentDateObj.getFullYear()
    const targetM = assignmentDateObj.getMonth()

    const pTagMap = getMonthMap(targetY, targetM - 1)
    const cTagMap = getMonthMap(targetY, targetM)
    const nTagMap = getMonthMap(targetY, targetM + 1)

    Object.entries(pTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))
    Object.entries(cTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))
    Object.entries(nTagMap).forEach(([date, tag]) => calendarMap.set(date, tag))

    const assignmentMap = new Map<string, string>()
    existingAssignments.forEach(assignment => {
      assignmentMap.set(assignment.date, assignment.shift_type)
    })

    assignmentMap.set(assignmentDate, newShiftType)

    let nonHolidayRestDaysCount = 0
    const holidayDates: string[] = []

    for (const date of weekDates) {
      const dateStr = formatDateString(date)
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = calendarMap.get(dateStr)

      let isWorkingDay = false
      if (assignment) {
        isWorkingDay = true
      } else {
        if (calendarTag?.shift_type === userShiftType) {
          isWorkingDay = true
        }
      }

      if (calendarTag?.isHoliday) {
        holidayDates.push(dateStr)
      }

      if (!isWorkingDay && !calendarTag?.isHoliday) {
        nonHolidayRestDaysCount++
      }
    }

    if (nonHolidayRestDaysCount < 2) {
      let holidayMsg = ''
      if (holidayDates.length > 0) {
        holidayMsg = `\n本週休假日碰上國定假日為：${holidayDates.join(', ')}`
      } else {
        holidayMsg = `\n本週無國定假日。`
      }
      return {
        isValid: false,
        message: `一週內必須保留至少兩天「非國定假日」的休息日！\n目前計算僅剩 ${nonHolidayRestDaysCount} 天非國定假日休息日。${holidayMsg}`
      }
    }

    return { isValid: true }
  }

  // 验证连续7天工作时数不超过70小时（线性扫描，包含前后月）（可傳入 targetUser 做代理驗證）
  const validateContinuousWorkDays = async (assignmentDate: string, newShiftType: string, targetUser?: User | null): Promise<{ isValid: boolean, message?: string }> => {
    const profileToUse = targetUser ?? getCache<User>(CACHE_KEYS.USER_PROFILE(user?.user_id || 0))
    let resolvedProfile = profileToUse

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      try {
        const uid = targetUser?.user_id ?? user?.user_id ?? 0
        const cacheKey = CACHE_KEYS.USER_PROFILE(uid)
        console.log('User profile cache expired in validateContinuousWorkDays, fetching fresh data...')
        resolvedProfile = await getUser(uid)
        if (resolvedProfile) {
          setCache(cacheKey, resolvedProfile, CACHE_TTL.USER_PROFILE)
        }
      } catch (error) {
        console.error('Failed to refresh user profile in validateContinuousWorkDays:', error)
        return { isValid: false, message: '无法获取用户信息，请刷新页面重试' }
      }
    }

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      return { isValid: false, message: '无法获取用户信息' }
    }

    const userShiftType = resolvedProfile.shift_type

    // 获取前后三个月的日历数据
    const prevMonthTagMap = getMonthMap(year, month - 1)
    const currentMonthTagMap = getMonthMap(year, month)
    const nextMonthTagMap = getMonthMap(year, month + 1)

    console.log('📅 檢查連續工作日 - 前月:', prevMonthTagMap)
    console.log('📅 檢查連續工作日 - 本月:', currentMonthTagMap)
    console.log('📅 檢查連續工作日 - 下月:', nextMonthTagMap)

    // 获取用户的排班分配缓存
    const assignmentsCacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(resolvedProfile.employee_id)
    const existingAssignments = getCache<ShiftAssignment[]>(assignmentsCacheKey) || []

    // 获取假别类型缓存
    const leaveTypesCache = getCache<LeaveType[]>(CACHE_KEYS.LEAVE_TYPES) || []

    // 创建假别类型名称到is_not_workday的映射
    const leaveTypeMap = new Map<string, number>()
    leaveTypesCache.forEach(lt => leaveTypeMap.set(lt.name, lt.is_not_workday))

    // 生成前后三个月的日期范围
    const generateMonthDates = (year: number, month: number): string[] => {
      const lastDay = new Date(year, month + 1, 0)
      const dates: string[] = []
      for (let i = 1; i <= lastDay.getDate(); i++) {
        const date = new Date(year, month, i)
        dates.push(formatDateString(date))
      }
      return dates
    }

    const prevMonthDates = generateMonthDates(year, month - 1)
    const currentMonthDates = generateMonthDates(year, month)
    const nextMonthDates = generateMonthDates(year, month + 1)

    // 合并所有日期进行线性扫描
    const allDates = [...prevMonthDates, ...currentMonthDates, ...nextMonthDates]

    // 创建日历标签映射（包含前后月）
    const calendarMap = new Map<string, any>()
    Object.entries(prevMonthTagMap).forEach(([date, tag]) => {
      calendarMap.set(date, tag)
    })
    Object.entries(currentMonthTagMap).forEach(([date, tag]) => {
      calendarMap.set(date, tag)
    })
    Object.entries(nextMonthTagMap).forEach(([date, tag]) => {
      calendarMap.set(date, tag)
    })

    // 创建现有分配映射
    const assignmentMap = new Map<string, string>()
    existingAssignments.forEach(assignment => {
      assignmentMap.set(assignment.date, assignment.shift_type)
    })

    // 更新分配映射（包含新的分配）
    assignmentMap.set(assignmentDate, newShiftType)

    console.log(`👤 用戶班別: ${userShiftType}`)
    console.log(`🎯 檢查日期: ${assignmentDate}`)
    console.log(`📊 掃描範圍: ${allDates[0]} ~ ${allDates[allDates.length - 1]}`)

    // 线性扫描检查连续7天工作日
    let maxContinuousHours = 0
    let currentContinuousHours = 0
    let violationStartDate = ''
    let violationEndDate = ''

    for (const dateStr of allDates) {
      const assignment = assignmentMap.get(dateStr)
      const calendarTag = calendarMap.get(dateStr)

      let isWorkingDay = false

      if (assignment) {
        // 检查是否是非工作日假别类型 (is_not_workday = 1)
        const leaveType = leaveTypesCache.find(lt => lt.name === assignment)
        if (leaveType && leaveType.is_not_workday === 1) {
          isWorkingDay = true
          //console.log(`📅 ${dateStr}: 非工作日假別 (${assignment}) - 工作日`)
        } else {
          isWorkingDay = true
          //console.log(`📅 ${dateStr}: 工作日假別 (${assignment}) - 非工作日也算工時`)
        }
      } else {
        // 没有分配，检查是否是正常工作日
        if (calendarTag?.shift_type === userShiftType) {
          isWorkingDay = true
          //console.log(`📅 ${dateStr}: 正常工作日 (班別: ${calendarTag.shift_type}) - 工作日`)
        } else if (calendarTag?.shift_type !== userShiftType) {
          //console.log(`📅 ${dateStr}: 非當班日 (班別: ${calendarTag?.shift_type}) - 非工作日`)
        } else {
          //console.log(`📅 ${dateStr}: 無排班資料 - 非工作日`)
        }
      }

      if (isWorkingDay) {
        if (currentContinuousHours === 0) {
          // 开始新的连续工作周期
          violationStartDate = dateStr
        }
        currentContinuousHours += 10
        //console.log(`📅 ${dateStr}: currentContinuousHours = ${currentContinuousHours}`)

        // 更新违规结束日期
        violationEndDate = dateStr

        maxContinuousHours = Math.max(maxContinuousHours, currentContinuousHours)

        // 如果已经超过70小时，继续扫描会使violationStartDate和violationEndDate不准确
        if (maxContinuousHours >= 70) {
          break
        }
      } else {
        //console.log(`📅 ${dateStr}: currentContinuousHours reset to 0`)
        currentContinuousHours = 0 // 重置连续计数
        violationStartDate = ''
        violationEndDate = ''
      }
    }

    console.log(`🔄 最大連續工作時數: ${maxContinuousHours}小時`)

    if (maxContinuousHours >= 70) {
      console.log(`🚨 超時工作期間: ${violationStartDate} ~ ${violationEndDate}`)
      return {
        isValid: false,
        message: `連續工作7天總時數不能超過70小時。目前最大連續時數：${maxContinuousHours}小時 (期間: ${violationStartDate} ~ ${violationEndDate})`
      }
    }

    return { isValid: true }
  }

  // 驗證任意連續 30 天工作時數（滾動視窗）：加班用手填時數；請假用 10.5 - 手填時數
  const validateRolling30DaysHours = async (
    assignmentDate: string,
    newShiftType: string,
    targetUser?: User | null,
    newWorkHours?: number | null
  ): Promise<{ isValid: boolean; message?: string }> => {
    const profileToUse = targetUser ?? getCache<User>(CACHE_KEYS.USER_PROFILE(user?.user_id || 0))
    let resolvedProfile = profileToUse

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      try {
        const uid = targetUser?.user_id ?? user?.user_id ?? 0
        const cacheKey = CACHE_KEYS.USER_PROFILE(uid)
        console.log('User profile cache expired in validateRolling30DaysHours, fetching fresh data...')
        resolvedProfile = await getUser(uid)
        if (resolvedProfile) {
          setCache(cacheKey, resolvedProfile, CACHE_TTL.USER_PROFILE)
        }
      } catch (error) {
        console.error('Failed to refresh user profile in validateRolling30DaysHours:', error)
        return { isValid: false, message: '无法获取用户信息，请刷新页面重试' }
      }
    }

    if (!resolvedProfile || !resolvedProfile.shift_type) {
      return { isValid: false, message: '无法获取用户信息' }
    }

    const userShiftType = resolvedProfile.shift_type

    const assignmentsCacheKey = CACHE_KEYS.SHIFT_ASSIGNMENTS(resolvedProfile.employee_id)
    const existingAssignments = getCache<ShiftAssignment[]>(assignmentsCacheKey) || []
    const leaveTypesCache = getCache<LeaveType[]>(CACHE_KEYS.LEAVE_TYPES) || []

    const assignmentMap = new Map<string, Rolling30AssignmentEntry>()
    existingAssignments.forEach(assignment => {
      assignmentMap.set(assignment.date, {
        shiftType: assignment.shift_type,
        workHours: assignment.work_hours ?? null,
      })
    })
    assignmentMap.set(assignmentDate, {
      shiftType: newShiftType,
      workHours: newWorkHours ?? null,
    })

    const allDates = buildRolling30AllDates(year, month)
    const { maxRollingHours, over236Windows } = computeRolling30DayStats(
      year,
      month,
      getMonthMap,
      leaveTypesCache,
      userShiftType,
      assignmentMap
    )

    const windowsCoveringDate = over236Windows.filter(
      w => assignmentDate >= w.windowStart && assignmentDate <= w.windowEnd
    )

    console.log(
      `🔄 滾動30天校驗: 範圍 ${allDates[0] ?? ''} ~ ${allDates[allDates.length - 1] ?? ''}，峰值 ${maxRollingHours}h，>236 視窗數 ${over236Windows.length}`
    )

    if (windowsCoveringDate.length > 0) {
      const detail = windowsCoveringDate.map(w => `${w.windowStart}～${w.windowEnd}（${w.hours}小時）`).join('；')
      return {
        isValid: false,
        message: `任意連續30天總工時不宜超過236小時。以下為含所選日期且超過236小時之滾動視窗：${detail}`,
      }
    }

    return { isValid: true }
  }

  const handleUpdateAssignmentDetails = async (dateString: string) => {
    if (!user || !targetEmployeeId) return
    const existing = assignments.find(
      (a) => a.employee_id === targetEmployeeId && a.date === dateString
    )
    if (!existing) return

    const isManager = userProfile?.role === 'manager'
    if (isManager) {
      if (!isWithinThreeMonthsFromTodayForManager(dateString)) {
        alert('只能調整今日前後 3 個月內的資料')
        return
      }
    } else {
      if (!canNonManagerEditAssignmentDate(dateString)) {
        alert(
          '此日期不在開放填寫區間：非主管僅能填寫「每月 25 日～次月底」鎖定期以外的日期，且須落在鎖定後連續三個日曆月內（例：3/25～4 月底鎖定後，開放 5、6、7 月）。'
        )
        return
      }
    }

    const parsedWorkHours = parseWorkHoursValue(workHoursInput)
    if (!parsedWorkHours.valid) {
      alert(parsedWorkHours.message)
      return
    }

    const substituteName =
      leaveTypeMapByName.get(existing.shift_type)?.is_not_workday === 1
        ? substituteCandidatesForSelectedDate.find((s) => s.employee_id === substituteEmployeeId)?.name ?? ''
        : ''

    let finalComment = comment.trim()
    if (substituteName) {
      const note = `代班${substituteName}`
      if (!finalComment.includes(note)) {
        finalComment = finalComment ? `${finalComment} ${note}` : note
      }
    }
    if (proxyUser && user?.name) {
      const suffix = ` (填寫人: ${user.name})`
      if (!finalComment.includes(suffix)) {
        finalComment += suffix
      }
    }

    try {
      const raw = await saveShiftAssignment(
        targetEmployeeId,
        dateString,
        existing.shift_type,
        finalComment,
        existing.overtime_shift ?? null,
        parsedWorkHours.value
      )
      setAssignments((prev) => {
        const updated = prev.map((a) =>
          a.employee_id === targetEmployeeId && a.date === dateString
            ? {
                ...a,
                shift_type: raw.shift_type ?? a.shift_type,
                comment: raw.comment ?? finalComment,
                overtime_shift: raw.overtime_shift ?? a.overtime_shift ?? null,
                work_hours: raw.work_hours ?? parsedWorkHours.value,
              }
            : a
        )
        const userOnly = updated.filter((a) => a.employee_id === targetEmployeeId)
        setCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(targetEmployeeId), userOnly, CACHE_TTL.SHIFT_ASSIGNMENTS)
        return updated
      })
      closeDateLeaveMenu()
      setUpdateNotice('資料已更新完成')
    } catch (error) {
      console.error('更新資料失敗:', error)
      alert('更新資料失敗，請重試')
    }
  }

  // 处理假别类型选择（代理時對 targetEmployeeId 操作）
  const handleLeaveTypeSelect = async (dateString: string, leaveTypeName: string) => {
    if (!user) return
    if (!targetEmployeeId) return

    try {
      const isManager = userProfile?.role === 'manager'
      if (isManager) {
        if (!isWithinThreeMonthsFromTodayForManager(dateString)) {
          alert('只能調整今日前後 3 個月內的資料')
          return
        }
      } else {
        if (!canNonManagerEditAssignmentDate(dateString)) {
          alert(
            '此日期不在開放填寫區間：非主管僅能填寫「每月 25 日～次月底」鎖定期以外的日期，且須落在鎖定後連續三個日曆月內（例：3/25～4 月底鎖定後，開放 5、6、7 月）。'
          )
          return
        }
      }

      // 检查目标用户是否已经有该日期的假别分配
      const existingAssignment = assignments.find(
        a => a.employee_id === targetEmployeeId && a.date === dateString
      )

      const leaveTypeDataForToggle = leaveTypes.find(lt => lt.name === leaveTypeName)
      const morningSupportCode = morningSupportCodeFor(effectiveUser ?? {})
      const otForSave: OvertimeShiftCode | null =
        leaveTypeDataForToggle?.is_not_workday === 1 && morningSupport && morningSupportCode
          ? morningSupportCode
          : null
      const sameOvertimeSlot =
        leaveTypeDataForToggle?.is_not_workday !== 1 ||
        normOvertimeShiftLabel(existingAssignment?.overtime_shift) === normOvertimeShiftLabel(otForSave)

      // 如果已经存在分配且是相同的假别类型（且非工作日時跨班加班一致），则删除分配（取消选择）
      if (existingAssignment && existingAssignment.shift_type === leaveTypeName && sameOvertimeSlot) {
        await deleteShiftAssignment(targetEmployeeId, dateString)
        setAssignments(prev => {
          const updatedAssignments = prev.filter(a => !(a.employee_id === targetEmployeeId && a.date === dateString))
          const userOnly = updatedAssignments.filter(a => a.employee_id === targetEmployeeId)
          setCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(targetEmployeeId), userOnly, CACHE_TTL.SHIFT_ASSIGNMENTS)
          return updatedAssignments
        })
      } else {
        if (existingAssignment) {
          await deleteShiftAssignment(targetEmployeeId, dateString)
          setAssignments(prev => {
            const updatedAssignments = prev.filter(a => !(a.employee_id === targetEmployeeId && a.date === dateString))
            const userOnly = updatedAssignments.filter(a => a.employee_id === targetEmployeeId)
            setCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(targetEmployeeId), userOnly, CACHE_TTL.SHIFT_ASSIGNMENTS)
            return updatedAssignments
          })
        }
        const parsedWorkHoursForSave = parseWorkHoursValue(workHoursInput)
        if (!parsedWorkHoursForSave.valid) {
          alert(parsedWorkHoursForSave.message)
          return
        }
        const workHoursForSave = parsedWorkHoursForSave.value

        // Check rule: if leave type is_not_workday === 0 (請假), check same group limit (max 3)
        const leaveTypeData = leaveTypeDataForToggle
        if (leaveTypeData && leaveTypeData.is_not_workday === 0 && effectiveUser?.group) {
          const userGroup = effectiveUser.group
          let groupLeaveCount = 0
          let groupOvertimeCount = 0

          // Get all assignments on this date
          const dateAssignments = assignments.filter(a => a.date === dateString)
          for (const a of dateAssignments) {
            // Check if this assignment's user is in the same group and the same day_night shift
            const assignmentUser = employees.find(
              u => u.employee_id === a.employee_id && u.day_night === effectiveUser.day_night
            )
            if (assignmentUser && assignmentUser.group === userGroup) {
              // Check if the assignment's leave type is is_not_workday === 0 or === 1
              const aLeaveType = leaveTypes.find(lt => lt.name === a.shift_type)
              if (aLeaveType) {
                if (aLeaveType.is_not_workday === 0) {
                  groupLeaveCount++
                } else if (aLeaveType.is_not_workday === 1) {
                  groupOvertimeCount++
                }
              }
            }
          }

          const matchedGroup = dbGroups.find(g => g.group === userGroup)
          const limit = matchedGroup ? matchedGroup.grouplimitnumber : 3
          const allowOvertime = matchedGroup ? (matchedGroup.allow_overtime ?? (matchedGroup['allow overtime'] ?? 1)) : 1

          if (allowOvertime === 0) {
            if (groupLeaveCount >= limit) {
              alert(`該群組 (${userGroup}) 在這天已有 ${groupLeaveCount} 人請假。請假數已達 ${limit} 人限制，無法再新增請假資料，請聯繫主管`)
              return
            }
          } else {
            if (groupLeaveCount - groupOvertimeCount >= limit) {
              alert(`該群組 (${userGroup}) 在這天已有 ${groupLeaveCount} 人請假，並有 ${groupOvertimeCount} 人加班。淨請假數已達 ${limit} 人限制，無法再新增請假資料，請聯繫主管`)
              return
            }
          }
        }

        const weeklyValidation = await validateWeeklyHours(dateString, leaveTypeName, effectiveUser)
        if (!weeklyValidation.isValid) {
          alert(weeklyValidation.message)
          return
        }
        const weeklyRestValidation = await validateWeeklyRestDays(dateString, leaveTypeName, effectiveUser)
        if (!weeklyRestValidation.isValid) {
          alert(weeklyRestValidation.message)
          return
        }
        const continuousValidation = await validateContinuousWorkDays(dateString, leaveTypeName, effectiveUser)
        if (!continuousValidation.isValid) {
          alert(continuousValidation.message)
          return
        }
        const rolling30DaysValidation = await validateRolling30DaysHours(
          dateString,
          leaveTypeName,
          effectiveUser,
          workHoursForSave
        )
        let rolling30UserConfirmed = false
        if (!rolling30DaysValidation.isValid) {
          const hint =
            (rolling30DaysValidation.message ?? '') +
            '\n\n計算說明：\n' +
            '廠區停留時間：當班(算11小時)、加班(算手填時數)、請假(算10.5-手填時數)；上述時間為估算。實際依照廠區出入口刷出為主，目前估算在特定 30 天 (滾動視窗內時間區段) 內密度過高。\n'
            alert(hint);
            return
            /** 
            if (!window.confirm(hint)) {
            return
          }
          rolling30UserConfirmed = true
          */
        }
        if (leaveTypeDataForToggle?.is_not_workday === 1) {
          const ymd = new Date(dateString + 'T12:00:00')
          const simulated: ShiftAssignment[] = [
            ...assignments.filter(a => !(a.employee_id === targetEmployeeId && a.date === dateString)),
            {
              employee_id: targetEmployeeId,
              date: dateString,
              shift_type: leaveTypeName,
            },
          ]
          const { total: projected } = computeMonthlyOvertimeTotalHours({
            year: ymd.getFullYear(),
            month: ymd.getMonth(),
            employeeId: targetEmployeeId,
            userShift: (effectiveUser?.shift_type ?? user?.shift_type ?? 'A') as 'A' | 'B',
            assignments: simulated,
            leaveTypes,
            overtimeLeaveTypeNames,
            getMonthMap,
          })
          const cap = resolveMonthlyOvertimeCapHours(effectiveUser ?? undefined)
          if (projected > cap) {
            alert(
              `當月加班時數（預估 ${projected} 小時）已超過上限 ${cap} 小時（${
                effectiveUser?.monthly_overtime_cap_hours != null ? '個人因素請洽人力課長' : '全站預設'
              }），無法儲存。`
            )
            return
          }
        }
        // 代為填寫：備註自動附帶實際登入填寫人（與 ShiftScheduler 一致）
        const substituteName =
          leaveTypeDataForToggle?.is_not_workday === 1
            ? substituteCandidatesForSelectedDate.find((s) => s.employee_id === substituteEmployeeId)?.name ?? ''
            : ''

        let finalComment = comment.trim()
        if (substituteName) {
          const note = `代班${substituteName}`
          if (!finalComment.includes(note)) {
            finalComment = finalComment ? `${finalComment} ${note}` : note
          }
        }
        if (proxyUser && user?.name) {
          const suffix = ` (填寫人: ${user.name})`
          if (!finalComment.includes(suffix)) {
            finalComment += suffix
          }
        }
        const raw = await saveShiftAssignment(
          targetEmployeeId,
          dateString,
          leaveTypeName,
          finalComment,
          otForSave,
          workHoursForSave
        )
        const newAssignment: ShiftAssignment = {
          employee_id: raw.employee_id ?? targetEmployeeId,
          date: raw.date ?? dateString,
          shift_type: raw.shift_type ?? leaveTypeName,
          comment: raw.comment ?? finalComment,
          overtime_shift: raw.overtime_shift ?? otForSave,
          work_hours: raw.work_hours ?? workHoursForSave,
        }
        setAssignments(prev => {
          const updatedAssignments = [...prev, newAssignment]
          const userOnly = updatedAssignments.filter(a => a.employee_id === targetEmployeeId)
          setCache(CACHE_KEYS.SHIFT_ASSIGNMENTS(targetEmployeeId), userOnly, CACHE_TTL.SHIFT_ASSIGNMENTS)
          return updatedAssignments
        })
        if (rolling30UserConfirmed) {
          alert(
            '已儲存。\n\n宣導：請自行注意廠區停留時間、連續出勤與滾動30日總工時，並遵守公司及法規；若有疑慮請主動聯繫主管或人資。'
          )
        }
      }

      setSelectedDateRow(null)
      setComment('')
      setWorkHoursInput('')
      setSubstituteEmployeeId('')
      setMorningSupport(false)
    } catch (error) {
      console.error('保存假别分配失败:', error)
      alert('保存失敗，請重試')
    }
  }

  if (loading) {
    return <div className="leave-overview">Loading...</div>
  }

  return (
    <div className="leave-overview">
      {updateNotice && (
        <div className="leave-update-notice" role="status" aria-live="polite">
          {updateNotice}
        </div>
      )}
      <div className="overview-header">
        <div className="month-navigation">
          <button className="nav-arrow" onClick={goToPreviousMonth}>‹</button>
          <div className="month-display" onClick={() => setShowMonthPicker(!showMonthPicker)}>
            <span className="month-year">{month + 1}月, {year}</span>
            {showMonthPicker && (
              <div className="month-picker-dropdown">
                <div className="picker-section">
                  <div className="picker-title">选择月份</div>
                  <div className="month-grid">
                    {Array.from({ length: 12 }, (_, i) => (
                      <button key={i} className={`month-option ${i === month ? 'selected' : ''}`} onClick={() => selectMonth(i)}>{i + 1}月</button>
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
        <div className="header-controls">
          <div className="group-filters">
            {['DA', 'DB', 'NA', 'NB'].map(k => (
              <label key={k} className="group-filter-label">
                <input
                  type="checkbox"
                  checked={shiftDayNightFilter[k] || false}
                  onChange={(e) => setShiftDayNightFilter(prev => ({ ...prev, [k]: e.target.checked }))}
                />
                {k}
              </label>
            ))}
            <label className="group-filter-label overtime-shift-filter-label" title="本職加班未勾選時，若該筆排班有填跨班加班且該加班有勾選，仍顯示該人員（例如本職 NB 關閉、跨班填 DA 且 DA 有勾選）">
              <input
                type="checkbox"
                checked={includeByOvertimeShiftLine}
                onChange={(e) => setIncludeByOvertimeShiftLine(e.target.checked)}
              />
              跨班加班
            </label>
          </div>
          <div className="group-filters">
            {availableGroups.map(g => (
              <label key={g} className="group-filter-label">
                <input
                  type="checkbox"
                  checked={groupFilter[g] || false}
                  onChange={(e) => setGroupFilter(prev => ({ ...prev, [g]: e.target.checked }))}
                />
                {g}
              </label>
            ))}
          </div>
          {userProfile?.role === 'manager' && (
            <div className="proxy-select-wrap">
              <label className="proxy-label">代為填寫：</label>
              <Select
                className="proxy-react-select"
                styles={{
                  container: (base) => ({ ...base, minWidth: 200 }),
                  control: (base) => ({ ...base, minHeight: 38 })
                }}
                value={proxyOptions.find(opt => opt.value === (proxyUser?.user_id ?? 0))}
                onChange={(option) => {
                  const id = option?.value ? Number(option.value) : 0
                  setProxyUser(id ? proxyEligibleUsers.find(u => u.user_id === id) ?? null : null)
                }}
                options={proxyOptions}
                isSearchable={true}
                placeholder="搜尋..."
                noOptionsMessage={() => "無理"}
              />
            </div>
          )}
          <button type="button" className="export-trigger-btn" onClick={openExportModal}>
            輸出排班
          </button>
          <button className="today-button" onClick={goToToday}>Today</button>
        </div>
      </div>

      {exportModalOpen &&
        createPortal(
          <div
            className="export-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setExportModalOpen(false)
            }}
          >
            <div className="export-modal-panel" role="dialog" aria-labelledby="export-modal-title">
              <h2 id="export-modal-title" className="export-modal-title">
                匯出排班資料
              </h2>
              
              <div className="export-modal-fields">
                <label className="export-modal-label">
                  開始日期
                  <input
                    type="date"
                    className="export-modal-date"
                    value={exportStartStr}
                    onChange={(e) => setExportStartStr(e.target.value)}
                  />
                </label>
                <label className="export-modal-label">
                  結束日期
                  <input
                    type="date"
                    className="export-modal-date"
                    value={exportEndStr}
                    onChange={(e) => setExportEndStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="export-modal-count">符合範圍筆數：<strong>{exportPreviewCount}</strong></p>
              <div className="export-modal-actions">
                <button type="button" className="export-modal-btn export-modal-btn-primary" onClick={runExportCsv}>
                  下載 CSV
                </button>
                <button type="button" className="export-modal-btn export-modal-btn-primary" onClick={runExportXlsx}>
                  下載 Excel
                </button>
                <button type="button" className="export-modal-btn" onClick={() => setExportModalOpen(false)}>
                  關閉
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 46/54 HR 當月與季度加班時數；月工時廠區估算（可收折） */}
      {effectiveUser?.shift_type && (
        <div className="overtime-46-54-block">
          <button
            type="button"
            className="overtime-section-toggle"
            onClick={() => setHrOvertimeSectionOpen((o) => !o)}
            aria-expanded={hrOvertimeSectionOpen}
          >
            <span className={`overtime-section-chevron ${hrOvertimeSectionOpen ? 'is-open' : ''}`} aria-hidden>▶</span>
            <span className="overtime-section-toggle-label">46/54 HR 加班時數</span>
            {!hrOvertimeSectionOpen && (
              <span className="overtime-section-toggle-summary">
                當月 {overtime46_54.monthly.total} / {overtime46_54.monthly.limit46} · 當季 {overtime46_54.quarterly.total} / {overtime46_54.quarterly.limit138}
              </span>
            )}
          </button>
          {hrOvertimeSectionOpen && (
            <div className="overtime-46-54-row">
              <div className="overtime-46-54-card">
                <div className="overtime-46-54-label">當月 ({year}/{month + 1})</div>
                <div className="overtime-46-54-value">
                  <span className={overtime46_54.monthly.total > overtime46_54.monthly.limitCap ? 'overtime-over' : ''}>
                    {overtime46_54.monthly.total}
                  </span>
                  <span className="overtime-46-54-limit">
                    {' '}
                    / {overtime46_54.monthly.limit46}（單月上限 {overtime46_54.monthly.limitCap} 小時）
                  </span>
                </div>
                <div className="overtime-46-54-detail">
                  平日加班 10hr：{overtime46_54.monthly.regularOvertime10hr}｜國定當班 2hr：{overtime46_54.monthly.holidayOnDuty2hr}｜國定加班 2hr：{overtime46_54.monthly.holidayOvertime2hr}
                </div>
              </div>
              <div className="overtime-46-54-card">
                <div className="overtime-46-54-label">當季 ({year} Q{Math.floor(month / 3) + 1})</div>
                <div className="overtime-46-54-value">
                  <span className={overtime46_54.quarterly.total > overtime46_54.quarterly.limit138 ? 'overtime-over' : ''}>
                    {overtime46_54.quarterly.total}
                  </span>
                  <span className="overtime-46-54-limit"> / {overtime46_54.quarterly.limit138}</span>
                </div>
              </div>
            </div>
          )}
          {rolling30WorkHours && (
            <>
              <button
                type="button"
                className="overtime-section-toggle overtime-rolling30-toggle"
                onClick={() => setRolling30SectionOpen((o) => !o)}
                aria-expanded={rolling30SectionOpen}
              >
                <span className={`overtime-section-chevron ${rolling30SectionOpen ? 'is-open' : ''}`} aria-hidden>▶</span>
                <span className="overtime-section-toggle-label">月工時廠區估算時數</span>
                {!rolling30SectionOpen && (
                  <span className="overtime-section-toggle-summary">
                    滾動30日峰值 {rolling30WorkHours.maxRollingHours} / 236 小時
                  </span>
                )}
              </button>
              {rolling30SectionOpen && (
                <div className="overtime-46-54-row">
                  <div className="overtime-46-54-card">
                    <div className="overtime-46-54-label">
                      任意連續 30 日（檢視月 ±2 月範圍內掃描）
                      {previous30DaysEstimatedHours && (
                        <span className="rolling30-recent-hours">
                          30日內(不含今日)估算：{previous30DaysEstimatedHours.hours}h
                          （{previous30DaysEstimatedHours.start}～{previous30DaysEstimatedHours.end}）
                        </span>
                      )}
                    </div>
                    <div className="overtime-46-54-value">
                      <span className={rolling30WorkHours.maxRollingHours > 236 ? 'overtime-over' : ''}>
                        {rolling30WorkHours.maxRollingHours}
                      </span>
                      <span className="overtime-46-54-limit"> / 236 小時</span>
                    </div>
                    <div className="overtime-46-54-detail">
                      區間內峰值視窗：{rolling30WorkHours.maxWindowStart} ～ {rolling30WorkHours.maxWindowEnd}（{rolling30WorkHours.maxRollingHours}h）
                      <br />
                      {rolling30WorkHours.over236Windows.length > 0 ? (
                        <>
                          <span className="rolling30-over236-heading">
                            超過236小時之連續30日視窗（共 {rolling30WorkHours.over236Windows.length} 個）：
                          </span>
                          <ul className="rolling30-over236-list">
                            {rolling30WorkHours.over236Windows.map((w, idx) => (
                              <li key={`${w.windowStart}-${w.windowEnd}-${idx}`}>
                                {w.windowStart} ～ {w.windowEnd}（{w.hours} 小時）
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <>目前掃描範圍內無超過236小時之滾動視窗。</>
                      )}
                      <br />
                      參考日（今日）：{formatDateString(new Date())}｜對象：{effectiveUser?.name ?? '—'}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="overview-table">
        {dates.map((date) => {
          const dateString = formatDateString(date)
          const tag = monthTagMap[dateString]
          const isSelected = selectedDateRow === dateString
          return (
            <div
              key={date.getTime()}
              className={`date-row ${isSelected ? 'selected' : ''} ${isSaturday(date) ? 'saturday-row' : ''}`}
              onDoubleClick={() => handleDateRowDoubleClick(dateString)}
            >
              {/* 左側週碼條：每一列都顯示，整週可辨識；週起始列強調，其餘列淡色延續 */}
              <div
                className={`week-rail ${isWeekStart(date) ? 'is-week-start' : ''}`}
                title={`第 ${getSundayWeek(date).week} 週 / ${getSundayWeek(date).weekYear}`}
              >
                <span className="week-rail-code">{formatWeekCode(date)}</span>
              </div>

              {/* 左侧日期 */}
              <div className={`date-column ${tag?.pattern === 'B' ? 'pattern-b' : ''}`}>
                <div className="day-name">{getDayName(date)}</div>
                <div className={`day-number ${isToday(date) ? 'today' : ''}`}>
                  {date.getDate()}
                </div>
                {tag?.comment && (
                  <div className="comment-display" title={tag.comment}>
                    {tag.comment}
                  </div>
                )}
              </div>

              {/* 右侧假别列表 */}
              <div className="leave-column">
                {/* 統計：請假人數與加班人數 */}
                {(() => {
                  const dayStats = dailyLeaveStatsByDate.get(dateString)
                  if (!dayStats) return null
                  const hasAnyStats = dayStats.totalLeave > 0 || dayStats.totalOvertime > 0 || dayStats.totalTraining > 0
                  if (hasAnyStats) {
                    return (
                      <>
                        <div className="leave-stats leave-stats-total">
                          <span className="stat-item">請假：{dayStats.totalLeave}人</span>
                          <span className="stat-item">加班：{dayStats.totalOvertime}人</span>
                          <span className="stat-item">上課：{dayStats.totalTraining}人</span>
                        </div>
                        {dayStats.byShiftLine.length > 0 && (
                          <div className="leave-stats leave-stats-by-line">
                            {dayStats.byShiftLine.map((line) => (
                              <span key={line.shiftLine} className="stat-item stat-item-line-breakdown">
                                {line.shiftLine} 請假:{line.leave}, 加班:{line.overtime}, 上課:{line.training}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  }
                  return null
                })()}

                {/* 第一组：工作日假别 (is_not_workday = 0) */}
                <div className="leave-group">
                  {groupedLeaveTypes.workday
                    .filter((leaveType) => getPeopleForLeaveType(dateString, leaveType.name).length > 0)
                    .map((leaveType) => {
                      const people = getPeopleForLeaveType(dateString, leaveType.name)
                      return (
                        <div key={leaveType.leave_id} className="leave-item">
                          <div
                            className="leave-name"
                            style={{ backgroundColor: leaveType.color || '#ff9800' }}
                          >
                            {leaveType.name}
                          </div>
                          {renderPeopleGroupedByShiftLine(people)}
                        </div>
                      )
                    })}
                </div>

                {/* 第二组：非工作日假别 (is_not_workday = 1) */}
                <div className="leave-group">
                  {groupedLeaveTypes.nonWorkday
                    .filter((leaveType) => getPeopleForLeaveType(dateString, leaveType.name).length > 0)
                    .map((leaveType) => {
                      const people = getPeopleForLeaveType(dateString, leaveType.name)
                      return (
                        <div key={leaveType.leave_id} className="leave-item">
                          <div
                            className="leave-name"
                            style={{ backgroundColor: leaveType.color || '#ff9800' }}
                          >
                            {leaveType.name}
                          </div>
                          {renderPeopleGroupedByShiftLine(people)}
                        </div>
                      )
                    })}
                </div>
              </div>

              {/* 双击显示的可用假别类型菜单 */}
              {isSelected && (
                <div className="date-leave-menu">
                  <div className="menu-title">可用假別類型</div>
                  <div className="comment-input-section">
                    <input
                      type="text"
                      className="comment-input"
                      placeholder="備註 (最多100字)"
                      maxLength={100}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <span className="comment-count">{comment.length}/100</span>
                    {selectedAssignment && (
                      <button
                        type="button"
                        className="update-comment-btn"
                        onClick={() => void handleUpdateAssignmentDetails(dateString)}
                      >
                        更新註解
                      </button>
                    )}
                  </div>
                  <div className="work-hours-input-section">
                    <label className="work-hours-input-label" htmlFor={`work-hours-${dateString}`}>
                      當日工時（0~13，最多小數點兩位）預設不用填寫,除非跨班加班或是七廠上課等
                    </label>
                    <input
                      id={`work-hours-${dateString}`}
                      type="text"
                      inputMode="decimal"
                      className="work-hours-input"
                      placeholder="例加班半天填寫6請假一小時填1"
                      value={workHoursInput}
                      onChange={(e) => {
                        const next = e.target.value.trim()
                        if (next === '' || /^\d{0,2}(\.\d{0,2})?$/.test(next)) {
                          setWorkHoursInput(next)
                        }
                      }}
                    />
                    {selectedAssignment && (
                      <button
                        type="button"
                        className="update-work-hours-btn"
                        onClick={() => void handleUpdateAssignmentDetails(dateString)}
                      >
                        更新時間
                      </button>
                    )}
                  </div>
                  {(() => {
                    const msCode = morningSupportCodeFor(effectiveUser ?? {})
                    if (!msCode) return null
                    const prevDateStr = shiftDateString(dateString, -1)
                    const prevDateObj = new Date(prevDateStr + 'T12:00:00')
                    const prevMap = getMonthMap(prevDateObj.getFullYear(), prevDateObj.getMonth())
                    const prevTag = prevMap[prevDateStr]
                    const userShift = effectiveUser?.shift_type ?? ''
                    const prevPattern = prevTag?.pattern ?? prevTag?.shift_type ?? ''
                    if (prevPattern !== 'A' && prevPattern !== 'B') return null
                    const prevIsNonWorkday = prevPattern !== userShift
                    if (!prevIsNonWorkday) return null
                    return (
                      <div className="overtime-shift-pick-section">
                        <label className="overtime-shift-pick-label">
                          <input
                            type="checkbox"
                            className="morning-support-checkbox"
                            checked={morningSupport}
                            onChange={(e) => setMorningSupport(e.target.checked)}
                          />
                          <span>跨班早班加班</span>
                          <span className="morning-support-hint">
                            （日／夜班皆可；自動帶入 overtime_shift：{msCode}）
                          </span>
                        </label>
                      </div>
                    )
                  })()}
                  {substituteCandidatesForSelectedDate.length > 0 && (
                    <div className="substitute-select-section">
                      <label className="substitute-select-label" htmlFor={`substitute-${dateString}`}>
                        代班對象（同組請假人員）
                      </label>
                      <select
                        id={`substitute-${dateString}`}
                        className="substitute-select"
                        value={substituteEmployeeId}
                        onChange={(e) => setSubstituteEmployeeId(e.target.value)}
                      >
                        <option value="">不指定</option>
                        {substituteCandidatesForSelectedDate.map((candidate) => (
                          <option key={candidate.employee_id} value={candidate.employee_id}>
                            {candidate.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="available-leave-types">
                    {getAvailableLeaveTypesForDate(dateString).map((leaveType) => {
                      const msCode = morningSupportCodeFor(effectiveUser ?? {})
                      const pickOt: OvertimeShiftCode | null =
                        leaveType.is_not_workday === 1 && morningSupport && msCode ? msCode : null
                      const isUserAssigned = assignments.some(
                        a =>
                          a.employee_id === targetEmployeeId &&
                          a.date === dateString &&
                          a.shift_type === leaveType.name &&
                          (leaveType.is_not_workday !== 1 ||
                            normOvertimeShiftLabel(a.overtime_shift) === normOvertimeShiftLabel(pickOt))
                      )
                      return (
                        <div
                          key={leaveType.leave_id}
                          className={`available-leave-item ${isUserAssigned ? 'assigned' : ''}`}
                          onClick={() => handleLeaveTypeSelect(dateString, leaveType.name)}
                        >
                          <div
                            className="leave-type-badge"
                            style={{ backgroundColor: leaveType.color || '#ff9800' }}
                          >
                            {leaveType.name}
                          </div>
                          <span className="leave-type-info">
                            {leaveType.is_not_workday === 0 ? '工作日' : '非工作日'}
                            {isUserAssigned && ' (已選擇)'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    className="close-menu-btn"
                    onClick={closeDateLeaveMenu}
                  >
                    關閉
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default LeaveOverview
