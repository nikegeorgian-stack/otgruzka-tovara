import { useCallback, useRef, useState } from 'react'
import { createNewEmployee } from '@/lib/hr/newEmployee'
import { dispatchMinimizeOverlays, dispatchRestoreWindow } from '@/lib/ui/overlayEvents'
import type { Employee } from '@/lib/types'

export type EmployeeEditorContext = {
  employee: Employee
  isNew: boolean
  assignToRowId?: string
  onSavedExtra?: (emp: Employee) => void
}

/** Одна открытая (или свёрнутая) карточка сотрудника. */
export type EmployeeEditorSession = EmployeeEditorContext & {
  id: string
}

function newSessionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `emp-win-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useEmployeeEditor(brigades: string[], employees: Employee[]) {
  const [sessions, setSessions] = useState<EmployeeEditorSession[]>([])
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const openNew = useCallback(
    (options?: {
      brigade?: string
      assignToRowId?: string
      onSavedExtra?: (emp: Employee) => void
    }) => {
      dispatchMinimizeOverlays()
      const session: EmployeeEditorSession = {
        id: newSessionId(),
        employee: createNewEmployee(brigades, employees, { brigade: options?.brigade }),
        isNew: true,
        assignToRowId: options?.assignToRowId,
        onSavedExtra: options?.onSavedExtra,
      }
      window.setTimeout(() => {
        setSessions((prev) => [...prev, session])
      }, 0)
    },
    [brigades, employees],
  )

  /**
   * Открыть карточку. Если этот сотрудник уже свёрнут — вернуть его на экран.
   * Если открыта другая — свернуть её и открыть новую (обе остаются в панели).
   */
  const openEdit = useCallback((employee: Employee) => {
    const existing = sessionsRef.current.find((s) => !s.isNew && s.employee.id === employee.id)
    if (existing) {
      dispatchMinimizeOverlays()
      window.setTimeout(() => {
        dispatchRestoreWindow(existing.id)
      }, 0)
      return existing.id
    }

    dispatchMinimizeOverlays()
    const session: EmployeeEditorSession = {
      id: newSessionId(),
      employee,
      isNew: false,
    }
    window.setTimeout(() => {
      setSessions((prev) => {
        if (prev.some((s) => !s.isNew && s.employee.id === employee.id)) return prev
        return [...prev, session]
      })
    }, 0)
    return session.id
  }, [])

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
  }, [])

  /** Закрыть последнюю сессию (совместимость). */
  const close = useCallback(() => {
    setSessions((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)))
  }, [])

  const ctx = sessions.length > 0 ? sessions[sessions.length - 1]! : null

  return {
    sessions,
    ctx,
    openNew,
    openEdit,
    close,
    closeSession,
  }
}
