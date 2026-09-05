import type { Employee } from '@/lib/types'
import { daysUntil, isExpiringSoon, isOverdue } from './stats'
import { HR_ARCHIVE_LABOR_CONTRACT_TYPE, HR_MONITORED_DOC_TYPES } from './labels'
import { isForeignPersonnel } from './inspector'
import { primaryEmploymentContract } from './contracts'

export type DocMonitorSeverity = 'overdue' | 'expiring' | 'ok'

export type DocMonitorSource =
  | 'document'
  | 'workPermit'
  | 'residencePermit'
  | 'contract'
  | 'stay'

export type DocMonitorRow = {
  id: string
  employeeId: string
  employeeName: string
  source: DocMonitorSource
  title: string
  docType: string
  number?: string
  expiresAt: string
  days: number | null
  severity: DocMonitorSeverity
}

export type DocMonitorCategory = 'all' | 'contracts' | 'documents' | 'permits'

function severityFor(expiresAt: string): DocMonitorSeverity {
  if (isOverdue(expiresAt)) return 'overdue'
  if (isExpiringSoon(expiresAt, 30)) return 'expiring'
  return 'ok'
}

function matchesCategory(source: DocMonitorSource, category: DocMonitorCategory): boolean {
  if (category === 'all') return true
  if (category === 'contracts') return source === 'contract'
  if (category === 'documents') return source === 'document'
  return source === 'workPermit' || source === 'residencePermit' || source === 'stay'
}

function isArchiveLaborContractCopy(docType: string): boolean {
  return docType === HR_ARCHIVE_LABOR_CONTRACT_TYPE
}

/** Собрать отслеживаемые сроки: договоры (цепочка), архив копий, разрешения. */
export function collectDocumentMonitorRows(
  employees: Employee[],
  opts?: {
    onlyProblems?: boolean
    foreignOnly?: boolean
    category?: DocMonitorCategory
  },
): DocMonitorRow[] {
  const onlyProblems = opts?.onlyProblems !== false
  const foreignOnly = opts?.foreignOnly === true
  const category = opts?.category ?? 'all'
  const out: DocMonitorRow[] = []

  for (const emp of employees) {
    if ((emp.hrStatus ?? 'active') === 'fired') continue
    if (foreignOnly && !isForeignPersonnel(emp) && !emp.foreignStatus) continue

    const fs = emp.foreignStatus
    if (fs?.workPermitUntil) {
      const sev = severityFor(fs.workPermitUntil)
      if ((!onlyProblems || sev !== 'ok') && matchesCategory('workPermit', category)) {
        out.push({
          id: `${emp.id}:workPermit`,
          employeeId: emp.id,
          employeeName: emp.fullName,
          source: 'workPermit',
          title: 'Трудовое разрешение',
          docType: 'Трудовое разрешение',
          number: fs.workPermitNumber,
          expiresAt: fs.workPermitUntil,
          days: daysUntil(fs.workPermitUntil),
          severity: sev,
        })
      }
    }
    if (fs?.residencePermitUntil) {
      const sev = severityFor(fs.residencePermitUntil)
      if ((!onlyProblems || sev !== 'ok') && matchesCategory('residencePermit', category)) {
        out.push({
          id: `${emp.id}:residencePermit`,
          employeeId: emp.id,
          employeeName: emp.fullName,
          source: 'residencePermit',
          title: 'ВНЖ',
          docType: 'ВНЖ',
          number: fs.residencePermitNumber,
          expiresAt: fs.residencePermitUntil,
          days: daysUntil(fs.residencePermitUntil),
          severity: sev,
        })
      }
    }
    if (fs?.stayUntil) {
      const sev = severityFor(fs.stayUntil)
      if ((!onlyProblems || sev !== 'ok') && matchesCategory('stay', category)) {
        out.push({
          id: `${emp.id}:stay`,
          employeeId: emp.id,
          employeeName: emp.fullName,
          source: 'stay',
          title: 'Срок пребывания (безвиз)',
          docType: 'Срок пребывания',
          number: fs.entryDate ? `въезд ${fs.entryDate}` : undefined,
          expiresAt: fs.stayUntil,
          days: daysUntil(fs.stayUntil),
          severity: sev,
        })
      }
    }

    for (const doc of emp.hrDocuments ?? []) {
      if (!doc.expiresAt) continue
      // Трудовой договор — только в hrContracts (логическая цепочка).
      if (isArchiveLaborContractCopy(doc.docType)) continue
      if (!(HR_MONITORED_DOC_TYPES as readonly string[]).includes(doc.docType)) continue
      const sev = severityFor(doc.expiresAt)
      if (onlyProblems && sev === 'ok') continue
      if (!matchesCategory('document', category)) continue
      out.push({
        id: `${emp.id}:doc:${doc.id}`,
        employeeId: emp.id,
        employeeName: emp.fullName,
        source: 'document',
        title: doc.title || doc.docType,
        docType: doc.docType,
        expiresAt: doc.expiresAt,
        days: daysUntil(doc.expiresAt),
        severity: sev,
      })
    }

    for (const c of emp.hrContracts ?? []) {
      if (!c.endDate || c.status === 'superseded') continue
      const sev = severityFor(c.endDate)
      if (onlyProblems && sev === 'ok') continue
      if (!matchesCategory('contract', category)) continue
      const num = c.contractNumber
      out.push({
        id: `${emp.id}:contract:${c.id}`,
        employeeId: emp.id,
        employeeName: emp.fullName,
        source: 'contract',
        title: num ? `Договор ${num}` : 'Трудовой договор',
        docType: 'Трудовой договор',
        number: num,
        expiresAt: c.endDate,
        days: daysUntil(c.endDate),
        severity: sev,
      })
    }
  }

  const rank = (s: DocMonitorSeverity) => (s === 'overdue' ? 0 : s === 'expiring' ? 1 : 2)
  return out.sort((a, b) => {
    const r = rank(a.severity) - rank(b.severity)
    if (r !== 0) return r
    const da = a.days ?? 9999
    const db = b.days ?? 9999
    if (da !== db) return da - db
    return a.employeeName.localeCompare(b.employeeName, 'ru')
  })
}

export function countDocumentMonitorProblems(
  employees: Employee[],
  opts?: { foreignOnly?: boolean; category?: DocMonitorCategory },
): {
  overdue: number
  expiring: number
} {
  const rows = collectDocumentMonitorRows(employees, {
    onlyProblems: true,
    foreignOnly: opts?.foreignOnly,
    category: opts?.category,
  })
  return {
    overdue: rows.filter((r) => r.severity === 'overdue').length,
    expiring: rows.filter((r) => r.severity === 'expiring').length,
  }
}

/** Активные сотрудники без основного договора в цепочке. */
export function employeesMissingPrimaryContract(employees: Employee[]): Array<{
  employeeId: string
  employeeName: string
  brigade?: string
  position?: string
}> {
  const out: Array<{
    employeeId: string
    employeeName: string
    brigade?: string
    position?: string
  }> = []
  for (const emp of employees) {
    if ((emp.hrStatus ?? 'active') === 'fired') continue
    const primary = primaryEmploymentContract(emp)
    if (primary && primary.status !== 'pending') continue
    if (primary?.status === 'pending') {
      out.push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        brigade: emp.brigade,
        position: emp.position,
      })
      continue
    }
    if (!(emp.hrContracts?.length)) {
      out.push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        brigade: emp.brigade,
        position: emp.position,
      })
    }
  }
  return out.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru'))
}
