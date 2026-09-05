import type { HrAbsence, HrAbsenceType, HrJournalEntry, HrJournalKind } from './types'
import type { AppStore, DayCode, Employee } from '@/lib/types'

const MAX_JOURNAL = 200

export const ABSENCE_TYPE_TO_CODE: Partial<Record<HrAbsenceType, DayCode>> = {
  vacation: 'ОТ',
  sick: 'Б',
}

export function absenceCodeForType(type: HrAbsenceType): DayCode | null {
  return ABSENCE_TYPE_TO_CODE[type] ?? null
}

export function journalKindForAbsence(type: HrAbsenceType): HrJournalKind {
  if (type === 'sick') return 'sick'
  if (type === 'vacation') return 'vacation'
  if (type === 'business_trip') return 'business_trip'
  return 'absence'
}

export function journalKindForDayCode(code: DayCode): HrJournalKind | null {
  if (code === 'Б') return 'sick'
  if (code === 'ОТ') return 'vacation'
  if (code === 'ОО') return 'unpaid_leave'
  if (code === 'X') return 'truancy'
  if (code === 'ПР') return 'idle'
  return null
}

export function appendEmployeeJournal(
  emp: Employee,
  entry: Omit<HrJournalEntry, 'id' | 'at'>,
): Employee {
  const row: HrJournalEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  }
  return {
    ...emp,
    hrJournal: [row, ...(emp.hrJournal ?? [])].slice(0, MAX_JOURNAL),
  }
}

export function appendEmployeeJournalInStore(
  store: AppStore,
  employeeId: string,
  entry: Omit<HrJournalEntry, 'id' | 'at'>,
): AppStore {
  return {
    ...store,
    employees: store.employees.map((e) =>
      e.id === employeeId ? appendEmployeeJournal(e, entry) : e,
    ),
  }
}

export function journalFromAbsence(
  absence: HrAbsence,
  source: HrJournalEntry['source'],
  extra?: Partial<HrJournalEntry>,
): Omit<HrJournalEntry, 'id' | 'at'> {
  const code = absenceCodeForType(absence.type)
  const workNote =
    (absence.type === 'sick' || absence.type === 'vacation') && absence.workDays != null
      ? `${absence.workDays} раб. дн.`
      : undefined
  const note = [absence.reason, workNote].filter(Boolean).join(' · ') || undefined
  return {
    kind: journalKindForAbsence(absence.type),
    startDate: absence.startDate,
    endDate: absence.endDate,
    code: code ?? undefined,
    note,
    source,
    timesheetTarget: code ? 'both' : undefined,
    ...extra,
  }
}
