import { describe, expect, it } from 'vitest'
import { reorderBrigadeRow } from '@/lib/brigadeRows'
import type { MonthSheet, TimesheetRow } from '@/lib/types'

function sheetWith(rows: TimesheetRow[]): MonthSheet {
  return {
    month: '2026-08',
    rows,
    plan: {},
    fact: {},
    comments: {},
    substitutions: {},
    factOverrides: [],
  }
}

describe('reorderBrigadeRow', () => {
  const a: TimesheetRow = { id: 'a', brigade: 'Б1', employeeId: 'e1', sortOrder: 0 }
  const b: TimesheetRow = { id: 'b', brigade: 'Б1', employeeId: 'e2', sortOrder: 1 }
  const c: TimesheetRow = { id: 'c', brigade: 'Б1', employeeId: 'e3', sortOrder: 2 }
  const other: TimesheetRow = { id: 'x', brigade: 'Б2', employeeId: 'e9', sortOrder: 0 }

  it('moves row before another inside the same brigade', () => {
    const next = reorderBrigadeRow(sheetWith([a, b, c, other]), 'Б1', 'c', 'a')
    const order = next.rows
      .filter((r) => r.brigade === 'Б1')
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map((r) => r.id)
    expect(order).toEqual(['c', 'a', 'b'])
    expect(next.rows.find((r) => r.id === 'x')?.brigade).toBe('Б2')
  })

  it('moves row to end when beforeRowId is null', () => {
    const next = reorderBrigadeRow(sheetWith([a, b, c]), 'Б1', 'a', null)
    const order = next.rows
      .filter((r) => r.brigade === 'Б1')
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map((r) => r.id)
    expect(order).toEqual(['b', 'c', 'a'])
  })

  it('no-ops when row is not in brigade', () => {
    const base = sheetWith([a, b, other])
    const next = reorderBrigadeRow(base, 'Б1', 'x', 'a')
    expect(next).toBe(base)
  })
})
