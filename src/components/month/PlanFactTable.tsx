import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { employeeName, employeeSearchText } from '@/i18n'
import { brigadeLabel } from '@/lib/brigadeText'
import { getBrigades } from '@/lib/brigades'
import { getCellComment } from '@/lib/bulkOps'
import { getSubstitution, substitutionLabel } from '@/lib/substitutions'
import {
  dayDateKey,
  daysInMonth,
  formatMonthTitle,
  isWeekend,
  parseMonthKey,
  weekdayShort,
} from '@/lib/dates'
import {
  georgiaHolidayNameBilingual,
  isGeorgiaPublicHoliday,
} from '@/lib/georgiaCalendar'
import { getFactExtraHours } from '@/lib/factExtra'
import { getFactMark, rowStats } from '@/lib/stats'
import { isCyclicSchedule, usesGroup2x2 } from '@/lib/schedules'
import {
  DEFAULT_MONTH_VIEW_DISPLAY,
  isBrigadeVisible,
  isEmployeeUnitVisible,
  structuralUnitFilterActive,
  type MonthGroupMode,
  type MonthTableDisplay,
} from '@/lib/monthViewOptions'
import { buildTimesheetLayout, layoutNavRowIds } from '@/lib/monthTimesheetLayout'
import { employeeStructuralUnitLabel } from '@/lib/hr/orgStructure'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import { CellCodePicker } from './CellCodePicker'
import { CellContextMenu } from './CellContextMenu'
import { DayCell } from './DayCell'

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
  search?: string
  selectedBrigades?: Set<string>
  brigadeSearch?: string
  selectedUnits?: Set<string>
  allUnitKeys?: string[]
  filterSchedule?: string
  groupMode?: MonthGroupMode
  display?: MonthTableDisplay
  readOnly?: boolean
  onCycle: (rowId: string, dateKey: string) => void
  onSetCode: (rowId: string, dateKey: string, code: DayCode) => void
  onSetFactExtra?: (rowId: string, dateKey: string, hours: number) => void
  onAssign: (rowId: string, employeeId: string | null) => void
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
  search = '',
  selectedBrigades,
  brigadeSearch = '',
  selectedUnits,
  allUnitKeys = [],
  filterSchedule = '',
  groupMode = 'brigade',
  display = DEFAULT_MONTH_VIEW_DISPLAY,
  readOnly = false,
  onCycle,
  onSetCode,
  onSetFactExtra,
  onAssign,
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
}: Props) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
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
  } | null>(null)

  const openCodePicker = useCallback(
    (
      rowId: string,
      dateKey: string,
      current: DayCode,
      x: number,
      y: number,
      currentExtra = 0,
    ) => {
      setContextMenu(null)
      setCodePicker({ rowId, dateKey, x, y, current, currentExtra })
    },
    [],
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
  const canAssign = assignEditable || (metaEditable && !readOnly)
  const canEditCells = metaEditable && !readOnly

  const assignedInMonth = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of sheet.rows) {
      if (row.employeeId) map.set(row.employeeId, row.id)
    }
    return map
  }, [sheet.rows])

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

  const rowVisible = useCallback(
    (_rowId: string, brigade: string, employeeId: string | null) => {
      if (!brigadeShown(brigade)) return false
      const emp = employeeId ? store.employees.find((e) => e.id === employeeId) : null
      if (unitFilterActive && selectedUnits && !isEmployeeUnitVisible(emp, selectedUnits)) {
        return false
      }
      if (filterSchedule && emp?.schedule !== filterSchedule) return false
      if (q) {
        if (!emp) return false
        return employeeSearchText(emp).includes(q)
      }
      return true
    },
    [brigadeShown, filterSchedule, q, selectedUnits, store.employees, unitFilterActive],
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
        },
        t,
      ),
    [store, sheet, brigades, groupMode, brigadeShown, rowVisible, q, t],
  )

  const visibleRowCount = useMemo(
    () =>
      layoutBlocks.reduce(
        (n, b) => n + (b.kind === 'unit' ? 0 : b.rows.length),
        0,
      ),
    [layoutBlocks],
  )

  const navRows = useMemo(() => layoutNavRowIds(layoutBlocks), [layoutBlocks])

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

  const cellSize = focusMode ? 'lg' : 'sm'
  const showGroupCol = mode === 'plan' && !!onChangeGroup2x2
  const leadingCols =
    2 +
    (display.showTab ? 1 : 0) +
    (display.showPosition ? 1 : 0) +
    (display.showUnit ? 1 : 0) +
    (display.showSchedule ? 1 : 0) +
    (showGroupCol ? 1 : 0)
  const trailingCols = display.showTotals ? 3 : 0

  return (
    <div
      ref={tableRef}
      tabIndex={-1}
      className={`bg-white/80 outline-none ${
        focusMode
          ? 'h-full min-h-0 flex-1 overflow-auto'
          : `overflow-auto ${embedded ? '' : 'rounded-sm border border-grid shadow-sm'}`
      }`}
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-[#faf8f4]">
          <tr>
            <th className="sticky left-0 z-30 min-w-[2rem] border-b border-r border-grid bg-[#faf8f4] px-2 py-2 text-xs">
              №
            </th>
            <th
              className={`sticky left-[2rem] z-30 border-b border-r border-grid bg-[#faf8f4] px-2 py-2 text-left text-xs font-semibold ${
                focusMode ? 'min-w-[14rem]' : 'min-w-[10rem]'
              }`}
            >
              {t('table.colName')}
            </th>
            {display.showTab && (
              <th className="border-b border-grid px-2 py-2 text-xs">{t('table.colTab')}</th>
            )}
            {display.showPosition && (
              <th className="min-w-[8rem] border-b border-grid px-2 py-2 text-left text-xs">
                {t('table.colPosition')}
              </th>
            )}
            {display.showUnit && (
              <th className="min-w-[9rem] border-b border-grid px-2 py-2 text-left text-xs">
                {t('table.colUnit')}
              </th>
            )}
            {display.showSchedule && (
              <th className="border-b border-grid px-2 py-2 text-xs">{t('table.colSchedule')}</th>
            )}
            {showGroupCol && (
              <th className="border-b border-grid px-1 py-2 text-center text-xs">
                {t('table.colGroup')}
              </th>
            )}
            {dayNums.map((d) => {
              const dateKey = dayDateKey(year, month, d)
              const holiday = isGeorgiaPublicHoliday(dateKey)
              const holidayName = georgiaHolidayNameBilingual(dateKey)
              return (
                <th
                  key={d}
                  title={holidayName ?? undefined}
                  className={`border-b border-grid px-0 py-1 text-center ${
                    holiday
                      ? 'bg-violet-100 text-violet-800'
                      : isWeekend(year, month, d)
                        ? 'bg-accent-soft/30 text-accent'
                        : ''
                  }`}
                >
                  <div className="font-mono text-xs font-semibold">{d}</div>
                  <div className="text-[9px] text-stone-400">
                    {weekdayShort(year, month, d, locale)}
                  </div>
                </th>
              )
            })}
            {display.showTotals && (
              <>
                <th className="border-b border-grid px-2 text-xs">{t('table.planH')}</th>
                <th className="border-b border-grid px-2 text-xs">{t('table.factH')}</th>
                <th className="border-b border-grid px-2 text-xs">Δ</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {layoutBlocks.map((block) => {
            if (block.kind === 'unit') {
              return (
                <tr key={`unit-${block.unitId}`} className="bg-sky-50/90">
                  <td
                    colSpan={leadingCols + days + trailingCols}
                    className="sticky left-0 border-b border-grid px-3 py-2.5 text-sm font-bold text-sky-950"
                  >
                    {block.unitLabel}
                  </td>
                </tr>
              )
            }

            const brigade = block.brigade
            const rows = sheet.rows.filter((r) => r.brigade === brigade)
            const visibleRows = block.rows
            const brigadeRowCount = block.brigadeRowCount
            const emptyRowCount = block.emptyRowCount
            const canRemoveEmpty = brigadeRowCount > 1 && emptyRowCount > 0
            const headerKey = `${block.kind}-${block.unitId ?? 'x'}-${brigade}`

            return (
              <Fragment key={headerKey}>
                <tr className={block.kind === 'unit-brigade' ? 'bg-stone-50/70' : 'bg-stone-50'}>
                  <td
                    colSpan={leadingCols + days + trailingCols}
                    className={`sticky left-0 border-b border-grid py-2 text-xs font-bold uppercase tracking-wide text-accent ${
                      block.kind === 'unit-brigade' ? 'px-3 pl-8' : 'px-3'
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{brigadeLabel(brigade, store.brigadeNamesKa, locale)}</span>
                      {(() => {
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
                            if (e.active && e.brigade === brigade) candidateIds.add(e.id)
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
                {visibleRows.map((row, idx) => {
                  const emp = row.employeeId
                    ? store.employees.find((e) => e.id === row.employeeId)
                    : null
                  const rs = rowStats(sheet, row.id, days, year, month)
                  return (
                    <tr key={row.id} className="group hover:bg-paper/60">
                      <td className="sticky left-0 border-b border-r border-grid bg-white px-1 py-1 font-mono text-xs group-hover:bg-paper/60">
                        <span className="flex items-center gap-1">
                          <span>{idx + 1}</span>
                          {canAssign && onRemoveRow && brigadeRowCount > 1 && (
                            <button
                              type="button"
                              className="rounded px-0.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                              title={t('table.removeSlot')}
                              onClick={() => onRemoveRow(row.id)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </td>
                      <td
                        className="sticky left-[2rem] border-b border-r border-grid bg-white px-1 py-1 group-hover:bg-paper/60"
                        data-employee-row={row.id}
                      >
                        {canAssign ? (
                          <EmployeePicker
                            employees={store.employees}
                            value={row.employeeId}
                            brigade={brigade}
                            assignedInMonth={assignedInMonth}
                            currentRowId={row.id}
                            compact
                            elevated={focusMode}
                            placeholder={t('table.freeSlot')}
                            onChange={(id) => {
                              onAssign(row.id, id)
                              if (id) focusNextEmptySlot(brigade, row.id)
                            }}
                            onAddNew={
                              onAddEmployee
                                ? () => onAddEmployee(row.id, brigade)
                                : undefined
                            }
                          />
                        ) : (
                          <span className="block max-w-[12rem] truncate px-1 text-sm font-medium">
                            {emp ? (
                              <BilingualText lines={employeeNameLines(emp)} />
                            ) : (
                              '—'
                            )}
                          </span>
                        )}
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
                                {emp.schedule}
                              </button>
                            ) : (
                              <span>{emp.schedule}</span>
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
                        const planCode = sheet.plan[row.id]?.[dateKey] ?? ''
                        const factCode = getFactMark(sheet, row.id, dateKey)
                        const code = mode === 'plan' ? planCode : factCode
                        const extraHours =
                          mode === 'fact' ? getFactExtraHours(sheet, row.id, dateKey) : 0
                        const mismatch = planCode !== factCode && !!emp
                        const comment = getCellComment(sheet, row.id, dateKey)
                        const substitution =
                          mode === 'fact'
                            ? getSubstitution(sheet, row.id, dateKey)
                            : undefined
                        const subLabel = substitution
                          ? substitutionLabel(sheet, store.employees, row.id, dateKey)
                          : undefined
                        const titleParts = [
                          subLabel,
                          comment,
                          extraHours > 0 ? `+${extraHours} ${t('common.hoursShort')}` : '',
                          mismatch
                            ? `${t('month.plan')} «${planCode || '·'}» → ${t('month.fact')} «${factCode || '·'}»`
                            : `${dateKey} ${mode}`,
                        ].filter(Boolean)
                        return (
                          <td key={d} className="border-b border-grid p-0">
                            <DayCell
                              code={code}
                              extraHours={extraHours}
                              size={cellSize}
                              mismatch={mismatch}
                              dimmed={mode === 'plan' && mismatch}
                              hasComment={!!comment}
                              hasSubstitution={!!substitution}
                              dataCell={`${row.id}|${dateKey}`}
                              onClick={(e) => {
                                if (emp && canEditCells) {
                                  setFocus({ rowId: row.id, day: d })
                                  if (e.shiftKey) {
                                    onCycle(row.id, dateKey)
                                    return
                                  }
                                  openCodePicker(
                                    row.id,
                                    dateKey,
                                    code,
                                    e.clientX,
                                    e.clientY + 4,
                                    extraHours,
                                  )
                                }
                              }}
                              onContextMenu={(e) => {
                                if (!emp || !canEditCells) return
                                if (!onCommentRequest && !onSubstitutionRequest) return
                                e.preventDefault()
                                setCodePicker(null)
                                setFocus({ rowId: row.id, day: d })
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
                          <td className="border-b border-grid px-2 text-center font-mono text-xs">
                            {emp ? rs.planHours : '—'}
                          </td>
                          <td className="border-b border-grid px-2 text-center font-mono text-xs">
                            {emp ? rs.factHours : '—'}
                          </td>
                          <td
                            className={`border-b border-grid px-2 text-center font-mono text-xs ${
                              rs.mismatches ? 'font-semibold text-amber-700' : ''
                            }`}
                          >
                            {emp ? rs.mismatches : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {!embedded && (
        <p className="border-t border-grid px-3 py-2 text-xs text-stone-400">
          {formatMonthTitle(sheet.month, locale)} ·{' '}
          <strong>{mode === 'plan' ? t('table.planUpper') : t('table.factUpper')}</strong>
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
              dateLabel={codePicker.dateKey}
              mode={mode}
              current={codePicker.current}
              currentExtra={codePicker.currentExtra}
              onPick={(code) => onSetCode(codePicker.rowId, codePicker.dateKey, code)}
              onPickExtra={
                mode === 'fact' && onSetFactExtra
                  ? (hours) =>
                      onSetFactExtra(codePicker.rowId, codePicker.dateKey, hours)
                  : undefined
              }
              cycleSchedule={canCycle ? pickerEmp!.schedule : undefined}
              onPickCycle={
                canCycle
                  ? (variant) =>
                      onSetCycleFromDay!(
                        codePicker.rowId,
                        pickerEmp!.id,
                        pickerDay,
                        variant,
                      )
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
          onComment={() => onCommentRequest?.(contextMenu.rowId, contextMenu.dateKey)}
          onSubstitution={() =>
            onSubstitutionRequest?.(contextMenu.rowId, contextMenu.dateKey)
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
