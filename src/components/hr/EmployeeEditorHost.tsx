import { HrEmployeeModal } from '@/components/hr/HrEmployeeModal'
import type { EmployeeEditorSession } from '@/hooks/useEmployeeEditor'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import type { AppStore, Employee } from '@/lib/types'

type Props = {
  sessions: EmployeeEditorSession[]
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  onUpsertPosition?: (p: HrPosition) => void
  store?: AppStore
  lockHolderUid?: string
  lockHolderName?: string
  canForceTakeOver?: boolean
  canEditSalary?: boolean
  onSave: (sessionId: string, e: Employee) => void
  onClose: (sessionId: string) => void
}

export function EmployeeEditorHost({
  sessions,
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onUpsertPosition,
  store,
  lockHolderUid,
  lockHolderName,
  canForceTakeOver,
  canEditSalary = false,
  onSave,
  onClose,
}: Props) {
  if (sessions.length === 0) return null

  return (
    <>
      {sessions.map((session) => (
        <HrEmployeeModal
          key={session.id}
          windowId={session.id}
          employee={session.employee}
          employees={employees}
          brigades={brigades}
          hrStructuralUnits={hrStructuralUnits}
          hrPositions={hrPositions}
          onUpsertPosition={onUpsertPosition}
          store={store}
          isNew={session.isNew}
          lockHolderUid={lockHolderUid}
          lockHolderName={lockHolderName}
          canForceTakeOver={canForceTakeOver}
          canEditSalary={canEditSalary}
          onSave={(emp) => {
            onSave(session.id, emp)
            session.onSavedExtra?.(emp)
          }}
          onClose={() => onClose(session.id)}
        />
      ))}
    </>
  )
}
