import { describe, expect, it } from 'vitest'
import {
  brigadeGetsNightLineFixed,
  computeNightLineFixedPay,
  countFactNightShifts,
} from '@/lib/finance/nightLineBonus'
import { calculateRowPay } from '@/lib/payroll'
import type { DayCode, Employee, MonthSheet } from '@/lib/types'

const MONTH = '2026-07'
const YEAR = 2026
const MO = 7
const NIGHT = '2026-07-30'
const NIGHT2 = '2026-07-29'

function emp(brigade: string): Employee {
  return {
    id: 'e1',
    fullName: 'Line Worker',
    active: true,
    schedule: '5/2 8ч',
    shiftMode: 'day',
    brigade,
    monthlySalary: 1840,
  } as Employee
}

function sheet(opts: {
  brigade: string
  nights: string[]
  extraFact?: Record<string, DayCode>
}): MonthSheet {
  const rowId = 'r1'
  const plan: Record<string, DayCode> = {
    '2026-07-01': '8',
    [NIGHT]: '8',
    [NIGHT2]: '8',
  }
  const fact: Record<string, DayCode> = { '2026-07-01': '8', ...opts.extraFact }
  const factOverrides: string[] = ['r1|2026-07-01']
  for (const key of opts.nights) {
    fact[key] = 'Н'
    factOverrides.push(`r1|${key}`)
  }
  return {
    month: MONTH,
    rows: [{ id: rowId, employeeId: 'e1', brigade: opts.brigade }],
    plan: { [rowId]: plan },
    fact: { [rowId]: fact },
    factOverrides,
    brigadierDays: {},
  } as MonthSheet
}

describe('ночь на линии — фикс 20 ₾', () => {
  it('пропитка / impregnation / გაჟღენთ — да; упаковка и офис — нет', () => {
    expect(brigadeGetsNightLineFixed('Пропитки №2.2')).toBe(true)
    expect(brigadeGetsNightLineFixed('Бригада пропитки №1.1')).toBe(true)
    expect(brigadeGetsNightLineFixed('Impregnation line 1')).toBe(true)
    expect(brigadeGetsNightLineFixed('გაჟღენთა 2')).toBe(true)
    expect(brigadeGetsNightLineFixed('Упаковка №1')).toBe(false)
    expect(brigadeGetsNightLineFixed('Миксер')).toBe(false)
    expect(brigadeGetsNightLineFixed('Офис')).toBe(false)
  })

  it('считает только факт Н с отработанными часами', () => {
    const s = sheet({
      brigade: 'Пропитки №2.2',
      nights: [NIGHT, NIGHT2],
      extraFact: { '2026-07-01': 'ПР' },
    })
    expect(countFactNightShifts(s, 'r1', YEAR, MO)).toBe(2)
  })

  it('ПР и X не дают фикс', () => {
    const s = sheet({
      brigade: 'Пропитки №2.2',
      nights: [],
      extraFact: { [NIGHT]: 'ПР', [NIGHT2]: 'X' },
    })
    s.factOverrides.push(`r1|${NIGHT}`, `r1|${NIGHT2}`)
    expect(countFactNightShifts(s, 'r1', YEAR, MO)).toBe(0)
    expect(
      computeNightLineFixedPay({
        sheet: s,
        rowId: 'r1',
        brigade: 'Пропитки №2.2',
        year: YEAR,
        month: MO,
        fixedGel: 20,
      }).amount,
    ).toBe(0)
  })

  it('одна ночь на пропитке = 20 ₾, две = 40 ₾', () => {
    const one = sheet({ brigade: 'Пропитки №2.2', nights: [NIGHT] })
    expect(
      computeNightLineFixedPay({
        sheet: one,
        rowId: 'r1',
        brigade: 'Пропитки №2.2',
        year: YEAR,
        month: MO,
        fixedGel: 20,
      }),
    ).toEqual({ nights: 1, amount: 20 })

    const two = sheet({ brigade: 'Пропитки №2.2', nights: [NIGHT, NIGHT2] })
    expect(
      computeNightLineFixedPay({
        sheet: two,
        rowId: 'r1',
        brigade: 'Пропитки №2.2',
        year: YEAR,
        month: MO,
        fixedGel: 20,
      }),
    ).toEqual({ nights: 2, amount: 40 })
  })

  it('упаковка с кодом Н — 0 ₾ фикса', () => {
    const s = sheet({ brigade: 'Упаковка №1', nights: [NIGHT] })
    expect(
      computeNightLineFixedPay({
        sheet: s,
        rowId: 'r1',
        brigade: 'Упаковка №1',
        year: YEAR,
        month: MO,
        fixedGel: 20,
      }).amount,
    ).toBe(0)
  })

  it('calculateRowPay добавляет фикс в amount поверх ночных часов', () => {
    const line = sheet({ brigade: 'Пропитки №2.2', nights: [NIGHT] })
    const pack = sheet({ brigade: 'Упаковка №1', nights: [NIGHT] })
    const linePay = calculateRowPay(emp('Пропитки №2.2'), line, 'r1', YEAR, MO)
    const packPay = calculateRowPay(emp('Упаковка №1'), pack, 'r1', YEAR, MO)

    expect(linePay.breakdown.nightLineBonus).toBe(20)
    expect(packPay.breakdown.nightLineBonus).toBe(0)
    expect(linePay.breakdown.night).toBeGreaterThan(0)
    expect(linePay.amount - packPay.amount).toBe(20)
  })
})
