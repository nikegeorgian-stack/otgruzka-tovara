import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  draftCellKey,
  mergeTimesheetDraft,
  readSheetCellCode,
  type TimesheetDraftChange,
} from '@/lib/timesheetDraft'
import { timesheetCellState, timesheetDateInRow } from '@/lib/timesheetEntries/cellState'
import { parseTimesheetDraft } from '@/lib/timesheetDraftStorage'
import type { DayCode, MonthSheet } from '@/lib/types'

/** Local proposals, scoped to project, user and month. Never posts during recovery. */
export function useTimesheetDraftSession(
  sheet: MonthSheet | undefined,
  storageKey: string,
  month: string,
) {
  const recovered = useMemo(() => {
    try {
      return new Map(
        parseTimesheetDraft(localStorage.getItem(storageKey), month).map((ch) => [
          draftCellKey(ch.mode, ch.rowId, ch.dateKey),
          ch,
        ]),
      )
    } catch {
      return new Map<string, TimesheetDraftChange>()
    }
  }, [storageKey, month])
  const [session, setSession] = useState(() => ({
    key: storageKey,
    map: recovered,
    storageError: false,
  }))
  const byKey = session.key === storageKey ? session.map : recovered
  const update = useCallback(
    (fn: (prev: Map<string, TimesheetDraftChange>) => Map<string, TimesheetDraftChange>) => {
      setSession((prev) => {
        const map = fn(prev.key === storageKey ? prev.map : recovered)
        let storageError = false
        try {
          if (map.size)
            localStorage.setItem(
              storageKey,
              JSON.stringify({ version: 1, month, changes: [...map.values()] }),
            )
          else localStorage.removeItem(storageKey)
        } catch {
          storageError = true
        }
        return { key: storageKey, map, storageError }
      })
    },
    [storageKey, month, recovered],
  )
  const changes = useMemo(
    () =>
      [...byKey.values()].sort(
        (a, b) =>
          a.mode.localeCompare(b.mode) ||
          a.dateKey.localeCompare(b.dateKey) ||
          a.rowId.localeCompare(b.rowId),
      ),
    [byKey],
  )
  const hasChanges = changes.length > 0
  useEffect(() => {
    if (!hasChanges) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasChanges])
  const displaySheet = useMemo(
    () => (sheet && hasChanges ? mergeTimesheetDraft(sheet, changes) : sheet),
    [sheet, changes, hasChanges],
  )
  const readCode = useCallback(
    (rowId: string, dateKey: string, mode: 'plan' | 'fact'): DayCode =>
      byKey.get(draftCellKey(mode, rowId, dateKey))?.after ??
      (sheet ? readSheetCellCode(sheet, rowId, dateKey, mode) : ''),
    [byKey, sheet],
  )
  const record = useCallback(
    (
      rowId: string,
      dateKey: string,
      mode: 'plan' | 'fact',
      after: DayCode,
      confirmFact = false,
    ) => {
      if (!sheet || !timesheetDateInRow(sheet, rowId, dateKey)) return
      const row = sheet.rows.find((r) => r.id === rowId)
      if (!row) return
      update((prev) => {
        const key = draftCellKey(mode, rowId, dateKey),
          existing = prev.get(key)
        const before = existing?.before ?? readSheetCellCode(sheet, rowId, dateKey, mode)
        const beforeState = existing?.beforeState ?? timesheetCellState(sheet, rowId, dateKey)
        const next = new Map(prev)
        const confirmation = mode === 'fact' && confirmFact && !!after && !beforeState.override
        if (after === before && !confirmation) next.delete(key)
        else
          next.set(key, {
            rowId,
            dateKey,
            mode,
            before,
            after,
            beforeState,
            expectedEmployeeId: existing ? existing.expectedEmployeeId : row.employeeId,
            confirmFact: confirmation || undefined,
          })
        return next
      })
    },
    [sheet, update],
  )
  const clear = useCallback(() => update(() => new Map()), [update])
  const removeKeys = useCallback(
    (keys: Array<{ rowId: string; dateKey: string; mode: 'plan' | 'fact' }>) =>
      update((prev) => {
        const next = new Map(prev)
        for (const key of keys) next.delete(draftCellKey(key.mode, key.rowId, key.dateKey))
        return next
      }),
    [update],
  )
  return {
    changes,
    hasChanges,
    displaySheet,
    readCode,
    record,
    clear,
    removeKeys,
    storageError: session.key === storageKey && session.storageError,
  }
}
