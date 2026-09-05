import { describe, expect, it } from 'vitest'
import { applyEmployeeMovementJournal, isMovementJournalKind } from '@/lib/hr/movementJournal'
import type { Employee } from '@/lib/types'

function emp(partial: Partial<Employee> & Pick<Employee, 'id' | 'fullName'>): Employee {
  return {
    tabNumber: '',
    position: 'Оператор',
    brigade: 'А',
    schedule: '5/2 8ч',
    group2x2: 'A',
    cycleStart: '2026-01-01',
    active: true,
    ...partial,
  } as Employee
}

describe('applyEmployeeMovementJournal name_change', () => {
  it('writes name_change when fullName changes', () => {
    const prev = emp({ id: 'e1', fullName: 'Иванов Иван' })
    const next = emp({ id: 'e1', fullName: 'Петров Пётр' })
    const out = applyEmployeeMovementJournal(prev, next)
    const row = out.hrJournal?.find((j) => j.kind === 'name_change')
    expect(row).toBeTruthy()
    expect(row?.prev).toBe('Иванов Иван')
    expect(row?.next).toBe('Петров Пётр')
    expect(isMovementJournalKind('name_change')).toBe(true)
  })

  it('does not write name_change when only brigade changes', () => {
    const prev = emp({ id: 'e1', fullName: 'Иванов Иван', brigade: 'А' })
    const next = emp({ id: 'e1', fullName: 'Иванов Иван', brigade: 'Б' })
    const out = applyEmployeeMovementJournal(prev, next)
    expect(out.hrJournal?.some((j) => j.kind === 'name_change')).toBe(false)
    expect(out.hrJournal?.some((j) => j.kind === 'brigade_transfer')).toBe(true)
  })
})
