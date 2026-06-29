import type { Employee } from '@/lib/types'

function parseTabNumber(value: string): number | null {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

/** Следующий свободный табельный номер (max + 1 по числовым значениям). */
export function suggestNextTabNumber(employees: Employee[]): string {
  let max = 0
  for (const e of employees) {
    const n = parseTabNumber(e.tabNumber)
    if (n !== null && n > max) max = n
  }
  return String(max + 1)
}

export function isTabNumberTaken(
  employees: Employee[],
  tabNumber: string,
  excludeId?: string,
): boolean {
  const t = tabNumber.trim()
  if (!t) return false
  return employees.some(
    (e) => e.id !== excludeId && e.tabNumber.trim() === t,
  )
}
