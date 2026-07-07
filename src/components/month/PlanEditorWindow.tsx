import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CodeLegendBar } from '@/components/month/CodeLegendBar'
import { MonthDisplayBar } from '@/components/month/MonthDisplayBar'
import {
  MonthWorkspaceAccordion,
  useMonthAccordionSections,
} from '@/components/month/MonthWorkspaceAccordion'
import { PlanFactTable } from '@/components/month/PlanFactTable'
import { useModalScope } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle, shiftMonth } from '@/lib/dates'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import type { MonthGroupMode, MonthViewDisplay } from '@/lib/monthViewOptions'
import type { AppStore, MonthSheet } from '@/lib/types'
import type { ComponentProps } from 'react'

const PLAN_EDITOR_ACCORDION_KEY = 'fst-plan-editor-accordion-open'

type TableProps = Omit<
  ComponentProps<typeof PlanFactTable>,
  'store' | 'sheet' | 'mode' | 'metaEditable' | 'assignEditable' | 'focusMode' | 'embedded'
>

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
  onCycle: (rowId: string, dateKey: string) => void
  onSetCode: (rowId: string, dateKey: string, code: import('@/lib/types').DayCode) => void
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
  onCycle,
  onSetCode,
  ...tableProps
}: Props) {
  const { t, tf, locale } = useI18n()
  const panelRef = useRef<HTMLDivElement>(null)
  const accordion = useMonthAccordionSections(PLAN_EDITOR_ACCORDION_KEY)

  const scheduleSummary = filterSchedule
    ? (SCHEDULE_OPTIONS.find((o) => o.value === filterSchedule)?.label ?? filterSchedule)
    : t('month.allSchedules')

  const { zIndex: stackZIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    disableEnterSubmit: true,
    initialFocus: 'none',
  })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 flex flex-col bg-[#f5f3ef]"
      style={{ zIndex: stackZIndex }}
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
          <div className="flex rounded-sm border border-grid bg-paper">
            <button
              type="button"
              className="px-2 py-1 text-stone-600 hover:bg-paper-dark"
              onClick={() => onMonthChange(shiftMonth(month, -1))}
              title={t('month.prevMonth')}
            >
              ‹
            </button>
            <button
              type="button"
              className="px-2 py-1 text-stone-600 hover:bg-paper-dark"
              onClick={() => onMonthChange(shiftMonth(month, 1))}
              title={t('month.nextMonth')}
            >
              ›
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`rounded-sm px-2.5 py-1.5 text-xs font-semibold sm:text-sm ${
            editing
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-accent text-white hover:opacity-90'
          }`}
          onClick={onToggleEditing}
        >
          {editing ? t('month.editDone') : t('month.edit')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-paper-dark disabled:opacity-50 sm:text-sm"
          onClick={onRegenerateMonth}
          disabled={!editing}
          title={!editing ? t('month.editToChange') : t('month.regenerate')}
        >
          {t('month.regenerate')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-stone-300 bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700 sm:text-sm"
          onClick={onClose}
          title={t('month.planEditorEsc')}
        >
          {t('month.planEditorClose')}
        </button>
      </header>

      <p className="shrink-0 border-b border-sky-200/60 bg-sky-50 px-3 py-1 text-[11px] text-sky-900">
        {t('month.planHint')} {t('month.planEditorScrollHint')}
      </p>

      <div className="shrink-0 space-y-1 px-3 pt-2">
        <div className="month-search-bar">
          <input
            className="month-search-bar__input"
            type="search"
            placeholder={t('month.searchEmployee')}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <MonthWorkspaceAccordion
          open={accordion.open}
          onToggle={accordion.toggle}
          items={[
            {
              id: 'filters',
              label: t('workspace.widget.filters'),
              summary: `${tf('workspace.chip.brigades', {
                count: selectedBrigades.size,
                total: store.brigades.length,
              })} · ${scheduleSummary}`,
              children: (
                <div className="space-y-3">
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
                    brigades={store.brigades}
                    brigadeNamesKa={store.brigadeNamesKa}
                    brigadeSearch={brigadeSearch}
                    selectedBrigades={selectedBrigades}
                    structuralUnits={timesheetUnits}
                    unitSearch={unitSearch}
                    selectedUnits={selectedUnits}
                    showUnassignedUnit={showUnassignedUnit}
                    groupMode={groupMode}
                    showUnitFilters={!workshopMasterMode}
                    showGroupModeToggle={!workshopMasterMode}
                    display={viewDisplay}
                    layout="plan"
                    onBrigadeSearch={onBrigadeSearch}
                    onSelectedBrigades={onSelectedBrigades}
                    onUnitSearch={onUnitSearch}
                    onSelectedUnits={onSelectedUnits}
                    onGroupMode={onGroupMode}
                    onDisplay={onViewDisplay}
                  />
                </div>
              ),
            },
            {
              id: 'legend',
              label: t('legend.codes'),
              summary: t('month.accordion.legendSummary'),
              children: <CodeLegendBar />,
            },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-sky-200/80 bg-white shadow-md">
          <PlanFactTable
            {...tableProps}
            store={store}
            sheet={sheet}
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
            onCycle={onCycle}
            onSetCode={onSetCode}
          />
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
