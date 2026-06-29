import { HrEmployeeModal } from '@/components/hr/HrEmployeeModal'
import type { EmployeeEditorContext } from '@/hooks/useEmployeeEditor'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

type Props = {
  ctx: EmployeeEditorContext | null
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  onSave: (e: Employee) => void
  onClose: () => void
}

export function EmployeeEditorHost({
  ctx,
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onSave,
  onClose,
}: Props) {
  if (!ctx) return null

  return (
    <HrEmployeeModal
      employee={ctx.employee}
      employees={employees}
      brigades={brigades}
      hrStructuralUnits={hrStructuralUnits}
      hrPositions={hrPositions}
      isNew={ctx.isNew}
      onSave={(emp) => {
        onSave(emp)
        ctx.onSavedExtra?.(emp)
      }}
      onClose={onClose}
    />
  )
}
