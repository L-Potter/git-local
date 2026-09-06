import React, { useMemo, useState } from 'react'
import { useCalendarTags, ShiftPattern } from '../hooks/useCalendarTags'
import { useCalendarTagsAPI } from '../hooks/useCalendarTagsAPI'
import { useAuth } from '../hooks/useAuth'
import './ShiftPattern.css'

const MONTHS_ZH = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ALL_PATTERNS: ShiftPattern[] = ['A', 'B']

const ShiftPatternPage: React.FC = () => {
  const [year, setYear] = useState(new Date().getFullYear())
  const { tags, getMonthMap, getAllTags, setComment } = useCalendarTags()
  const { setCalendarTag, deleteCalendarTag } = useCalendarTagsAPI()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [commentText, setCommentText] = useState('')

  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => m), [])

  const getDaysInMonth = (y: number, m: number) => {
    const last = new Date(y, m + 1, 0).getDate()
    return Array.from({ length: last }, (_, i) => new Date(y, m, i + 1))
  }

  const toggleSelect = (date: string) => {
    setSelectedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date])
  }

  const applyHoliday = async (isHoliday: boolean) => {
    if (selectedDates.length === 0) return
    for (const date of selectedDates) {
      await setCalendarTag(date, isHoliday)
    }
    setSelectedDates([])
    await getAllTags() // Refresh data after modification
  }

  const applyPattern = async (pattern: ShiftPattern | null) => {
    if (selectedDates.length === 0) return
    for (const date of selectedDates) {
      await setCalendarTag(date, undefined, pattern)
    }
    setSelectedDates([])
    await getAllTags() // Refresh data after modification
  }

  const generateTwoOnTwoOff = async (startDate: string, startPattern: ShiftPattern) => {
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(year, 11, 31)
    if (isNaN(start.getTime())) return

    let d = new Date(start)
    let currentPattern = startPattern

    while (d <= end) {
      // 兩天同一班別 (使用固定的起始班別)
      for (let k = 0; k < 2 && d <= end; k++) {
        await setCalendarTag(formatDate(d), undefined, currentPattern)
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      }
      // 兩天休息 (不設定班別)
      //for (let k = 0; k < 2 && d <= end; k++) {
      //  await setCalendarTag(formatDate(d), undefined, null)
      //  d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      //}
      // 切換班別
      currentPattern = currentPattern === 'A' ? 'B' : 'A'
    }
    await getAllTags() // Refresh data after modification
  }

  const applyComment = async () => {
    if (selectedDates.length === 0 || !commentText.trim()) return
    for (const date of selectedDates) {
      await setComment(date, commentText.trim())
    }
    setSelectedDates([])
    setCommentText('')
    await getAllTags() // Refresh data after modification
  }

  const removeComment = async () => {
    if (selectedDates.length === 0) return
    for (const date of selectedDates) {
      // Use null instead of empty string, or pass a space to bypass empty field validation if null is rejected
      await setComment(date, ' ')
    }
    setSelectedDates([])
    setCommentText('')
    await getAllTags() // Refresh data after modification
  }

  const clearAllTags = async () => {
    // 過濾出當年所有的tag
    const yearTags = tags.filter(tag => {
      const tagDate = new Date(tag.date + 'T00:00:00')
      return tagDate.getFullYear() === year
    })

    // 刪除所有當年的tag
    for (const tag of yearTags) {
      await deleteCalendarTag(tag.date)
    }

    await getAllTags() // Refresh data after modification
  }

  return (
    <div className="pattern-page">
      <div className="pattern-header">
        <h1>班別年曆設定</h1>
        <div className="year-nav">
          <button className="nav-btn" onClick={() => setYear(year - 1)}>‹</button>
          <div className="year-title">{year} 年</div>
          <button className="nav-btn" onClick={() => setYear(year + 1)}>›</button>
        </div>
      </div>

      <div className="toolbar">
        {isAdmin && (
          <>
            <div className="group">
              <span className="group-title">國定假日</span>
              <button className="btn" onClick={() => applyHoliday(true)}>標記為假日</button>
              <button className="btn" onClick={() => applyHoliday(false)}>取消假日</button>
            </div>
            <div className="group">
              <span className="group-title">班別</span>
              {ALL_PATTERNS.map(p => (
                <button key={p} className="btn" onClick={() => applyPattern(p)}>{p}</button>
              ))}
              <button className="btn" onClick={() => applyPattern(null)}>清除班別</button>
            </div>
            <div className="group">
              <span className="group-title">自動 2 上 2 休（至年底）</span>
              <AutoTwoOnTwoOff onGenerate={(startDate, startPattern) => generateTwoOnTwoOff(startDate, startPattern)} defaultYear={year} />
            </div>
          </>
        )}
        <div className="group">
          <span className="group-title">註解</span>
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="輸入註解..."
            className="comment-input"
          />
          <button className="btn" onClick={applyComment}>新增註解</button>
          <button className="btn" onClick={removeComment}>移除註解</button>
        </div>
        {isAdmin && (
          <div className="group">
            <span className="group-title">清除所有設定</span>
            <button className="btn danger" onClick={clearAllTags}>清除 {year} 年所有標記</button>
          </div>
        )}
      </div>

      <div className="year-grid">
        {months.map((m) => {
          const monthDays = getDaysInMonth(year, m)
          const map = getMonthMap(year, m)
          return (
            <div key={m} className="month-card">
              <div className="month-header">{MONTHS_ZH[m]}</div>
              <div className="month-calendar">
                {['日','一','二','三','四','五','六'].map(dn => (
                  <div key={dn} className="weekday">{dn}</div>
                ))}
                {Array.from({ length: monthDays[0].getDay() }, (_, i) => (
                  <div key={`l-${i}`} className="empty"></div>
                ))}
                {monthDays.map((d) => {
                  const ds = formatDate(d)
                  const tag = map[ds]
                  const selected = selectedDates.includes(ds)
                  return (
                    <div key={ds} className={`cell ${selected ? 'selected' : ''} ${tag?.isHoliday ? 'holiday' : ''}`} onClick={() => toggleSelect(ds)}>
                      <div className="date-num">{d.getDate()}</div>
                      {tag?.pattern && <div className="pattern-badge">{tag.pattern}</div>}
                      {tag?.isHoliday && <div className="holiday-badge">假日</div>}
                      {tag?.comment && tag.comment.trim() !== '' && <div className="comment-badge" title={tag.comment}>註</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="legend">
        <div className="legend-item"><span className="legend-color holiday"></span> 國定假日</div>
        <div className="legend-item"><span className="legend-color pattern"></span> 班別（A 班 / B 班）</div>
      </div>
    </div>
  )
}

const AutoTwoOnTwoOff: React.FC<{ onGenerate: (startDate: string, startPattern: ShiftPattern) => void, defaultYear: number }> = ({ onGenerate, defaultYear }) => {
  const [startDate, setStartDate] = useState(`${defaultYear}-01-01`)
  const [startPattern, setStartPattern] = useState<ShiftPattern>('A')

  return (
    <div className="auto-gen">
      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
      <select value={startPattern} onChange={e => setStartPattern(e.target.value as ShiftPattern)}>
        <option value="A">A 班</option>
        <option value="B">B 班</option>
      </select>
      <button className="btn" onClick={() => onGenerate(startDate, startPattern)}>產生</button>
    </div>
  )
}

export default ShiftPatternPage
