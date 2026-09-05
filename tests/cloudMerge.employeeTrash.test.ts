import { describe, expect, it } from 'vitest'
import { applyRosterTrashTombstones, mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { createDefaultStore } from '@/lib/storage'
import { restoreTrashEmployee, trashEmployee } from '@/lib/trash'
import type { Employee } from '@/lib/types'

function emp(id: string, extra?: Partial<Employee>): Employee {
  return {
    id,
    fullName: `Emp ${id}`,
    active: true,
    schedule: '5/2 8ч',
    shiftMode: 'day',
    ...extra,
  } as Employee
}

describe('applyRosterTrashTombstones', () => {
  it('drops roster row that sits in merged trash unless this session restored it', () => {
    const roster = [emp('a'), emp('b')]
    const tombstones = new Set(['a'])
    const kept = applyRosterTrashTombstones(roster, tombstones, [emp('b')], new Set(), new Set(['a']))
    expect(kept.map((e) => e.id)).toEqual(['b'])
  })

  it('keeps employee restored from trash this session', () => {
    const roster = [emp('a')]
    const kept = applyRosterTrashTombstones(
      roster,
      new Set(['a']),
      [emp('a')],
      new Set(['a']),
      new Set(),
    )
    expect(kept.map((e) => e.id)).toEqual(['a'])
  })
})

describe('mergeCloudStores employee trash', () => {
  const theo = emp('theo-jeiran', { fullName: 'Джейраношвили Тео' })

  it('does not resurrect a locally trashed employee when remote card drifted', () => {
    const base = { ...createDefaultStore(), employees: [theo] }
    const remote = {
      ...createDefaultStore(),
      employees: [{ ...theo, position: 'оператор', employeeNumber: '99' }],
    }
    const local = trashEmployee(base, theo.id)
    const { store } = mergeCloudStores(base, remote, local)
    expect(store.employees.some((e) => e.id === theo.id)).toBe(false)
    expect(store.trash.employees.some((t) => t.employee.id === theo.id)).toBe(true)
  })

  it('stale client with old roster cannot push a trashed employee back', () => {
    const withEmp = { ...createDefaultStore(), employees: [theo] }
    const deleted = trashEmployee(withEmp, theo.id)
    const { store } = mergeCloudStores(withEmp, deleted, withEmp)
    expect(store.employees.some((e) => e.id === theo.id)).toBe(false)
    expect(store.trash.employees.some((t) => t.employee.id === theo.id)).toBe(true)
  })

  it('restore from trash keeps the employee', () => {
    const withEmp = { ...createDefaultStore(), employees: [theo] }
    const deleted = trashEmployee(withEmp, theo.id)
    const at = deleted.trash.employees[0]?.deletedAt
    expect(at).toBeTruthy()
    const restored = restoreTrashEmployee(deleted, at)
    const { store } = mergeCloudStores(deleted, deleted, restored)
    expect(store.employees.some((e) => e.id === theo.id)).toBe(true)
    expect(store.trash.employees.some((t) => t.employee.id === theo.id)).toBe(false)
  })
})
