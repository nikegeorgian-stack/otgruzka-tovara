import type { AppStore, AuditEntry, DayCode } from './types'
import { MAX_AUDIT_ENTRIES } from './types'

export type AuditActorFields = {
  by?: string
  byName?: string
}

export function appendAudit(
  store: AppStore,
  entry: Omit<AuditEntry, 'id' | 'at'>,
): AppStore {
  const full: AuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  }
  const auditLog = [full, ...store.auditLog].slice(0, MAX_AUDIT_ENTRIES)
  return { ...store, auditLog }
}

function employeeLabel(store: AppStore, employeeId?: string): string {
  if (!employeeId) return '—'
  return store.employees.find((e) => e.id === employeeId)?.fullName ?? employeeId.slice(0, 8)
}

/** Изменение плана или факта в ячейке табеля. */
export function auditCellChange(
  store: AppStore,
  args: {
    action: 'fact_change' | 'plan_change'
    month: string
    rowId: string
    dateKey: string
    employeeId?: string
    brigade?: string
    timesheetEntryId?: string
    factConfirmed?: boolean
    oldCode: DayCode
    newCode: DayCode
    /** Правка чужой бригады по временной подмене мастера. */
    viaCoverage?: boolean
  } & AuditActorFields,
): AppStore {
  if (args.oldCode === args.newCode && args.factConfirmed === undefined) return store
  const who = employeeLabel(store, args.employeeId)
  const brigadePart = args.brigade ? `${args.brigade} · ` : ''
  const actorPart = args.byName ? ` · ${args.byName}` : ''
  const coveragePart = args.viaCoverage ? ' · подмена' : ''
  return appendAudit(store, {
    action: args.action,
    month: args.month,
    rowId: args.rowId,
    dateKey: args.dateKey,
    employeeId: args.employeeId,
    brigade: args.brigade,
    by: args.by,
    byName: args.byName,
    factConfirmed: args.factConfirmed,
    timesheetEntryId: args.timesheetEntryId,
    oldValue: args.oldCode || '·',
    newValue: args.newCode || '·',
    detail: `${brigadePart}${who} · ${args.dateKey}: ${args.oldCode || '·'} → ${args.newCode || '·'}${actorPart}${coveragePart}`,
  })
}

/** @deprecated используйте auditCellChange — оставлен для совместимости HR absence. */
export function auditFactChange(
  store: AppStore,
  month: string,
  rowId: string,
  dateKey: string,
  employeeId: string | undefined,
  oldCode: DayCode,
  newCode: DayCode,
  actor?: AuditActorFields,
): AppStore {
  return auditCellChange(store, {
    action: 'fact_change',
    month,
    rowId,
    dateKey,
    employeeId,
    oldCode,
    newCode,
    by: actor?.by,
    byName: actor?.byName,
  })
}
