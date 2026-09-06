import React, { useState, useEffect } from 'react'
import { useShiftSettingAPI, LeaveType, CreateLeaveTypeData } from '../hooks/useShiftSettingAPI'
import './ShiftSettings.css'

const ShiftSettings: React.FC = () => {
  const { getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType } = useShiftSettingAPI()
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingType, setEditingType] = useState<LeaveType | null>(null)
  const [formData, setFormData] = useState({ name: '', is_not_workday: false, color: '#ff9800' })

  useEffect(() => {
    const fetchLeaveTypes = async () => {
      setLoading(true)
      try {
        const types = await getLeaveTypes()
        setLeaveTypes(types)
      } catch (error) {
        console.error('Failed to fetch leave types:', error)
        alert('載入假別失敗')
      } finally {
        setLoading(false)
      }
    }
    fetchLeaveTypes()
  }, [])

  const handleOpenAddModal = () => {
    setFormData({ name: '', is_not_workday: false, color: '#ff9800' })
    setEditingType(null)
    setShowAddModal(true)
  }

  const handleOpenEditModal = (type: LeaveType) => {
    setFormData({ name: type.name, is_not_workday: !!type.is_not_workday, color: type.color || '#ff9800' })
    setEditingType(type)
    setShowAddModal(true)
  }

  const handleCloseModal = () => {
    setShowAddModal(false)
    setEditingType(null)
    setFormData({ name: '', is_not_workday: false, color: '#ff9800' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      alert('請輸入假別名稱')
      return
    }

    try {
      if (editingType) {
        await updateLeaveType(editingType.leave_id, { name: formData.name.trim(), is_not_workday: formData.is_not_workday, color: formData.color })
        // Refresh list
        const types = await getLeaveTypes()
        setLeaveTypes(types)
      } else {
        await createLeaveType({ name: formData.name.trim(), is_not_workday: formData.is_not_workday, color: formData.color })
        // Refresh list
        const types = await getLeaveTypes()
        setLeaveTypes(types)
      }
      handleCloseModal()
    } catch (error) {
      console.error('Failed to save leave type:', error)
      alert('儲存假別失敗')
    }
  }

  const handleDelete = async (type: LeaveType) => {
    if (window.confirm(`確定要刪除「${type.name}」這個假別嗎？`)) {
      try {
        await deleteLeaveType(type.leave_id)
        // Refresh list
        const types = await getLeaveTypes()
        setLeaveTypes(types)
      } catch (error) {
        console.error('Failed to delete leave type:', error)
        alert('刪除假別失敗')
      }
    }
  }

  return (
    <div className="shift-settings">
      <div className="settings-header">
        <h1>假別設定</h1>
        <button className="add-shift-type-btn" onClick={handleOpenAddModal}>
          + 新增假別
        </button>
      </div>

      <div className="settings-content">
        {loading ? (
          <div className="loading">載入中...</div>
        ) : (
          <>
            <div className="shift-types-list">
              {leaveTypes.map((type) => (
                <div key={type.leave_id} className="shift-type-card">
                  <div className="type-preview">
                    <div className="type-color-indicator" style={{ backgroundColor: type.color || '#ff9800' }}></div>
                    <div className="type-label">{type.name}</div>
                    {type.is_not_workday ? (
                      <div className="holiday-badge"> 假日</div>
                    ) : (
                      <div className="workday-badge"> -當班</div>
                    )}
                  </div>
                  <div className="type-actions">
                    <button
                      className="action-btn edit-btn"
                      onClick={() => handleOpenEditModal(type)}
                      title="編輯"
                    >
                      ✏️
                    </button>
                    <button
                      className="action-btn delete-btn"
                      onClick={() => handleDelete(type)}
                      title="刪除"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {leaveTypes.length === 0 && (
              <div className="empty-state">
                <p>還沒有定義任何假別</p>
                <p className="empty-hint">點擊上方的「+ 新增假別」按鈕來新增</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 新增/編輯模態框 */}
      {showAddModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingType ? '編輯假別' : '新增假別'}</h2>
              <button className="modal-close" onClick={handleCloseModal}>
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="name">假別名稱</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：喪假、病假、年假..."
                  maxLength={20}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="color">顏色</label>
                <input
                  id="color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_not_workday}
                    onChange={(e) => setFormData({ ...formData, is_not_workday: e.target.checked })}
                  />
                  是否為加班類型
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                  取消
                </button>
                <button type="submit" className="btn-submit">
                  {editingType ? '更新' : '新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ShiftSettings
