import type {
  TimesheetEntryAppliedMark,
  TimesheetEntryChange,
  TimesheetEntryDocument,
  TimesheetEntrySource,
  TimesheetEntryStatus,
  TimesheetEntryStore,
  TimesheetEntryCellState,
} from './types'
import { TIMESHEET_ENTRY_MAX_DOCS, TIMESHEET_ENTRY_VOID_TRIM_MONTHS } from './types'
import type { DayCode } from '@/lib/types'

const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = new Set<TimesheetEntryStatus>(['draft', 'posted', 'void'])
const SOURCES = new Set<TimesheetEntrySource>(['edit_batch'])
const MODES = new Set(['plan', 'fact'])

export function createDefaultTimesheetEntryStore(): TimesheetEntryStore {
  return { documents: [] }
}

export function nextTimesheetEntryNumber(list: TimesheetEntryDocument[], now = new Date()): string {
  const year = now.getFullYear()
  const prefix = `ВТ-${year}-`
  let max = 0
  for (const d of list) {
    const num = d.number?.trim() ?? ''
    if (!num.startsWith(prefix)) continue
    const n = parseInt(num.slice(prefix.length), 10)
    if (!Number.isNaN(n)) max = Math.max(max, n)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function asDayCode(v: unknown): DayCode {
  return (typeof v === 'string' ? v : '') as DayCode
}

function normalizeCellState(raw: unknown): TimesheetEntryCellState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const state = raw as Record<string, unknown>
  if (typeof state.override !== 'boolean') return undefined
  return {
    plan: typeof state.plan === 'string' ? asDayCode(state.plan) : undefined,
    fact: typeof state.fact === 'string' ? asDayCode(state.fact) : undefined,
    override: state.override,
    extraHours:
      typeof state.extraHours === 'number' && Number.isFinite(state.extraHours)
        ? state.extraHours
        : undefined,
    hoursOverride:
      typeof state.hoursOverride === 'number' && Number.isFinite(state.hoursOverride)
        ? state.hoursOverride
        : undefined,
  }
}

function normalizeChange(raw: unknown): TimesheetEntryChange | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const rowId = typeof o.rowId === 'string' ? o.rowId.trim() : ''
  const dateKey = typeof o.dateKey === 'string' ? o.dateKey.trim() : ''
  const mode = o.mode === 'plan' || o.mode === 'fact' ? o.mode : null
  if (!rowId || !DATE_RE.test(dateKey) || !mode || !MODES.has(mode)) return null
  return {
    rowId,
    dateKey,
    mode,
    before: asDayCode(o.before),
    after: asDayCode(o.after),
    confirmFact: o.confirmFact === true ? true : undefined,
    expectedEmployeeId:
      o.expectedEmployeeId === null
        ? null
        : typeof o.expectedEmployeeId === 'string'
          ? o.expectedEmployeeId
          : undefined,
    beforeState: normalizeCellState(o.beforeState),
    afterState: normalizeCellState(o.afterState),
    employeeId:
      typeof o.employeeId === 'string' && o.employeeId.trim() ? o.employeeId.trim() : undefined,
    brigade: typeof o.brigade === 'string' && o.brigade.trim() ? o.brigade.trim() : undefined,
  }
}

function normalizeApplied(raw: unknown): TimesheetEntryAppliedMark[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: TimesheetEntryAppliedMark[] = []
  for (const row of raw) {
    const c = normalizeChange(row)
    if (c) out.push(c)
  }
  return out.length ? out : undefined
}

export function normalizeTimesheetEntryDocument(raw: unknown): TimesheetEntryDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  if (!id) return null
  const month = typeof o.month === 'string' ? o.month.trim() : ''
  if (!MONTH_RE.test(month)) return null
  const status =
    typeof o.status === 'string' && STATUSES.has(o.status as TimesheetEntryStatus)
      ? (o.status as TimesheetEntryStatus)
      : 'draft'
  const source =
    typeof o.source === 'string' && SOURCES.has(o.source as TimesheetEntrySource)
      ? (o.source as TimesheetEntrySource)
      : 'edit_batch'
  const number =
    typeof o.number === 'string' && o.number.trim()
      ? o.number.trim()
      : `ВТ-${month.slice(0, 4)}-000`
  const changes: TimesheetEntryChange[] = []
  if (Array.isArray(o.changes)) {
    for (const row of o.changes) {
      const c = normalizeChange(row)
      if (c) changes.push(c)
    }
  }
  const createdAt =
    typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : new Date().toISOString()
  return {
    id,
    number,
    status,
    month,
    source,
    changes,
    applied: normalizeApplied(o.applied),
    skipped: typeof o.skipped === 'number' && o.skipped > 0 ? o.skipped : undefined,
    voidDetail:
      typeof o.voidDetail === 'string' && o.voidDetail.trim() ? o.voidDetail.trim() : undefined,
    createdAt,
    createdBy: typeof o.createdBy === 'string' ? o.createdBy : undefined,
    createdByName: typeof o.createdByName === 'string' ? o.createdByName : undefined,
    postedAt: typeof o.postedAt === 'string' ? o.postedAt : undefined,
    postedBy: typeof o.postedBy === 'string' ? o.postedBy : undefined,
    postedByName: typeof o.postedByName === 'string' ? o.postedByName : undefined,
    voidedAt: typeof o.voidedAt === 'string' ? o.voidedAt : undefined,
    voidedBy: typeof o.voidedBy === 'string' ? o.voidedBy : undefined,
    voidedByName: typeof o.voidedByName === 'string' ? o.voidedByName : undefined,
  }
}

function monthAgeMonths(month: string, now: Date): number {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return 999
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
}

/** Trim старых void до TIMESHEET_ENTRY_MAX_DOCS. Posted не режем. */
export function trimTimesheetEntryDocuments(
  docs: TimesheetEntryDocument[],
  now = new Date(),
): TimesheetEntryDocument[] {
  if (docs.length <= TIMESHEET_ENTRY_MAX_DOCS) return docs
  const voidOld = docs.filter(
    (d) =>
      d.status === 'void' &&
      !d.applied?.some((m) => m.beforeState && m.afterState) &&
      monthAgeMonths(d.month, now) > TIMESHEET_ENTRY_VOID_TRIM_MONTHS,
  )
  const voidOldIds = new Set(voidOld.map((d) => d.id))
  let next = docs.filter((d) => !voidOldIds.has(d.id))
  if (next.length <= TIMESHEET_ENTRY_MAX_DOCS) return next

  const voidRest = next
    .filter((d) => d.status === 'void' && !d.applied?.some((m) => m.beforeState && m.afterState))
    .sort((a, b) => (a.voidedAt ?? a.createdAt).localeCompare(b.voidedAt ?? b.createdAt))
  const drop = next.length - TIMESHEET_ENTRY_MAX_DOCS
  const dropIds = new Set(voidRest.slice(0, Math.max(0, drop)).map((d) => d.id))
  next = next.filter((d) => !dropIds.has(d.id))
  return next
}

export function normalizeTimesheetEntryStore(
  raw: TimesheetEntryStore | undefined | null,
): TimesheetEntryStore {
  if (!raw || !Array.isArray(raw.documents)) return createDefaultTimesheetEntryStore()
  const docs: TimesheetEntryDocument[] = []
  const seen = new Set<string>()
  for (const row of raw.documents) {
    const d = normalizeTimesheetEntryDocument(row)
    if (!d || seen.has(d.id)) continue
    seen.add(d.id)
    docs.push(d)
  }
  return { documents: trimTimesheetEntryDocuments(docs) }
}
