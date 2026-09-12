/**
 * 取得目前登入者的工號，供 API 在日誌中識別實際操作者。
 * 未登入或舊版 localStorage 資料無工號時，不傳送此標頭。
 */
export function actorRequestHeaders(): Record<string, string> {
  try {
    const storedUser = JSON.parse(localStorage.getItem('user') ?? '{}') as { employee_id?: unknown }
    const employeeId = typeof storedUser.employee_id === 'string' ? storedUser.employee_id.trim() : ''
    return employeeId ? { 'X-Actor-Employee-ID': employeeId } : {}
  } catch {
    return {}
  }
}
