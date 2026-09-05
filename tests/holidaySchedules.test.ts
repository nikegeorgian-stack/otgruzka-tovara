import { describe, expect, it } from 'vitest'
import { autoCodeForDay } from '@/lib/schedule'
import { applyHolidayVForAll } from '@/lib/bulkOps'
import type { Employee, MonthSheet } from '@/lib/types'

/** 2026-05-26 — День независимости (вт), будний день. */
const HOLIDAY = { y: 2026, m: 5, d: 26 }

describe('public holidays vs schedules', () => {
  it('5/2: holiday on weekday → В', () => {
    expect(
      autoCodeForDay('5/2 8ч', '', HOLIDAY.y, HOLIDAY.m, HOLIDAY.d, 'day', 8),
    ).toBe('В')
  })

  it('5/2: normal weekday → work code', () => {
    // 2026-05-27 среда
    expect(autoCodeForDay('5/2 8ч', '', 2026, 5, 27, 'day', 8)).toBe('8')
  })

  it('2/2: holiday does not force В — follows cycle', () => {
    const cycleStart = '2026-05-25' // mon work, tue work, wed off...
    const holidayCode = autoCodeForDay(
      '2/2 11ч',
      cycleStart,
      HOLIDAY.y,
      HOLIDAY.m,
      HOLIDAY.d,
      'day',
      11,
    )
    // 25=0 work, 26=1 work → should be 11, not В from holiday
    expect(holidayCode).toBe('11')
  })

  it('applyHolidayVForAll only touches 5/2 rows', () => {
    const emp52: Employee = {
      id: 'e52',
      fullName: 'A',
      active: true,
      brigade: 'B1',
      schedule: '5/2 8ч',
    } as Employee
    const emp22: Employee = {
      id: 'e22',
      fullName: 'B',
      active: true,
      brigade: 'B1',
      schedule: '2/2 11ч',
    } as Employee
    const sheet: MonthSheet = {
      month: '2026-05',
      rows: [
        { id: 'r52', employeeId: 'e52', brigade: 'B1', position: 0 },
        { id: 'r22', employeeId: 'e22', brigade: 'B1', position: 1 },
      ],
      plan: {
        r52: { '2026-05-26': '8' },
        r22: { '2026-05-26': '11' },
      },
      fact: {
        r52: { '2026-05-26': '8' },
        r22: { '2026-05-26': '11' },
      },
      factOverrides: [],
      comments: {},
    } as MonthSheet

    const next = applyHolidayVForAll(sheet, null, [emp52, emp22])
    expect(next.plan.r52['2026-05-26']).toBe('В')
    expect(next.plan.r22['2026-05-26']).toBe('11')
  })
})
