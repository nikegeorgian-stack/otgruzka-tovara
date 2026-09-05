import { bankAccountsSummary, sameBankAccounts } from '@/lib/hr/employeeBank'
import { appendEmployeeJournal } from '@/lib/hr/journal'
import { effectiveShiftHours } from '@/lib/schedules'
import type { HrJournalEntry } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

export const MOVEMENT_JOURNAL_KINDS = [
  'brigade_transfer',
  'salary_change',
  'position_change',
  'schedule_change',
  'bank_account_change',
  'unit_change',
  'name_change',
  'status',
  'dismissal_settlement',
] as const

export type MovementJournalKind = (typeof MOVEMENT_JOURNAL_KINDS)[number]

export function isMovementJournalKind(kind: string): boolean {
  return (MOVEMENT_JOURNAL_KINDS as readonly string[]).includes(kind)
}

function scheduleLabel(emp: Pick<Employee, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode'>): string {
  const h = effectiveShiftHours(emp)
  const parts = [emp.schedule, `${h}ч`]
  if (emp.group2x2) parts.push(`гр.${emp.group2x2}`)
  if (emp.shiftMode && emp.shiftMode !== 'day') parts.push(emp.shiftMode === 'night' ? 'ночь' : String(emp.shiftMode))
  return parts.join(' ')
}

function salaryLabel(emp: Pick<Employee, 'monthlySalary' | 'hourlyRate'>): string {
  if (emp.monthlySalary != null && emp.monthlySalary > 0) {
    return `${Math.round(emp.monthlySalary)} ₾/мес`
  }
  if (emp.hourlyRate != null && emp.hourlyRate > 0) {
    return `${emp.hourlyRate} ₾/ч`
  }
  return '—'
}

function sameSalary(
  a: Pick<Employee, 'monthlySalary' | 'hourlyRate'>,
  b: Pick<Employee, 'monthlySalary' | 'hourlyRate'>,
): boolean {
  return (a.monthlySalary ?? 0) === (b.monthlySalary ?? 0) && (a.hourlyRate ?? 0) === (b.hourlyRate ?? 0)
}

function nameLabel(emp: Pick<Employee, 'fullName' | 'nameKa' | 'nameEn'>): string {
  return [emp.fullName, emp.nameKa, emp.nameEn].map((s) => s?.trim()).filter(Boolean).join(' / ')
}

function samePersonName(
  a: Pick<Employee, 'fullName' | 'nameKa' | 'nameEn'>,
  b: Pick<Employee, 'fullName' | 'nameKa' | 'nameEn'>,
): boolean {
  return (
    (a.fullName || '').trim() === (b.fullName || '').trim() &&
    (a.nameKa || '').trim() === (b.nameKa || '').trim() &&
    (a.nameEn || '').trim() === (b.nameEn || '').trim()
  )
}

function sameSchedule(
  a: Pick<Employee, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode'>,
  b: Pick<Employee, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode'>,
): boolean {
  return (
    a.schedule === b.schedule &&
    effectiveShiftHours(a) === effectiveShiftHours(b) &&
    (a.group2x2 || '') === (b.group2x2 || '') &&
    (a.shiftMode || 'day') === (b.shiftMode || 'day')
  )
}

/** Запись журнала при переводе бригады с даты. */
export function journalEntryForBrigadeTransfer(input: {
  fromBrigade: string
  toBrigade: string
  fromDateKey: string
  month: string
  oldEmp: Employee
  newEmp: Employee
}): Omit<HrJournalEntry, 'id' | 'at'> {
  const { fromBrigade, toBrigade, fromDateKey, month, oldEmp, newEmp } = input
  const schedChanged = !sameSchedule(oldEmp, newEmp)
  const noteParts = [
    `${fromBrigade || '—'} → ${toBrigade}`,
    `с ${fromDateKey}`,
  ]
  if (schedChanged) {
    noteParts.push(`${scheduleLabel(oldEmp)} → ${scheduleLabel(newEmp)}`)
  }
  return {
    kind: 'brigade_transfer',
    dateKey: fromDateKey,
    month,
    fromBrigade: fromBrigade || undefined,
    toBrigade,
    prev: schedChanged ? scheduleLabel(oldEmp) : undefined,
    next: schedChanged ? scheduleLabel(newEmp) : undefined,
    note: noteParts.join(' · '),
    source: 'brigade_transfer',
  }
}

/** Смена графика с даты (в т.ч. в той же бригаде: 5/2 → 2/2). */
export function journalEntryForScheduleChangeFromDate(input: {
  fromDateKey: string
  month: string
  oldEmp: Employee
  newEmp: Employee
  sameBrigade?: boolean
}): Omit<HrJournalEntry, 'id' | 'at'> {
  const { fromDateKey, month, oldEmp, newEmp, sameBrigade } = input
  const brigadeNote = sameBrigade
    ? `бригада ${newEmp.brigade || '—'} (без смены)`
    : undefined
  return {
    kind: 'schedule_change',
    dateKey: fromDateKey,
    month,
    prev: scheduleLabel(oldEmp),
    next: scheduleLabel(newEmp),
    note: [`с ${fromDateKey}`, `${scheduleLabel(oldEmp)} → ${scheduleLabel(newEmp)}`, brigadeNote]
      .filter(Boolean)
      .join(' · '),
    source: 'brigade_transfer',
  }
}

/**
 * Добавляет в журнал строки по диффу карточки (бригада, должность, график, ЗП).
 * Не трогает отсутствия — они пишутся отдельно.
 */
export function applyEmployeeMovementJournal(prev: Employee | undefined, next: Employee): Employee {
  if (!prev) {
    return appendEmployeeJournal(next, {
      kind: 'status',
      dateKey: next.hireDate,
      note: `Приём · ${next.brigade || '—'} · ${next.position || '—'} · ${salaryLabel(next)}`,
      fromBrigade: undefined,
      toBrigade: next.brigade || undefined,
      next: next.position || undefined,
      source: 'hr_card',
    })
  }

  // Карточка в модалке может быть старше стора (после перевода) — журнал из prev не теряем.
  let emp: Employee = { ...next, hrJournal: prev.hrJournal ?? next.hrJournal }
  const base = emp

  if (!samePersonName(prev, base)) {
    emp = appendEmployeeJournal(emp, {
      kind: 'name_change',
      prev: nameLabel(prev),
      next: nameLabel(base),
      note: `${nameLabel(prev)} → ${nameLabel(base)}`,
      source: 'hr_card',
    })
  }

  if ((prev.brigade || '') !== (base.brigade || '')) {
    emp = appendEmployeeJournal(emp, {
      kind: 'brigade_transfer',
      fromBrigade: prev.brigade || undefined,
      toBrigade: base.brigade || undefined,
      note: `${prev.brigade || '—'} → ${base.brigade || '—'} (карточка HR)`,
      source: 'hr_card',
    })
  }

  if ((prev.position || '') !== (base.position || '') || (prev.positionKa || '') !== (base.positionKa || '')) {
    emp = appendEmployeeJournal(emp, {
      kind: 'position_change',
      prev: prev.position || '—',
      next: base.position || '—',
      note: `${prev.position || '—'} → ${base.position || '—'}`,
      source: 'hr_card',
    })
  }

  if (!sameSchedule(prev, base)) {
    emp = appendEmployeeJournal(emp, {
      kind: 'schedule_change',
      prev: scheduleLabel(prev),
      next: scheduleLabel(base),
      note: `${scheduleLabel(prev)} → ${scheduleLabel(base)}`,
      source: 'hr_card',
    })
  }

  if (!sameSalary(prev, base)) {
    emp = appendEmployeeJournal(emp, {
      kind: 'salary_change',
      prev: salaryLabel(prev),
      next: salaryLabel(base),
      note: `${salaryLabel(prev)} → ${salaryLabel(base)}`,
      source: 'hr_card',
    })
  }

  if (!sameBankAccounts(prev.bankAccounts, base.bankAccounts)) {
    emp = appendEmployeeJournal(emp, {
      kind: 'bank_account_change',
      prev: bankAccountsSummary(prev.bankAccounts),
      next: bankAccountsSummary(base.bankAccounts),
      note: `${bankAccountsSummary(prev.bankAccounts)} → ${bankAccountsSummary(base.bankAccounts)}`,
      source: 'hr_card',
    })
  }

  if ((prev.structuralUnitId || '') !== (base.structuralUnitId || '')) {
    emp = appendEmployeeJournal(emp, {
      kind: 'unit_change',
      prev: prev.structuralUnitId || '—',
      next: base.structuralUnitId || '—',
      note: `Подразделение: ${prev.structuralUnitId || '—'} → ${base.structuralUnitId || '—'}`,
      source: 'hr_card',
    })
  }

  if (
    (prev.hrStatus || 'active') !== (base.hrStatus || 'active') ||
    (prev.terminationDate || '') !== (base.terminationDate || '')
  ) {
    const statusNote =
      base.hrStatus === 'fired'
        ? `Увольнение${base.terminationDate ? ` · ${base.terminationDate}` : ''}`
        : `Статус: ${prev.hrStatus || 'active'} → ${base.hrStatus || 'active'}`
    emp = appendEmployeeJournal(emp, {
      kind: 'status',
      dateKey: base.terminationDate || undefined,
      note: statusNote,
      source: 'hr_card',
    })
  }

  return emp
}
