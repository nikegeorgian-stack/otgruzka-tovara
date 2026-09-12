import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { createDefaultFinanceStore } from '@/lib/finance/init'
import { calculateRowPay } from '@/lib/payroll'
import { monthStatement, statementRowForEmployee, buildPayrollSnapshot } from '@/lib/finance/calc'
import { roundMoney } from '@/lib/finance/money'
import { fullScheduleMonthHours } from '@/lib/schedule'
import { assertBrigadesNotWiped } from '@/lib/cloud/refuseStoreWipe'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'

describe('payroll tetri consistency 1840/176 × 16h', () => {
  const month = '2099-03'
  const year = 2099
  const mo = 3
  const emp = {
    id: 'e1',
    fullName: 'Round Test',
    tabNumber: 'RT1',
    position: 't',
    group2x2: '',
    cycleStart: '',
    active: true,
    schedule: '5/2 8ч',
    brigade: 'B',
    monthlySalary: 1840,
  } as Employee

  it('does not pre-round hourly rate; 16h base is 167.27', () => {
    const norm = fullScheduleMonthHours(emp, year, mo)
    expect(norm).toBe(176)
    const exact = 1840 / 176
    expect(exact).toBeCloseTo(10.454545, 5)
    expect(roundMoney(exact)).toBe(10.45) // label only
    expect(roundMoney(16 * exact)).toBe(167.27)
    expect(roundMoney(roundMoney(8 * exact) + roundMoney(8 * exact))).toBe(167.28)
  })

  it('employee aggregate of two 8h rows matches one 16h row (167.27)', () => {
    const d1 = '2099-03-02'
    const d2 = '2099-03-03'
    const sheetOne: MonthSheet = {
      month,
      rows: [{ id: 'r16', employeeId: emp.id, brigade: 'B', sortOrder: 0 }],
      plan: { r16: { [d1]: '8', [d2]: '8' } },
      fact: { r16: { [d1]: '8', [d2]: '8' } },
      factOverrides: [`r16|${d1}`, `r16|${d2}`],
      factExtraHours: {},
      comments: {},
      substitutions: {},
    }
    const one = calculateRowPay(emp, sheetOne, 'r16', year, mo)
    expect(one.breakdown.base).toBe(167.27)
    expect(one.amount).toBe(167.27)

    const sheetTwo: MonthSheet = {
      month,
      rows: [
        {
          id: 'ra',
          employeeId: emp.id,
          brigade: 'B',
          periodStart: '2099-03-01',
          periodEnd: '2099-03-15',
          sortOrder: 0,
        },
        {
          id: 'rb',
          employeeId: emp.id,
          brigade: 'B',
          periodStart: '2099-03-16',
          periodEnd: '2099-03-31',
          sortOrder: 1,
        },
      ],
      plan: { ra: { [d1]: '8' }, rb: { [d2]: '8' } },
      fact: { ra: { [d1]: '8' }, rb: { [d2]: '8' } },
      factOverrides: [`ra|${d1}`, `rb|${d2}`],
      factExtraHours: {},
      comments: {},
      substitutions: {},
    }
    const a = calculateRowPay(emp, sheetTwo, 'ra', year, mo)
    const b = calculateRowPay(emp, sheetTwo, 'rb', year, mo)
    expect(a.breakdown.base).toBe(83.64)
    expect(b.breakdown.base).toBe(83.64)
    // Naive sum of independent tetri lines differs:
    expect(roundMoney(a.breakdown.base + b.breakdown.base)).toBe(167.28)

    const store = {
      ...createDefaultStore(),
      employees: [emp],
      months: { [month]: sheetTwo },
      finance: createDefaultFinanceStore(),
    } as AppStore
    const dual = monthStatement(store, month).filter((r) => r.employeeId === emp.id)
    expect(dual).toHaveLength(2)
    expect(roundMoney(dual.reduce((s, r) => s + r.accrued, 0))).toBe(167.27)
    expect(roundMoney(dual.reduce((s, r) => s + r.breakdown.base, 0))).toBe(167.27)

    const agg = statementRowForEmployee(store, month, emp.id)!
    expect(agg.accrued).toBe(167.27)
    expect(agg.breakdown.base).toBe(167.27)
    expect(agg.accrued).toBe(one.amount)

    const snap = buildPayrollSnapshot(store, month)
    const snapAccrued = roundMoney(
      snap.rows.filter((r) => r.employeeId === emp.id).reduce((s, r) => s + r.accrued, 0),
    )
    expect(snapAccrued).toBe(167.27)
  })
})

describe('assertBrigadesNotWiped', () => {
  it('refuses missing/undefined brigades over non-empty remote (incomplete load)', () => {
    const remote = { brigades: ['A', 'B'] } as AppStore
    expect(() =>
      assertBrigadesNotWiped(remote, { brigades: undefined } as unknown as AppStore),
    ).toThrow(/cloud_refuse_brigades_wipe/)
    expect(() => assertBrigadesNotWiped(remote, {} as AppStore)).toThrow(/cloud_refuse_brigades_wipe/)
  })

  it('allows explicit empty array (intentional delete of last brigade)', () => {
    expect(() =>
      assertBrigadesNotWiped({ brigades: ['A'] } as AppStore, { brigades: [] } as AppStore),
    ).not.toThrow()
  })

  it('allows empty when remote also empty/missing', () => {
    expect(() =>
      assertBrigadesNotWiped({ brigades: [] } as AppStore, { brigades: [] } as AppStore),
    ).not.toThrow()
  })
})
