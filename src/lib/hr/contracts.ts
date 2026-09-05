import type { Employee } from '@/lib/types'
import type { Locale } from '@/i18n/types'
import type { EmploymentAgreementKind, HrEmploymentContract, HrEmploymentContractStatus } from './types'
import { daysUntil, isExpiringSoon, isOverdue } from './stats'

export function isTraineePosition(position: string, positionKa?: string): boolean {
  const p = `${position ?? ''} ${positionKa ?? ''}`.toLowerCase()
  return /ученик|мосწ|стаж|intern|trainee|მოსწავ/.test(p)
}

export function isPendingContractTerm(term?: string): boolean {
  return /гасаформ|оформ|pending|დასაწყ|გასაფორმ/i.test(term ?? '')
}

/** Вид договора: основной (permanent) для действующей должности, кроме явной стажировки. */
export function inferContractAgreementKind(
  contract: Pick<HrEmploymentContract, 'position' | 'positionKa' | 'term'>,
  isPrimary: boolean,
): EmploymentAgreementKind | undefined {
  if (isTraineePosition(contract.position, contract.positionKa)) return 'fixed_term'
  if (isPrimary) {
    const t = (contract.term ?? '').trim()
    if (/^3$|^2$|3\s*мес|3\s*თვ|2\s*თვ/i.test(t)) return 'fixed_term'
    return 'permanent'
  }
  if (/1\s*წელი|1\s*год|2\s*თვ|3\s*თვ|3\s*мес/i.test(contract.term ?? '')) return 'fixed_term'
  return 'permanent'
}

export function primaryEmploymentContract(employee: Employee): HrEmploymentContract | undefined {
  const list = employee.hrContracts ?? []
  return list.find((c) => c.isPrimary) ?? list[0]
}

export function contractAlertDays(endDate?: string): number | null {
  return daysUntil(endDate)
}

export function contractIsExpiringSoon(endDate?: string, withinDays = 30): boolean {
  return isExpiringSoon(endDate, withinDays)
}

export function contractIsOverdue(endDate?: string): boolean {
  return isOverdue(endDate)
}

export function allEmployeeContracts(employees: Employee[]): Array<{
  employeeId: string
  employeeName: string
  employeeStatus: Employee['hrStatus']
  contract: HrEmploymentContract
}> {
  const out: Array<{
    employeeId: string
    employeeName: string
    employeeStatus: Employee['hrStatus']
    contract: HrEmploymentContract
  }> = []
  for (const e of employees) {
    for (const contract of e.hrContracts ?? []) {
      out.push({
        employeeId: e.id,
        employeeName: e.fullName,
        employeeStatus: e.hrStatus,
        contract,
      })
    }
  }
  return out.sort((a, b) => {
    if (a.contract.isPrimary !== b.contract.isPrimary) return a.contract.isPrimary ? -1 : 1
    return (b.contract.effectiveDate ?? '').localeCompare(a.contract.effectiveDate ?? '')
  })
}

export function employeeHasExpiringContract(employee: Employee, withinDays = 30): boolean {
  for (const c of employee.hrContracts ?? []) {
    if (!c.isPrimary || !c.endDate) continue
    if (contractIsExpiringSoon(c.endDate, withinDays) || contractIsOverdue(c.endDate)) return true
  }
  return false
}

export function contractStatusLabel(
  status: HrEmploymentContractStatus | undefined,
  locale: Locale,
): string {
  const ru: Record<HrEmploymentContractStatus, string> = {
    active: 'Действует',
    superseded: 'Предыдущий',
    pending: 'К оформлению',
  }
  const ka: Record<HrEmploymentContractStatus, string> = {
    active: 'მოქმედი',
    superseded: 'წინა',
    pending: 'გასაფორმებელი',
  }
  if (!status) return '—'
  return locale === 'ka' ? ka[status] : ru[status]
}

/** Добавить или обновить договор; при isPrimary остальные снимаются с основного. */
export function upsertEmploymentContract(
  list: HrEmploymentContract[] | undefined,
  next: HrEmploymentContract,
): HrEmploymentContract[] {
  const prev = list ?? []
  const exists = prev.some((c) => c.id === next.id)
  let out = exists ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next]
  if (next.isPrimary) {
    out = out.map((c) =>
      c.id === next.id
        ? { ...c, isPrimary: true, status: c.status === 'pending' ? 'pending' : 'active' }
        : {
            ...c,
            isPrimary: false,
            status: c.status === 'pending' ? 'pending' : 'superseded',
          },
    )
  }
  return out
}

export function removeEmploymentContract(
  list: HrEmploymentContract[] | undefined,
  id: string,
): HrEmploymentContract[] {
  return (list ?? []).filter((c) => c.id !== id)
}
