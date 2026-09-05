import { describe, expect, it } from 'vitest'
import { calculateRowPay } from '@/lib/payroll'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { OT_DAY_MULTIPLIER } from '@/lib/payrollRates'
import type { DayCode, Employee, MonthSheet } from '@/lib/types'

const emp = {
  id: 'e1',
  fullName: 'Test',
  active: true,
  schedule: '5/2 8ч',
  shiftMode: 'day',
  brigade: 'B1',
  monthlySalary: 1840, // 10 ₾/ч при норме 184
} as Employee

/**
 * Июль 2026, 5 дней плана по 8ч (=40), один день факт ОТ, на рабочих днях
 * суммарно 48 ч факта → норма работы 32, переработка 16 (не 8 = 48−40).
 */
function buildSheet(): MonthSheet {
  const rowId = 'r1'
  const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07']
  const plan: Record<string, DayCode> = {}
  const fact: Record<string, DayCode> = {}
  const factHoursOverride: Record<string, number> = {}
  for (const key of days) {
    plan[key] = '8'
    fact[key] = '8'
  }
  // 1-е — подтверждённый отпуск
  fact['2026-07-01'] = 'ОТ'
  // На 4 рабочих дня: 12+12+12+12 = 48 ч
  for (const key of ['2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07']) {
    factHoursOverride[`r1|${key}`] = 12
  }
  return {
    month: '2026-07',
    rows: [{ id: rowId, employeeId: 'e1', brigade: 'B1' }],
    plan: { [rowId]: plan },
    fact: { [rowId]: fact },
    factOverrides: ['r1|2026-07-01'],
    factHoursOverride,
    brigadierDays: {},
  } as MonthSheet
}

describe('vacation reduces work norm for month-Δ overtime', () => {
  it('OT hours = workFact − (plan − vacation), not workFact − plan', () => {
    const sheet = buildSheet()
    const confirm = { vacationConfirmed: true, sickConfirmed: false }
    const snap = getRowHoursSnapshot(sheet, 'r1', emp, 2026, 7, confirm)

    expect(snap.planHours).toBe(40)
    expect(snap.workFactHours).toBe(48)
    expect(snap.factHours).toBe(48 + 8) // работа + зачёт ОТ
    expect(snap.workNormHours).toBe(32)
    expect(snap.workHoursDelta).toBe(16)
    // Старый баг: 48 − 40 = 8; верно: 48 − (40 − 8) = 16
    expect(snap.monthDeltaOtHours).toBe(16)
  })

  it('payroll pays OT on 16h at 110%, base on 32h, vacation 8h', () => {
    const sheet = buildSheet()
    const pay = calculateRowPay(emp, sheet, 'r1', 2026, 7, {
      vacationConfirmed: true,
    })
    const rate = 1840 / 184
    expect(pay.breakdown.base).toBe(Math.round(32 * rate))
    expect(pay.breakdown.vacation).toBe(Math.round(8 * rate))
    expect(pay.breakdown.ot110).toBe(Math.round(16 * rate * OT_DAY_MULTIPLIER))
    expect(pay.breakdown.overtime).toBe(pay.breakdown.ot110)
  })
})
