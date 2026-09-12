import { computePayrollHourDetail } from '@/lib/finance/payrollDetail'
import { brigadeTimesheetFingerprint } from '@/lib/brigadeSignoff'
import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { createDefaultFinanceStore, normalizeFinanceStore } from '@/lib/finance/init'
import {
  monthStatement,
  statementRowForEmployee,
  statementTotals,
  buildPayrollSnapshot,
} from '@/lib/finance/calc'
import { createSettingsSlice } from '@/store/slices/settingsSlice'
import { calculateRowPay } from '@/lib/payroll'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { buildSalary1cRows } from '@/lib/finance/georgiaSalary1c'
import { createDefaultMealsStore } from '@/lib/meals/init'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'

const month = '2026-07',
  day = `${month}-01`
function fixture() {
  const employee = {
    id: 'e',
    fullName: 'Synthetic',
    tabNumber: '1',
    position: '',
    group2x2: '',
    cycleStart: '',
    active: true,
    schedule: '5/2 8ч',
    brigade: 'B1',
    monthlySalary: 1840,
    personalId: 'TEST',
  } as Employee
  const sheet = {
    month,
    rows: [{ id: 'r1', employeeId: 'e', brigade: 'B1' }],
    plan: { r1: { [day]: '8' } },
    fact: { r1: { [day]: '8' } },
    factOverrides: [`r1|${day}`],
    brigadierDays: {},
  } as MonthSheet
  let store: AppStore = {
    ...createDefaultStore(),
    employees: [employee],
    months: { [month]: sheet },
    closedMonths: [],
    finance: createDefaultFinanceStore(),
  }
  sheet.brigadeSignoffs = {
    B1: { verified: true, at: day, fingerprint: brigadeTimesheetFingerprint(sheet, 'B1', store) },
  }
  const settings = createSettingsSlice(
    {
      getStore: () => store,
      setStore: (fn) => {
        store = typeof fn === 'function' ? fn(store) : fn
      },
    },
    { getActiveMonth: () => month, setActiveMonth: () => {} },
  )
  return {
    get store() {
      return store
    },
    employee,
    sheet,
    settings,
  }
}

describe('payroll integrity', () => {
  it('reclosing uses corrected facts and retains the previous approved version', () => {
    const f = fixture()
    f.settings.setMonthClosed(month, true)
    expect(monthStatement(f.store, month)[0].accrued).toBe(80)
    f.settings.setMonthClosed(month, false)
    f.store.employees[0] = { ...f.employee, monthlySalary: 3680 }
    expect(monthStatement(f.store, month)[0].accrued).toBe(160)
    f.sheet.brigadeSignoffs = {
      B1: {
        verified: true,
        at: day,
        fingerprint: brigadeTimesheetFingerprint(f.sheet, 'B1', f.store),
      },
    }
    f.settings.setMonthClosed(month, true)
    expect(monthStatement(f.store, month)[0].accrued).toBe(160)
    expect(Object.values(f.store.finance!.snapshotHistory!)[0].rows[0].accrued).toBe(80)
  })

  it('freezes details, roster and meals but keeps later payouts live', () => {
    const f = fixture()
    f.settings.setMonthClosed(month, true)
    f.store.employees[0] = { ...f.employee, monthlySalary: 3680 }
    f.store.meals = createDefaultMealsStore()
    f.store.meals.acceptedDays.push({ id: 'ad', date: day, acceptedAt: day })
    f.store.meals.orders.push({
      id: 'o',
      date: day,
      employeeId: 'e',
      employeeName: 'Synthetic',
      status: 'accepted',
      lines: [{ optionId: 'x', qty: 1, employeeUnitGel: 5 }],
      createdAt: day,
      updatedAt: day,
    })
    f.store.finance!.payouts.push({
      id: 'p',
      employeeId: 'e',
      month,
      date: day,
      amount: 20,
      method: 'cash',
      at: day,
    })
    delete f.store.months[month]
    f.store.employees = []
    const row = monthStatement(f.store, month)[0]
    expect([row.accrued, row.breakdown.base, row.net, row.paid, row.remaining]).toEqual([
      80, 80, 80, 20, 60,
    ])
    expect(row.emp.fullName).toBe('Synthetic')
  })

  it('preserves legacy snapshot amounts without inventing its missing explanation', () => {
    const f = fixture()
    f.store.closedMonths = [month]
    f.store.finance!.snapshots[month] = {
      month,
      at: day,
      rows: [
        {
          employeeId: 'e',
          rowId: 'r1',
          accrued: 80,
          bonus: 0,
          penalty: 0,
          advance: 0,
          net: 75,
          factHours: 8,
        },
      ],
    }
    const row = monthStatement(f.store, month)[0]
    expect(row.net).toBe(75)
    expect(row.mealDeduction).toBe(5)
    expect(row.hourDetail.unavailable).toBe(true)
    expect(row.rateLabel).toBe('')
  })

  it('counts employee transactions once for duplicate/split brigade rows and totals the personal view', () => {
    const f = fixture(),
      day2 = `${month}-02`
    f.sheet.rows.push({ id: 'r2', employeeId: 'e', brigade: 'B1' })
    f.sheet.plan.r2 = { [day2]: '8' }
    f.sheet.fact.r2 = { [day2]: '8' }
    f.store.finance!.advances.push({
      id: 'a',
      employeeId: 'e',
      month,
      date: day,
      amount: 30,
      method: 'cash',
      at: day,
    })
    f.store.finance!.adjustments.push({
      id: 'b',
      employeeId: 'e',
      month,
      date: day,
      kind: 'bonus',
      amount: 10,
      reason: 'test',
      at: day,
    })
    for (const brigade of ['B1', 'B3']) {
      f.employee.brigade = brigade
      const rows = monthStatement(f.store, month),
        totals = statementTotals(rows)
      expect([totals.accrued, totals.advance, totals.bonus, totals.net]).toEqual([160, 30, 10, 140])
      expect(statementRowForEmployee(f.store, month, 'e')?.net).toBe(140)
      expect(rows.reduce((s, r) => s + r.otherManualBonus, 0)).toBe(10)
    }
  })

  it('uses reduced work norm for overtime even below the full plan', () => {
    const f = fixture()
    for (const d of ['01', '02', '03', '06', '07']) {
      f.sheet.plan.r1[`${month}-${d}`] = '8'
      f.sheet.fact.r1[`${month}-${d}`] = '8'
    }
    f.sheet.fact.r1[day] = 'ОТ'
    f.sheet.plan.r1[`${month}-04`] = 'В'
    f.sheet.fact.r1[`${month}-04`] = '4'
    const opts = { vacationConfirmed: true }
    expect(getRowHoursSnapshot(f.sheet, 'r1', f.employee, 2026, 7, opts).monthDeltaOtHours).toBe(4)
    const pay = calculateRowPay(f.employee, f.sheet, 'r1', 2026, 7, opts)
    expect([pay.breakdown.base, pay.breakdown.ot110, pay.breakdown.vacation, pay.amount]).toEqual([
      320, 44, 80, 444,
    ])
  })

  it('allocates night overtime once and shows the same hours as the monetary calculation', () => {
    const f = fixture()
    f.sheet.plan.r1[day] = '8'
    f.sheet.fact.r1[day] = 'Н'
    f.sheet.factHoursOverride = { [`r1|${day}`]: 12 }
    const pay = calculateRowPay(f.employee, f.sheet, 'r1', 2026, 7)
    const detail = computePayrollHourDetail(f.store, f.sheet, 'r1', f.employee, 2026, 7)
    expect([detail.nightShiftHours, detail.otNightHours, detail.monthDeltaOtHours]).toEqual([
      8, 4, 4,
    ])
    expect([pay.breakdown.base, pay.breakdown.night, pay.breakdown.ot120, pay.amount]).toEqual([
      0, 100, 54, 154,
    ])
  })

  it('preserves payroll and brigadier totals when a month is split across rows', () => {
    const f = fixture(),
      nextDay = `${month}-02`
    f.sheet.plan.r1[nextDay] = '8'
    f.sheet.fact.r1[nextDay] = '8'
    f.sheet.factHoursOverride = { [`r1|${nextDay}`]: 10 }
    f.store.brigadiers.B1 = 'e'
    const before = statementRowForEmployee(f.store, month, 'e')!
    f.sheet.rows.push({ id: 'r2', employeeId: 'e', brigade: 'B1', sortOrder: 1 })
    f.sheet.plan.r2 = { [nextDay]: '8' }
    f.sheet.fact.r2 = { [nextDay]: '8' }
    delete f.sheet.plan.r1[nextDay]
    delete f.sheet.fact.r1[nextDay]
    f.sheet.factHoursOverride = { [`r2|${nextDay}`]: 10 }
    const after = statementRowForEmployee(f.store, month, 'e')!
    expect(after.accrued).toBe(before.accrued)
    expect(after.brigadierBonus).toBe(before.brigadierBonus)
    expect(after.hourDetail.otDayHours).toBe(2)
    expect(after.hourDetail.baseHours + after.hourDetail.otDayHours).toBe(18)
    expect(after.net).toBe(before.net)
  })

  it('retains tetri', () => {
    const f = fixture()
    f.employee.monthlySalary = 1886
    f.sheet.factHoursOverride = { [`r1|${day}`]: 1 }
    expect(calculateRowPay(f.employee, f.sheet, 'r1', 2026, 7).amount).toBe(10.25)
  })

  it('exports full monthly net to 1C independently of advances and partial payments', () => {
    const f = fixture()
    const before = buildSalary1cRows(f.store, month, day).rows[0].netSalaryGel
    f.store.finance!.advances.push({
      id: 'a',
      employeeId: 'e',
      month,
      date: day,
      amount: 30,
      method: 'cash',
      at: day,
    })
    f.store.finance!.payouts.push({
      id: 'p',
      employeeId: 'e',
      month,
      date: day,
      amount: 20,
      method: 'cash',
      at: day,
    })
    expect(buildSalary1cRows(f.store, month, day).rows[0].netSalaryGel).toBe(before)
    expect(monthStatement(f.store, month)[0].remaining).toBe(30)
  })

  it('normalization retains v2 snapshot and avoids copying PIN/biometric data', () => {
    const f = fixture()
    f.employee.attendancePinHash = 'must-not-copy'
    f.employee.attendanceFaceDescriptor = [1, 2]
    f.settings.setMonthClosed(month, true)
    const normalized = normalizeFinanceStore(JSON.parse(JSON.stringify(f.store.finance)))
    expect(normalized.snapshots[month].version).toBe(2)
    expect(normalized.snapshots[month].rows[0].statement?.emp.attendancePinHash).toBeUndefined()
    expect(
      normalized.snapshots[month].rows[0].statement?.emp.attendanceFaceDescriptor,
    ).toBeUndefined()
    expect(buildPayrollSnapshot(f.store, month).rows[0].statement?.breakdown.base).toBe(80)
  })
})
