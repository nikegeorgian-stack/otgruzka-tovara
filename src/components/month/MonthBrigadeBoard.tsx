import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { KanbanCardShell } from '@/components/kanban'
import { KANBAN_DRAG_MIME } from '@/components/kanban/useKanbanDrag'
import { useI18n } from '@/context/I18nContext'
import { employeeName, employeePosition } from '@/i18n'
import { brigadeMismatchCount } from '@/lib/brigadeStats'
import { brigadeLabel } from '@/lib/brigadeText'
import type { AppStore, MonthSheet } from '@/lib/types'

type Props = {
  store: AppStore
  sheet: MonthSheet
  /** Все доступные бригады (не только выбранный таб) — чтобы Пропитки и др. были видны. */
  brigades: string[]
  search: string
  readOnly: boolean
  sheetMode: 'plan' | 'fact'
  onReorderRow: (brigade: string, rowId: string, beforeRowId: string | null) => void
  onMoveToBrigade: (rowId: string, toBrigade: string) => void
  onOpenTransfer: (employeeId: string, toBrigade?: string) => void
  onFillBrigade?: (brigade: string) => void
  /** Табель дней для раскрытой бригады (те же plan/fact данные). */
  renderTimesheet?: (brigade: string) => ReactNode
  /** Сообщить родителю, какая бригада открыта (для контекстных действий). */
  onExpandedChange?: (brigade: string | null) => void
}

function rowMatchesSearch(
  store: AppStore,
  row: MonthSheet['rows'][number],
  q: string,
  locale: import('@/i18n/types').Locale,
): boolean {
  if (!q.trim()) return true
  if (!row.employeeId) return false
  const emp = store.employees.find((e) => e.id === row.employeeId)
  if (!emp) return false
  const needle = q.trim().toLowerCase()
  return (
    employeeName(emp, locale).toLowerCase().includes(needle) ||
    emp.tabNumber.toLowerCase().includes(needle)
  )
}

export function MonthBrigadeBoard({
  store,
  sheet,
  brigades,
  search,
  readOnly,
  sheetMode,
  onReorderRow,
  onMoveToBrigade,
  onOpenTransfer,
  onFillBrigade,
  renderTimesheet,
  onExpandedChange,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    brigade: string
    beforeRowId: string | null
  } | null>(null)

  const clearDrag = useCallback(() => {
    setDraggingId(null)
    setDropTarget(null)
  }, [])

  const setExpandedBrigade = useCallback(
    (brigade: string | null) => {
      setExpanded(brigade)
      onExpandedChange?.(brigade)
    },
    [onExpandedChange],
  )

  const blocks = useMemo(() => {
    return brigades
      .map((brigade) => {
        const rows = sheet.rows
          .filter((r) => r.brigade === brigade)
          .sort((a, b) => a.sortOrder - b.sortOrder)
        const visibleRows = rows.filter((r) =>
          rowMatchesSearch(store, r, search, locale),
        )
        const assigned = rows.filter((r) => r.employeeId).length
        const mismatches = brigadeMismatchCount(store, sheet, brigade)
        const matchSearch =
          !search.trim() ||
          visibleRows.some((r) => r.employeeId) ||
          brigadeLabel(brigade, store.brigadeNamesKa, locale)
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        return { brigade, rows, visibleRows, assigned, mismatches, matchSearch }
      })
      .filter((b) => b.matchSearch)
  }, [brigades, sheet, store, search, locale])

  const prevSearchRef = useRef(search)
  useEffect(() => {
    const prev = prevSearchRef.current
    prevSearchRef.current = search
    if (!search.trim() || prev === search) return
    const hit = blocks.find((b) => b.visibleRows.some((r) => r.employeeId))
    if (hit) setExpandedBrigade(hit.brigade)
  }, [search, blocks, setExpandedBrigade])

  const cardDragProps = useCallback(
    (rowId: string) => ({
      draggable: !readOnly,
      onDragStart: (e: React.DragEvent) => {
        if (readOnly) return
        e.dataTransfer.setData(KANBAN_DRAG_MIME, rowId)
        e.dataTransfer.effectAllowed = 'move'
        setDraggingId(rowId)
      },
      onDragEnd: clearDrag,
    }),
    [clearDrag, readOnly],
  )

  function handleDrop(
    e: React.DragEvent,
    toBrigade: string,
    beforeRowId: string | null,
  ) {
    e.preventDefault()
    if (readOnly) return
    const rowId = e.dataTransfer.getData(KANBAN_DRAG_MIME)
    if (!rowId) return
    const row = sheet.rows.find((r) => r.id === rowId)
    if (!row) return
    clearDrag()
    if (row.brigade === toBrigade) {
      if (row.id !== beforeRowId) onReorderRow(toBrigade, rowId, beforeRowId)
      return
    }
    if (!row.employeeId) return
    onMoveToBrigade(rowId, toBrigade)
  }

  function dropZoneProps(toBrigade: string, beforeRowId: string | null) {
    const active =
      dropTarget?.brigade === toBrigade && dropTarget.beforeRowId === beforeRowId
    return {
      onDragOver: (e: React.DragEvent) => {
        if (readOnly) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget({ brigade: toBrigade, beforeRowId })
      },
      onDragLeave: () => {
        setDropTarget((prev) =>
          prev?.brigade === toBrigade && prev.beforeRowId === beforeRowId
            ? null
            : prev,
        )
      },
      onDrop: (e: React.DragEvent) => handleDrop(e, toBrigade, beforeRowId),
      className: `h-1 rounded transition-colors ${active ? 'bg-sky-300' : 'bg-transparent'}`,
    }
  }

  if (!blocks.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-stone-500">
        {t('month.brigadeBoard.empty')}
      </p>
    )
  }

  const expandedBlock = expanded
    ? blocks.find((b) => b.brigade === expanded)
    : null

  const focusMode = Boolean(expandedBlock)

  function renderRoster(block: NonNullable<typeof expandedBlock>) {
    return (
      <div className="bw-brigade-board__roster-inner">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t('month.brigadeBoard.roster')}
        </p>
        <div className="bw-brigade-board__roster-list">
          {block.visibleRows.map((row) => {
            const emp = row.employeeId
              ? store.employees.find((e) => e.id === row.employeeId)
              : null
            const isEmpty = !emp
            return (
              <div key={row.id}>
                <div {...dropZoneProps(block.brigade, row.id)} />
                {isEmpty ? (
                  <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/60 px-3 py-2 text-xs text-stone-400">
                    {t('month.brigadeBoard.emptySlot')}
                  </div>
                ) : readOnly ? (
                  <div
                    className="rounded-xl border border-stone-200 bg-white px-2.5 py-1.5"
                    title={employeeName(emp, locale)}
                  >
                    <div className="truncate text-[11px] text-stone-600">
                      №{emp.tabNumber}
                      {emp.position
                        ? ` · ${employeePosition(emp, locale)}`
                        : ''}
                    </div>
                  </div>
                ) : (
                  <KanbanCardShell
                    dragging={draggingId === row.id}
                    dragProps={cardDragProps(row.id) as never}
                    className="flex items-center gap-2"
                    title={employeeName(emp, locale)}
                  >
                    <span className="cursor-grab text-stone-300" aria-hidden>
                      ⠿
                    </span>
                    <div className="min-w-0 flex-1 truncate text-[11px] text-stone-600">
                      №{emp.tabNumber}
                      {emp.position
                        ? ` · ${employeePosition(emp, locale)}`
                        : ''}
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded border border-grid bg-stone-50 px-2 py-0.5 text-[10px] font-medium text-stone-700 hover:bg-white"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenTransfer(emp.id)
                      }}
                    >
                      {t('month.brigadeBoard.transfer')}
                    </button>
                  </KanbanCardShell>
                )}
              </div>
            )
          })}
          <div {...dropZoneProps(block.brigade, null)} />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`bw-brigade-board${focusMode ? ' bw-brigade-board--focus' : ''}`}
      data-coach="month:brigadeBoard"
    >
      {!focusMode ? (
        <>
          <p className="bw-brigade-board__hint">{t('month.brigadeBoard.hint')}</p>
          <div className="bw-brigade-board__grid">
            {blocks.map(({ brigade, assigned, mismatches }) => {
              const label = brigadeLabel(brigade, store.brigadeNamesKa, locale)
              return (
                <button
                  key={brigade}
                  type="button"
                  data-coach="month:brigadeBoardTile"
                  className={[
                    'bw-brigade-board__tile',
                    draggingId ? 'bw-brigade-board__tile--drop' : '',
                  ].join(' ')}
                  onClick={() => setExpandedBrigade(brigade)}
                  onDragOver={(e) => {
                    if (readOnly) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => handleDrop(e, brigade, null)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-snug text-ink">
                      {label}
                    </span>
                    <span className="shrink-0 text-[10px] text-stone-400">▸</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-stone-600">
                    <span className="rounded-md bg-stone-100 px-1.5 py-0.5">
                      {tf('month.brigadeBoard.count', { n: assigned })}
                    </span>
                    {mismatches > 0 ? (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900">
                        Δ {mismatches}
                      </span>
                    ) : (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                        {t('month.brigadeBoard.ok')}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      ) : expandedBlock ? (
        <>
          <div className="bw-brigade-board__picker" role="tablist">
            <button
              type="button"
              className="bw-brigade-board__picker-back"
              onClick={() => setExpandedBrigade(null)}
              title={t('month.brigadeBoard.showTiles')}
              data-coach="month:brigadeBoardTiles"
            >
              {t('month.brigadeBoard.showTiles')}
            </button>
            {blocks.map(({ brigade, mismatches }) => {
              const isActive = brigade === expanded
              const label = brigadeLabel(brigade, store.brigadeNamesKa, locale)
              return (
                <button
                  key={brigade}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`bw-brigade-board__picker-chip${isActive ? ' bw-brigade-board__picker-chip--on' : ''}`}
                  onClick={() => setExpandedBrigade(brigade)}
                  onDragOver={(e) => {
                    if (readOnly) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.stopPropagation()
                    if (isActive) return
                    handleDrop(e, brigade, null)
                  }}
                >
                  <span className="truncate">{label}</span>
                  {mismatches > 0 ? (
                    <span className="bw-brigade-board__picker-delta">Δ{mismatches}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <section
            className="bw-brigade-board__detail"
            data-coach="month:brigadeBoardExpanded"
          >
            <div className="bw-brigade-board__detail-head">
              <h3 className="text-sm font-bold text-ink sm:text-base">
                {brigadeLabel(expandedBlock.brigade, store.brigadeNamesKa, locale)}
              </h3>
              {rosterOpen ? (
                <span className="hidden text-xs text-stone-500 sm:inline">
                  {t('month.brigadeBoard.dragHint')}
                </span>
              ) : null}
              <div className="flex-1" />
              <button
                type="button"
                className="bw-brigade-board__head-btn"
                data-coach="month:brigadeBoardRoster"
                onClick={() => setRosterOpen((v) => !v)}
                aria-expanded={rosterOpen}
              >
                {rosterOpen
                  ? t('month.brigadeBoard.hideRoster')
                  : t('month.brigadeBoard.showRoster')}
              </button>
              {onFillBrigade && sheetMode === 'plan' ? (
                <button
                  type="button"
                  className="bw-brigade-board__head-btn"
                  onClick={() => onFillBrigade(expandedBlock.brigade)}
                >
                  {t('month.brigadeBoard.compose')}
                </button>
              ) : null}
              <button
                type="button"
                className="bw-brigade-board__head-btn"
                onClick={() => setExpandedBrigade(null)}
              >
                {t('month.brigadeBoard.collapse')}
              </button>
            </div>

            <div className="bw-brigade-board__split">
              {rosterOpen ? (
                <aside className="bw-brigade-board__roster">
                  {renderRoster(expandedBlock)}
                </aside>
              ) : null}

              <div className="bw-brigade-board__sheet" data-coach="month:brigadeBoardSheet">
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {sheetMode === 'plan'
                    ? t('month.brigadeBoard.daysPlan')
                    : t('month.brigadeBoard.daysFact')}
                </p>
                {renderTimesheet ? renderTimesheet(expandedBlock.brigade) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
