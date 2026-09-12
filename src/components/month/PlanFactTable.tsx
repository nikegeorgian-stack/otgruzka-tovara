import { isBrigadeTimesheetVerified } from '@/lib/brigadeSignoff'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { employeeName, employeeSearchText } from '@/i18n'
import { brigadeAllowsBrigadier } from '@/lib/brigadeHasBrigadier'
import { brigadeLabel } from '@/lib/brigadeText'
import { getBrigades } from '@/lib/brigades'
import { getCellComment } from '@/lib/bulkOps'
import { getSubstitution, substitutionLabel } from '@/lib/substitutions'
import {
  dayDateKey,
  daysInMonth,
  formatMonthTitle,
  isoDateLocal,
  isWeekend,
  parseMonthKey,
  weekdayShort,
} from '@/lib/dates'
import {
  georgiaHolidayNameBilingual,
  isGeorgiaPublicHoliday,
} from '@/lib/georgiaCalendar'
import { getFactExtraHours, getFactHoursOverride, isWorkCode } from '@/lib/factExtra'
import { hoursForCode, workCodeForExactHours } from '@/lib/codes'
import { hasRowPeriodBounds, rowPeriodOffReason } from '@/lib/rowPeriod'
import { absenceConfirmForEmployee } from '@/lib/absenceConfirm'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { getFactMark } from '@/lib/stats'
import { isCyclicSchedule, scheduleDisplayLabel, usesGroup2x2 } from '@/lib/schedules'
import {
  DEFAULT_MONTH_VIEW_DISPLAY,
  isBrigadeVisible,
  isEmployeeUnitVisible,
  structuralUnitFilterActive,
  type MonthGroupMode,
  type MonthTableDisplay,
} from '@/lib/monthViewOptions'
import { buildTimesheetLayout, flattenTimesheetLayout, layoutNavRowIds, type BrigadeHeaderMode } from '@/lib/monthTimesheetLayout'
import {
  DEFAULT_MONTH_ROW_SORT,
  toggleMonthRowSort,
  type MonthRowSort,
  type MonthRowSortKey,
} from '@/lib/monthRowSort'
import { employeeStructuralUnitLabel } from '@/lib/hr/orgStructure'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import { monthAssignmentsByEmployee } from '@/lib/monthAssignment'
import type { AppStore, DayCode, Employee, MonthSheet } from '@/lib/types'
import {
  monthCellSnapshotEqual,
  readMonthCellSnapshot,
  type MonthCellSnapshot,
  type RemoteCellConflictInfo,
} from '@/lib/monthCellSnapshot'
import { KANBAN_DRAG_MIME } from '@/components/kanban/useKanbanDrag'
import { CellCodePicker } from './CellCodePicker'
import { CellContextMenu } from './CellContextMenu'
import { DayCell } from './DayCell'
import { TimesheetFlatBody } from './TimesheetFlatBody'

type Props = {
  store: AppStore
  sheet: MonthSheet
  mode: 'plan' | 'fact'
  metaEditable?: boolean
  /** Назначение сотрудников в строки (без режима «Редактировать»). */
  assignEditable?: boolean
  embedded?: boolean
  /** Полноэкранный редактор — крупнее ячейки, на всю высоту. */
  focusMode?: boolean
  /** Заголовки бригад в таблице: полные, только название или скрыты (контекст-бар). */
  brigadeHeaderMode?: BrigadeHeaderMode
  search?: string
  selectedBrigades?: Set<string>
  brigadeSearch?: string
  selectedUnits?: Set<string>
  allUnitKeys?: string[]
  filterSchedule?: string
  groupMode?: MonthGroupMode
  display?: MonthTableDisplay
  rowSort?: MonthRowSort
  onRowSortChange?: (sort: MonthRowSort) => void
  readOnly?: boolean
  onCycle: (rowId: string, dateKey: string) => void
  onSetCode: (rowId: string, dateKey: string, code: DayCode) => void
  /** Пакетная установка кода (мультивыбор) — один апдейт store. */
  onSetCodesBatch?: (
    cells: Array<{ rowId: string; dateKey: string }>,
    code: DayCode,
  ) => void
  onSetFactExtra?: (rowId: string, dateKey: string, hours: number) => void
  onSetFactHours?: (rowId: string, dateKey: string, hours: number | null) => void
  onAssign: (rowId: string, employeeId: string | null) => void
  /** Конфликт: человек уже в другой бригаде месяца / кадрах. */
  onAssignConflict?: (info: {
    employeeId: string
    fromBrigade: string
    toBrigade: string
  }) => void
  onAddEmployee?: (rowId: string, brigade: string) => void
  onFillBrigade?: (brigade: string) => void
  onRegenerateRow: (rowId: string) => void
  onAddRow?: (brigade: string) => void
  onRemoveRow?: (rowId: string) => void
  onRemoveEmptyRow?: (brigade: string) => void
  onCommentRequest?: (rowId: string, dateKey: string) => void
  onSubstitutionRequest?: (rowId: string, dateKey: string) => void
  onChangeGroup2x2?: (rowId: string, employeeId: string, group: 'А' | 'Б') => void
  /** Привязать цикл графика сотрудника к кликнутому дню (план). */
  onSetCycleFromDay?: (
    rowId: string,
    employeeId: string,
    day: number,
    variant: 'first' | 'last',
  ) => void
  /** Назначить бригадира бригады (null — снять). */
  onSetBrigadier?: (brigade: string, employeeId: string | null) => void
  canSignoff?: boolean
  onSetBrigadeSignoff?: (brigade: string, verified: boolean) => void
  /** Отметить/снять бригадирство в конкретный день (для бригадирской премии). */
  onMarkBrigadier?: (rowId: string, dateKey: string, on: boolean) => void
  /** Отметить/снять бригадирство на весь месяц по строке. */
  onMarkBrigadierMonth?: (rowId: string, on: boolean) => void
  onRowInactiveFrom?: (rowId: string, dateKey: string) => void
  onRowActiveFrom?: (rowId: string, dateKey: string) => void
  onClearRowPeriod?: (rowId: string) => void
  /** Ячейка изменилась удалённо, пока открыт picker / меню. */
  onRemoteCellConflict?: (info: RemoteCellConflictInfo) => void
  /** Показать только строки с расхождением план≠факт. */
  mismatchOnly?: boolean
  /** Порядок строк в бригаде (как ⠿ на плитках). */
  onReorderRow?: (brigade: string, rowId: string, beforeRowId: string | null) => void
  /** Порядок № без режима «Редактировать» (ячейки остаются read-only). */
  allowRowReorder?: boolean
  /** Drop ⠿ на другую бригаду — окно переноса. */
  onMoveToOtherBrigade?: (rowId: string, toBrigade: string) => void
}

type FocusCell = { rowId: string; day: number }

export function PlanFactTable({
  store,
  sheet,
  mode,
  metaEditable = true,
  assignEditable = false,
  embedded = false,
  focusMode = false,
  brigadeHeaderMode = 'full',
  search = '',
  selectedBrigades,
  brigadeSearch = '',
  selectedUnits,
  allUnitKeys = [],
  filterSchedule = '',
  groupMode = 'brigade',
  display = DEFAULT_MONTH_VIEW_DISPLAY,
  rowSort = DEFAULT_MONTH_ROW_SORT,
  onRowSortChange,
  readOnly = false,
  onCycle,
  onSetCode,
  onSetCodesBatch,
  onSetFactExtra,
  onSetFactHours,
  onAssign,
  onAssignConflict,
  onAddEmployee,
  onFillBrigade,
  onRegenerateRow,
  onAddRow,
  onRemoveRow,
  onRemoveEmptyRow,
  onCommentRequest,
  onSubstitutionRequest,
  onChangeGroup2x2,
  onSetCycleFromDay,
  onSetBrigadier,
  canSignoff = false,
  onSetBrigadeSignoff,
  onMarkBrigadier,
  onMarkBrigadierMonth,
  onRowInactiveFrom,
  onRowActiveFrom,
  onClearRowPeriod,
  onRemoteCellConflict,
  mismatchOnly = false,
  onReorderRow,
  allowRowReorder,
  onMoveToOtherBrigade,
}: Props) {
  const { t, tf, locale, employeeNameLines, employeePositionLines } = useI18n()
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  const dayNums = Array.from({ length: days }, (_, i) => i + 1)
  const brigades = getBrigades(store)
  const tableRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<FocusCell | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    rowId: string
    dateKey: string
    x: number
    y: number
  } | null>(null)
  const [codePicker, setCodePicker] = useState<{
    rowId: string
    dateKey: string
    x: number
    y: number
    current: DayCode
    currentExtra: number
    currentOverride: number | null
  } | null>(null)
  const ignoreCellConflictRef = useRef(false)
  const contextSnapshotRef = useRef<MonthCellSnapshot | null>(null)
  const remoteFlashTimerRef = useRef<number | null>(null)
  const [remoteFlashCell, setRemoteFlashCell] = useState<string | null>(null)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set())
  const selectionAnchorRef = useRef<{ rowId: string; day: number } | null>(null)
  const dragSelectRef = useRef(false)
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null)
  const draggingRowIdRef = useRef<string | null>(null)
  const [dropBeforeId, setDropBeforeId] = useState<string | null | undefined>(undefined)
  const canReorder = Boolean(onReorderRow && (allowRowReorder ?? !readOnly))
  const canTransferDrop = Boolean(onMoveToOtherBrigade && (allowRowReorder ?? !readOnly))
  const canRowDrag = canReorder || canTransferDrop

  const beginRowDrag = (e: React.DragEvent, rowId: string) => {
    e.dataTransfer.setData(KANBAN_DRAG_MIME, rowId)
    e.dataTransfer.setData('text/plain', rowId)
    e.dataTransfer.effectAllowed = 'move'
    draggingRowIdRef.current = rowId
    setDraggingRowId(rowId)
    onRowSortChange?.(DEFAULT_MONTH_ROW_SORT)
  }

  const endRowDrag = () => {
    draggingRowIdRef.current = null
    setDraggingRowId(null)
    setDropBeforeId(undefined)
  }


  const clearSelection = useCallback(() => {
    setSelectedCells(new Set())
    selectionAnchorRef.current = null
    dragSelectRef.current = false
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
    }
    const onUp = () => {
      dragSelectRef.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onUp)
    }
  }, [clearSelection])

  const openCodePicker = useCallback(
    (
      rowId: string,
      dateKey: string,
      current: DayCode,
      x: number,
      y: number,
      currentExtra = 0,
      currentOverride: number | null = null,
    ) => {
      setContextMenu(null)
      setCodePicker({
        rowId,
        dateKey,
        x,
        y,
        current,
        currentExtra,
        currentOverride,
      })
    },
    [],
  )

  const closeCellEditors = useCallback(() => {
    setCodePicker(null)
    setContextMenu(null)
    contextSnapshotRef.current = null
  }, [])

  const notifyRemoteConflict = useCallback(
    (info: RemoteCellConflictInfo) => {
      closeCellEditors()
      const key = `${info.rowId}|${info.dateKey}`
      setRemoteFlashCell(key)
      if (remoteFlashTimerRef.current) window.clearTimeout(remoteFlashTimerRef.current)
      remoteFlashTimerRef.current = window.setTimeout(() => {
        setRemoteFlashCell(null)
        remoteFlashTimerRef.current = null
      }, 4500)
      onRemoteCellConflict?.(info)
    },
    [closeCellEditors, onRemoteCellConflict],
  )

  useEffect(
    () => () => {
      if (remoteFlashTimerRef.current) window.clearTimeout(remoteFlashTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!codePicker && !contextMenu) {
      ignoreCellConflictRef.current = false
      return
    }
    if (ignoreCellConflictRef.current) return

    const target = codePicker ?? contextMenu
    if (!target) return

    const row = sheet.rows.find((r) => r.id === target.rowId)
    if (!row) {
      notifyRemoteConflict({
        rowId: target.rowId,
        dateKey: target.dateKey,
        was: codePicker?.current ?? '',
        now: '',
        mode,
      })
      return
    }

    const live = readMonthCellSnapshot(sheet, target.rowId, target.dateKey, mode)

    if (codePicker) {
      const opened: MonthCellSnapshot = {
        code: codePicker.current,
        extraHours: codePicker.currentExtra,
      }
      if (!monthCellSnapshotEqual(opened, live)) {
        notifyRemoteConflict({
          rowId: codePicker.rowId,
          dateKey: codePicker.dateKey,
          was: codePicker.current,
          now: live.code,
          mode,
        })
      }
      return
    }

    if (contextMenu && contextSnapshotRef.current) {
      if (!monthCellSnapshotEqual(contextSnapshotRef.current, live)) {
        notifyRemoteConflict({
          rowId: contextMenu.rowId,
          dateKey: contextMenu.dateKey,
          was: contextSnapshotRef.current.code,
          now: live.code,
          mode,
        })
      }
    }
  }, [sheet, codePicker, contextMenu, mode, notifyRemoteConflict])

  const handlePickCode = useCallback(
    (code: DayCode) => {
      if (!codePicker) return
      ignoreCellConflictRef.current = true
      const targets =
        selectedCells.size > 1
          ? [...selectedCells].map((k) => {
              const i = k.indexOf('|')
              return { rowId: k.slice(0, i), dateKey: k.slice(i + 1) }
            })
          : [{ rowId: codePicker.rowId, dateKey: codePicker.dateKey }]
      if (onSetCodesBatch) {
        onSetCodesBatch(targets, code)
      } else {
        for (const c of targets) {
          onSetCode(c.rowId, c.dateKey, code)
        }
      }
      if (targets.length > 1) {
        clearSelection()
        setCodePicker(null)
        queueMicrotask(() => {
          ignoreCellConflictRef.current = false
        })
        return
      }
      const work = isWorkCode(code)
      // В факте после рабочей смены оставляем пикер — чтобы сразу указать 4 / 7 ч и т.д.
      if (mode === 'fact' && onSetFactHours && work) {
        setCodePicker((prev) =>
          prev
            ? {
                ...prev,
                current: code,
                currentExtra: 0,
                currentOverride: null,
              }
            : null,
        )
        // ignore остаётся true, пока пикер открыт — иначе свой же setStore даёт ложный «remote flash».
        return
      }
      // Закрываем окно сразу: иначе оно «переезжает» на следующий день и перекрывает ячейку.
      const day = Number(codePicker.dateKey.slice(8))
      const nextDay = day + 1
      if (Number.isFinite(day) && nextDay <= days) {
        setFocus({ rowId: codePicker.rowId, day: nextDay })
      }
      setCodePicker(null)
      queueMicrotask(() => {
        ignoreCellConflictRef.current = false
      })
    },
    [codePicker, onSetCode, onSetCodesBatch, days, mode, onSetFactHours, selectedCells, clearSelection],
  )

  const handlePickExtra = useCallback(
    (hours: number) => {
      if (!codePicker || !onSetFactExtra) return
      ignoreCellConflictRef.current = true
      onSetFactExtra(codePicker.rowId, codePicker.dateKey, hours)
      setCodePicker((prev) => (prev ? { ...prev, currentExtra: hours } : null))
    },
    [codePicker, onSetFactExtra],
  )

  const handlePickHoursOverride = useCallback(
    (hours: number | null) => {
      if (!codePicker || !onSetFactHours) return
      ignoreCellConflictRef.current = true
      onSetFactHours(codePicker.rowId, codePicker.dateKey, hours)
      setCodePicker((prev) => {
        if (!prev) return null
        let current = prev.current
        let currentOverride = hours
        if (hours != null && hours > 0 && !isWorkCode(current)) {
          current = workCodeForExactHours(hours)
          const norm = hoursForCode(current)
          currentOverride = hours === norm ? null : hours
        } else if (hours != null && isWorkCode(current)) {
          const norm = hoursForCode(current)
          currentOverride = hours === norm ? null : hours
        }
        return { ...prev, current, currentOverride, currentExtra: 0 }
      })
    },
    [codePicker, onSetFactHours],
  )

  const q = search.trim().toLowerCase()
  const effectiveSelected = useMemo(
    () => selectedBrigades ?? new Set(brigades),
    [brigades, selectedBrigades],
  )
  const brigadeFilterActive =
    !!brigadeSearch.trim() || effectiveSelected.size < brigades.length
  const unitFilterActive =
    selectedUnits && allUnitKeys.length > 0
      ? structuralUnitFilterActive(selectedUnits, allUnitKeys)
      : false
  const hasFilter = !!(q || brigadeFilterActive || unitFilterActive || filterSchedule)

  const brigadeShown = useCallback(
    (brigade: string) =>
      isBrigadeVisible(
        brigade,
        effectiveSelected,
        brigadeSearch,
        store.brigadeNamesKa,
      ),
    [brigadeSearch, effectiveSelected, store.brigadeNamesKa],
  )
  const canAssign = !readOnly && (assignEditable || metaEditable)
  const canEditCells = !readOnly

  const assignedInMonth = useMemo(() => monthAssignmentsByEmployee(sheet), [sheet])

  const employeesById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const emp of store.employees) map.set(emp.id, emp)
    return map
  }, [store.employees])

  const rowStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getRowHoursSnapshot>>()
    for (const row of sheet.rows) {
      const emp = row.employeeId ? employeesById.get(row.employeeId) : undefined
      if (!emp) continue
      const confirm = absenceConfirmForEmployee(store, row.employeeId!, sheet.month)
      map.set(row.id, getRowHoursSnapshot(sheet, row.id, emp, year, month, confirm))
    }
    return map
  }, [sheet, year, month, employeesById, store.finance])

  const focusNextEmptySlot = useCallback(
    (brigade: string, afterRowId: string) => {
      const rows = sheet.rows.filter((r) => r.brigade === brigade)
      const idx = rows.findIndex((r) => r.id === afterRowId)
      const nextEmpty = rows.slice(idx + 1).find((r) => !r.employeeId)
        ?? rows.find((r) => !r.employeeId)
      if (!nextEmpty) return
      window.setTimeout(() => {
        const el = tableRef.current?.querySelector(
          `[data-employee-row="${nextEmpty.id}"] input`,
        ) as HTMLInputElement | null
        el?.focus()
      }, 50)
    },
    [sheet.rows],
  )

  const rowHasMismatch = useCallback(
    (rowId: string) => {
      for (let d = 1; d <= days; d++) {
        const dk = dayDateKey(year, month, d)
        const plan = sheet.plan[rowId]?.[dk] ?? ''
        const fact = getFactMark(sheet, rowId, dk)
        if (plan !== fact) return true
      }
      return false
    },
    [sheet, days, year, month],
  )

  const rowVisible = useCallback(
    (rowId: string, brigade: string, employeeId: string | null) => {
      if (!brigadeShown(brigade)) return false
      const emp = employeeId ? employeesById.get(employeeId) ?? null : null
      if (unitFilterActive && selectedUnits && !isEmployeeUnitVisible(emp, selectedUnits)) {
        return false
      }
      if (filterSchedule && emp?.schedule !== filterSchedule) return false
      if (q) {
        if (!emp) return false
        if (!employeeSearchText(emp).includes(q)) return false
      }
      if (mismatchOnly && employeeId && !rowHasMismatch(rowId)) return false
      if (mismatchOnly && !employeeId) return false
      return true
    },
    [brigadeShown, employeesById, filterSchedule, q, selectedUnits, unitFilterActive, mismatchOnly, rowHasMismatch],
  )

  const layoutBlocks = useMemo(
    () =>
      buildTimesheetLayout(
        {
          store,
          sheet,
          brigades,
          groupMode,
          brigadeShown,
          rowVisible,
          searchActive: !!q,
          rowSort,
          employeesById,
          locale,
        },
        t,
      ),
    [store.employees, store.brigadeNamesKa, store.brigadeUnits, store.hrStructuralUnits, sheet, brigades, groupMode, brigadeShown, rowVisible, q, rowSort, employeesById, locale, t],
  )

  const flatItems = useMemo(
    () => flattenTimesheetLayout(layoutBlocks, { brigadeHeaderMode }),
    [layoutBlocks, brigadeHeaderMode],
  )

  const shouldVirtualize = flatItems.length >= 20

  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => tableRef.current,
    estimateSize: (index) => {
      const kind = flatItems[index]?.kind
      if (kind === 'data') return focusMode ? 44 : 40
      if (kind === 'unit') return 38
      return 44
    },
    overscan: 10,
  })

  const visibleRowCount = useMemo(
    () =>
      layoutBlocks.reduce(
        (n, b) => n + (b.kind === 'unit' ? 0 : b.rows.length),
        0,
      ),
    [layoutBlocks],
  )

  const navRows = useMemo(() => layoutNavRowIds(layoutBlocks), [layoutBlocks])

  const handleSortClick = useCallback(
    (key: MonthRowSortKey) => {
      if (!onRowSortChange) return
      onRowSortChange(toggleMonthRowSort(rowSort, key))
    },
    [onRowSortChange, rowSort],
  )

  const sortMark = useCallback(
    (key: MonthRowSortKey) => {
      if (rowSort.key !== key) return null
      return rowSort.dir === 'asc' ? ' ↑' : ' ↓'
    },
    [rowSort],
  )

  const sortableTh = useCallback(
    (
      key: MonthRowSortKey,
      label: string,
      className: string,
    ) => (
      <th className={className}>
        {onRowSortChange ? (
          <button
            type="button"
            className="th-sortable inline-flex w-full items-center gap-0.5 text-left font-semibold hover:text-accent"
            title={t('table.sortBy')}
            onClick={() => handleSortClick(key)}
          >
            <span>{label}</span>
            {sortMark(key) && (
              <span className="font-mono text-[10px] text-accent">{sortMark(key)}</span>
            )}
          </button>
        ) : (
          label
        )}
      </th>
    ),
    [handleSortClick, onRowSortChange, sortMark, t],
  )

  useEffect(() => {
    const root = tableRef.current
    if (!root) return

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter' && focus && !readOnly) {
        e.preventDefault()
        const dateKey = dayDateKey(year, month, focus.day)
        if (e.ctrlKey && onCommentRequest) {
          onCommentRequest(focus.rowId, dateKey)
        } else if (canEditCells) {
          const planCode = sheet.plan[focus.rowId]?.[dateKey] ?? ''
          const factCode = getFactMark(sheet, focus.rowId, dateKey)
          const current = (mode === 'plan' ? planCode : factCode) as DayCode
          const extra =
            mode === 'fact' ? getFactExtraHours(sheet, focus.rowId, dateKey) : 0
          const override =
            mode === 'fact' ? getFactHoursOverride(sheet, focus.rowId, dateKey) : null
          const btn = root.querySelector(
            `[data-cell="${focus.rowId}|${dateKey}"]`,
          ) as HTMLButtonElement | null
          const rect = btn?.getBoundingClientRect()
          openCodePicker(
            focus.rowId,
            dateKey,
            current,
            rect?.left ?? 0,
            (rect?.bottom ?? 0) + 4,
            extra,
            override,
          )
        }
        return
      }

      if (!focus || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        return
      }
      e.preventDefault()
      const rowIdx = navRows.indexOf(focus.rowId)
      if (rowIdx < 0) return

      let nextRow = rowIdx
      let nextDay = focus.day
      if (e.key === 'ArrowLeft') nextDay = Math.max(1, focus.day - 1)
      else if (e.key === 'ArrowRight') nextDay = Math.min(days, focus.day + 1)
      else if (e.key === 'ArrowUp') nextRow = Math.max(0, rowIdx - 1)
      else if (e.key === 'ArrowDown') nextRow = Math.min(navRows.length - 1, rowIdx + 1)

      setFocus({ rowId: navRows[nextRow], day: nextDay })
    }

    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [
    canEditCells,
    days,
    focus,
    mode,
    month,
    navRows,
    onCommentRequest,
    openCodePicker,
    readOnly,
    sheet,
    year,
  ])

  useEffect(() => {
    if (!focus) return
    const dk = dayDateKey(year, month, focus.day)
    const btn = tableRef.current?.querySelector(
      `[data-cell="${focus.rowId}|${dk}"]`,
    ) as HTMLButtonElement | null
    btn?.focus()
  }, [focus, month, year])

  if (hasFilter && visibleRowCount === 0) {
    return (
      <div
        className={`px-4 py-8 text-center text-sm text-stone-500 ${
          embedded ? '' : 'rounded-sm border border-grid bg-white/80 shadow-sm'
        }`}
      >
        {t('month.noFilterResults')}
      </div>
    )
  }

  const cellSize = focusMode || mode === 'fact' ? 'lg' : 'sm'
  const showGroupCol = mode === 'plan' && !!onChangeGroup2x2
  const leadingCols =
    2 +
    (display.showTab ? 1 : 0) +
    (display.showPosition ? 1 : 0) +
    (display.showUnit ? 1 : 0) +
    (display.showSchedule ? 1 : 0) +
    (showGroupCol ? 1 : 0)
  const trailingCols = display.showTotals ? 6 : 0
  const todayKey = isoDateLocal(new Date())
  const headSticky = 'pf-th'

  function employeeMetaTitle(emp: (typeof store.employees)[number] | null | undefined): string | undefined {
    if (!emp) return undefined
    const parts: string[] = []
    const pos = employeePositionLines(emp).primary
    if (pos && pos !== '—') parts.push(pos)
    if (emp.tabNumber?.trim()) parts.push(`№ ${emp.tabNumber.trim()}`)
    const unit = employeeStructuralUnitLabel(emp, store.hrStructuralUnits)
    if (unit) parts.push(unit)
    parts.push(scheduleDisplayLabel(emp))
    return parts.filter(Boolean).join(' · ') || undefined
  }

  return (
    <>
      {selectedCells.size > 0 ? (
        <div className="pf-selection-bar print:hidden">
          <span>{tf('month.selection.count', { count: selectedCells.size })}</span>
          <span className="text-stone-500">{t('month.selection.hint')}</span>
          <button type="button" className="bw-toolbar__btn" onClick={clearSelection}>
            {t('month.selection.clear')}
          </button>
        </div>
      ) : null}
      <div
        ref={tableRef}
        tabIndex={-1}
        data-pf-mode={mode}
        className={`pf-sheet pf-sheet--${mode} outline-none ${
          focusMode || embedded
            ? 'h-full min-h-0 flex-1 overflow-auto'
            : 'overflow-auto rounded-sm border border-grid shadow-sm'
        }`}
      >
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="pf-sheet__head sticky top-0 z-20">
          <tr>
            {sortableTh(
              'default',
              '№',
              `sticky left-0 z-30 min-w-[2rem] border-b border-r border-grid px-2 py-2 text-xs ${headSticky}`,
            )}
            {sortableTh(
              'name',
              t('table.colName'),
              `sticky left-[2rem] z-30 border-b border-r border-grid px-2 py-2 text-left text-xs font-semibold ${headSticky} ${
                focusMode ? 'min-w-[14rem]' : 'min-w-[10rem]'
              }`,
            )}
            {display.showTab &&
              sortableTh(
                'tab',
                t('table.colTab'),
                `border-b border-grid px-2 py-2 text-xs ${headSticky}`,
              )}
            {display.showPosition &&
              sortableTh(
                'position',
                t('table.colPosition'),
                `min-w-[8rem] border-b border-grid px-2 py-2 text-left text-xs ${headSticky}`,
              )}
            {display.showUnit && (
              <th className={`min-w-[9rem] border-b border-grid px-2 py-2 text-left text-xs ${headSticky}`}>
                {t('table.colUnit')}
              </th>
            )}
            {display.showSchedule &&
              sortableTh(
                'schedule',
                t('table.colSchedule'),
                `border-b border-grid px-2 py-2 text-xs ${headSticky}`,
              )}
            {showGroupCol && (
              <th className={`border-b border-grid px-1 py-2 text-center text-xs ${headSticky}`}>
                {t('table.colGroup')}
              </th>
            )}
            {dayNums.map((d) => {
              const dateKey = dayDateKey(year, month, d)
              const holiday = isGeorgiaPublicHoliday(dateKey)
              const holidayName = georgiaHolidayNameBilingual(dateKey)
              const dow = new Date(year, month - 1, d).getDay()
              const weekend = isWeekend(year, month, d)
              const weekStart = dow === 1
              const isToday = dateKey === todayKey
              return (
                <th
                  key={d}
                  title={holidayName ?? undefined}
                  className={`border-b border-grid px-0 py-1 text-center ${headSticky} ${
                    holiday
                      ? 'pf-th--holiday'
                      : weekend
                        ? 'pf-th--weekend'
                        : ''
                  } ${weekend && dow === 6 ? 'pf-th--weekend-start' : ''} ${weekStart ? 'pf-th--week' : ''} ${isToday ? 'pf-th--today' : ''}`}
                >
                  <div className="font-mono text-xs font-semibold">{d}</div>
                  <div
                    className={`text-[9px] ${
                      weekend && !holiday ? 'font-bold uppercase text-amber-800' : 'text-stone-400'
                    }`}
                  >
                    {weekdayShort(year, month, d, locale)}
                  </div>
                </th>
              )
            })}
            {display.showTotals && (
              <>
                <th
                  className={`border-b border-grid px-1.5 ${headSticky} ${
                    mode === 'plan'
                      ? 'text-xs font-bold text-sky-900'
                      : 'text-[10px] font-medium text-stone-500'
                  }`}
                  title={t('table.planHNormHint')}
                >
                  {t('table.planH')}
                </th>
                <th
                  className={`border-b border-grid px-1.5 ${headSticky} ${
                    mode === 'fact'
                      ? 'text-xs font-bold text-rose-900'
                      : 'text-[10px] font-medium text-stone-500'
                  }`}
                  title={t('table.factHWorkHint')}
                >
                  {t('table.factH')}
                </th>
                <th
                  className={`border-b border-grid px-1.5 text-[10px] ${headSticky}`}
                  title={t('table.deltaHint')}
                >
                  Δ
                </th>
                <th
                  className={`border-b border-grid px-1.5 text-[10px] ${headSticky}`}
                  title={t('table.prHint')}
                >
                  {t('table.pr')}
                </th>
                <th
                  className={`border-b border-grid px-1.5 text-[10px] ${headSticky}`}
                  title={t('table.nightHint')}
                >
                  {t('table.nightH')}
                </th>
                <th
                  className={`border-b border-grid px-1.5 text-[10px] ${headSticky}`}
                  title={t('table.otHint')}
                >
                  {t('table.otH')}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          <TimesheetFlatBody
            items={flatItems}
            colSpan={leadingCols + days + trailingCols}
            virtualizer={shouldVirtualize ? rowVirtualizer : undefined}
            renderItem={(item) => {
              if (item.kind === 'unit') {
                const block = item.block
                return (
                  <tr key={item.key} className="bg-sky-50/90">
                    <td
                      colSpan={leadingCols + days + trailingCols}
                      className="sticky left-0 border-b border-grid px-3 py-2.5 text-sm font-bold text-sky-950"
                    >
                      {block.unitLabel}
                    </td>
                  </tr>
                )
              }

              if (item.kind === 'brigade-header') {
                const block = item.block
                const brigade = block.brigade
                const rows = sheet.rows.filter((r) => r.brigade === brigade)
                const brigadeRowCount = block.brigadeRowCount
                const emptyRowCount = block.emptyRowCount
                const canRemoveEmpty = brigadeRowCount > 1 && emptyRowCount > 0

                if (brigadeHeaderMode === 'label') {
                  return (
                    <tr
                      key={item.key}
                      className={block.kind === 'unit-brigade' ? 'bg-stone-50/50' : 'bg-stone-50/80'}
                    >
                      <td
                        colSpan={leadingCols + days + trailingCols}
                        className={`sticky left-0 border-b border-grid py-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent/90 ${
                          block.kind === 'unit-brigade' ? 'px-3 pl-8' : 'px-3'
                        }`}
                      >
                        {brigadeLabel(brigade, store.brigadeNamesKa, locale)}
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={item.key}
                    className={block.kind === 'unit-brigade' ? 'bg-stone-50/70' : 'bg-stone-50'}
                  >
                    <td
                      colSpan={leadingCols + days + trailingCols}
                      className={`sticky left-0 border-b border-grid py-2 text-xs font-bold uppercase tracking-wide text-accent ${
                        block.kind === 'unit-brigade' ? 'px-3 pl-8' : 'px-3'
                      }`}
                    >
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{brigadeLabel(brigade, store.brigadeNamesKa, locale)}</span>
                      {(() => {
                        // Бригада без роли бригадира — ни выбора, ни подписи в табеле.
                        if (!brigadeAllowsBrigadier(store, brigade)) return null
                        const brigadierId = store.brigadiers?.[brigade] ?? ''
                        const brigadierEmp = brigadierId
                          ? store.employees.find((e) => e.id === brigadierId)
                          : undefined
                        if (canAssign && onSetBrigadier) {
                          const candidateIds = new Set<string>()
                          for (const r of rows) {
                            if (r.employeeId) candidateIds.add(r.employeeId)
                          }
                          for (const e of store.employees) {
                            if (employeeActiveInMonth(e, sheet.month) && e.brigade === brigade) {
                              candidateIds.add(e.id)
                            }
                          }
                          if (brigadierId) candidateIds.add(brigadierId)
                          const candidates = store.employees
                            .filter((e) => candidateIds.has(e.id))
                            .sort((a, b) =>
                              employeeName(a, locale).localeCompare(
                                employeeName(b, locale),
                                'ru',
                              ),
                            )
                          return (
                            <label className="flex items-center gap-1 text-[11px] font-medium normal-case tracking-normal text-stone-600">
                              {t('table.brigadier')}:
                              <select
                                value={brigadierId}
                                className="rounded-sm border border-grid bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink"
                                onChange={(e) =>
                                  onSetBrigadier(brigade, e.target.value || null)
                                }
                              >
                                <option value="">{t('table.brigadierNone')}</option>
                                {candidates.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {employeeName(e, locale)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )
                        }
                        if (!brigadierEmp) return null
                        return (
                          <span className="text-[11px] font-medium normal-case tracking-normal text-stone-600">
                            {t('table.brigadier')}:{' '}
                            <span className="text-ink">
                              {employeeName(brigadierEmp, locale)}
                            </span>
                          </span>
                        )
                      })()}
                      {canSignoff && onSetBrigadeSignoff ? (
                        <label
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal ${
                            isBrigadeTimesheetVerified(sheet, brigade, store)
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : 'border-amber-200 bg-amber-50 text-amber-950'
                          }`}
                          title={t('month.signoff.hint')}
                        >
                          <input
                            type="checkbox"
                            className="rounded-sm"
                            checked={isBrigadeTimesheetVerified(sheet, brigade, store)}
                            onChange={(e) => onSetBrigadeSignoff(brigade, e.target.checked)}
                          />
                          {t('month.signoff.label')}
                        </label>
                      ) : isBrigadeTimesheetVerified(sheet, brigade, store) ? (
                        <span className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-emerald-800">
                          ✓ {t('month.signoff.done')}
                        </span>
                      ) : null}
                      {canAssign && onFillBrigade && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm border border-accent/30 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case tracking-normal text-accent shadow-sm hover:bg-accent hover:text-white"
                          title={t('table.fillBrigadeHint')}
                          onClick={() => onFillBrigade(brigade)}
                        >
                          {t('table.fillBrigade')}
                        </button>
                      )}
                      {canAssign && onAddRow && (
                        <button
                          type="button"
                          className="btn-add-xs"
                          title={t('table.addSlotHint')}
                          onClick={() => onAddRow(brigade)}
                        >
                          + {t('table.addSlot')}
                        </button>
                      )}
                      {canAssign && onRemoveEmptyRow && canRemoveEmpty && (
                        <button
                          type="button"
                          className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-stone-600 hover:bg-stone-100"
                          title={t('table.removeEmptySlotHint')}
                          onClick={() => onRemoveEmptyRow(brigade)}
                        >
                          − {t('table.addSlot')}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
                )
              }

              const { block, row, rowIndex: idx } = item
              const brigade = block.brigade
              const brigadeRowCount = block.brigadeRowCount
              const emp = row.employeeId
                ? employeesById.get(row.employeeId) ?? null
                : null
              const rs = rowStatsMap.get(row.id)
              const confirm = row.employeeId
                ? absenceConfirmForEmployee(store, row.employeeId, sheet.month)
                : undefined
              const nextInBrigadeId = block.rows[idx + 1]?.id ?? null
              const draggedRow = draggingRowId
                ? sheet.rows.find((r) => r.id === draggingRowId)
                : undefined
              const dropInThisBrigade = draggedRow?.brigade === brigade
              const dropBeforeHere = dropInThisBrigade && dropBeforeId === row.id
              const dropAfterHere =
                dropInThisBrigade && dropBeforeId === null && nextInBrigadeId === null
              return (
                <tr
                  key={item.key}
                  className={`group hover:bg-paper/60${dropBeforeHere ? ' pf-row--drop-before' : ''}${
                    dropAfterHere ? ' pf-row--drop-after' : ''
                  }${draggingRowId === row.id ? ' opacity-60' : ''}`}
                  onDragOver={
                    canRowDrag
                      ? (e) => {
                          const dragId = draggingRowIdRef.current
                          if (!dragId || dragId === row.id) return
                          const dragged = sheet.rows.find((r) => r.id === dragId)
                          if (!dragged) return
                          if (dragged.brigade !== brigade) {
                            if (!canTransferDrop || !dragged.employeeId) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDropBeforeId(undefined)
                            return
                          }
                          if (!canReorder) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          const rect = e.currentTarget.getBoundingClientRect()
                          const before =
                            e.clientY < rect.top + rect.height / 2
                          setDropBeforeId(before ? row.id : nextInBrigadeId)
                        }
                      : undefined
                  }
                  onDrop={
                    canRowDrag
                      ? (e) => {
                          e.preventDefault()
                          const rowId =
                            e.dataTransfer.getData(KANBAN_DRAG_MIME) ||
                            e.dataTransfer.getData('text/plain') ||
                            draggingRowIdRef.current
                          if (!rowId) return
                          const dragged = sheet.rows.find((r) => r.id === rowId)
                          if (!dragged) return
                          endRowDrag()
                          if (dragged.brigade !== brigade) {
                            if (dragged.employeeId) onMoveToOtherBrigade?.(rowId, brigade)
                            return
                          }
                          if (!canReorder) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          const before =
                            e.clientY < rect.top + rect.height / 2
                          const beforeRowId = before ? row.id : nextInBrigadeId
                          if (rowId !== beforeRowId) {
                            onReorderRow?.(brigade, rowId, beforeRowId)
                            onRowSortChange?.(DEFAULT_MONTH_ROW_SORT)
                          }
                        }
                      : undefined
                  }
                >
                      <td
                        className={`sticky left-0 border-b border-r border-grid bg-white px-1 py-1 font-mono text-xs group-hover:bg-paper/60${
                          canReorder ? ' pf-td--ord' : ''
                        }`}
                        data-coach={canReorder && row.employeeId ? 'month:reorderRow' : undefined}
                        draggable={canReorder}
                        title={canReorder ? t('table.reorderHint') : undefined}
                        onDragStart={
                          canReorder
                            ? (e) => {
                                beginRowDrag(e, row.id)
                              }
                            : undefined
                        }
                        onDragEnd={canReorder ? endRowDrag : undefined}
                      >
                        <span className="flex items-center gap-0.5">
                          {canReorder ? (
                            <span className="pf-row-handle" aria-hidden>
                              ⠿
                            </span>
                          ) : null}
                          <span>{idx + 1}</span>
                          {canAssign && onRemoveRow && brigadeRowCount > 1 && (
                            <button
                              type="button"
                              className="rounded px-0.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                              title={t('table.removeSlot')}
                              draggable={false}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => onRemoveRow(row.id)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </td>
                      <td
                        className={`sticky left-[2rem] border-b border-r border-grid bg-white px-1 py-1 group-hover:bg-paper/60${
                          canReorder && !canAssign ? ' pf-td--ord' : ''
                        }`}
                        data-employee-row={row.id}
                        title={employeeMetaTitle(emp)}
                        draggable={canReorder && !canAssign && Boolean(row.employeeId)}
                        onDragStart={
                          canReorder && !canAssign && row.employeeId
                            ? (e) => beginRowDrag(e, row.id)
                            : undefined
                        }
                        onDragEnd={
                          canReorder && !canAssign ? endRowDrag : undefined
                        }
                      >
                        <div className="flex min-w-0 items-start gap-0.5">
                          {canAssign ? (
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <EmployeePicker
                              employees={store.employees}
                              value={row.employeeId}
                              brigade={brigade}
                              month={sheet.month}
                              assignedInMonth={assignedInMonth}
                              currentRowId={row.id}
                              compact
                              placeholder={t('table.freeSlot')}
                              onChange={(id) => {
                                onAssign(row.id, id)
                                if (id) focusNextEmptySlot(brigade, row.id)
                              }}
                              onConflictPick={onAssignConflict}
                              onAddNew={
                                onAddEmployee
                                  ? () => onAddEmployee(row.id, brigade)
                                  : undefined
                              }
                            />
                            {(() => {
                              const b = sheet.rowBounds?.[row.id]
                              if (b?.inactiveFrom) {
                                const d = Number(b.inactiveFrom.slice(8, 10))
                                return (
                                  <span className="px-1 text-[10px] font-medium text-amber-800">
                                    {tf('transfer.splitUntil', { day: String(d) })}
                                  </span>
                                )
                              }
                              if (b?.inactiveUntil) {
                                const d = Number(b.inactiveUntil.slice(8, 10)) + 1
                                return (
                                  <span className="px-1 text-[10px] font-medium text-sky-800">
                                    {tf('transfer.splitFrom', { day: String(d) })}
                                  </span>
                                )
                              }
                              return null
                            })()}
                          </div>
                        ) : (
                          <span className="block max-w-[12rem] px-1 text-sm font-medium">
                            {emp ? (
                              <>
                                <BilingualText lines={employeeNameLines(emp)} />
                                {(() => {
                                  const b = sheet.rowBounds?.[row.id]
                                  if (b?.inactiveFrom) {
                                    const d = Number(b.inactiveFrom.slice(8, 10))
                                    return (
                                      <span className="mt-0.5 block text-[10px] font-medium text-amber-800">
                                        {tf('transfer.splitUntil', { day: String(d) })}
                                      </span>
                                    )
                                  }
                                  if (b?.inactiveUntil) {
                                    const d = Number(b.inactiveUntil.slice(8, 10)) + 1
                                    return (
                                      <span className="mt-0.5 block text-[10px] font-medium text-sky-800">
                                        {tf('transfer.splitFrom', { day: String(d) })}
                                      </span>
                                    )
                                  }
                                  return null
                                })()}
                              </>
                            ) : (
                              '—'
                            )}
                          </span>
                        )}
                        </div>
                      </td>
                      {display.showTab && (
                        <td className="border-b border-grid px-2 font-mono text-xs text-stone-500">
                          {emp?.tabNumber ?? '—'}
                        </td>
                      )}
                      {display.showPosition && (
                        <td className="max-w-[10rem] border-b border-grid px-2 text-xs text-stone-600">
                          {emp ? (
                            <BilingualText lines={employeePositionLines(emp)} />
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {display.showUnit && (
                        <td className="max-w-[11rem] border-b border-grid px-2 text-xs text-stone-600">
                          {emp ? (
                            (() => {
                              const label = employeeStructuralUnitLabel(
                                emp,
                                store.hrStructuralUnits,
                              )
                              return label ? (
                                <span className="line-clamp-2" title={label}>
                                  {label}
                                </span>
                              ) : (
                                <span className="text-stone-400">{t('month.unitUnassigned')}</span>
                              )
                            })()
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {display.showSchedule && (
                        <td className="border-b border-grid px-2 text-xs whitespace-nowrap">
                          {emp ? (
                            canAssign || canEditCells ? (
                              <button
                                type="button"
                                className="text-accent hover:underline"
                                title={t('table.regenerateTitle')}
                                onClick={() => onRegenerateRow(row.id)}
                              >
                                {scheduleDisplayLabel(emp)}
                              </button>
                            ) : (
                              <span>{scheduleDisplayLabel(emp)}</span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {showGroupCol && (
                        <td className="border-b border-grid px-1 py-1 text-center">
                          {emp && usesGroup2x2(emp.schedule) ? (
                            canEditCells ? (
                              <div
                                className="inline-flex rounded-sm border border-grid bg-stone-50 p-0.5"
                                title={t('table.group2x2Hint')}
                              >
                                {(['А', 'Б'] as const).map((g) => {
                                  const active = (emp.group2x2 || 'А') === g
                                  return (
                                    <button
                                      key={g}
                                      type="button"
                                      className={`min-w-[1.75rem] rounded px-1.5 py-0.5 font-mono text-xs font-bold ${
                                        active
                                          ? 'bg-accent text-white shadow-sm'
                                          : 'text-stone-600 hover:bg-white'
                                      }`}
                                      onClick={() => {
                                        if (active) return
                                        onChangeGroup2x2(row.id, emp.id, g)
                                      }}
                                    >
                                      {g}
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <span
                                className="font-mono text-xs font-semibold text-stone-500"
                                title={t('month.editToChange')}
                              >
                                {emp.group2x2 || 'А'}
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-stone-300">—</span>
                          )}
                        </td>
                      )}
                      {dayNums.map((d) => {
                        const dateKey = dayDateKey(year, month, d)
                        const dow = new Date(year, month - 1, d).getDay()
                        const planCode = sheet.plan[row.id]?.[dateKey] ?? ''
                        const factCode = getFactMark(sheet, row.id, dateKey)
                        const code = mode === 'plan' ? planCode : factCode
                        const extraHours =
                          mode === 'fact' ? getFactExtraHours(sheet, row.id, dateKey) : 0
                        const overrideHours =
                          mode === 'fact' ? getFactHoursOverride(sheet, row.id, dateKey) : null
                        const mismatch = planCode !== factCode && !!emp
                        const comment = getCellComment(sheet, row.id, dateKey)
                        const substitution =
                          mode === 'fact'
                            ? getSubstitution(sheet, row.id, dateKey)
                            : undefined
                        const subLabel = substitution
                          ? substitutionLabel(sheet, store.employees, row.id, dateKey)
                          : undefined
                        const rowBounds = sheet.rowBounds?.[row.id]
                        const periodOff = emp
                          ? rowPeriodOffReason(emp, dateKey, rowBounds)
                          : null
                        const isBrigadier =
                          brigadeAllowsBrigadier(store, row.brigade) &&
                          !!sheet.brigadierDays?.[`${row.id}|${dateKey}`]
                        const titleParts = [
                          subLabel,
                          comment,
                          periodOff === 'inactiveFrom'
                            ? t('month.rowPeriod.hintInactiveFrom')
                            : periodOff === 'inactiveUntil'
                              ? t('month.rowPeriod.hintInactiveUntil')
                              : '',
                          extraHours > 0 ? `+${extraHours} ${t('common.hoursShort')}` : '',
                          overrideHours != null
                            ? (() => {
                                const planNorm = hoursForCode(planCode)
                                if (planNorm <= 0) {
                                  return tf('table.overrideOtHint', { n: overrideHours })
                                }
                                const d = overrideHours - planNorm
                                if (d < 0) return tf('table.overrideShortHint', { n: Math.abs(d), got: overrideHours, plan: planNorm })
                                if (d > 0) return tf('table.overrideOtHint', { n: d })
                                return `${overrideHours} ${t('common.hoursShort')}`
                              })()
                            : '',
                          mismatch
                            ? `${t('month.plan')} «${planCode || '·'}» → ${t('month.fact')} «${factCode || '·'}»`
                            : `${dateKey} ${mode}`,
                        ].filter(Boolean)
                        const payRisk: 'idle' | 'pending' | null =
                          mode === 'fact' && factCode === 'ПР'
                            ? 'idle'
                            : mode === 'fact' &&
                                factCode === 'Б' &&
                                confirm?.sickConfirmed !== true
                              ? 'pending'
                              : mode === 'fact' &&
                                  factCode === 'ОТ' &&
                                  confirm?.vacationConfirmed !== true
                                ? 'pending'
                                : null
                        if (payRisk === 'idle') titleParts.push(t('table.prHint'))
                        if (payRisk === 'pending') titleParts.push(t('table.pendingAbsenceHint'))
                        return (
                          <td
                            key={d}
                            className={`border-b border-grid p-0 ${
                              dow === 1 ? 'pf-td--week' : ''
                            } ${
                              isWeekend(year, month, d)
                                ? `pf-td--weekend${dow === 6 ? ' pf-td--weekend-start' : ''}`
                                : ''
                            } ${dateKey === todayKey ? 'pf-td--today' : ''}`}
                          >
                            <DayCell
                              code={code}
                              layer={mode}
                              planCode={planCode}
                              otherCode={
                                mismatch
                                  ? mode === 'fact'
                                    ? planCode
                                    : factCode
                                  : undefined
                              }
                              extraHours={extraHours}
                              overrideHours={overrideHours}
                              size={cellSize}
                              mismatch={mismatch}
                              selected={selectedCells.has(`${row.id}|${dateKey}`)}
                              hasComment={!!comment}
                              hasSubstitution={!!substitution}
                              isBrigadier={isBrigadier}
                              periodOff={!!periodOff}
                              payRisk={payRisk}
                              dataCell={`${row.id}|${dateKey}`}
                              remoteFlash={remoteFlashCell === `${row.id}|${dateKey}`}
                              onMouseDown={(e) => {
                                if (!emp || !canEditCells || e.button !== 0) return
                                if (e.ctrlKey || e.metaKey) {
                                  e.preventDefault()
                                  dragSelectRef.current = true
                                  selectionAnchorRef.current = { rowId: row.id, day: d }
                                  const key = `${row.id}|${dateKey}`
                                  setSelectedCells((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(key)) next.delete(key)
                                    else next.add(key)
                                    return next
                                  })
                                }
                              }}
                              onMouseEnter={() => {
                                if (!dragSelectRef.current || !canEditCells) return
                                const anchor = selectionAnchorRef.current
                                if (!anchor || anchor.rowId !== row.id) return
                                const from = Math.min(anchor.day, d)
                                const to = Math.max(anchor.day, d)
                                const next = new Set<string>()
                                for (let day = from; day <= to; day++) {
                                  next.add(`${row.id}|${dayDateKey(year, month, day)}`)
                                }
                                setSelectedCells(next)
                              }}
                              onClick={(e) => {
                                if (emp && canEditCells) {
                                  setFocus({ rowId: row.id, day: d })
                                  if (e.ctrlKey || e.metaKey) {
                                    e.preventDefault()
                                    return
                                  }
                                  if (e.shiftKey && !e.altKey) {
                                    onCycle(row.id, dateKey)
                                    return
                                  }
                                  const key = `${row.id}|${dateKey}`
                                  if (selectedCells.size > 0 && !selectedCells.has(key)) {
                                    clearSelection()
                                  }
                                  openCodePicker(
                                    row.id,
                                    dateKey,
                                    code,
                                    e.clientX,
                                    e.clientY + 4,
                                    extraHours,
                                    overrideHours,
                                  )
                                }
                              }}
                              onContextMenu={(e) => {
                                if (!emp || !canEditCells) return
                                if (
                                  !onCommentRequest &&
                                  !onSubstitutionRequest &&
                                  !onMarkBrigadier &&
                                  !onRowInactiveFrom
                                )
                                  return
                                e.preventDefault()
                                setCodePicker(null)
                                setFocus({ rowId: row.id, day: d })
                                contextSnapshotRef.current = readMonthCellSnapshot(
                                  sheet,
                                  row.id,
                                  dateKey,
                                  mode,
                                )
                                setContextMenu({
                                  rowId: row.id,
                                  dateKey,
                                  x: e.clientX,
                                  y: e.clientY,
                                })
                              }}
                              title={titleParts.join(' · ')}
                              readOnly={!canEditCells}
                            />
                          </td>
                        )
                      })}
                      {display.showTotals && (
                        <>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono ${
                              mode === 'plan'
                                ? 'text-sm font-bold text-sky-900'
                                : 'text-[11px] text-stone-500'
                            }`}
                            title={t('table.planHNormHint')}
                          >
                            {emp && rs ? rs.planHours : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono ${
                              mode === 'fact'
                                ? 'text-sm font-bold text-rose-900'
                                : 'text-[11px] text-stone-500'
                            }`}
                            title={t('table.factHWorkHint')}
                          >
                            {emp && rs ? rs.factHours : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono text-[11px] ${
                              emp && rs && rs.workHoursDelta !== 0
                                ? 'font-semibold text-amber-700'
                                : ''
                            }`}
                            title={t('table.deltaHint')}
                          >
                            {emp && rs
                              ? `${rs.workHoursDelta > 0 ? '+' : ''}${rs.workHoursDelta}`
                              : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono text-[11px] ${
                              emp && rs && rs.pr > 0 ? 'font-semibold text-orange-700' : 'text-stone-400'
                            }`}
                            title={t('table.prHint')}
                          >
                            {emp && rs ? rs.pr : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono text-[11px] ${
                              emp && rs && rs.nightHours > 0 ? 'text-violet-700' : 'text-stone-400'
                            }`}
                          >
                            {emp && rs ? rs.nightHours : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-1.5 text-center font-mono text-[11px] ${
                              emp && rs && rs.monthDeltaOtHours > 0
                                ? 'font-semibold text-amber-800'
                                : 'text-stone-400'
                            }`}
                          >
                            {emp && rs && rs.monthDeltaOtHours > 0
                              ? `+${rs.monthDeltaOtHours}`
                              : emp && rs
                                ? '0'
                                : '—'}
                          </td>
                        </>
                      )}
                    </tr>
              )
            }}
          />
        </tbody>
      </table>
      {!embedded && (
        <p className="pf-sheet__footer border-t border-grid px-3 py-2 text-xs text-stone-500">
          {formatMonthTitle(sheet.month, locale)} ·{' '}
          <strong className={mode === 'plan' ? 'text-sky-800' : 'text-teal-800'}>
            {mode === 'plan' ? t('table.planUpper') : t('table.factUpper')}
          </strong>
          {' · '}
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-400 align-middle" />{' '}
          {t('table.mismatch')}
          {mode === 'fact' && (
            <>
              {' · '}
              <span className="inline-block rounded bg-violet-600 px-0.5 text-[8px] font-bold text-white align-middle">
                З
              </span>{' '}
              {t('substitution.legend')}
              {' · '}
              <span className="inline-block rounded bg-amber-500 px-0.5 text-[8px] font-bold text-white align-middle">
                +N
              </span>{' '}
              {t('cellPicker.extraLegend')}
              {' · '}
              <span className="inline-block rounded bg-stone-500 px-0.5 text-[8px] font-bold text-white align-middle">
                −N
              </span>{' '}
              {t('cellPicker.hoursShortLegend')}
            </>
          )}
        </p>
      )}
      {codePicker &&
        (() => {
          const pickerRow = sheet.rows.find((r) => r.id === codePicker.rowId)
          const pickerEmp = pickerRow?.employeeId
            ? store.employees.find((e) => e.id === pickerRow.employeeId)
            : undefined
          const canCycle =
            mode === 'plan' &&
            !!onSetCycleFromDay &&
            !!pickerEmp &&
            isCyclicSchedule(pickerEmp.schedule)
          const pickerDay = Number(codePicker.dateKey.slice(8))
          return (
            <CellCodePicker
              x={codePicker.x}
              y={codePicker.y}
              dateLabel={selectedCells.size > 1 ? tf('month.selection.fillLabel', { count: selectedCells.size }) : codePicker.dateKey}
              mode={mode}
              current={codePicker.current}
              currentExtra={codePicker.currentExtra}
              currentOverrideHours={codePicker.currentOverride}
              planCode={
                mode === 'fact'
                  ? ((sheet.plan[codePicker.rowId]?.[codePicker.dateKey] ?? '') as DayCode)
                  : undefined
              }
              onPick={handlePickCode}
              onPickExtra={
                mode === 'fact' && onSetFactExtra ? handlePickExtra : undefined
              }
              onPickHoursOverride={
                mode === 'fact' && onSetFactHours ? handlePickHoursOverride : undefined
              }
              cycleSchedule={canCycle ? pickerEmp!.schedule : undefined}
              onPickCycle={
                canCycle
                  ? (variant) => {
                      ignoreCellConflictRef.current = true
                      onSetCycleFromDay!(
                        codePicker.rowId,
                        pickerEmp!.id,
                        pickerDay,
                        variant,
                      )
                      setCodePicker(null)
                    }
                  : undefined
              }
              onClose={() => setCodePicker(null)}
            />
          )
        })()}
      {contextMenu && (
        <CellContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          showSubstitution={mode === 'fact' && !!onSubstitutionRequest}
          showBrigadier={
            !!onMarkBrigadier &&
            brigadeAllowsBrigadier(
              store,
              sheet.rows.find((r) => r.id === contextMenu.rowId)?.brigade ?? '',
            )
          }
          isBrigadier={!!sheet.brigadierDays?.[`${contextMenu.rowId}|${contextMenu.dateKey}`]}
          onComment={() => onCommentRequest?.(contextMenu.rowId, contextMenu.dateKey)}
          onSubstitution={() =>
            onSubstitutionRequest?.(contextMenu.rowId, contextMenu.dateKey)
          }
          onToggleBrigadier={
            onMarkBrigadier
              ? () =>
                  onMarkBrigadier(
                    contextMenu.rowId,
                    contextMenu.dateKey,
                    !sheet.brigadierDays?.[`${contextMenu.rowId}|${contextMenu.dateKey}`],
                  )
              : undefined
          }
          onBrigadierMonth={
            onMarkBrigadierMonth
              ? () =>
                  onMarkBrigadierMonth(
                    contextMenu.rowId,
                    !sheet.brigadierDays?.[`${contextMenu.rowId}|${contextMenu.dateKey}`],
                  )
              : undefined
          }
          showPeriod={!!onRowInactiveFrom}
          periodDay={Number.parseInt(contextMenu.dateKey.slice(8), 10) || undefined}
          hasPeriodMark={hasRowPeriodBounds(sheet.rowBounds?.[contextMenu.rowId])}
          onInactiveFrom={
            onRowInactiveFrom
              ? () => onRowInactiveFrom(contextMenu.rowId, contextMenu.dateKey)
              : undefined
          }
          onActiveFrom={
            onRowActiveFrom
              ? () => onRowActiveFrom(contextMenu.rowId, contextMenu.dateKey)
              : undefined
          }
          onClearPeriod={
            onClearRowPeriod ? () => onClearRowPeriod(contextMenu.rowId) : undefined
          }
          onClose={() => {
            setContextMenu(null)
            contextSnapshotRef.current = null
          }}
        />
      )}
      </div>
    </>
  )
}
