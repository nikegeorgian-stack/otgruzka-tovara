import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CodeLegendBar } from '@/components/month/CodeLegendBar'
import { MonthDisplayBar } from '@/components/month/MonthDisplayBar'
import { PlanFactTable } from '@/components/month/PlanFactTable'
import { useConfirm } from '@/context/ConfirmContext'
import { useModalScope } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { FULLSCREEN_OVER_CHROME_Z } from '@/lib/ui/chromeLayout'
import { useI18n } from '@/context/I18nContext'
import { nextCode } from '@/lib/codes'
import { formatMonthTitle, shiftMonth } from '@/lib/dates'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import type { MonthGroupMode, MonthViewDisplay } from '@/lib/monthViewOptions'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import type { ComponentProps } from 'react'

type TableProps = Omit<
  ComponentProps<typeof PlanFactTable>,
  'store' | 'sheet' | 'mode' | 'metaEditable' | 'assignEditable' | 'focusMode' | 'embedded'
>

type PlanMap = MonthSheet['plan']

function clonePlan(plan: PlanMap): PlanMap {
  const out: PlanMap = {}
  for (const [rowId, days] of Object.entries(plan)) {
    out[rowId] = { ...days }
  }
  return out
}

type Props = TableProps & {
  store: AppStore
  sheet: MonthSheet
  month: string
  editing: boolean
  search: string
  selectedBrigades: Set<string>
  brigadeSearch: string
  selectedUnits: Set<string>
  allUnitKeys: string[]
  unitSearch: string
  showUnassignedUnit: boolean
  groupMode: MonthGroupMode
  timesheetUnits: import('@/lib/types').HrStructuralUnit[]
  workshopMasterMode?: boolean
  lockBrigadeScope?: boolean
  filterableBrigades?: string[]
  primaryBrigades?: string[]
  /** Можно ли включать режим правки (ACL edit). */
  canEditTimesheet?: boolean
  filterSchedule: string
  viewDisplay: MonthViewDisplay
  onSearch: (v: string) => void
  onBrigadeSearch: (v: string) => void
  onSelectedBrigades: (next: Set<string>) => void
  onUnitSearch: (v: string) => void
  onSelectedUnits: (next: Set<string>) => void
  onGroupMode: (mode: MonthGroupMode) => void
  onViewDisplay: (patch: Partial<MonthViewDisplay>) => void
  onFilterSchedule: (v: string) => void
  onToggleEditing: () => void
  onRegenerateMonth: () => void
  onMonthChange: (m: string) => void
  onClose: () => void
  /** Применить черновик плана в стор + журнал. */
  onSavePlan: (draftPlan: PlanMap) => void
  /** Открыть журнал изменений табеля. */
  onOpenAudit: () => void
  onCycle: (rowId: string, dateKey: string) => void
  onSetCode: (rowId: string, dateKey: string, code: DayCode) => void
}

export function PlanEditorWindow({
  store,
  sheet,
  month,
  editing,
  search,
  selectedBrigades,
  brigadeSearch,
  selectedUnits,
  allUnitKeys,
  unitSearch,
  showUnassignedUnit,
  groupMode,
  timesheetUnits,
  workshopMasterMode = false,
  lockBrigadeScope = false,
  filterableBrigades,
  primaryBrigades,
  canEditTimesheet = true,
  filterSchedule,
  viewDisplay,
  onSearch,
  onBrigadeSearch,
  onSelectedBrigades,
  onUnitSearch,
  onSelectedUnits,
  onGroupMode,
  onViewDisplay,
  onFilterSchedule,
  onToggleEditing,
  onRegenerateMonth,
  onMonthChange,
  onClose,
  onSavePlan,
  onOpenAudit,
  onCycle: _onCycleLive,
  onSetCode: _onSetCodeLive,
  onAssign,
  onRegenerateRow,
  ...tableProps
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirmUnsaved } = useConfirm()
  const panelRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftPlan, setDraftPlan] = useState<PlanMap>(() => clonePlan(sheet.plan))
  const [dirty, setDirty] = useState(false)
  const brigadeList = filterableBrigades ?? store.brigades
  const editEnabled = editing && canEditTimesheet

  const draftSheet = useMemo(
    () => ({ ...sheet, plan: draftPlan }),
    [sheet, draftPlan],
  )

  useEffect(() => {
    if (dirty) return
    setDraftPlan(clonePlan(sheet.plan))
  }, [sheet.plan, month, dirty])

  const flushDraftIfNeeded = useCallback(() => {
    if (!dirty) return
    onSavePlan(draftPlan)
    setDirty(false)
  }, [dirty, draftPlan, onSavePlan])

  const patchCell = useCallback((rowId: string, dateKey: string, code: DayCode) => {
    setDraftPlan((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? {}), [dateKey]: code },
    }))
    setDirty(true)
  }, [])

  const handleCycle = useCallback(
    (rowId: string, dateKey: string) => {
      if (!editEnabled) return
      const current = (draftPlan[rowId]?.[dateKey] ?? '') as DayCode
      patchCell(rowId, dateKey, nextCode(current))
    },
    [draftPlan, editEnabled, patchCell],
  )

  const handleSetCode = useCallback(
    (rowId: string, dateKey: string, code: DayCode) => {
      if (!editEnabled) return
      patchCell(rowId, dateKey, code)
    },
    [editEnabled, patchCell],
  )

  const handleSave = useCallback(() => {
    if (dirty) {
      onSavePlan(draftPlan)
      setDirty(false)
    } else {
      onSavePlan(draftPlan)
    }
    if (editEnabled) onToggleEditing()
    onClose()
  }, [dirty, draftPlan, editEnabled, onClose, onSavePlan, onToggleEditing])

  const requestClose = useCallback(async () => {
    if (dirty) {
      const choice = await confirmUnsaved({
        title: t('month.planEditorUnsavedTitle'),
        message: t('month.planEditorUnsavedBody'),
      })
      if (choice === 'cancel') return
      if (choice === 'save') {
        onSavePlan(draftPlan)
        setDirty(false)
      }
    }
    onClose()
  }, [confirmUnsaved, dirty, draftPlan, onClose, onSavePlan, t])

  const { zIndex: stackZIndex } = useModalScope({
    open: true,
    onClose: () => {
      void requestClose()
    },
    containerRef: panelRef,
    disableEnterSubmit: true,
    initialFocus: 'none',
  })
  const zIndex = Math.max(stackZIndex, FULLSCREEN_OVER_CHROME_Z)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.dataset.planEditorOpen = '1'
    return () => {
      document.body.style.overflow = prev
      delete document.documentElement.dataset.planEditorOpen
    }
  }, [])

  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 flex flex-col bg-[#f5f3ef]"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-editor-title"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-grid bg-white px-3 py-2 shadow-sm">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
          <h2
            id="plan-editor-title"
            className="text-sm font-bold capitalize text-ink sm:text-base"
          >
            {t('month.planEditorTitle')} · {formatMonthTitle(month, locale)}
          </h2>
          {dirty ? (
            <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              {t('month.planEditorDirty')}
            </span>
          ) : null}
          <div className="flex rounded-sm border border-grid bg-paper">
            <button
              type="button"
              className="px-2 py-1 text-stone-600 hover:bg-paper-dark"
              onClick={() => {
                flushDraftIfNeeded()
                onMonthChange(shiftMonth(month, -1))
                setDirty(false)
              }}
              title={t('month.prevMonth')}
            >
              ‹
            </button>
            <button
              type="button"
              className="px-2 py-1 text-stone-600 hover:bg-paper-dark"
              onClick={() => {
                flushDraftIfNeeded()
                onMonthChange(shiftMonth(month, 1))
                setDirty(false)
              }}
              title={t('month.nextMonth')}
            >
              ›
            </button>
          </div>
        </div>

        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-paper-dark sm:text-sm"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          {filtersOpen ? '▾' : '▸'} {t('workspace.widget.filters')}
        </button>

        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-paper-dark sm:text-sm"
          onClick={onOpenAudit}
          title={t('month.audit.openHint')}
        >
          {t('month.audit.open')}
        </button>

        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-paper-dark sm:text-sm"
          onClick={() => void requestClose()}
        >
          {t('month.planEditorClose')}
        </button>

        <button
          type="button"
          className="rounded-sm bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:text-sm"
          onClick={handleSave}
          disabled={!canEditTimesheet}
          title={t('month.planEditorSaveHint')}
        >
          {t('month.planEditorSave')}
        </button>
      </header>

      <p className="shrink-0 border-b border-sky-100 bg-sky-50/80 px-3 py-1.5 text-[11px] text-sky-950">
        {t('month.planEditorSaveHint')}
      </p>

      {filtersOpen ? (
        <div className="shrink-0 space-y-2 border-b border-grid bg-white px-3 py-2">
          <div className="month-search-bar">
            <input
              className="month-search-bar__input"
              type="search"
              placeholder={t('month.searchEmployee')}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-stone-600">
            {t('month.filterSchedule')}
            <select
              className="rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterSchedule}
              onChange={(e) => onFilterSchedule(e.target.value)}
            >
              <option value="">{t('month.allSchedules')}</option>
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <MonthDisplayBar
            brigades={brigadeList}
            brigadeNamesKa={store.brigadeNamesKa}
            brigadeUnits={store.brigadeUnits}
            brigadeSearch={brigadeSearch}
            selectedBrigades={selectedBrigades}
            primaryBrigades={
              workshopMasterMode || lockBrigadeScope ? primaryBrigades : undefined
            }
            lockBrigadeScope={lockBrigadeScope}
            structuralUnits={timesheetUnits}
            unitSearch={unitSearch}
            selectedUnits={selectedUnits}
            showUnassignedUnit={showUnassignedUnit}
            groupMode={groupMode}
            showUnitFilters={!workshopMasterMode && !lockBrigadeScope}
            showGroupModeToggle={!workshopMasterMode && !lockBrigadeScope}
            display={viewDisplay}
            layout="plan"
            onBrigadeSearch={onBrigadeSearch}
            onSelectedBrigades={onSelectedBrigades}
            onUnitSearch={onUnitSearch}
            onSelectedUnits={onSelectedUnits}
            onGroupMode={onGroupMode}
            onDisplay={onViewDisplay}
          />
          <details className="rounded-sm border border-stone-200 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-600">
            <summary className="cursor-pointer font-medium text-stone-700">
              {t('legend.codes')}
            </summary>
            <div className="mt-2">
              <CodeLegendBar />
            </div>
          </details>
          {!lockBrigadeScope && canEditTimesheet ? (
            <button
              type="button"
              className="rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
              onClick={() => {
                flushDraftIfNeeded()
                onRegenerateMonth()
                setDirty(false)
              }}
              disabled={!editEnabled}
              title={!editEnabled ? t('month.editToChange') : t('month.regenerate')}
            >
              {t('month.regenerate')}
            </button>
          ) : null}
          <p className="text-[11px] text-stone-500">
            {tf('workspace.chip.brigades', {
              count: selectedBrigades.size,
              total: brigadeList.length,
            })}
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-b border-grid bg-white px-3 py-1.5">
          <input
            className="month-search-bar__input w-full max-w-md"
            type="search"
            placeholder={t('month.searchEmployee')}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-sky-200/80 bg-white shadow-md">
          <PlanFactTable
            {...tableProps}
            store={store}
            sheet={draftSheet}
            mode="plan"
            metaEditable
            assignEditable
            focusMode
            embedded
            search={search}
            selectedBrigades={selectedBrigades}
            brigadeSearch={brigadeSearch}
            selectedUnits={selectedUnits}
            allUnitKeys={allUnitKeys}
            filterSchedule={filterSchedule}
            groupMode={groupMode}
            display={viewDisplay}
            readOnly={!editing}
            onCycle={handleCycle}
            onSetCode={handleSetCode}
            onAssign={(rowId, employeeId) => {
              flushDraftIfNeeded()
              onAssign?.(rowId, employeeId)
            }}
            onRegenerateRow={(rowId) => {
              flushDraftIfNeeded()
              onRegenerateRow?.(rowId)
            }}
          />
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
