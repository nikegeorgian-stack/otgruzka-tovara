import type { AppStore, MonthSheet } from '@/lib/types'
import { restoreTimesheetCellState, sameTimesheetCellState, timesheetCellState } from './cellState'

/** A retained void document authorizes a precise restoration; blanket wipes still cannot remove overrides. */
export function preserveTimesheetEntryVoids(
  merged: AppStore,
  remote: AppStore,
  local: AppStore,
): void {
  const docs = [...(merged.timesheetEntries?.documents ?? [])]
    .filter((d) => d.status === 'void' && d.voidedAt)
    .sort((a, b) => (a.voidedAt ?? '').localeCompare(b.voidedAt ?? ''))
  for (const doc of docs) {
    let sheet = merged.months[doc.month]
    const r = remote.months[doc.month],
      l = local.months[doc.month]
    if (!sheet || !r || !l || (sheet.resetAt && sheet.resetAt > doc.voidedAt!)) continue
    // Reduce a document's repeated plan/fact edits to its initial and final physical cell states.
    const cells = new Map<
      string,
      {
        first: NonNullable<typeof doc.applied>[number]
        last: NonNullable<typeof doc.applied>[number]
      }
    >()
    for (const mark of doc.applied ?? []) {
      const key = `${mark.rowId}|${mark.dateKey}`,
        prior = cells.get(key)
      cells.set(key, { first: prior?.first ?? mark, last: mark })
    }
    for (const { first, last } of cells.values()) {
      if (!first.beforeState || !last.afterState || first.expectedEmployeeId === undefined) continue
      const laterDocument = (merged.timesheetEntries?.documents ?? []).some(
        (other) =>
          other.id !== doc.id &&
          (other.voidedAt ?? other.postedAt ?? other.createdAt) > doc.voidedAt! &&
          other.month === doc.month &&
          other.applied?.some((m) => m.rowId === first.rowId && m.dateKey === first.dateKey),
      )
      const laterAudit = merged.auditLog.some((a) => {
        if (a.month !== doc.month || a.rowId !== first.rowId || a.dateKey !== first.dateKey) {
          return false
        }
        if (!(a.at > doc.voidedAt!)) return false
        if (a.timesheetEntryId === doc.id) return false
        // Other tagged document → real later edit.
        if (a.timesheetEntryId != null) return true
        // Legacy / clock-skew: ignore confirm↔void mirrors of this same applied cell.
        const mirrorsThisCell =
          (a.oldValue === last.after && a.newValue === last.before) ||
          (a.oldValue === first.before && a.newValue === last.after) ||
          (a.oldValue === (last.after || '·') && a.newValue === (last.before || '·')) ||
          (a.oldValue === (first.before || '·') && a.newValue === (last.after || '·'))
        return !mirrorsThisCell
      })
      if (laterDocument || laterAudit) continue
      const matchesIdentity = (s: MonthSheet) =>
        s.rows.some((row) => row.id === first.rowId && row.employeeId === first.expectedEmployeeId)
      if (![sheet, r, l].every(matchesIdentity)) continue
      const rs = timesheetCellState(r, first.rowId, first.dateKey),
        ls = timesheetCellState(l, first.rowId, first.dateKey)
      const before = first.beforeState,
        after = last.afterState
      const remoteVoided = remote.timesheetEntries?.documents.some(
        (d) => d.id === doc.id && d.status === 'void',
      )
      const localVoided = local.timesheetEntries?.documents.some(
        (d) => d.id === doc.id && d.status === 'void',
      )
      // One side actually performed this void and is still at its restored state.
      if (
        !(
          (remoteVoided && sameTimesheetCellState(rs, before)) ||
          (localVoided && sameTimesheetCellState(ls, before))
        )
      )
        continue
      if (
        ![rs, ls].every(
          (state) => sameTimesheetCellState(state, before) || sameTimesheetCellState(state, after),
        )
      )
        continue
      sheet = restoreTimesheetCellState(sheet, first.rowId, first.dateKey, before)
    }
    merged.months[doc.month] = sheet
  }
}
