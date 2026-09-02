import type { Employee } from '@/lib/types'
import type { HrAbsence, HrAbsenceType, HrStatus } from './types'
import { applyHrStatus } from './sync'
import { withScheduledWorkDays } from './sickWorkDays'
import { appendEmployeeJournal, journalFromAbsence } from './journal'

/** Сегодняшний день (YYYY-MM-DD) — OpenSIOSISO without timezone skew for midday. */
export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Активное (на дату) отсутствие vacation/sick — для badge и statusUntil. */
export function activeAbsenceOn(
  absences: HrAbsence[] | undefined,
  dateISO: string,
): HrAbsence | undefined {
  const list = (absences ?? []).filter(
    (a) =>
      (a.type === 'sick' || a.type === 'vacation') &&
      a.startDate <= dateISO &&
      a.endDate >= dateISO,
  )
  if (!list.length) return undefined
  return list.sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
}

/**
 * Пересчитать hrStatus / employmentStatus / statusUntil
 * по текущему списку absences (после удаления или смены периода).
 */
export function recomputeStatusFromAbsences(emp: Employee, asOf = todayISO()): Employee {
  if ((emp.hrStatus ?? 'active') === 'fired') return emp
  const active = activeAbsenceOn(emp.hrAbsences, asOf)
  if (!active) {
    return {
      ...applyHrStatus(emp, 'active'),
      statusUntil: undefined,
    }
  }
  const status: HrStatus = active.type === 'sick' ? 'sick' : 'vacation'
  return {
    ...applyHrStatus(emp, status),
    statusUntil: active.endDate,
  }
}

/** Создать отсутствие с нормализацией workDays для больничного. */
export function buildAbsenceEntry(
  emp: Employee,
  type: HrAbsenceType,
  startDate: string,
  endDate: string,
  reason?: string,
  id?: string,
): HrAbsence {
  return withScheduledWorkDays(emp, {
    id: id ?? crypto.randomUUID(),
    type,
    startDate,
    endDate,
    reason,
  })
}

/** Добавить период статуса (больничный / отпуск) — единый контракт для карточки. */
export function applyStatusPeriod(
  emp: Employee,
  type: 'sick' | 'vacation',
  startDate: string,
  endDate: string,
  source: 'hr_card' | 'vacation_form' = 'hr_card',
): Employee {
  const absence = buildAbsenceEntry(emp, type, startDate, endDate)
  const status: HrStatus = type === 'sick' ? 'sick' : 'vacation'
  let next: Employee = {
    ...applyHrStatus(emp, status),
    statusUntil: endDate,
    terminationDate: undefined,
    hrAbsences: [...(emp.hrAbsences ?? []), absence],
  }
  next = appendEmployeeJournal(next, journalFromAbsence(absence, source))
  return next
}
