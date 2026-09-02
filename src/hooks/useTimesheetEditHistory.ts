import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayCode } from '@/lib/types'

export type TimesheetCellEdit = {
  rowId: string
  dateKey: string
  mode: 'plan' | 'fact'
  before: DayCode
  after: DayCode
}

const MAX = 80

/**
 * Локальная история правок ячеек табеля (как ← → в Word).
 * Не в сторе — только сессия вкладки.
 */
export function useTimesheetEditHistory(opts: {
  enabled: boolean
  apply: (edit: TimesheetCellEdit, direction: 'undo' | 'redo') => void
}) {
  const undoStack = useRef<TimesheetCellEdit[]>([])
  const redoStack = useRef<TimesheetCellEdit[]>([])
  const mute = useRef(false)
  const applyRef = useRef(opts.apply)
  applyRef.current = opts.apply
  const [, bump] = useState(0)

  const canUndo = undoStack.current.length > 0
  const canRedo = redoStack.current.length > 0

  const record = useCallback((edit: TimesheetCellEdit) => {
    if (mute.current) return
    if (edit.before === edit.after) return
    undoStack.current = [...undoStack.current.slice(-(MAX - 1)), edit]
    redoStack.current = []
    bump((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const edit = undoStack.current[undoStack.current.length - 1]
    if (!edit) return false
    undoStack.current = undoStack.current.slice(0, -1)
    redoStack.current = [...redoStack.current, edit]
    mute.current = true
    try {
      applyRef.current(edit, 'undo')
    } finally {
      mute.current = false
    }
    bump((n) => n + 1)
    return true
  }, [])

  const redo = useCallback(() => {
    const edit = redoStack.current[redoStack.current.length - 1]
    if (!edit) return false
    redoStack.current = redoStack.current.slice(0, -1)
    undoStack.current = [...undoStack.current, edit]
    mute.current = true
    try {
      applyRef.current(edit, 'redo')
    } finally {
      mute.current = false
    }
    bump((n) => n + 1)
    return true
  }, [])

  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    bump((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!opts.enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        if (undo()) {
          e.preventDefault()
        }
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (redo()) {
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts.enabled, undo, redo])

  return {
    record,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    undoCount: undoStack.current.length,
    redoCount: redoStack.current.length,
  }
}
