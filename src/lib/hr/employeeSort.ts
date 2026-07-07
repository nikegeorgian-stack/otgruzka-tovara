import { employeeName, employeePosition } from '@/i18n'
import type { Locale } from '@/i18n/types'
import { hrStatusLabel } from '@/lib/hr/labels'
import { splitEmployeeName } from '@/lib/hr/displayName'
import { citizenshipLabel } from '@/lib/hr/citizenship'
import type { EmployeeCitizenship } from '@/lib/hr/citizenship'
import type { HrStatus } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'
import { applyTableSort, type TableSortState } from '@/lib/ui/tableSort'

export type EmployeeSortKey =
  | 'name'
  | 'tab'
  | 'department'
  | 'status'
  | 'position'
  | 'brigade'
  | 'schedule'
  | 'surname'
  | 'firstName'
  | 'citizenship'

const STATUS_ORDER: Record<HrStatus, number> = {
  active: 0,
  vacation: 1,
  sick: 2,
  fired: 3,
}

function localeTag(locale: Locale): string {
  return locale === 'ka' ? 'ka' : 'ru'
}

function deptLabel(emp: Employee): string {
  return (emp.department ?? emp.brigade ?? '').trim()
}

export function compareEmployees(
  a: Employee,
  b: Employee,
  key: EmployeeSortKey,
  locale: Locale,
): number {
  const tag = localeTag(locale)
  let cmp = 0

  switch (key) {
    case 'name':
      cmp = employeeName(a, locale).localeCompare(employeeName(b, locale), tag)
      break
    case 'surname': {
      const sa = splitEmployeeName(a.fullName).surname
      const sb = splitEmployeeName(b.fullName).surname
      cmp = sa.localeCompare(sb, tag)
      break
    }
    case 'firstName': {
      const fa = splitEmployeeName(a.fullName).firstName
      const fb = splitEmployeeName(b.fullName).firstName
      cmp = fa.localeCompare(fb, tag)
      break
    }
    case 'tab':
      cmp = (a.tabNumber ?? '').localeCompare(b.tabNumber ?? '', tag, { numeric: true })
      break
    case 'department':
      cmp = deptLabel(a).localeCompare(deptLabel(b), tag)
      break
    case 'position':
      cmp = employeePosition(a, locale).localeCompare(employeePosition(b, locale), tag)
      break
    case 'brigade':
      cmp = (a.brigade ?? '').localeCompare(b.brigade ?? '', tag)
      break
    case 'schedule':
      cmp = (a.schedule ?? '').localeCompare(b.schedule ?? '', tag)
      break
    case 'status': {
      const sa = a.hrStatus ?? 'active'
      const sb = b.hrStatus ?? 'active'
      cmp = STATUS_ORDER[sa] - STATUS_ORDER[sb]
      if (cmp === 0) {
        cmp = hrStatusLabel(sa, locale).localeCompare(hrStatusLabel(sb, locale), tag)
      }
      break
    }
    case 'citizenship':
      cmp = citizenshipLabel(a.citizenship as EmployeeCitizenship, locale).localeCompare(
        citizenshipLabel(b.citizenship as EmployeeCitizenship, locale),
        tag,
      )
      break
  }

  if (cmp === 0) {
    cmp = employeeName(a, locale).localeCompare(employeeName(b, locale), tag)
  }
  return cmp
}

export function sortEmployees(
  employees: Employee[],
  sort: TableSortState<EmployeeSortKey>,
  locale: Locale,
): Employee[] {
  return applyTableSort(employees, sort, (a, b, key) => compareEmployees(a, b, key, locale))
}
