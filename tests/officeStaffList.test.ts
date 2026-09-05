import { describe, expect, it } from 'vitest'
import { filterOfficeStaff, type OfficeStaffFilter } from '@/lib/office/staffListFilter'
import {
  DEFAULT_OFFICE_STAFF_FIELDS,
  OFFICE_FORBIDDEN_EMPLOYEE_KEYS,
  OFFICE_STAFF_FIELD_IDS,
  normalizeOfficeStaffFields,
} from '@/lib/office/staffListFields'
import { officeStaffCellValue, projectOfficeStaffTable } from '@/lib/office/staffListRows'
import { officeStaffExcelColumnWidths } from '@/lib/office/staffListExcel'
import {
  OFFICE_STAFF_PRINT_ROWS_FIRST,
  OFFICE_STAFF_PRINT_ROWS_OTHER,
  chunkOfficeStaffPrintPages,
} from '@/lib/office/staffListPrint'
import type { Employee } from '@/lib/types'
import type { HrStructuralUnit } from '@/lib/hr/types'

function emp(over: Partial<Employee> & Pick<Employee, 'id' | 'fullName'>): Employee {
  return {
    tabNumber: '1',
    position: 'офис-менеджер',
    brigade: 'Офис',
    schedule: '5/2 8ч',
    group2x2: '',
    cycleStart: '2026-01-01',
    active: true,
    hrStatus: 'active',
    ...over,
  }
}

const units: HrStructuralUnit[] = [
  { id: 'apparat-upravleniya', name: 'Аппарат управления', sortOrder: 0 },
  { id: 'ceh', name: 'Цех', sortOrder: 1 },
]

const baseFilter: OfficeStaffFilter = {
  query: '',
  unitIds: [],
  positions: [],
  brigades: [],
  statuses: [],
  includeFired: false,
  schedules: [],
  citizenships: [],
  genders: [],
  hireFrom: '',
  hireTo: '',
}

describe('office staff list', () => {
  it('hides fired unless includeFired', () => {
    const list = [
      emp({ id: 'a', fullName: 'Иванов' }),
      emp({ id: 'b', fullName: 'Петров', active: false, hrStatus: 'fired' }),
    ]
    expect(filterOfficeStaff(list, units, baseFilter).map((e) => e.id)).toEqual(['a'])
    expect(
      filterOfficeStaff(list, units, { ...baseFilter, includeFired: true }).map((e) => e.id),
    ).toEqual(['a', 'b'])
    expect(
      filterOfficeStaff(list, units, { ...baseFilter, statuses: ['fired'] }).map((e) => e.id),
    ).toEqual(['b'])
  })

  it('filters by structural unit', () => {
    const list = [
      emp({
        id: 'a',
        fullName: 'Офис',
        structuralUnitId: 'apparat-upravleniya',
        department: 'Аппарат управления',
      }),
      emp({ id: 'b', fullName: 'Цех', structuralUnitId: 'ceh', department: 'Цех' }),
    ]
    expect(
      filterOfficeStaff(list, units, { ...baseFilter, unitIds: ['apparat-upravleniya'] }).map(
        (e) => e.id,
      ),
    ).toEqual(['a'])
  })

  it('keeps field whitelist away from payroll keys', () => {
    const forbidden = new Set<string>(OFFICE_FORBIDDEN_EMPLOYEE_KEYS)
    for (const id of OFFICE_STAFF_FIELD_IDS) {
      expect(forbidden.has(id)).toBe(false)
    }
  })

  it('does not leak salary into projected cells', () => {
    const person = emp({
      id: 'a',
      fullName: 'Секретный',
      monthlySalary: 9999,
      hourlyRate: 8888,
      phone: '555',
      bankAccounts: [{ id: 'ba1', iban: 'GE00SECRET' }],
    })
    const ctx = {
      locale: 'ru' as const,
      units,
      genderLabel: () => '',
    }
    const labels = Object.fromEntries(
      DEFAULT_OFFICE_STAFF_FIELDS.map((id) => [id, id]),
    ) as Record<(typeof DEFAULT_OFFICE_STAFF_FIELDS)[number], string>
    const table = projectOfficeStaffTable([person], DEFAULT_OFFICE_STAFF_FIELDS, ctx, labels)
    const blob = JSON.stringify(table)
    expect(blob).not.toContain('9999')
    expect(blob).not.toContain('8888')
    expect(blob).not.toContain('GE00SECRET')
    expect(blob).not.toContain('hourlyRate')
    expect(blob).not.toContain('monthlySalary')
    expect(officeStaffCellValue(person, 'phone', ctx)).toBe('555')
  })

  it('falls back to default columns when selection is empty/unknown', () => {
    expect(normalizeOfficeStaffFields([])).toEqual([...DEFAULT_OFFICE_STAFF_FIELDS])
    expect(normalizeOfficeStaffFields(['hourlyRate', 'fullName'])).toEqual(['fullName'])
  })

  it('sizes Excel columns with a leading № and field widths', () => {
    const widths = officeStaffExcelColumnWidths(['tabNumber', 'fullName'])
    expect(widths[0]).toBe(5)
    expect(widths[1]).toBeLessThan(widths[2])
    expect(widths).toHaveLength(3)
  })

  it('keeps contiguous numbers: first page fits logo, nobody skipped', () => {
    const items = Array.from({ length: 50 }, (_, i) => i + 1)
    const pages = chunkOfficeStaffPrintPages(items)
    expect(pages[0]).toHaveLength(OFFICE_STAFF_PRINT_ROWS_FIRST)
    expect(pages[1]).toHaveLength(OFFICE_STAFF_PRINT_ROWS_OTHER)
    expect(pages.flat()).toEqual(items)
    expect(OFFICE_STAFF_PRINT_ROWS_FIRST).toBeLessThanOrEqual(16)
    expect(OFFICE_STAFF_PRINT_ROWS_OTHER).toBeGreaterThan(OFFICE_STAFF_PRINT_ROWS_FIRST)
  })
})
