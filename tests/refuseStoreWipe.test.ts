import { describe, expect, it } from 'vitest'
import {
  assertNoMassStoreWipe,
  countAuditJournal,
  countFilledTimesheetCells,
  countFinanceFootprint,
  countHrContractFootprint,
  countMealsFootprint,
  countWarehouseFootprint,
} from '@/lib/cloud/refuseStoreWipe'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

function emp(i: number) {
  return {
    id: `e${i}`,
    fullName: `Emp ${i}`,
    active: true,
    schedule: '5/2 8ч',
    shiftMode: 'day' as const,
  }
}

function sheetWithCells(n: number): MonthSheet {
  const plan: Record<string, Record<string, DayCode>> = { r1: {} }
  const fact: Record<string, Record<string, DayCode>> = { r1: {} }
  for (let i = 1; i <= n; i++) {
    const day = `2026-07-${String(i).padStart(2, '0')}`
    plan.r1[day] = '8'
    fact.r1[day] = '8'
  }
  return {
    year: 2026,
    month: 7,
    rows: [{ id: 'r1', employeeId: 'e1', order: 0 }],
    plan,
    fact,
  } as MonthSheet
}

function warehouse(opts: { items: number; movements: number; documents: number }): WarehouseStore {
  return {
    locations: [],
    categories: [],
    items: Array.from({ length: opts.items }, (_, i) => ({ id: `i${i}` })) as never[],
    movements: Array.from({ length: opts.movements }, (_, i) => ({ id: `m${i}` })) as never[],
    documents: Array.from({ length: opts.documents }, (_, i) => ({ id: `d${i}` })) as never[],
    invoiceRegistry: [],
    auditLog: [],
  } as WarehouseStore
}

function store(partial: Partial<AppStore> & { employees: AppStore['employees'] }): AppStore {
  return {
    version: 6,
    employees: partial.employees,
    months: partial.months ?? {},
    access: partial.access ?? { users: [], roles: [] },
    auditLog: partial.auditLog ?? [],
    warehouse: partial.warehouse,
    finance: partial.finance,
    sales: partial.sales,
    procurement: partial.procurement,
    meals: partial.meals,
  } as AppStore
}

describe('countFilledTimesheetCells', () => {
  it('counts non-empty plan+fact cells', () => {
    expect(countFilledTimesheetCells({ '2026-07': sheetWithCells(5) })).toBe(10)
  })
})

describe('countWarehouseFootprint / countAuditJournal', () => {
  it('sums warehouse lists', () => {
    expect(countWarehouseFootprint(warehouse({ items: 10, movements: 5, documents: 2 }))).toBe(17)
    expect(countWarehouseFootprint(undefined)).toBe(0)
  })

  it('counts audit journal length', () => {
    expect(countAuditJournal(Array.from({ length: 3 }, (_, i) => ({ id: `a${i}` })) as never[])).toBe(3)
  })
})

describe('assertNoMassStoreWipe', () => {
  it('allows normal merge', () => {
    const remote = store({
      employees: Array.from({ length: 10 }, (_, i) => emp(i)),
      access: { users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] as never[], roles: [] },
      months: { '2026-07': sheetWithCells(20) },
    })
    const merged = store({
      employees: remote.employees.slice(0, 9),
      access: remote.access,
      months: remote.months,
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).not.toThrow()
  })

  it('refuses employee wipe below 85%', () => {
    const remote = store({ employees: Array.from({ length: 10 }, (_, i) => emp(i)) })
    const merged = store({ employees: remote.employees.slice(0, 7) })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_employee_wipe/)
  })

  it('refuses user wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      access: {
        users: Array.from({ length: 5 }, (_, i) => ({ id: `u${i}` })) as never[],
        roles: [],
      },
    })
    const merged = store({
      employees: remote.employees,
      access: { users: remote.access!.users!.slice(0, 3) as never[], roles: [] },
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_user_wipe/)
  })

  it('refuses timesheet wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      months: { '2026-07': sheetWithCells(20) },
    })
    const merged = store({
      employees: remote.employees,
      months: { '2026-07': sheetWithCells(12) },
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_timesheet_wipe/)
  })

  it('refuses audit journal wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      auditLog: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })) as never[],
    })
    const merged = store({
      employees: remote.employees,
      auditLog: remote.auditLog!.slice(0, 30) as never[],
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_audit_wipe/)
  })

  it('refuses warehouse wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      warehouse: warehouse({ items: 20, movements: 10, documents: 5 }),
    })
    const merged = store({
      employees: remote.employees,
      warehouse: warehouse({ items: 10, movements: 5, documents: 2 }),
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_warehouse_wipe/)
  })

  it('skips employee check when remote roster is small', () => {
    const remote = store({ employees: Array.from({ length: 5 }, (_, i) => emp(i)) })
    const merged = store({ employees: [emp(0)] })
    expect(() => assertNoMassStoreWipe(remote, merged)).not.toThrow()
  })

  it('treats null remote as empty (no refuse)', () => {
    const merged = store({ employees: [] })
    expect(() => assertNoMassStoreWipe(null, merged)).not.toThrow()
  })

  it('refuses finance wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      finance: {
        advances: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` })),
        adjustments: [],
        payouts: [],
        sickConfirmations: [],
        vacationConfirmations: [],
        snapshots: {},
      } as never,
    })
    const merged = store({
      employees: remote.employees,
      finance: {
        advances: (remote.finance!.advances as unknown[]).slice(0, 6),
        adjustments: [],
        payouts: [],
        sickConfirmations: [],
        vacationConfirmations: [],
        snapshots: {},
      } as never,
    })
    expect(countFinanceFootprint(remote.finance)).toBe(10)
    expect(countFinanceFootprint(merged.finance)).toBe(6)
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_finance_wipe/)
  })

  it('refuses sales wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      sales: { orders: Array.from({ length: 10 }, (_, i) => ({ id: `o${i}` })), nextOrderSeq: 10 } as never,
    })
    const merged = store({
      employees: remote.employees,
      sales: { orders: (remote.sales!.orders as unknown[]).slice(0, 6), nextOrderSeq: 10 } as never,
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_sales_wipe/)
  })

  it('refuses procurement wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      procurement: {
        orders: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` })),
        nextOrderSeq: 10,
        categories: [],
        routePoints: [],
      } as never,
    })
    const merged = store({
      employees: remote.employees,
      procurement: {
        orders: (remote.procurement!.orders as unknown[]).slice(0, 6),
        nextOrderSeq: 10,
        categories: [],
        routePoints: [],
      } as never,
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_procurement_wipe/)
  })

  it('protects meal weeks, accepted days and advance receipts from a stale client', () => {
    const remote = store({
      employees: [emp(1)],
      meals: {
        settings: {} as never,
        catalog: Array.from({ length: 2 }, (_, i) => ({ id: `c${i}` })),
        weeks: Array.from({ length: 2 }, (_, i) => ({ id: `w${i}` })),
        advances: [{ id: 'a1' }],
        orders: [],
        acceptedDays: [{ id: 'd1' }],
      } as never,
    })
    const merged = store({
      employees: remote.employees,
      meals: {
        settings: {} as never,
        catalog: [],
        weeks: [],
        advances: [],
        orders: [],
        acceptedDays: [],
      } as never,
    })
    expect(countMealsFootprint(remote.meals)).toBe(6)
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_meals_wipe/)
  })

  it('refuses hr contracts wipe below 85%', () => {
    const remote = store({
      employees: Array.from({ length: 10 }, (_, i) => ({
        ...emp(i),
        hrContracts: [{ id: `c${i}` }],
      })) as never,
    })
    const merged = store({
      employees: remote.employees.map((e, i) => (i < 6 ? e : { ...e, hrContracts: [] })) as never,
    })
    expect(countHrContractFootprint(remote.employees)).toBe(10)
    expect(countHrContractFootprint(merged.employees)).toBe(6)
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_hr_contracts_wipe/)
  })

  it('refuses access views wipe below 85%', () => {
    const remote = store({
      employees: [emp(1)],
      access: {
        users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
        roleViews: { hr: Array.from({ length: 12 }, (_, i) => `v${i}`) },
      } as never,
    })
    const merged = store({
      employees: remote.employees,
      access: {
        users: remote.access!.users,
        roleViews: { hr: ['v0'] },
      } as never,
    })
    expect(() => assertNoMassStoreWipe(remote, merged)).toThrow(/cloud_refuse_access_views_wipe/)
  })
})
