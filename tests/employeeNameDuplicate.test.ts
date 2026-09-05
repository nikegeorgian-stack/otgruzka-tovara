import { describe, expect, it } from 'vitest'
import {
  findEmployeeFullNameDuplicate,
  normalizeEmployeeFullName,
} from '@/lib/hr/employeeName'
import type { Employee } from '@/lib/types'

function employee(id: string, fullName: string): Employee {
  return { id, fullName } as Employee
}

describe('employee full-name duplicate guard', () => {
  it('normalizes case, repeated spaces and ё', () => {
    expect(normalizeEmployeeFullName('  Алёна   СЕМЁНОВА ')).toBe('алена семенова')
  })

  it('finds the same first-name and surname combination', () => {
    const existing = employee('existing', 'Алёна Семёнова')

    expect(
      findEmployeeFullNameDuplicate([existing], '  АЛЕНА   семёнова  '),
    ).toBe(existing)
  })

  it('does not treat the edited employee as its own duplicate', () => {
    const existing = employee('existing', 'Алёна Семёнова')

    expect(
      findEmployeeFullNameDuplicate([existing], 'Алёна Семёнова', 'existing'),
    ).toBeUndefined()
  })
})
