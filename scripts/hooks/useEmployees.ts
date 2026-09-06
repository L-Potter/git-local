import { useState, useEffect } from 'react'

export interface Employee {
  id: string
  name: string
  employeeId: string // 工號
  shiftPattern: 'NA' | 'DA' | 'NB' | 'DB' // 班別
  factory: 'P1' | 'P2' | 'P3' | 'P4' // 廠區
  password?: string // 密碼
}

const DEFAULT_EMPLOYEES: Employee[] = [
  { id: '1', name: '藍奕嫻', employeeId: 'E001', shiftPattern: 'NA', factory: 'P1' },
  { id: '2', name: '鮑軼琨', employeeId: 'E002', shiftPattern: 'DA', factory: 'P1' },
  { id: '3', name: '馬羿雨', employeeId: 'E003', shiftPattern: 'NB', factory: 'P2' },
  { id: '4', name: '姚伯佑', employeeId: 'E004', shiftPattern: 'DB', factory: 'P2' },
  { id: '5', name: '柳毅凱', employeeId: 'E005', shiftPattern: 'NA', factory: 'P3' },
  { id: '6', name: '傅家悅', employeeId: 'E006', shiftPattern: 'DA', factory: 'P3' },
  { id: '7', name: '黎正諺', employeeId: 'E007', shiftPattern: 'NB', factory: 'P4' },
  { id: '8', name: '楊成葦', employeeId: 'E008', shiftPattern: 'DB', factory: 'P4' },
  { id: '9', name: '傅文弘', employeeId: 'E009', shiftPattern: 'NA', factory: 'P1' },
  { id: '10', name: '朱汶慈', employeeId: 'E010', shiftPattern: 'DA', factory: 'P2' },
]

const STORAGE_KEY = 'employees'

export const useEmployees = () => {
  const [employees, setEmployees] = useState<Employee[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load employees from storage:', error)
    }
    return DEFAULT_EMPLOYEES
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(employees))
    } catch (error) {
      console.error('Failed to save employees to storage:', error)
    }
  }, [employees])

  const updateEmployee = (id: string, updates: Partial<Employee>) => {
    setEmployees(
      employees.map(emp =>
        emp.id === id ? { ...emp, ...updates } : emp
      )
    )
  }

  const getEmployeeById = (id: string): Employee | undefined => {
    return employees.find(emp => emp.id === id)
  }

  const addEmployee = (employee: Omit<Employee, 'id'>) => {
    const newId = `emp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newEmployee: Employee = {
      id: newId,
      ...employee,
    }
    setEmployees([...employees, newEmployee])
    return newId
  }

  const deleteEmployee = (id: string) => {
    setEmployees(employees.filter(emp => emp.id !== id))
  }

  return {
    employees,
    updateEmployee,
    getEmployeeById,
    addEmployee,
    deleteEmployee,
  }
}

