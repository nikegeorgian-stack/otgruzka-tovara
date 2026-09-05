import { describe, expect, it } from 'vitest'
import { resolveCabinetAsOfDate } from '@/lib/employeeCabinet/asOf'
import { sumPlanHours } from '@/lib/hr/absencePlan'
import { rowStats } from '@/lib/stats'
import type { DayCode, Employee, MonthSheet } from '@/lib/types'

const emp = {
  id: 'e1',
  fullName: 'Test',
  active: true,
  schedule: '5/2',
  shiftMode: 'day',
  brigade: 'B1',
} as Employee

function sheetWithPlanFact(month: string, days: number): MonthSheet {
  const rowId = 'r1'
  const plan: Record<string, DayCode> = {}
  const fact: Record<string, DayCode> = {}
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`
    plan[key] = '8'
    // факт = план на весь месяц (как после копирования) — без asOf выглядело бы «всё отработано»
    fact[key] = '8'
  }
  return {
    month,
    rows: [{ id: rowId, employeeId: 'e1', brigade: 'B1' }],
    plan: { [rowId]: plan },
    fact: { [rowId]: fact },
    factOverrides: [],
    brigadierDays: {},
  } as MonthSheet
}

describe('cabinet as-of hours', () => {
  it('resolveCabinetAsOfDate: current month → today', () => {
    expect(resolveCabinetAsOfDate('2026-08', '2026-08-11')).toBe('2026-08-11')
  })

  it('resolveCabinetAsOfDate: past month → undefined (full)', () => {
    expect(resolveCabinetAsOfDate('2026-07', '2026-08-11')).toBeUndefined()
  })

  it('resolveCabinetAsOfDate: future month → empty slice', () => {
    expect(resolveCabinetAsOfDate('2026-09', '2026-08-11')).toBe('0000-01-01')
  })

  it('rowStats with asOfDate ignores future plan-as-fact days', () => {
    const sheet = sheetWithPlanFact('2026-08', 31)
    const full = rowStats(sheet, 'r1', 31, 2026, 8, emp)
    const toDate = rowStats(sheet, 'r1', 31, 2026, 8, emp, undefined, '2026-08-11')
    expect(full.factHours).toBeGreaterThan(toDate.factHours)
    expect(toDate.factHours).toBe(11 * 8)
    expect(toDate.planHours).toBe(11 * 8)
    const monthPlan = sumPlanHours(emp, sheet.plan.r1!, 2026, 8, 31)
    expect(monthPlan).toBeGreaterThan(toDate.planHours)
  })
})
