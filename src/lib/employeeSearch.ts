import { employeeSearchText } from '@/i18n/employeeText'
import type { Employee } from '@/lib/types'

export type SearchEmployeesOptions = {
  brigade?: string
  excludeId?: string
  limit?: number
}

export function searchEmployees(
  employees: Employee[],
  query: string,
  options: SearchEmployeesOptions = {},
): Employee[] {
  const { brigade, excludeId, limit = 25 } = options
  const q = query.trim().toLowerCase()

  let list = employees.filter(
    (e) => e.active && (e.hrStatus ?? 'active') !== 'fired' && e.id !== excludeId,
  )

  if (q) {
    list = list.filter((e) => {
      const haystack = [employeeSearchText(e), e.brigade, e.tabNumber].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }

  list.sort((a, b) => {
    if (brigade) {
      const aSame = a.brigade === brigade ? 0 : 1
      const bSame = b.brigade === brigade ? 0 : 1
      if (aSame !== bSame) return aSame - bSame
    }
    return a.fullName.localeCompare(b.fullName, 'ru')
  })

  return list.slice(0, limit)
}
