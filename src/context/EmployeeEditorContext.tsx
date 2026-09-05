import { createContext, useContext, type ReactNode } from 'react'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import {
  useEmployeeEditor,
  type EmployeeEditorContext as EditorCtx,
} from '@/hooks/useEmployeeEditor'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import type { AppStore, Employee } from '@/lib/types'

type EmployeeEditorApi = ReturnType<typeof useEmployeeEditor>

const EmployeeEditorReactContext = createContext<EmployeeEditorApi | null>(null)

type ProviderProps = {
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  onUpsertPosition?: (p: HrPosition) => void
  /** Для вкладки «Табель» в карточке сотрудника. */
  store?: AppStore
  onSave: (e: Employee) => void
  lockHolderUid?: string
  lockHolderName?: string
  canForceTakeOver?: boolean
  /** HR / инспектор / финансы / sysadmin — оклад в карточке. */
  canEditSalary?: boolean
  children: ReactNode
}

/**
 * Глобальный хост карточек сотрудника — живёт на уровне App.
 * Несколько сессий: свёрнутая остаётся в панели, можно открыть другую.
 */
export function EmployeeEditorProvider({
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onUpsertPosition,
  store,
  onSave,
  lockHolderUid,
  lockHolderName,
  canForceTakeOver,
  canEditSalary = false,
  children,
}: ProviderProps) {
  const editor = useEmployeeEditor(brigades, employees)

  return (
    <EmployeeEditorReactContext.Provider value={editor}>
      {children}
      <EmployeeEditorHost
        sessions={editor.sessions}
        employees={employees}
        brigades={brigades}
        hrStructuralUnits={hrStructuralUnits}
        hrPositions={hrPositions}
        onUpsertPosition={onUpsertPosition}
        store={store}
        lockHolderUid={lockHolderUid}
        lockHolderName={lockHolderName}
        canForceTakeOver={canForceTakeOver}
        canEditSalary={canEditSalary}
        onSave={(_sessionId, e) => {
          onSave(e)
        }}
        onClose={(sessionId) => editor.closeSession(sessionId)}
      />
    </EmployeeEditorReactContext.Provider>
  )
}

export function useEmployeeEditorApi(): EmployeeEditorApi {
  const ctx = useContext(EmployeeEditorReactContext)
  if (!ctx) {
    throw new Error('useEmployeeEditorApi must be used within EmployeeEditorProvider')
  }
  return ctx
}

/** Безопасный вариант — null вне провайдера (страницы могут держать локальный редактор). */
export function useEmployeeEditorApiOptional(): EmployeeEditorApi | null {
  return useContext(EmployeeEditorReactContext)
}

export type { EditorCtx }
