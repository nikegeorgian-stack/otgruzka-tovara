import type { DayCode } from '@/lib/types'

export type TimesheetEntryStatus = 'draft' | 'posted' | 'void'

export type TimesheetEntrySource = 'edit_batch'

export type TimesheetEntryCellState = {
  plan?: DayCode
  fact?: DayCode
  override: boolean
  extraHours?: number
  hoursOverride?: number
}

export type TimesheetEntryChange = {
  rowId: string
  employeeId?: string
  brigade?: string
  dateKey: string
  mode: 'plan' | 'fact'
  before: DayCode
  after: DayCode
  /** Same-code operation that explicitly confirms a planned shift. */
  confirmFact?: boolean
  expectedEmployeeId?: string | null
  beforeState?: TimesheetEntryCellState
  afterState?: TimesheetEntryCellState
}

/** Снимок реально записанной ячейки (для void). */
export type TimesheetEntryAppliedMark = TimesheetEntryChange

export type TimesheetEntryDocument = {
  id: string
  number: string
  status: TimesheetEntryStatus
  month: string
  source: TimesheetEntrySource
  /** Запрошенные правки из UI. */
  changes: TimesheetEntryChange[]
  /** Фактически применённые (после ACL и conflict-check). */
  applied?: TimesheetEntryAppliedMark[]
  /** Сколько ячеек пропущено из‑за конфликта / ACL. */
  skipped?: number
  voidDetail?: string
  createdAt: string
  createdBy?: string
  createdByName?: string
  postedAt?: string
  postedBy?: string
  postedByName?: string
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
}

export type TimesheetEntryStore = {
  documents: TimesheetEntryDocument[]
}

export const TIMESHEET_ENTRY_MAX_DOCS = 400
export const TIMESHEET_ENTRY_VOID_TRIM_MONTHS = 6
