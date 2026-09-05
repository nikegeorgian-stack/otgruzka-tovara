import { useCallback, useMemo, useState } from 'react'
import {
  draftCellKey,
  mergeTimesheetDraft,
  readSheetCellCode,
  type TimesheetDraftChange,
} from '@/lib/timesheetDraft'
import type { DayCode, MonthSheet } from '@/lib/types'

/**
 * Черновик правок табеля на время режима «Редактировать».
 * В стор не пишет — только локальная карта изменений до «Готово».
 */
export function useTimesheetDraftSession(sheet: MonthSheet | undefined) {
  const [byKey, setByKey] = useState<Map<string, TimesheetDraftChange>>(() => new Map())

  const changes = useMemo(() => {
    const list = [...byKey.values()]
    list.sort((a, b) => {
      const modeCmp = a.mode.localeCompare(b.mode)
      if (modeCmp !== 0) return modeCmp
      const dateCmp = a.dateKey.localeCompare(b.dateKey)
      if (dateCmp !== 0) return dateCmp
      return a.rowId.localeCompare(b.rowId)
    })
    return list
  }, [byKey])

  const hasChanges = changes.length > 0

  const displaySheet = useMemo(() => {
    if (!sheet) return undefined
    if (!hasChanges) return sheet
    return mergeTimesheetDraft(sheet, changes)
  }, [sheet, changes, hasChanges])

  const readCode = useCallback(
    (rowId: string, dateKey: string, mode: 'plan' | 'fact'): DayCode => {
      const k = draftCellKey(mode, rowId, dateKey)
      const draft = byKey.get(k)
      if (draft) return draft.after
      if (!sheet) return ''
      return readSheetCellCode(sheet, rowId, dateKey, mode)
    },
    [byKey, sheet],
  )

  const record = useCallback(
    (rowId: string, dateKey: string, mode: 'plan' | 'fact', after: DayCode) => {
      if (!sheet) return
      setByKey((prev) => {
        const k = draftCellKey(mode, rowId, dateKey)
        const existing = prev.get(k)
        const before = existing?.before ?? readSheetCellCode(sheet, rowId, dateKey, mode)
        if (after === before) {
          if (!existing) return prev
          const next = new Map(prev)
          next.delete(k)
          return next
        }
        const next = new Map(prev)
        next.set(k, { rowId, dateKey, mode, before, after })
        return next
      })
    },
    [sheet],
  )

  const clear = useCallback(() => setByKey(new Map()), [])

  const removeKeys = useCallback(
    (
      keys: Array<{
        rowId: string
        dateKey: string
        mode: 'plan' | 'fact'
      }>,
    ) => {
      if (keys.length === 0) return
      setByKey((prev) => {
        const next = new Map(prev)
        for (const k of keys) {
          next.delete(draftCellKey(k.mode, k.rowId, k.dateKey))
        }
        return next
      })
    },
    [],
  )

  return {
    changes,
    hasChanges,
    displaySheet,
    readCode,
    record,
    clear,
    removeKeys,
  }
}
