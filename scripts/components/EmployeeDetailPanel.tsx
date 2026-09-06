import React, { useState, useEffect, useMemo } from 'react'
import { User } from '../hooks/useUsersAPI'
import { useCalendarTagsAPI, CalendarTag } from '../hooks/useCalendarTagsAPI'
import { useShiftAssignmentsAPI, ShiftAssignment } from '../hooks/useShiftAssignmentsAPI'
import './EmployeeDetailPanel.css'

interface LeaveType {
  leave_id: number
  name: string
  is_not_workday: number
  color?: string
  created_at: string
}

interface LeaveTypesData {
  employee_id: string
  leave_types: LeaveType[]
}

interface EmployeeDetailPanelProps {
  user: User
  onClose: () => void
}

const MONTHS_ZH = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
]

const EmployeeDetailPanel: React.FC<EmployeeDetailPanelProps> = ({ user, onClose }) => {
  const { getCalendarTags } = useCalendarTagsAPI()
  const { getShiftAssignments } = useShiftAssignmentsAPI()
  const [activeTab, setActiveTab] = useState<'personal' | 'schedule'>('personal')
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [calendarTags, setCalendarTags] = useState<CalendarTag[]>([])
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignment[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypesData | null>(null)

  useEffect(() => {
    const loadData = async () => {
      // Load calendar tags
      try {
        const tags = await getCalendarTags()
        setCalendarTags(tags)
      } catch (error) {
        console.error('Failed to load calendar tags:', error)
      }

      // Load shift assignments
      try {
        const assignments = await getShiftAssignments(user.employee_id)
        setShiftAssignments(assignments || [])
      } catch (error) {
        console.error('Failed to load shift assignments:', error)
      }

      // Load leave types
      try {
        const leaveTypesResponse = await fetch(`/api/leave-types`)
        if (leaveTypesResponse.ok) {
          const responseData = await leaveTypesResponse.json()
          // The response is the leave_types array
          setLeaveTypes({ employee_id: user.employee_id, leave_types: responseData })
        } else {
          console.error('Failed to load leave types')
        }
      } catch (error) {
        console.error('Failed to load leave types:', error)
      }
    }
    loadData()
  }, [])//user.employee_id

  // 根據用戶的班別決定顯示邏輯
  const userShiftType = useMemo(() => {
    if (!user.shift_type) return null
    // NA, DA 視為 A 班, DB, NB 視為 B 班
    if (['NA', 'DA'].includes(user.shift_type)) return 'A'
    if (['DB', 'NB'].includes(user.shift_type)) return 'B'
    return user.shift_type
  }, [user.shift_type])

  // 獲取假別的顏色
  const getLeaveTypeColor = (leaveTypeName: string): string => {
    const leaveType = leaveTypes?.leave_types.find(type => type.name === leaveTypeName)
    return leaveType?.color || '#ff9800'
  }

  const formatDateString = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const getDaysInMonth = (date: Date): (Date | null)[] => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    
    const startingDayOfWeek = firstDay.getDay()
    const totalDays = lastDay.getDate()
    
    const days: (Date | null)[] = []
    
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    
    for (let i = 1; i <= totalDays; i++) {
      days.push(new Date(year, month, i))
    }
    return days
  }

  const getCalendarTagForDate = (date: Date): CalendarTag | null => {
    const dateString = formatDateString(date)
    return calendarTags.find(tag => tag.date === dateString) || null
  }

  const getShiftAssignmentForDate = (date: Date): ShiftAssignment | null => {
    const dateString = formatDateString(date)
    return shiftAssignments.find(assignment => assignment.date === dateString) || null
  }

  const goToPreviousMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1))
  }

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2>{user.name} - 詳細資訊</h2>
          <button className="panel-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === 'personal' ? 'active' : ''}`}
            onClick={() => setActiveTab('personal')}
          >
            個人資訊
          </button>
          <button
            className={`panel-tab ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            班表
          </button>
        </div>

        <div className="panel-content">
          {activeTab === 'personal' && (
            <div className="personal-info-view">
              <div className="info-row">
                <label>姓名</label>
                <span>{user.name}</span>
              </div>
              <div className="info-row">
                <label>工號</label>
                <span>{user.employee_id}</span>
              </div>
              <div className="info-row">
                <label>班別</label>
                <span>{user.shift_type ? `${user.shift_type} 班` : '未設定'}</span>
              </div>
              <div className="info-row">
                <label>廠區</label>
                <span>{user.site || '未設定'}</span>
              </div>
              <div className="info-row">
                <label>角色</label>
                <span>{user.role === 'admin' ? '管理員' : '一般用戶'}</span>
              </div>
              <div className="info-row">
                <label>建立時間</label>
                <span>{new Date(user.created_at).toLocaleString('zh-TW')}</span>
              </div>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="schedule-view">
              <div className="schedule-month-selector">
                <button className="month-nav-btn" onClick={goToPreviousMonth}>
                  ‹
                </button>
                <span className="month-display">
                  {selectedMonth.getFullYear()}年 {MONTHS_ZH[selectedMonth.getMonth()]}
                </span>
                <button className="month-nav-btn" onClick={goToNextMonth}>
                  ›
                </button>
              </div>
              <div className="schedule-calendar">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                  <div key={`header-${d}`} style={{ textAlign: 'center', fontSize: '13px', fontWeight: 'bold', color: '#666', paddingBottom: '8px' }}>
                    {d}
                  </div>
                ))}
                {getDaysInMonth(selectedMonth).map((date, index) => {
                  if (!date) {
                    return <div key={`empty-${index}`} className="schedule-day" style={{ border: 'none', background: 'transparent' }}></div>
                  }
                  
                  const tag = getCalendarTagForDate(date)
                  const assignment = getShiftAssignmentForDate(date)
                  const isWorkDay = tag && tag.shift_type === userShiftType
                  const isHoliday = tag && tag.is_holiday === 1
                  const leaveType = assignment ? leaveTypes?.leave_types.find(lt => lt.name === assignment.shift_type) : null

                  return (
                    <div key={date.getTime()} className="schedule-day">
                      <div className="schedule-day-number">{date.getDate()}</div>
                      {isWorkDay && (
                        <div className="schedule-shift-badge work-day">
                          當班
                        </div>
                      )}
                      {isHoliday && (
                        <div className="schedule-shift-badge holiday">
                          假日
                        </div>
                      )}
                      {leaveType && (
                        <div
                          className="schedule-shift-badge leave"
                          style={{ backgroundColor: leaveType.color || '#ff9800' }}
                          title={assignment?.overtime_shift ? `跨班線別：${assignment.overtime_shift}` : undefined}
                        >
                          {leaveType.name}
                          {assignment?.overtime_shift ? ` [${assignment.overtime_shift}]` : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default EmployeeDetailPanel
