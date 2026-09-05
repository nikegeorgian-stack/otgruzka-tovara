import { describe, expect, it } from 'vitest'
import { creditedAbsenceHours } from '@/lib/absenceConfirm'
import { calculateRowPay } from '@/lib/payroll'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { autoCodeForDay, resolveCycleStart } from '@/lib/schedule'
import { effectiveShiftHours } from '@/lib/schedules'
import type { DayCode, Employee, MonthSheet } from '@/lib/types'

const emp = {
  id: 'e1',
  fullName: 'Test',
  active: true,
  schedule: '5/2 8ч',
  shiftMode: 'day',
  brigade: 'B1',
  monthlySalary: 1840,
} as Employee

/** План по графику 5/2, факт = ОТ на всех рабочих днях. */
function buildVacationSheet(month: string, year: number, mo: number): MonthSheet {
  const rowId = 'r1'
  const days = new Date(year, mo, 0).getDate()
  const plan: Record<string, DayCode> = {}
  const fact: Record<string, DayCode> = {}
  const overrides: string[] = []
  const cycleStart = resolveCycleStart(emp, year, mo)
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`
    const code = autoCodeForDay(
      emp.schedule,
      cycleStart,
      year,
      mo,
      d,
      emp.shiftMode ?? 'day',
      effectiveShiftHours(emp),
    )
    plan[key] = code
    if (code !== 'В' && code !== '') {
      fact[key] = 'ОТ'
      overrides.push(`${rowId}|${key}`)
    } else {
      fact[key] = code
    }
  }
  return {
    month,
    rows: [{ id: rowId, employeeId: 'e1', brigade: 'B1' }],
    plan: { [rowId]: plan },
    fact: { [rowId]: fact },
    factOverrides: overrides,
    brigadierDays: {},
  } as MonthSheet
}

describe('confirmed vacation closes hour norm', () => {
  it('creditedAbsenceHours returns shift hours for confirmed ОТ', () => {
    const h = creditedAbsenceHours(emp, 2026, 8, 11, 'ОТ', { vacationConfirmed: true })
    expect(h).toBe(8)
    expect(creditedAbsenceHours(emp, 2026, 8, 11, 'ОТ', { vacationConfirmed: false })).toBe(0)
  })

  it('full-month fact with confirm matches plan when work days are ОТ', () => {
    const sheet = buildVacationSheet('2026-08', 2026, 8)
    const confirm = { vacationConfirmed: true, sickConfirmed: false }
    const snap = getRowHoursSnapshot(sheet, 'r1', emp, 2026, 8, confirm)
    expect(snap.planHours).toBeGreaterThan(0)
    expect(snap.factHours).toBe(snap.planHours)
    expect(Math.max(0, snap.planHours - snap.factHours)).toBe(0)
  })

  it('without confirm ОТ does not close plan', () => {
    const sheet = buildVacationSheet('2026-08', 2026, 8)
    const snap = getRowHoursSnapshot(sheet, 'r1', emp, 2026, 8, {
      vacationConfirmed: false,
    })
    expect(snap.factHours).toBe(0)
    expect(snap.planHours).toBeGreaterThan(0)
  })

  it('payroll vacation hours > 0 when plan is work and fact is ОТ', () => {
    const sheet = buildVacationSheet('2026-08', 2026, 8)
    const pay = calculateRowPay(emp, sheet, 'r1', 2026, 8, {
      vacationConfirmed: true,
    })
    expect(pay.breakdown.vacation).toBeGreaterThan(0)
    expect(pay.amount).toBeGreaterThan(0)
  })

  it('payroll vacation hours > 0 when plan cell is already ОТ', () => {
    const sheet = buildVacationSheet('2026-08', 2026, 8)
    // Как после проведения отпуска в план
    for (const key of Object.keys(sheet.fact.r1 ?? {})) {
      if (sheet.fact.r1![key] === 'ОТ') sheet.plan.r1![key] = 'ОТ'
    }
    const pay = calculateRowPay(emp, sheet, 'r1', 2026, 8, {
      vacationConfirmed: true,
    })
    expect(pay.breakdown.vacation).toBeGreaterThan(0)
  })
})
