import { describe, expect, it } from 'vitest'
import { computeDirectorCommandBriefing } from '@/lib/director/commandBriefing'
import { createDefaultProcurement } from '@/lib/procurement/init'
import { emptySalesOrder } from '@/lib/sales/init'
import type { Employee, MonthSheet } from '@/lib/types'
import { createDefaultWarehouse } from '@/lib/warehouse/init'

const MONTH = '2026-08'

function emp(partial: Partial<Employee> & Pick<Employee, 'id' | 'fullName' | 'brigade'>): Employee {
  return {
    active: true,
    schedule: '2/2 11ч',
    rateType: 'hourly',
    rate: 10,
    hireDate: '2025-01-01',
    ...partial,
  } as Employee
}

function emptyPlant() {
  const warehouse = createDefaultWarehouse()
  warehouse.items = []
  warehouse.movements = []
  const procurement = createDefaultProcurement()
  procurement.orders = []
  return { procurement, warehouse }
}

function sheet(): MonthSheet {
  return {
    month: MONTH,
    rows: [
      { id: 'row-lag', brigade: 'Линия 1', employeeId: 'e-lag', sortOrder: 0 },
      { id: 'row-over', brigade: 'Линия 2', employeeId: 'e-over', sortOrder: 1 },
    ],
    plan: {
      'row-lag': {
        '2026-08-10': '11',
        '2026-08-11': '11',
        '2026-08-12': '11',
      },
      'row-over': {
        '2026-08-10': '8',
        '2026-08-11': '8',
      },
    },
    fact: {
      'row-lag': {
        '2026-08-10': '11',
        '2026-08-11': '11',
        '2026-08-12': '6',
      },
      'row-over': {
        '2026-08-10': '11',
        '2026-08-11': '11',
      },
    },
    factOverrides: [],
    comments: {},
    substitutions: {},
  }
}

describe('computeDirectorCommandBriefing', () => {
  it('ranks who missed plan hours and who overfulfilled', () => {
    const briefing = computeDirectorCommandBriefing({
      months: { [MONTH]: sheet() },
      employees: [
        emp({ id: 'e-lag', fullName: 'Отстающий', brigade: 'Линия 1' }),
        emp({ id: 'e-over', fullName: 'Перевыполнил', brigade: 'Линия 2' }),
      ],
      salesOrders: [],
      plannerOrders: [],
      requests: [],
      loadingShipments: [],
      ...emptyPlant(),
      today: '2026-08-18',
    })

    expect(briefing.monthKey).toBe(MONTH)
    expect(briefing.underPeople.map((r) => r.id)).toEqual(['e-lag'])
    expect(briefing.overPeople.map((r) => r.id)).toEqual(['e-over'])
    expect(briefing.underBrigades.map((r) => r.id)).toEqual(['Линия 1'])
    expect(briefing.overBrigades.map((r) => r.id)).toEqual(['Линия 2'])
    expect(briefing.underPeople[0].deviation).toBeLessThan(-2)
    expect(briefing.overPeople[0].deviation).toBeGreaterThan(2)
    expect(briefing.duties).toEqual([])
  })

  it('treats at-risk orders as a late verdict and an open duty', () => {
    const order = emptySalesOrder('2026-08-01')
    order.status = 'in_production'
    order.dueDate = '2026-08-10'
    order.customer = 'A2'
    order.lines = [
      {
        id: 'ln-1',
        productName: 'A2',
        category: 'ratl1',
        qtyMp: 100,
        productionOrderIds: ['po-1'],
      },
    ]
    const briefing = computeDirectorCommandBriefing({
      months: { [MONTH]: sheet() },
      employees: [
        emp({ id: 'e-lag', fullName: 'Отстающий', brigade: 'Линия 1' }),
        emp({ id: 'e-over', fullName: 'Перевыполнил', brigade: 'Линия 2' }),
      ],
      salesOrders: [order],
      plannerOrders: [],
      requests: [],
      loadingShipments: [],
      ...emptyPlant(),
      today: '2026-08-18',
    })

    expect(briefing.verdict).toBe('late')
    expect(briefing.atRiskOrders).toBeGreaterThan(0)
    expect(briefing.duties.some((d) => d.id === 'atRisk')).toBe(true)
  })
})
