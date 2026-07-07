import type { EmployeeCitizenship } from './citizenship'
import { isGeorgianCitizen } from './citizenship'
import { daysUntil, isExpiringSoon, isOverdue } from './stats'
import type { Employee } from '@/lib/types'

/** Учётная запись инспектора по кадрам (Firebase UID). */
export const HR_INSPECTOR_USER_ID = 'Y1jTkLrN21ciDQYlCz9YPtj5TNo2'
export const HR_INSPECTOR_LOGIN = 'inspektor-nata@fibercell.net'

const FOREIGN_REQUIRED_DOC_TYPES = ['Паспорт', 'Трудовой договор', 'Медосмотр'] as const

export function isForeignPersonnel(employee: Employee): boolean {
  const citizenship = employee.citizenship as EmployeeCitizenship | undefined
  if (citizenship && !isGeorgianCitizen(citizenship)) return true
  const title = `${employee.position ?? ''} ${employee.positionKa ?? ''}`.toLowerCase()
  return /иностран|უცხოური|foreign/i.test(title)
}

export type ForeignPersonnelAlert = {
  employeeId: string
  employeeName: string
  citizenship?: string
  position?: string
  missingDocs: string[]
  expiringDocs: Array<{ title: string; expiresAt: string; days: number | null }>
  overdueDocs: Array<{ title: string; expiresAt: string }>
}

export function collectForeignPersonnelAlerts(employees: Employee[]): ForeignPersonnelAlert[] {
  const out: ForeignPersonnelAlert[] = []

  for (const employee of employees) {
    if ((employee.hrStatus ?? 'active') === 'fired') continue
    if (!isForeignPersonnel(employee)) continue

    const docs = employee.hrDocuments ?? []
    const docTypes = new Set(docs.map((d) => d.docType))
    const missingDocs = FOREIGN_REQUIRED_DOC_TYPES.filter((type) => !docTypes.has(type))

    const expiringDocs: ForeignPersonnelAlert['expiringDocs'] = []
    const overdueDocs: ForeignPersonnelAlert['overdueDocs'] = []
    for (const doc of docs) {
      if (isOverdue(doc.expiresAt)) {
        overdueDocs.push({ title: doc.title || doc.docType, expiresAt: doc.expiresAt! })
      } else if (isExpiringSoon(doc.expiresAt)) {
        expiringDocs.push({
          title: doc.title || doc.docType,
          expiresAt: doc.expiresAt!,
          days: daysUntil(doc.expiresAt),
        })
      }
    }

    if (missingDocs.length > 0 || expiringDocs.length > 0 || overdueDocs.length > 0) {
      out.push({
        employeeId: employee.id,
        employeeName: employee.fullName,
        citizenship: employee.citizenship,
        position: employee.position,
        missingDocs: [...missingDocs],
        expiringDocs,
        overdueDocs,
      })
    }
  }

  return out.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru'))
}

export function listForeignPersonnel(employees: Employee[]): Employee[] {
  return employees
    .filter((e) => (e.hrStatus ?? 'active') !== 'fired' && isForeignPersonnel(e))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
}
