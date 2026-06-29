import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CodeLegendBar } from '@/components/month/CodeLegendBar'
import { MonthDisplayBar } from '@/components/month/MonthDisplayBar'
import { PlanFactTable } from '@/components/month/PlanFactTable'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle, shiftMonth } from '@/lib/dates'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import type { MonthGroupMode, MonthViewDisplay } from '@/lib/monthViewOptions'
import type { AppStore, MonthSheet } from '@/lib/types'
import type { ComponentProps } from 'react'

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
  const { t, locale } = useI18n()

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex flex-col bg-[#f5f3ef]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-editor-title"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-grid bg-white px-4 py-3 shadow-sm">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
          <h2
            id="plan-editor-title"
            className="text-base font-bold capitalize text-ink sm:text-lg"
          >
            {t('month.planEditorTitle')} · {formatMonthTitle(month, locale)}
          </h2>
          <div className="flex rounded-sm border border-grid bg-paper">
            <button
              type="button"
              className="px-2.5 py-1.5 text-stone-600 hover:bg-paper-dark"
              onClick={() => onMonthChange(shiftMonth(month, -1))}
              title={t('month.prevMonth')}
            >
              ‹
            </button>
            <button
              type="button"
              className="px-2.5 py-1.5 text-stone-600 hover:bg-paper-dark"
              onClick={() => onMonthChange(shiftMonth(month, 1))}
              title={t('month.nextMonth')}
            >
              ›
            </button>
          </div>
        </div>

        <input
          type="search"
          className="min-w-[10rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm sm:max-w-xs"
          placeholder={t('month.searchEmployee')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <select
          className="rounded-sm border border-grid px-2 py-2 text-sm"
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

        <button
          type="button"
          className={`rounded-sm px-3 py-2 text-sm font-semibold ${
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
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm font-medium hover:bg-paper-dark disabled:opacity-50"
          onClick={onRegenerateMonth}
          disabled={!editing}
          title={!editing ? t('month.editToChange') : t('month.regenerate')}
        >
          {t('month.regenerate')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-stone-300 bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
          onClick={onClose}
          title={t('month.planEditorEsc')}
        >
          {t('month.planEditorClose')}
        </button>
      </header>

      <p className="shrink-0 border-b border-sky-200/60 bg-sky-50 px-4 py-1.5 text-xs text-sky-900">
        {t('month.planHint')} {t('month.planEditorScrollHint')}
      </p>

      <div className="shrink-0 px-3 pt-2">
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

      <div className="flex min-h-0 flex-1 flex-col p-3 pt-2">
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

      <footer className="shrink-0 border-t border-grid bg-white px-4 py-2">
        <CodeLegendBar compact />
      </footer>
    </div>,
    document.body,
  )
}
