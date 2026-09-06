/** 全站預設：當月加班時數上限（users.monthly_overtime_cap_hours 為 NULL 時使用） */
export const DEFAULT_MONTHLY_OVERTIME_CAP_HOURS = 54

/** 全站預設：單週工時上限（validateWeeklyHours） */
export const DEFAULT_WEEKLY_WORK_HOURS_CAP = 50

/** HR 參考：法規常見單月加班建議值（僅供畫面對照，非強制欄位） */
export const MONTHLY_OVERTIME_REFERENCE_SOFT_LIMIT = 46

export function resolveMonthlyOvertimeCapHours(user?: {
  monthly_overtime_cap_hours?: number | null
}): number {
  const v = user?.monthly_overtime_cap_hours
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  return DEFAULT_MONTHLY_OVERTIME_CAP_HOURS
}
