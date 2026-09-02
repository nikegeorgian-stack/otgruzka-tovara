import type { Employee } from '@/lib/types'

function parseEmployeeNumber(value: string | undefined | null): number | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

/** Следующий свободный индивидуальный номер (max + 1). Не путать с табельным. */
export function suggestNextEmployeeNumber(employees: Employee[]): string {
  const used = new Set<string>()
  let max = 0
  for (const e of employees) {
    const t = e.employeeNumber?.trim()
    if (!t) continue
    used.add(t)
    const n = parseEmployeeNumber(t)
    if (n !== null && n > max) max = n
  }
  let next = max + 1
  while (used.has(String(next))) next += 1
  return String(next)
}

/**
 * Проставить нарастающие номера всем без `employeeNumber`.
 * Уже выданные не меняем. Порядок для пустых — по `id` (стабильно при sync).
 */
export function ensureEmployeeNumbers(employees: Employee[]): Employee[] {
  if (employees.length === 0) return employees
  const used = new Set<string>()
  let max = 0
  for (const e of employees) {
    const t = e.employeeNumber?.trim()
    if (!t) continue
    used.add(t)
    const n = parseEmployeeNumber(t)
    if (n !== null && n > max) max = n
  }
  const need = employees
    .filter((e) => !e.employeeNumber?.trim())
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
  if (need.length === 0) return employees

  const assigned = new Map<string, string>()
  let next = max + 1
  for (const e of need) {
    while (used.has(String(next))) next += 1
    const value = String(next)
    assigned.set(e.id, value)
    used.add(value)
    next += 1
  }

  let changed = false
  const out = employees.map((e) => {
    const value = assigned.get(e.id)
    if (!value) return e
    changed = true
    return { ...e, employeeNumber: value }
  })
  return changed ? out : employees
}

/** Зафиксировать номер: у существующего не менять; новому — выдать при отсутствии. */
export function lockEmployeeNumber(
  draft: Employee,
  prev: Employee | undefined,
  allEmployees: Employee[],
): Employee {
  const prevNum = prev?.employeeNumber?.trim()
  if (prevNum) {
    return draft.employeeNumber === prevNum ? draft : { ...draft, employeeNumber: prevNum }
  }
  const own = draft.employeeNumber?.trim()
  if (own) return draft.employeeNumber === own ? draft : { ...draft, employeeNumber: own }
  return {
    ...draft,
    employeeNumber: suggestNextEmployeeNumber(
      allEmployees.filter((e) => e.id !== draft.id),
    ),
  }
}
