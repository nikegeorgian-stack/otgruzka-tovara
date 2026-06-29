import { useCallback, useState } from 'react'
import { createNewEmployee } from '@/lib/hr/newEmployee'
import type { Employee } from '@/lib/types'

export type EmployeeEditorContext = {
  employee: Employee
  isNew: boolean
  assignToRowId?: string
  onSavedExtra?: (emp: Employee) => void
}

export function useEmployeeEditor(brigades: string[], employees: Employee[]) {
  const [ctx, setCtx] = useState<EmployeeEditorContext | null>(null)

  const openNew = useCallback(
    (options?: {
      brigade?: string
      assignToRowId?: string
      onSavedExtra?: (emp: Employee) => void
    }) => {
      setCtx({
        employee: createNewEmployee(brigades, employees, { brigade: options?.brigade }),
        isNew: true,
        assignToRowId: options?.assignToRowId,
        onSavedExtra: options?.onSavedExtra,
      })
    },
    [brigades, employees],
  )

  const openEdit = useCallback((employee: Employee) => {
    setCtx({ employee, isNew: false })
  }, [])

  const close = useCallback(() => setCtx(null), [])

  return { ctx, openNew, openEdit, close, setCtx }
}
