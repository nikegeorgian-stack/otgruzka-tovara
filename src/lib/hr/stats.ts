import type { Employee } from '@/lib/types'
import type { HrDocument, HrAbsence, HrTraining } from './types'

const MS_DAY = 86400000

export function daysUntil(dateIso?: string): number | null {
  if (!dateIso) return null
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / MS_DAY)
}

export function isExpiringSoon(dateIso?: string, withinDays = 30): boolean {
  const d = daysUntil(dateIso)
  return d !== null && d >= 0 && d <= withinDays
}

export function isOverdue(dateIso?: string): boolean {
  const d = daysUntil(dateIso)
  return d !== null && d < 0
}

export type HrKpis = {
  total: number
  active: number
  vacationSick: number
  fired: number
  expiringDocs: number
  overdueDocs: number
  expiringContracts: number
  overdueContracts: number
  missingPrimaryContracts: number
  expiringTrainings: number
  overdueTrainings: number
}

export function computeHrKpis(employees: Employee[]): HrKpis {
  let active = 0
  let vacationSick = 0
  let fired = 0
  let expiringDocs = 0
  let overdueDocs = 0
  let expiringContracts = 0
  let overdueContracts = 0
  let missingPrimaryContracts = 0
  let expiringTrainings = 0
  let overdueTrainings = 0

  for (const e of employees) {
    const status = e.hrStatus ?? 'active'
    if (status === 'active') active++
    else if (status === 'vacation' || status === 'sick') vacationSick++
    else if (status === 'fired') fired++

    if (status !== 'fired') {
      const contracts = e.hrContracts ?? []
      const primary = contracts.find((c) => c.isPrimary) ?? contracts[0]
      if (!primary || primary.status === 'pending') missingPrimaryContracts++
    }

    for (const doc of e.hrDocuments ?? []) {
      // Архив копий: трудовой договор в цепочке hrContracts, не здесь.
      if (doc.docType === 'Трудовой договор') continue
      if (isOverdue(doc.expiresAt)) overdueDocs++
      else if (isExpiringSoon(doc.expiresAt)) expiringDocs++
    }
    for (const c of e.hrContracts ?? []) {
      if (!c.isPrimary || !c.endDate) continue
      if (c.status === 'superseded') continue
      if (isOverdue(c.endDate)) overdueContracts++
      else if (isExpiringSoon(c.endDate)) expiringContracts++
    }
    for (const tr of e.hrTrainings ?? []) {
      if (isOverdue(tr.validUntil)) overdueTrainings++
      else if (isExpiringSoon(tr.validUntil)) expiringTrainings++
    }
  }

  return {
    total: employees.length,
    active,
    vacationSick,
    fired,
    expiringDocs,
    overdueDocs,
    expiringContracts,
    overdueContracts,
    missingPrimaryContracts,
    expiringTrainings,
    overdueTrainings,
  }
}

export function allEmployeeDocuments(employees: Employee[]): Array<{
  employeeId: string
  employeeName: string
  doc: HrDocument
}> {
  const out: Array<{ employeeId: string; employeeName: string; doc: HrDocument }> = []
  for (const e of employees) {
    for (const doc of e.hrDocuments ?? []) {
      out.push({ employeeId: e.id, employeeName: e.fullName, doc })
    }
  }
  return out.sort((a, b) => b.doc.uploadedAt.localeCompare(a.doc.uploadedAt))
}

export function allEmployeeAbsences(employees: Employee[]): Array<{
  employeeId: string
  employeeName: string
  absence: HrAbsence
}> {
  const out: Array<{ employeeId: string; employeeName: string; absence: HrAbsence }> = []
  for (const e of employees) {
    for (const absence of e.hrAbsences ?? []) {
      out.push({ employeeId: e.id, employeeName: e.fullName, absence })
    }
  }
  return out.sort((a, b) => b.absence.startDate.localeCompare(a.absence.startDate))
}

export function allEmployeeTrainings(employees: Employee[]): Array<{
  employeeId: string
  employeeName: string
  training: HrTraining
}> {
  const out: Array<{ employeeId: string; employeeName: string; training: HrTraining }> = []
  for (const e of employees) {
    for (const training of e.hrTrainings ?? []) {
      out.push({ employeeId: e.id, employeeName: e.fullName, training })
    }
  }
  return out.sort((a, b) => (a.training.validUntil ?? '').localeCompare(b.training.validUntil ?? ''))
}
