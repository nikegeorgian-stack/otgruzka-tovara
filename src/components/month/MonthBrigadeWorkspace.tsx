import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { useCoach } from '@/context/CoachContext'
import { WorkspaceWidgetDrawer } from '@/components/ui/workspace/WorkspaceWidgetDrawer'
import { brigadeAssignedCount, brigadeMismatchCount } from '@/lib/brigadeStats'
import {
  type MonthGroupMode,
} from '@/lib/monthViewOptions'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import type { CopyPlanToFactScope } from '@/lib/bulkOps'
import type { MonthStatsFilter } from '@/lib/stats'
import { monthStats } from '@/lib/stats'
import { absenceConfirmForEmployee } from '@/lib/absenceConfirm'
import { monthProblems } from '@/lib/problems'
import type { AppStore, MonthSheet, ShiftTemplate } from '@/lib/types'
import type { BrigadeHeaderMode } from '@/lib/monthTimesheetLayout'
import type { MonthRowSort } from '@/lib/monthRowSort'
import type { MonthViewDisplay } from '@/lib/monthViewOptions'
import { PlanFactTable } from './PlanFactTable'
import { MonthBrigadeBoard } from './MonthBrigadeBoard'
import { KanbanViewToggle, type KanbanViewMode } from '@/components/kanban'
import { BrigadeTabsBar, type BrigadeTabId } from './BrigadeTabsBar'
import { BrigadeContextBar } from './BrigadeContextBar'
import { MonthWorkspaceFooter } from './MonthWorkspaceFooter'
import { CodeLegendBar } from './CodeLegendBar'
import type { ComponentProps, ReactNode } from 'react'

const MONTH_TOOLS_COACH = new Set([
  'month:fillDay',
  'month:planEditor',
  'month:mismatchOnly',
  'month:copyPlanDanger',
  'month:copyPlanEmpty',
  'month:history',
  'month:historyUndo',
])

type TableCoreProps = Omit<
  ComponentProps<typeof PlanFactTable>,
  'mode' | 'onCycle' | 'onSetCode' | 'onSetCodesBatch' | 'onSetFactExtra' | 'brigadeHeaderMode' | 'metaEditable' | 'assignEditable' | 'embedded'
>

type Props = TableCoreProps & {
  store: AppStore
  sheet: MonthSheet
  workshopMasterMode?: boolean
  /** Жёсткая область ACL: только masterBrigades, без «все бригады». */
  lockBrigadeScope?: boolean
  masterBrigades: string[]
  groupMode: MonthGroupMode
  onGroupMode: (mode: MonthGroupMode) => void
  showGroupModeToggle?: boolean
  viewDisplay: MonthViewDisplay
  filterSchedule: string
  onFilterSchedule: (v: string) => void
  onExportExcel: () => void
  onBulkHolidayV: () => void
  onBulkCopyPlanToFact: (scope: CopyPlanToFactScope, brigade?: string) => void
  onApplyShiftTemplate: (templateId: string, brigade: string) => void
  onManageBrigades: () => void
  onOpenPlanEditor: () => void
  onFillDay: (brigades: string[]) => void
  shiftTemplates: ShiftTemplate[]
  selectedBrigades: Set<string>
  onSelectedBrigades: (next: Set<string>) => void
  search: string
  onSearch: (v: string) => void
  readOnly: boolean
  readOnlyHint?: string
  /** Порядок № без режима правки ячеек. */
  allowRowReorder?: boolean
  /** Что показывает основная таблица: факт или план. */
  sheetMode: 'plan' | 'fact'
  onSheetMode: (mode: 'plan' | 'fact') => void
  onCycle: (rowId: string, dateKey: string, mode: 'plan' | 'fact') => void
  onSetCode: (
    rowId: string,
    dateKey: string,
    code: import('@/lib/types').DayCode,
    mode: 'plan' | 'fact',
  ) => void
  onSetCodesBatch?: (
    cells: Array<{ rowId: string; dateKey: string }>,
    code: import('@/lib/types').DayCode,
    mode: 'plan' | 'fact',
  ) => void
  onSetFactExtra?: (rowId: string, dateKey: string, hours: number) => void
  rowSort: MonthRowSort
  onRowSortChange?: (sort: MonthRowSort) => void
  canSignoff?: boolean
  onSetBrigadeSignoff?: (brigade: string, verified: boolean) => void
  /** Кнопки истории правок (↶↷) в тулбаре */
  historyControls?: ReactNode
  mismatchOnly?: boolean
  onMismatchOnly?: (v: boolean) => void
  onBulkCopyPlanToFactEmpty?: (scope: CopyPlanToFactScope, brigade?: string) => void
  onReorderBrigadeRow?: (
    brigade: string,
    rowId: string,
    beforeRowId: string | null,
  ) => void
  onBoardMoveToBrigade?: (rowId: string, toBrigade: string) => void
  onOpenTransfer?: (employeeId: string, toBrigade?: string) => void
}

export function MonthBrigadeWorkspace({
  store,
  sheet,
  workshopMasterMode = false,
  lockBrigadeScope = false,
  masterBrigades,
  groupMode,
  onGroupMode,
  showGroupModeToggle = true,
  viewDisplay,
  filterSchedule,
  onFilterSchedule,
  onExportExcel,
  onBulkHolidayV,
  onBulkCopyPlanToFact,
  onApplyShiftTemplate,
  onManageBrigades,
  onOpenPlanEditor,
  onFillDay,
  shiftTemplates,
  selectedBrigades,
  onSelectedBrigades,
  search,
  onSearch,
  readOnly,
  readOnlyHint,
  allowRowReorder = false,
  sheetMode,
  onCycle,
  onSetCode,
  onSetCodesBatch,
  onSetFactExtra,
  rowSort,
  onRowSortChange,
  canSignoff = false,
  onSetBrigadeSignoff,
  historyControls,
  mismatchOnly = false,
  onMismatchOnly,
  onBulkCopyPlanToFactEmpty,
  onReorderBrigadeRow,
  onBoardMoveToBrigade,
  onOpenTransfer,
  ...tableCore
}: Props) {
  const { t } = useI18n()
  const { currentStep } = useCoach()
  const [myBrigadesOnly, setMyBrigadesOnly] = useState(workshopMasterMode || lockBrigadeScope)
  const [legendOpen, setLegendOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<KanbanViewMode>('kanban')
  const [boardExpanded, setBoardExpanded] = useState<string | null>(null)
  const closeTools = useCallback(() => setToolsOpen(false), [])

  const coachTarget = currentStep?.target
  useLayoutEffect(() => {
    if (!coachTarget) return
    if (coachTarget === 'month:tools') {
      setToolsOpen(false)
      return
    }
    if (MONTH_TOOLS_COACH.has(coachTarget)) setToolsOpen(true)
  }, [coachTarget])

  const tabBrigades = useMemo(() => {
    if (lockBrigadeScope) {
      return store.brigades.filter((b) => masterBrigades.includes(b))
    }
    if (workshopMasterMode && myBrigadesOnly) {
      return store.brigades.filter((b) => masterBrigades.includes(b))
    }
    return store.brigades
  }, [lockBrigadeScope, masterBrigades, myBrigadesOnly, store.brigades, workshopMasterMode])

  const handleBoardExpandedChange = useCallback(
    (brigade: string | null) => {
      setBoardExpanded(brigade)
      // Синхрон с KPI / «Ещё» / перекличкой вне плиток: открытая плитка = область.
      if (brigade) {
        onSelectedBrigades(new Set([brigade]))
      } else {
        onSelectedBrigades(new Set(tabBrigades))
      }
    },
    [onSelectedBrigades, tabBrigades],
  )

  const activeTab: BrigadeTabId = useMemo(() => {
    if (selectedBrigades.size === tabBrigades.length && tabBrigades.every((b) => selectedBrigades.has(b))) {
      return '__all__'
    }
    if (selectedBrigades.size === 1) {
      const [only] = [...selectedBrigades]
      if (only && tabBrigades.includes(only)) return only
    }
    return '__all__'
  }, [selectedBrigades, tabBrigades])

  const handleTabChange = useCallback(
    (tab: BrigadeTabId) => {
      if (tab === '__all__') {
        onSelectedBrigades(new Set(tabBrigades))
      } else {
        onSelectedBrigades(new Set([tab]))
      }
    },
    [onSelectedBrigades, tabBrigades],
  )

  useEffect(() => {
    if (lockBrigadeScope) {
      const next = new Set([...selectedBrigades].filter((b) => masterBrigades.includes(b)))
      if (next.size === 0) {
        for (const b of masterBrigades) {
          if (store.brigades.includes(b)) next.add(b)
        }
      }
      if (
        next.size !== selectedBrigades.size ||
        [...next].some((b) => !selectedBrigades.has(b))
      ) {
        onSelectedBrigades(next)
      }
      return
    }
    if (!workshopMasterMode || !myBrigadesOnly) return
    const next = new Set([...selectedBrigades].filter((b) => masterBrigades.includes(b)))
    if (next.size === 0) {
      for (const b of masterBrigades) {
        if (store.brigades.includes(b)) next.add(b)
      }
    }
    if (
      next.size !== selectedBrigades.size ||
      [...next].some((b) => !selectedBrigades.has(b))
    ) {
      onSelectedBrigades(next)
    }
  }, [
    lockBrigadeScope,
    masterBrigades,
    myBrigadesOnly,
    onSelectedBrigades,
    selectedBrigades,
    store.brigades,
    workshopMasterMode,
  ])

  const singleBrigade =
    activeTab !== '__all__' && typeof activeTab === 'string' ? activeTab : null

  const brigadeHeaderMode: BrigadeHeaderMode = singleBrigade ? 'hidden' : 'label'

  const statsFilter = useMemo((): MonthStatsFilter => {
    const filter: MonthStatsFilter = {
      confirmForEmployee: (employeeId) => absenceConfirmForEmployee(store, employeeId, sheet.month),
    }
    const brigadeCount = Array.isArray(store.brigades) ? store.brigades.length : 0
    if (lockBrigadeScope || selectedBrigades.size < brigadeCount) {
      filter.brigades = [...selectedBrigades]
    }
    return filter
  }, [lockBrigadeScope, selectedBrigades, sheet.month, store])

  const stats = useMemo(
    () => monthStats(sheet, store.employees, statsFilter),
    [sheet, store.employees, statsFilter],
  )
  const problems = useMemo(
    () => monthProblems(store, sheet),
    [sheet, store.employees],
  )

  const tableProps = {
    ...tableCore,
    store,
    sheet,
    search,
    selectedBrigades,
    filterSchedule,
    groupMode,
    display: viewDisplay,
    rowSort,
    onRowSortChange,
    readOnly,
    allowRowReorder,
  }

  const mismatchForContext = singleBrigade
    ? brigadeMismatchCount(store, sheet, singleBrigade)
    : 0

  const deltaClass =
    stats.deviation === 0
      ? 'bw-metric--flat'
      : stats.deviation > 0
        ? 'bw-metric--up'
        : 'bw-metric--down'

  const toolsActive = Boolean(search.trim() || mismatchOnly)
  const fillDayScope = () =>
    workspaceView === 'kanban'
      ? boardExpanded
        ? [boardExpanded]
        : [...tabBrigades]
      : singleBrigade
        ? [singleBrigade]
        : [...selectedBrigades]

  return (
    <div className={`bw-shell bw-shell--${sheetMode} bw-shell--deck-collapsed`}>
      <div className="bw-command print:hidden">
        <KanbanViewToggle
          mode={workspaceView}
          onChange={(mode) => {
            setWorkspaceView(mode)
            if (mode === 'list' && boardExpanded) {
              onSelectedBrigades(new Set([boardExpanded]))
            }
            if (mode === 'kanban') {
              handleBoardExpandedChange(null)
            }
          }}
          listLabel={t('month.viewGrid')}
          kanbanLabel={t('month.viewBrigades')}
          dataCoachKanban="month:viewBrigades"
          className="shrink-0"
        />
        <button
          type="button"
          className={`bw-command__tools${toolsActive ? ' bw-command__tools--on' : ''}`}
          onClick={() => setToolsOpen(true)}
          aria-expanded={toolsOpen}
          aria-controls="month-tools-panel"
          title={t('month.toolsHint')}
          data-coach="month:tools"
        >
          {toolsActive ? <span className="bw-command__dot" aria-hidden /> : null}
          {t('month.tools')}
        </button>
      </div>

      <WorkspaceWidgetDrawer
        open={toolsOpen}
        title={t('month.tools')}
        subtitle={t('month.toolsHint')}
        onClose={closeTools}
      >
        <div id="month-tools-panel" className="bw-tools-panel">
          <section className="bw-tools-panel__section" aria-label={t('month.deck.metrics')}>
            <p className="bw-tools-panel__label">{t('month.deck.metrics')}</p>
            <div className="bw-deck__metrics">
              <div className={`bw-metric bw-metric--plan ${sheetMode === 'plan' ? 'bw-metric--live' : ''}`}>
                <span className="bw-metric__label">{t('month.plan')}</span>
                <span className="bw-metric__value">{stats.planHours}</span>
                <span className="bw-metric__unit">{t('common.hoursShort')}</span>
              </div>
              <div className={`bw-metric bw-metric--delta ${deltaClass}`}>
                <span className="bw-metric__label">Δ</span>
                <span className="bw-metric__value">
                  {stats.deviation > 0 ? `+${stats.deviation}` : stats.deviation}
                </span>
              </div>
              <div className={`bw-metric bw-metric--fact ${sheetMode === 'fact' ? 'bw-metric--live' : ''}`}>
                <span className="bw-metric__label">{t('month.fact')}</span>
                <span className="bw-metric__value">{stats.factHours}</span>
                <span className="bw-metric__unit">{t('common.hoursShort')}</span>
              </div>
              {problems.length > 0 ? (
                <div className="bw-metric bw-metric--warn">
                  <span className="bw-metric__label">{t('month.workspace.problemsShort')}</span>
                  <span className="bw-metric__value">{problems.length}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="bw-tools-panel__section">
            <p className="bw-tools-panel__label">{t('workspace.widget.filters')}</p>
            <input
              className="bw-toolbar__search"
              type="search"
              placeholder={t('month.searchEmployee')}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
            {workspaceView === 'list' && showGroupModeToggle && activeTab === '__all__' ? (
              <div className="bw-toolbar__seg" title={t('month.groupByBrigade')}>
                {(
                  [
                    ['brigade', t('month.groupByBrigadeShort')],
                    ['unit', t('month.groupByUnitShort')],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`bw-toolbar__seg-btn ${groupMode === id ? 'bw-toolbar__seg-btn--on' : ''}`}
                    onClick={() => onGroupMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <select
              className="bw-toolbar__select"
              value={filterSchedule}
              onChange={(e) => onFilterSchedule(e.target.value)}
              title={t('month.filterSchedule')}
            >
              <option value="">{t('month.allSchedules')}</option>
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {onMismatchOnly ? (
              <button
                type="button"
                className={`bw-toolbar__btn ${mismatchOnly ? 'bw-toolbar__btn--accent' : ''}`}
                aria-pressed={mismatchOnly}
                onClick={() => onMismatchOnly?.(!mismatchOnly)}
                title={t('month.mismatchOnlyHint')}
                data-coach="month:mismatchOnly"
              >
                {t('month.mismatchOnly')}
              </button>
            ) : null}
          </section>

          <section className="bw-tools-panel__section">
            <p className="bw-tools-panel__label">{t('workspace.widget.operations')}</p>
            <button
              type="button"
              className="bw-toolbar__btn bw-toolbar__btn--primary"
              onClick={() => onFillDay(fillDayScope())}
              disabled={readOnly || sheetMode !== 'fact'}
              title={
                sheetMode !== 'fact'
                  ? t('month.workspace.fillDayFactOnly')
                  : (readOnlyHint ?? t('month.workspace.fillDayHint'))
              }
              data-coach="month:fillDay"
            >
              {t('month.workspace.fillDay')}
            </button>
            {sheetMode === 'plan' ? (
              <button
                type="button"
                className="bw-toolbar__btn bw-toolbar__btn--accent"
                onClick={onOpenPlanEditor}
                title={t('month.planEditorHint')}
                data-coach="month:planEditor"
              >
                {t('month.planEditor')}
              </button>
            ) : null}
            {historyControls}
            <button
              type="button"
              className={`bw-toolbar__btn ${legendOpen ? 'bw-toolbar__btn--accent' : ''}`}
              onClick={() => setLegendOpen((v) => !v)}
              aria-expanded={legendOpen}
              title={t('legend.codes')}
            >
              {t('legend.codes')}
            </button>
            {legendOpen ? <CodeLegendBar compact /> : null}
          </section>

          <section className="bw-tools-panel__section">
            <p className="bw-tools-panel__label">{t('common.more')}</p>
            <button
              type="button"
              className="bw-toolbar__btn"
              onClick={onExportExcel}
            >
              {t('month.exportExcel')}
            </button>
            {!readOnly ? (
              <button
                type="button"
                className="bw-toolbar__btn bw-toolbar__more-item--danger"
                onClick={() => {
                  onBulkCopyPlanToFact(
                    singleBrigade ? 'brigade' : 'all',
                    singleBrigade ?? undefined,
                  )
                }}
                title={t('month.deck.copyPlanDangerHint')}
                data-coach="month:copyPlanDanger"
              >
                {t('month.workspace.planHubCopyFact')}
              </button>
            ) : null}
            {!readOnly && onBulkCopyPlanToFactEmpty ? (
              <button
                type="button"
                className="bw-toolbar__btn"
                onClick={() => {
                  onBulkCopyPlanToFactEmpty(
                    singleBrigade ? 'brigade' : 'all',
                    singleBrigade ?? undefined,
                  )
                }}
                title={t('month.copyPlanEmptyHint')}
                data-coach="month:copyPlanEmpty"
              >
                {t('month.copyPlanEmpty')}
              </button>
            ) : null}
            {!workshopMasterMode && !lockBrigadeScope ? (
              <button
                type="button"
                className="bw-toolbar__btn"
                onClick={onManageBrigades}
              >
                {t('month.brigadesManage')}
              </button>
            ) : null}
          </section>
        </div>
      </WorkspaceWidgetDrawer>

      <div className="bw-body">
        <div className="bw-stage">
          {workspaceView === 'list' ? (
          <div className="bw-chrome print:hidden">
            <BrigadeTabsBar
              brigades={tabBrigades}
              brigadeNamesKa={store.brigadeNamesKa}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              countForBrigade={(b) => brigadeAssignedCount(sheet, b)}
              myBrigadesOnly={myBrigadesOnly}
              onMyBrigadesOnly={setMyBrigadesOnly}
              showMyBrigadesToggle={workshopMasterMode && !lockBrigadeScope}
            />

            {singleBrigade ? (
              <BrigadeContextBar
                store={store}
                sheet={sheet}
                brigade={singleBrigade}
                mismatchCount={mismatchForContext}
                readOnly={readOnly}
                readOnlyHint={readOnlyHint}
                shiftTemplates={shiftTemplates}
                onSetBrigadier={tableCore.onSetBrigadier!}
                onFillBrigade={tableCore.onFillBrigade!}
                onAddRow={tableCore.onAddRow!}
                onRemoveEmptyRow={tableCore.onRemoveEmptyRow!}
                onBulkHolidayV={onBulkHolidayV}
                onBulkCopyPlanToFact={onBulkCopyPlanToFact}
                onBulkCopyPlanToFactEmpty={onBulkCopyPlanToFactEmpty}
                onApplyShiftTemplate={onApplyShiftTemplate}
                onManageBrigades={onManageBrigades}
                onOpenPlanEditor={onOpenPlanEditor}
                onFillDay={() => onFillDay([singleBrigade])}
                hideManageBrigades={workshopMasterMode || lockBrigadeScope}
                compact
                canSignoff={canSignoff}
                onSetBrigadeSignoff={onSetBrigadeSignoff}
              />
            ) : null}
          </div>
          ) : workshopMasterMode && !lockBrigadeScope ? (
            <div className="bw-chrome print:hidden px-3 py-1">
              <label className="inline-flex items-center gap-2 text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={myBrigadesOnly}
                  onChange={(e) => setMyBrigadesOnly(e.target.checked)}
                />
                {t('month.workspace.myBrigades')}
              </label>
            </div>
          ) : null}

          <div
            className={`bw-table-area${
              workspaceView === 'kanban' && boardExpanded ? ' bw-table-area--board-focus' : ''
            }`}
          >
            {workspaceView === 'kanban' && boardExpanded ? (
              <div className="bw-chrome print:hidden border-b border-grid px-2 py-1">
                <BrigadeContextBar
                  store={store}
                  sheet={sheet}
                  brigade={boardExpanded}
                  mismatchCount={brigadeMismatchCount(store, sheet, boardExpanded)}
                  readOnly={readOnly}
                  readOnlyHint={readOnlyHint}
                  shiftTemplates={shiftTemplates}
                  onSetBrigadier={tableCore.onSetBrigadier!}
                  onFillBrigade={tableCore.onFillBrigade!}
                  onAddRow={tableCore.onAddRow!}
                  onRemoveEmptyRow={tableCore.onRemoveEmptyRow!}
                  onBulkHolidayV={onBulkHolidayV}
                  onBulkCopyPlanToFact={onBulkCopyPlanToFact}
                  onBulkCopyPlanToFactEmpty={onBulkCopyPlanToFactEmpty}
                  onApplyShiftTemplate={onApplyShiftTemplate}
                  onManageBrigades={onManageBrigades}
                  onOpenPlanEditor={onOpenPlanEditor}
                  onFillDay={() => onFillDay([boardExpanded])}
                  hideManageBrigades={workshopMasterMode || lockBrigadeScope}
                  compact
                  canSignoff={canSignoff}
                  onSetBrigadeSignoff={onSetBrigadeSignoff}
                />
              </div>
            ) : null}
            {workspaceView === 'kanban' ? (
              <MonthBrigadeBoard
                store={store}
                sheet={sheet}
                brigades={tabBrigades}
                search={search}
                readOnly={readOnly}
                sheetMode={sheetMode}
                onExpandedChange={handleBoardExpandedChange}
                onReorderRow={(brigade, rowId, beforeRowId) =>
                  onReorderBrigadeRow?.(brigade, rowId, beforeRowId)
                }
                onMoveToBrigade={(rowId, toBrigade) =>
                  onBoardMoveToBrigade?.(rowId, toBrigade)
                }
                onOpenTransfer={(employeeId, toBrigade) =>
                  onOpenTransfer?.(employeeId, toBrigade)
                }
                onFillBrigade={tableCore.onFillBrigade}
                renderTimesheet={(brigade) => (
                  <PlanFactTable
                    {...tableProps}
                    selectedBrigades={new Set([brigade])}
                    mismatchOnly={mismatchOnly}
                    mode={sheetMode}
                    focusMode
                    metaEditable={sheetMode === 'plan'}
                    assignEditable={sheetMode === 'plan'}
                    embedded
                    brigadeHeaderMode="hidden"
                    onCycle={(rowId, dk) => onCycle(rowId, dk, sheetMode)}
                    onSetCode={(rowId, dk, code) =>
                      onSetCode(rowId, dk, code, sheetMode)
                    }
                    onSetCodesBatch={
                      onSetCodesBatch
                        ? (cells, code) =>
                            onSetCodesBatch(cells, code, sheetMode)
                        : undefined
                    }
                    onSetFactExtra={
                      sheetMode === 'fact' ? onSetFactExtra : undefined
                    }
                    onReorderRow={onReorderBrigadeRow}
                    onMoveToOtherBrigade={onBoardMoveToBrigade}
                    canSignoff={canSignoff}
                    onSetBrigadeSignoff={onSetBrigadeSignoff}
                  />
                )}
              />
            ) : (
            <PlanFactTable
              {...tableProps}
              mismatchOnly={mismatchOnly}
              mode={sheetMode}
              focusMode
              metaEditable={sheetMode === 'plan'}
              assignEditable={sheetMode === 'plan'}
              embedded
              brigadeHeaderMode={brigadeHeaderMode}
              onCycle={(rowId, dk) => onCycle(rowId, dk, sheetMode)}
              onSetCode={(rowId, dk, code) => onSetCode(rowId, dk, code, sheetMode)}
              onSetCodesBatch={
                onSetCodesBatch
                  ? (cells, code) => onSetCodesBatch(cells, code, sheetMode)
                  : undefined
              }
              onSetFactExtra={sheetMode === 'fact' ? onSetFactExtra : undefined}
              onReorderRow={onReorderBrigadeRow}
              onMoveToOtherBrigade={onBoardMoveToBrigade}
              canSignoff={canSignoff}
              onSetBrigadeSignoff={onSetBrigadeSignoff}
            />
            )}
          </div>
        </div>
      </div>

      <MonthWorkspaceFooter
        store={store}
        sheet={sheet}
        stats={stats}
        problemCount={problems.length}
      />
    </div>
  )
}
