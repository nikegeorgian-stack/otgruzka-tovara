import { describe, expect, it } from 'vitest'
import {
  brigadierDateKeys,
  computeBrigadierPay,
} from '@/lib/finance/payrollDetail'
import { clearBrigadierMarksForBrigade } from '@/lib/brigadeHasBrigadier'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'

const MONTH = '2026-07'
const YEAR = 2026
const MO = 7

function emp(partial: Partial<Employee> & Pick<Employee, 'id' | 'fullName' | 'brigade'>): Employee {
  return {
    active: true,
    schedule: '5/2',
    rateType: 'hourly',
    rate: 10,
    hireDate: '2025-01-01',
    ...partial,
  } as Employee
}

function baseSheet(over: Partial<MonthSheet> = {}): MonthSheet {
  return {
    month: MONTH,
    rows: [
      { id: 'row-main', brigade: 'Бригада А', employeeId: 'e-main' },
      { id: 'row-sub', brigade: 'Бригада А', employeeId: 'e-sub' },
    ],
    plan: {
      'row-main': { '2026-07-10': '11', '2026-07-11': '11', '2026-07-12': '11' },
      'row-sub': { '2026-07-10': '11', '2026-07-11': '11', '2026-07-12': '11' },
    },
    fact: {},
    factOverrides: [],
    brigadierDays: {},
    ...over,
  } as MonthSheet
}

function store(sheet: MonthSheet, brigadiers: Record<string, string>): AppStore {
  return {
    brigades: ['Бригада А'],
    brigadiers,
    employees: [
      emp({ id: 'e-main', fullName: 'Спандерашвили', brigade: 'Бригада А' }),
      emp({ id: 'e-sub', fullName: 'Басария', brigade: 'Бригада А' }),
    ],
    months: { [MONTH]: sheet },
    settings: { brigadierBonus: 300 },
  } as AppStore
}

describe('заместитель бригадира — доплата', () => {
  it('основной в простое (ПР) не получает день; заместитель с отметкой — получает', () => {
    const day = '2026-07-10'
    const sheet = baseSheet({
      plan: {
        'row-main': { [day]: '11' },
        'row-sub': { [day]: '11' },
      },
      fact: {
        'row-main': { [day]: 'ПР' },
        'row-sub': { [day]: '11' },
      },
      factOverrides: [`row-main|${day}`, `row-sub|${day}`],
      brigadierDays: { [`row-sub|${day}`]: true },
    })
    // Постоянный бригадир — основной
    const s = store(sheet, { 'Бригада А': 'e-main' })
    const main = s.employees[0]!
    const sub = s.employees[1]!

    const mainDays = brigadierDateKeys(s, sheet, 'row-main', main, YEAR, MO)
    const subDays = brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO)

    expect(mainDays.has(day)).toBe(false)
    expect(mainDays.size).toBe(0)
    expect(subDays.has(day)).toBe(true)

    const mainPay = computeBrigadierPay(s, sheet, 'row-main', main, YEAR, MO)
    const subPay = computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)

    expect(mainPay?.amount ?? 0).toBe(0)
    expect(subPay).not.toBeNull()
    expect(subPay!.brigadierDays).toBe(1)
    expect(subPay!.factBrigHours).toBe(11)
    expect(subPay!.amount).toBeGreaterThan(0)
    expect(subPay!.designatedBrigadier).toBe(false)
  })

  it('отметки с дня до конца месяца дают заместителю несколько дней доплаты', () => {
    const sheet = baseSheet({
      fact: {
        'row-sub': {
          '2026-07-10': '11',
          '2026-07-11': '11',
          '2026-07-12': '11',
        },
      },
      factOverrides: ['row-sub|2026-07-10', 'row-sub|2026-07-11', 'row-sub|2026-07-12'],
      brigadierDays: {
        'row-sub|2026-07-10': true,
        'row-sub|2026-07-11': true,
        'row-sub|2026-07-12': true,
      },
    })
    const s = store(sheet, { 'Бригада А': 'e-main' })
    const sub = s.employees[1]!
    const pay = computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)

    expect(pay).not.toBeNull()
    expect(pay!.brigadierDays).toBe(3)
    expect(pay!.factBrigHours).toBe(33)
    expect(pay!.amount).toBeGreaterThan(0)
  })

  it('если заместителя сделали постоянным бригадиром — доплата по рабочим дням без ручных отметок', () => {
    const sheet = baseSheet({
      fact: {
        'row-sub': { '2026-07-10': '11', '2026-07-11': '11' },
      },
      factOverrides: ['row-sub|2026-07-10', 'row-sub|2026-07-11'],
    })
    const s = store(sheet, { 'Бригада А': 'e-sub' })
    const sub = s.employees[1]!
    const days = brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO)
    const pay = computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)

    expect(days.has('2026-07-10')).toBe(true)
    expect(days.has('2026-07-11')).toBe(true)
    expect(pay!.designatedBrigadier).toBe(true)
    expect(pay!.amount).toBeGreaterThan(0)
  })

  it('назначенный + «с этого дня»: не платит дни до отметки; простой выкидывает; ночная входит', () => {
    const sheet = baseSheet({
      plan: {
        'row-sub': {
          '2026-07-08': '11',
          '2026-07-09': '11',
          '2026-07-10': '11',
          '2026-07-11': '11',
          '2026-07-12': 'Н',
        },
      },
      fact: {
        'row-sub': {
          '2026-07-08': '11',
          '2026-07-09': '11',
          '2026-07-10': '11',
          '2026-07-11': 'ПР',
          '2026-07-12': 'Н',
        },
      },
      factOverrides: [
        'row-sub|2026-07-08',
        'row-sub|2026-07-09',
        'row-sub|2026-07-10',
        'row-sub|2026-07-11',
        'row-sub|2026-07-12',
      ],
      brigadierDays: {
        'row-sub|2026-07-10': true,
        'row-sub|2026-07-11': true,
        'row-sub|2026-07-12': true,
      },
    })
    const s = store(sheet, { 'Бригада А': 'e-sub' })
    const sub = s.employees[1]!
    const days = brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO)
    const pay = computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)

    expect(days.has('2026-07-08')).toBe(false)
    expect(days.has('2026-07-09')).toBe(false)
    expect(days.has('2026-07-10')).toBe(true)
    expect(days.has('2026-07-11')).toBe(false)
    expect(days.has('2026-07-12')).toBe(true)
    expect(pay!.designatedBrigadier).toBe(true)
    expect(pay!.brigadierDays).toBe(2)
    expect(pay!.factBrigHours).toBe(22)
    expect(pay!.amount).toBe(Math.round(22 * (300 / 55)))
  })

  it('назначение по бригаде строки, даже если в карточке HR бригада пустая', () => {
    const sheet = baseSheet({
      fact: { 'row-sub': { '2026-07-10': '11' } },
      factOverrides: ['row-sub|2026-07-10'],
    })
    const s = store(sheet, { 'Бригада А': 'e-sub' })
    s.employees[1] = emp({ id: 'e-sub', fullName: 'Басария', brigade: '' })
    const sub = s.employees[1]!
    const days = brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO)
    expect(days.has('2026-07-10')).toBe(true)
    expect(computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)?.amount).toBeGreaterThan(0)
  })

  it('бригада без роли бригадира — ни назначение, ни отметки не дают доплату', () => {
    const sheet = baseSheet({
      fact: {
        'row-main': { '2026-07-10': '11' },
        'row-sub': { '2026-07-10': '11' },
      },
      factOverrides: ['row-main|2026-07-10', 'row-sub|2026-07-10'],
      brigadierDays: { 'row-sub|2026-07-10': true },
    })
    const s = {
      ...store(sheet, { 'Бригада А': 'e-main' }),
      brigadeHasBrigadier: { 'Бригада А': false },
    }
    const main = s.employees[0]!
    const sub = s.employees[1]!

    expect(brigadierDateKeys(s, sheet, 'row-main', main, YEAR, MO).size).toBe(0)
    expect(brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO).size).toBe(0)
    expect(computeBrigadierPay(s, sheet, 'row-main', main, YEAR, MO)).toBeNull()
    expect(computeBrigadierPay(s, sheet, 'row-sub', sub, YEAR, MO)).toBeNull()
  })

  it('подмена в перекличке — коррекция на день: постоянный теряет только этот день', () => {
    const sheet = baseSheet({
      fact: {
        'row-main': { '2026-07-10': '11', '2026-07-11': '11', '2026-07-12': '11' },
        'row-sub': { '2026-07-10': '11', '2026-07-11': '11', '2026-07-12': '11' },
      },
      factOverrides: [
        'row-main|2026-07-10',
        'row-main|2026-07-11',
        'row-main|2026-07-12',
        'row-sub|2026-07-10',
        'row-sub|2026-07-11',
        'row-sub|2026-07-12',
      ],
      brigadierDays: { 'row-sub|2026-07-11': true },
    })
    // Постоянный бригадир по плану остаётся прежним — перекличка его не меняет.
    const s = store(sheet, { 'Бригада А': 'e-main' })
    const main = s.employees[0]!
    const sub = s.employees[1]!

    const mainDays = brigadierDateKeys(s, sheet, 'row-main', main, YEAR, MO)
    const subDays = brigadierDateKeys(s, sheet, 'row-sub', sub, YEAR, MO)

    expect([...mainDays].sort()).toEqual(['2026-07-10', '2026-07-12'])
    expect([...subDays]).toEqual(['2026-07-11'])
    expect(computeBrigadierPay(s, sheet, 'row-main', main, YEAR, MO)?.designatedBrigadier).toBe(
      true,
    )
  })

  it('снятие роли бригадира удаляет старые звёзды только у этой бригады', () => {
    const sheet = baseSheet({
      rows: [
        { id: 'row-main', brigade: 'Бригада А', employeeId: 'e-main' },
        { id: 'row-other', brigade: 'Бригада Б', employeeId: 'e-other' },
      ],
      brigadierDays: {
        'row-main|2026-07-10': true,
        'row-other|2026-07-10': true,
      },
    })

    const months = clearBrigadierMarksForBrigade({ [MONTH]: sheet }, 'Бригада А')

    expect(months[MONTH]?.brigadierDays).toEqual({
      'row-other|2026-07-10': true,
    })
  })
})
