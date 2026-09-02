import { employeePosition } from '@/i18n'
import { citizenshipLabel, type EmployeeCitizenship } from '@/lib/hr/citizenship'
import { hrStatusLabel } from '@/lib/hr/labels'
import { employeeStructuralUnitLabel } from '@/lib/hr/orgStructure'
import { scheduleDisplayLabel } from '@/lib/schedules'
import type { HrStatus, HrStructuralUnit } from '@/lib/hr/types'
import type { Locale } from '@/i18n/types'
import type { Employee } from '@/lib/types'
import type { OfficeStaffFieldId } from './staffListFields'

export type OfficeStaffRowCtx = {
  locale: Locale
  units: HrStructuralUnit[]
  genderLabel: (gender: string | undefined) => string
}

function formatIsoDate(iso: string | undefined): string {
  const raw = iso?.trim() ?? ''
  if (!raw) return ''
  const [y, m, d] = raw.split('-')
  if (!y || !m || !d) return raw
  return `${d}.${m}.${y}`
}

function statusOf(emp: Employee): HrStatus {
  return emp.hrStatus ?? (emp.active === false ? 'fired' : 'active')
}

function addressOf(emp: Employee): string {
  return (
    emp.actualAddress?.trim() ||
    emp.address?.trim() ||
    emp.registrationAddress?.trim() ||
    ''
  )
}

export function officeStaffCellValue(
  emp: Employee,
  field: OfficeStaffFieldId,
  ctx: OfficeStaffRowCtx,
): string {
  switch (field) {
    case 'fullName':
      return emp.fullName?.trim() ?? ''
    case 'nameKa':
      return emp.nameKa?.trim() ?? ''
    case 'tabNumber':
      return emp.tabNumber ?? ''
    case 'employeeNumber':
      return emp.employeeNumber ?? ''
    case 'position':
      return employeePosition(emp, ctx.locale)
    case 'unit':
      return employeeStructuralUnitLabel(emp, ctx.units)
    case 'brigade':
      return emp.brigade ?? ''
    case 'status':
      return hrStatusLabel(statusOf(emp), ctx.locale)
    case 'phone':
      return emp.phone?.trim() ?? ''
    case 'email':
      return emp.email?.trim() ?? ''
    case 'personalId':
      return emp.personalId?.trim() ?? ''
    case 'address':
      return addressOf(emp)
    case 'citizenship':
      return citizenshipLabel(emp.citizenship as EmployeeCitizenship | undefined, ctx.locale)
    case 'birthDate':
      return formatIsoDate(emp.birthDate)
    case 'hireDate':
      return formatIsoDate(emp.hireDate)
    case 'schedule':
      return scheduleDisplayLabel(emp)
    case 'gender':
      return ctx.genderLabel(emp.gender)
    default:
      return ''
  }
}

export function projectOfficeStaffTable(
  employees: Employee[],
  fields: OfficeStaffFieldId[],
  ctx: OfficeStaffRowCtx,
  labels: Record<OfficeStaffFieldId, string>,
): { headers: string[]; rows: string[][]; fieldIds: OfficeStaffFieldId[] } {
  const fieldIds = fields
  const headers = fieldIds.map((id) => labels[id])
  const rows = employees.map((emp) => fieldIds.map((id) => officeStaffCellValue(emp, id, ctx)))
  return { headers, rows, fieldIds }
}
