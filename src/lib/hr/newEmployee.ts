import { newId } from '@/lib/hr/files'
import { applyHrStatus } from '@/lib/hr/sync'
import { suggestNextTabNumber } from '@/lib/hr/tabNumber'
import type { Employee } from '@/lib/types'

export function createNewEmployee(
  brigades: string[],
  employees: Employee[],
  options?: { brigade?: string },
): Employee {
  const today = new Date().toISOString().slice(0, 10)
  const brigade = options?.brigade ?? brigades[0] ?? ''
  return applyHrStatus(
    {
      id: newId(),
      fullName: '',
      tabNumber: suggestNextTabNumber(employees),
      position: '',
      brigade,
      schedule: '2/2 11ч',
      group2x2: 'А',
      cycleStart: today,
      active: true,
      hireDate: today,
      hrDocuments: [],
      hrAbsences: [],
      hrTrainings: [],
      department: brigade,
      line: brigade,
      currency: 'GEL',
      contractType: 'full_time',
      shiftMode: 'day',
      employmentStatus: 'active',
    },
    'active',
  )
}
