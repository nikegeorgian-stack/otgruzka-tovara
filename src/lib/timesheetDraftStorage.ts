import { normalizeTimesheetEntryDocument } from './timesheetEntries/init'
import type { TimesheetDraftChange } from './timesheetDraft'

export function timesheetDraftStorageKey(project: string, user: string, month: string): string {
  return `fst:timesheet-draft:v1:${encodeURIComponent(project)}:${encodeURIComponent(user)}:${month}`
}

/** Recover proposals only; posting must still check ACL, row identity and original cell state. */
export function parseTimesheetDraft(raw: string | null, month: string): TimesheetDraftChange[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (value.version !== 1 || value.month !== month || !Array.isArray(value.changes)) return []
    const doc = normalizeTimesheetEntryDocument({
      id: 'local-draft',
      month,
      changes: value.changes,
    })
    return (doc?.changes ?? []).filter(
      (ch) =>
        ch.dateKey.startsWith(`${month}-`) && ch.beforeState && ch.expectedEmployeeId !== undefined,
    )
  } catch {
    return []
  }
}
