import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HotkeysHelp } from '@/components/help/HotkeysHelp'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageActionOverflow } from '@/components/ui/PageActionOverflow'
import { monthProblems } from '@/lib/problems'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { OnboardingTour } from '@/components/help/OnboardingTour'
import { BrigadesManageModal } from '@/components/month/BrigadesManageModal'
import { DayRollCallModal } from '@/components/month/DayRollCallModal'
import { BrigadeFillModal } from '@/components/month/BrigadeFillModal'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import { AttendanceLogPrintModal } from '@/components/hr/AttendanceLogPrintModal'
import { CellCommentModal } from '@/components/month/CellCommentModal'
import { SubstitutionModal } from '@/components/month/SubstitutionModal'
import { FormNotice } from '@/components/ui/FormNotice'
import { CodeLegendBar } from '@/components/month/CodeLegendBar'
import { MonthDisplayBar } from '@/components/month/MonthDisplayBar'
import { MonthKpiBar } from '@/components/month/MonthKpiBar'
import { MonthProblemsBar } from '@/components/month/MonthProblemsBar'
import { MonthToolsBar } from '@/components/month/MonthToolsBar'
import { MonthViewDefaultsDialog } from '@/components/month/MonthViewDefaultsDialog'
import {
  MonthWorkspaceAccordion,
  useMonthAccordionSections,
} from '@/components/month/MonthWorkspaceAccordion'
import { PlanEditorWindow } from '@/components/month/PlanEditorWindow'
import { PlanFactTable } from '@/components/month/PlanFactTable'
import { TimesheetSection } from '@/components/month/TimesheetSection'
import { PrintPreviewModal, type PrintConfig } from '@/components/print/PrintPreviewModal'
import { PrintSetupModal } from '@/components/print/PrintSetupModal'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { getCellComment, type CopyPlanToFactScope } from '@/lib/bulkOps'
import { formatMonthTitle } from '@/lib/dates'
import { isMonthArchived, isMonthClosed, monthClosureInfo } from '@/lib/monthManage'
import {
  DEFAULT_MONTH_VIEW_DISPLAY,
  singleSelectedBrigade,
  structuralUnitFilterActive,
  structuralUnitFilterKeys,
  NO_STRUCTURAL_UNIT_ID,
  type MonthGroupMode,
  type MonthViewDisplay,
} from '@/lib/monthViewOptions'
import type { MonthStatsFilter } from '@/lib/stats'
import { monthStats } from '@/lib/stats'
import {
  employeesInBrigades,
  resolveWorkshopMasterBrigades,
  timesheetStructuralUnits,
} from '@/lib/workshopMasterScope'
import type { MonthViewDefaults, MonthViewLayout } from '@/lib/viewDefaults/types'
import {
  DEFAULT_MONTH_ROW_SORT,
  type MonthRowSort,
} from '@/lib/monthRowSort'
import type { AppStore, DaySubstitution, Employee } from '@/lib/types'

export type { MonthViewLayout }

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  onPatch: (fn: (s: AppStore) => AppStore) => void
  onCycle: (rowId: string, dateKey: string, mode: 'plan' | 'fact') => void
  onSetCode: (
    rowId: string,
    dateKey: string,
    code: import('@/lib/types').DayCode,
    mode: 'plan' | 'fact',
  ) => void
  onSetFactExtra: (rowId: string, dateKey: string, hours: number) => void
  onAssign: (rowId: string, employeeId: string | null) => void
  onRegenerateRow: (rowId: string) => void
  onAddRow: (brigade: string) => void
  onRemoveRow: (rowId: string) => void
  onRemoveEmptyRow: (brigade: string) => void
  onRegenerateMonth: () => void
  onBulkHolidayV: () => void
  onBulkCopyPlanToFact: (scope: CopyPlanToFactScope, brigade?: string) => void
  onApplyShiftTemplate: (templateId: string, brigade: string) => void
  onExportExcel: () => void
  onSetComment: (rowId: string, dateKey: string, text: string) => void
  onSetSubstitution: (
    rowId: string,
    dateKey: string,
    sub: DaySubstitution,
  ) => { warningNoRow?: boolean }
  onClearSubstitution: (rowId: string, dateKey: string) => void
  onAddBrigade: (name: string) => void
  onRenameBrigade: (oldName: string, newName: string) => void
  onRemoveBrigade: (name: string) => void
  onSetBrigadeNameKa: (nameRu: string, nameKa: string) => void
  onSetBrigadeUnit: (brigade: string, unitId: string | null) => void
  onSetBrigadeRoster: (
    brigade: string,
    employeeIds: string[],
    syncHr: boolean,
  ) => void
  onChangeGroup2x2: (rowId: string, employeeId: string, group: 'А' | 'Б') => void
  onSetCycleFromDay: (
    rowId: string,
    employeeId: string,
    day: number,
    variant: 'first' | 'last',
  ) => void
  onSetBrigadier: (brigade: string, employeeId: string | null) => void
  onMarkBrigadier: (rowId: string, dateKey: string, on: boolean) => void
  onMarkBrigadierMonth: (rowId: string, on: boolean) => void
  onSetFactHours: (rowId: string, dateKey: string, hours: number | null) => void
  onAddDayWorker: (
    brigade: string,
    employeeId: string,
    dateKey: string,
    code: import('@/lib/types').DayCode,
  ) => void
  onAssignPermanent: (employeeId: string, brigade: string) => void
  onUpsertEmployee: (employee: Employee) => void
  onTourComplete: () => void
  /** Закрыть месяц (зафиксировать план/факт) */
  onCloseMonth?: () => void
  /** Переоткрыть закрытый месяц (только директор/админ) */
  onReopenMonth?: () => void
  /** Может ли текущий пользователь переоткрывать закрытый месяц */
  canReopen?: boolean
  workshopMasterMode?: boolean
  workshopMasterLogin?: string
  workshopMasterEmployeeId?: string
  userDefaultBrigades?: string[]
  userMonthDefaults?: MonthViewDefaults
  currentUserId?: string
  onSaveMonthDefaults?: (defaults: MonthViewDefaults) => void
}

export function MonthPage({
  store,
  month,
  onMonthChange,
  onPatch: _onPatch,
  onCycle,
  onSetCode,
  onSetFactExtra,
  onAssign,
  onRegenerateRow,
  onAddRow,
  onRemoveRow,
  onRemoveEmptyRow,
  onRegenerateMonth,
  onBulkHolidayV,
  onBulkCopyPlanToFact,
  onApplyShiftTemplate,
  onExportExcel,
  onSetComment,
  onSetSubstitution,
  onClearSubstitution,
  onTourComplete,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeUnit,
  onSetBrigadeRoster,
  onChangeGroup2x2,
  onSetCycleFromDay,
  onSetBrigadier,
  onMarkBrigadier,
  onMarkBrigadierMonth,
  onSetFactHours,
  onAddDayWorker,
  onAssignPermanent,
  onUpsertEmployee,
  onCloseMonth,
  onReopenMonth,
  canReopen = false,
  workshopMasterMode = false,
  workshopMasterLogin,
  workshopMasterEmployeeId,
  userDefaultBrigades,
  userMonthDefaults,
  currentUserId,
  onSaveMonthDefaults,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [layout, setLayout] = useState<MonthViewLayout>(userMonthDefaults?.layout ?? 'dual')
  const [printStep, setPrintStep] = useState<'off' | 'setup' | 'preview'>('off')
  const [printConfig, setPrintConfig] = useState<PrintConfig | null>(null)
  const preferredBrigades = userMonthDefaults?.defaultBrigades ?? userDefaultBrigades
  const masterBrigades = useMemo(
    () =>
      resolveWorkshopMasterBrigades(
        store,
        workshopMasterLogin,
        workshopMasterEmployeeId,
        preferredBrigades,
      ),
    [store, workshopMasterLogin, workshopMasterEmployeeId, preferredBrigades],
  )
  const defaultBrigadeFilter = useMemo(() => {
    if (preferredBrigades?.length) {
      const mapped = preferredBrigades.filter((b) => store.brigades.includes(b))
      if (mapped.length > 0) return mapped
    }
    if (workshopMasterMode) return masterBrigades
    return store.brigades
  }, [preferredBrigades, workshopMasterMode, masterBrigades, store.brigades])
  const [groupMode, setGroupMode] = useState<MonthGroupMode>(
    userMonthDefaults?.groupMode ?? 'brigade',
  )
  const [search, setSearch] = useState('')
  const [brigadeSearch, setBrigadeSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(() =>
    new Set(defaultBrigadeFilter),
  )
  const timesheetUnits = useMemo(
    () => timesheetStructuralUnits(store.hrStructuralUnits, workshopMasterMode),
    [store.hrStructuralUnits, workshopMasterMode],
  )
  const allUnitKeys = useMemo(
    () =>
      workshopMasterMode
        ? []
        : structuralUnitFilterKeys(timesheetUnits, store.employees),
    [timesheetUnits, store.employees, workshopMasterMode],
  )
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(
    () => new Set(allUnitKeys),
  )
  const showUnassignedUnit = allUnitKeys.includes(NO_STRUCTURAL_UNIT_ID)
  const [viewDisplay, setViewDisplay] = useState<MonthViewDisplay>(() => ({
    ...DEFAULT_MONTH_VIEW_DISPLAY,
    ...userMonthDefaults?.viewDisplay,
    showUnit: workshopMasterMode ? false : (userMonthDefaults?.viewDisplay?.showUnit ?? true),
  }))
  const [filterSchedule, setFilterSchedule] = useState('')
  const [rowSort, setRowSort] = useState<MonthRowSort>(
    () => userMonthDefaults?.rowSort ?? DEFAULT_MONTH_ROW_SORT,
  )
  const [showHotkeys, setShowHotkeys] = useState(false)
  const [tourStep, setTourStep] = useState(
    () => (store.settings.tourCompleted ? 99 : 0),
  )
  const [commentTarget, setCommentTarget] = useState<{
    rowId: string
    dateKey: string
  } | null>(null)
  const [substitutionTarget, setSubstitutionTarget] = useState<{
    rowId: string
    dateKey: string
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [brigadesOpen, setBrigadesOpen] = useState(false)
  const [rollCallOpen, setRollCallOpen] = useState(false)
  const [fillBrigade, setFillBrigade] = useState<string | null>(null)
  const [planEditorOpen, setPlanEditorOpen] = useState(false)
  const [attendanceLogOpen, setAttendanceLogOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const accordion = useMonthAccordionSections()
  const employeeEditor = useEmployeeEditor(store.brigades, store.employees)

  function applyMonthDefaults(defaults: MonthViewDefaults) {
    if (defaults.layout) setLayout(defaults.layout)
    if (defaults.groupMode && !workshopMasterMode) setGroupMode(defaults.groupMode)
    if (defaults.viewDisplay) {
      setViewDisplay((prev) => ({
        ...prev,
        ...defaults.viewDisplay,
        showUnit: workshopMasterMode ? false : (defaults.viewDisplay?.showUnit ?? prev.showUnit),
      }))
    }
    if (defaults.defaultBrigades?.length) {
      const mapped = defaults.defaultBrigades.filter((b) => store.brigades.includes(b))
      if (mapped.length > 0) setSelectedBrigades(new Set(mapped))
    }
    if (defaults.rowSort) setRowSort(defaults.rowSort)
  }

  function openPlanEditor() {
    setEditing(true)
    setPlanEditorOpen(true)
  }

  const prevBrigadesRef = useRef(store.brigades)

  useEffect(() => {
    setEditing(false)
    setGroupMode(userMonthDefaults?.groupMode ?? 'brigade')
    setLayout(userMonthDefaults?.layout ?? 'dual')
    setViewDisplay({
      ...DEFAULT_MONTH_VIEW_DISPLAY,
      ...userMonthDefaults?.viewDisplay,
      showUnit: workshopMasterMode ? false : (userMonthDefaults?.viewDisplay?.showUnit ?? true),
    })
    setRowSort(userMonthDefaults?.rowSort ?? DEFAULT_MONTH_ROW_SORT)
    setSelectedBrigades(new Set(defaultBrigadeFilter))
    if (!workshopMasterMode) {
      setSelectedUnits(new Set(allUnitKeys))
    }
    prevBrigadesRef.current = store.brigades
  }, [
    month,
    allUnitKeys,
    defaultBrigadeFilter,
    masterBrigades,
    store.brigades,
    workshopMasterMode,
    userMonthDefaults,
  ])

  useEffect(() => {
    const prev = prevBrigadesRef.current
    const curr = store.brigades
    if (prev.length === curr.length && prev.every((b, i) => b === curr[i])) return

    setSelectedBrigades((selected) => {
      const next = new Set(selected)
      for (const b of prev) {
        if (!curr.includes(b)) next.delete(b)
      }
      for (const b of curr) {
        if (!prev.includes(b)) next.add(b)
      }
      if (workshopMasterMode && next.size === 0) {
        for (const b of masterBrigades) {
          if (curr.includes(b)) next.add(b)
        }
      }
      return next
    })
    prevBrigadesRef.current = curr
  }, [store.brigades, workshopMasterMode, masterBrigades])

  const allUnitKeysKey = allUnitKeys.join('\0')

  useEffect(() => {
    setSelectedUnits((selected) => {
      const next = new Set(selected)
      for (const key of allUnitKeys) next.add(key)
      for (const key of [...next]) {
        if (!allUnitKeys.includes(key)) next.delete(key)
      }
      if (next.size === selected.size && [...next].every((key) => selected.has(key))) {
        return selected
      }
      return next
    })
  }, [allUnitKeysKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey) setShowHotkeys(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statsFilter = useMemo((): MonthStatsFilter | undefined => {
    const filter: MonthStatsFilter = {}
    if (selectedBrigades.size < store.brigades.length) {
      filter.brigades = [...selectedBrigades]
    }
    if (structuralUnitFilterActive(selectedUnits, allUnitKeys)) {
      filter.structuralUnitIds = [...selectedUnits]
    }
    return filter.brigades || filter.structuralUnitIds ? filter : undefined
  }, [allUnitKeys, selectedBrigades, selectedUnits, store.brigades.length])

  const sheet = store.months[month]
  const closed = sheet ? isMonthClosed(store, month) : false
  const effectiveEditing = editing && !closed

  function handleRegenerateMonth() {
    onRegenerateMonth()
  }

  async function handleBulkHolidayV() {
    if (!(await confirm({ message: t('month.confirmBulkHoliday') }))) return
    onBulkHolidayV()
  }

  async function handleBulkCopyPlanToFact(scope: CopyPlanToFactScope, brigade?: string) {
    const msg =
      scope === 'all'
        ? t('month.confirmBulkCopyAll')
        : scope === '52'
          ? t('month.confirmBulkCopy52')
          : scope === '22'
            ? t('month.confirmBulkCopy22')
            : tf('month.confirmBulkCopyBrigade', { brigade: brigade ?? '' })
    if (!(await confirm({ message: msg }))) return
    onBulkCopyPlanToFact(scope, brigade)
  }

  async function handleApplyShiftTemplate(templateId: string, brigade: string) {
    const tpl = store.shiftTemplates.find((x) => x.id === templateId)
    if (
      !(await confirm({
        message: tf('month.confirmShiftTemplate', { brigade, template: tpl?.name ?? templateId }),
      }))
    ) {
      return
    }
    onApplyShiftTemplate(templateId, brigade)
  }

  async function handleCloseMonth() {
    if (!onCloseMonth) return
    if (!(await confirm({ message: t('month.confirmClose'), danger: true }))) return
    setEditing(false)
    onCloseMonth()
  }

  async function handleReopenMonth() {
    if (!onReopenMonth) return
    if (!(await confirm({ message: t('month.confirmReopen'), danger: true }))) return
    onReopenMonth()
  }

  const filterBrigade = singleSelectedBrigade(selectedBrigades)

  const timesheetStore = useMemo(
    () => store,
    [
      store.employees,
      store.brigades,
      store.brigadeNamesKa,
      store.brigadeUnits,
      store.brigadiers,
      store.hrStructuralUnits,
    ],
  )

  const onCommentRequest = useCallback((rowId: string, dateKey: string) => {
    setCommentTarget({ rowId, dateKey })
  }, [])

  const onSubstitutionRequest = useCallback((rowId: string, dateKey: string) => {
    setSubstitutionTarget({ rowId, dateKey })
  }, [])

  const onFillBrigadeRequest = useCallback((brigade: string) => {
    setFillBrigade(brigade)
  }, [])

  const onAddEmployeeFromTable = useCallback(
    (rowId: string, brigade: string) => {
      employeeEditor.openNew({ brigade, assignToRowId: rowId })
    },
    [employeeEditor],
  )

  const handleRowSortChange = useCallback(
    (sort: MonthRowSort) => {
      setRowSort(sort)
      onSaveMonthDefaults?.({
        ...userMonthDefaults,
        layout,
        groupMode,
        defaultBrigades: [...selectedBrigades],
        viewDisplay,
        rowSort: sort,
      })
    },
    [
      onSaveMonthDefaults,
      userMonthDefaults,
      layout,
      groupMode,
      selectedBrigades,
      viewDisplay,
    ],
  )

  const tableProps = useMemo(
    () => {
      if (!sheet) return null
      return {
      store: timesheetStore,
      sheet,
      search,
      selectedBrigades,
      brigadeSearch,
      selectedUnits,
      allUnitKeys,
      filterSchedule,
      groupMode,
      display: viewDisplay,
      rowSort,
      onRowSortChange: handleRowSortChange,
      readOnly: !effectiveEditing,
      onAssign,
      onRegenerateRow,
      onAddRow,
      onRemoveRow,
      onRemoveEmptyRow,
      onCommentRequest,
      onSubstitutionRequest,
      onFillBrigade: onFillBrigadeRequest,
      onChangeGroup2x2,
      onSetCycleFromDay,
      onSetBrigadier,
      onMarkBrigadier,
      onMarkBrigadierMonth,
      onAddEmployee: onAddEmployeeFromTable,
      }
    },
    [
      timesheetStore,
      sheet,
      search,
      selectedBrigades,
      brigadeSearch,
      selectedUnits,
      allUnitKeys,
      filterSchedule,
      groupMode,
      viewDisplay,
      rowSort,
      handleRowSortChange,
      effectiveEditing,
      onAssign,
      onRegenerateRow,
      onAddRow,
      onRemoveRow,
      onRemoveEmptyRow,
      onCommentRequest,
      onSubstitutionRequest,
      onFillBrigadeRequest,
      onChangeGroup2x2,
      onSetCycleFromDay,
      onSetBrigadier,
      onMarkBrigadier,
      onMarkBrigadierMonth,
      onAddEmployeeFromTable,
    ],
  )

  const attendanceLogEmployees = useMemo(() => {
    if (!workshopMasterMode) return store.employees
    const fromSelected = employeesInBrigades(store.employees, [...selectedBrigades])
    if (fromSelected.length > 0) return fromSelected
    return employeesInBrigades(store.employees, masterBrigades)
  }, [masterBrigades, selectedBrigades, store.employees, workshopMasterMode])

  const overflowItems = [
    {
      id: 'regenerate',
      label: t('month.regenerate'),
      onClick: handleRegenerateMonth,
      disabled: !effectiveEditing,
      title: !effectiveEditing ? t('month.editToChange') : undefined,
    },
    {
      id: 'brigades',
      label: t('month.brigadesManage'),
      onClick: () => setBrigadesOpen(true),
      disabled: workshopMasterMode,
      hidden: workshopMasterMode,
      title: t('month.brigadesManageHint'),
    },
    {
      id: 'rollcall',
      label: t('rollcall.open'),
      onClick: () => setRollCallOpen(true),
      disabled: closed,
      title: t('rollcall.hint'),
    },
    {
      id: 'attendance',
      label: t('hr.attendanceLog.open'),
      onClick: () => setAttendanceLogOpen(true),
      hidden: !workshopMasterMode,
      title: t('hr.attendanceLog.panelHint'),
    },
    {
      id: 'print',
      label: t('common.print'),
      onClick: () => setPrintStep('setup'),
    },
    {
      id: 'defaults',
      label: t('month.defaults.open'),
      onClick: () => setDefaultsOpen(true),
      hidden: !(currentUserId && onSaveMonthDefaults),
      title: t('month.defaults.openHint'),
    },
    {
      id: 'close',
      label: t('month.close'),
      onClick: handleCloseMonth,
      hidden: closed || !onCloseMonth || workshopMasterMode,
      title: t('month.closeHint'),
    },
    {
      id: 'reopen',
      label: t('month.reopen'),
      onClick: handleReopenMonth,
      hidden: !(closed && canReopen && onReopenMonth),
      title: t('month.reopenHint'),
    },
  ]

  if (!sheet) {
    return <div className="p-8 text-stone-500">{t('month.loading')}</div>
  }

  const stats = monthStats(sheet, store.employees, statsFilter)
  const problems = monthProblems(store, sheet)
  const archived = isMonthArchived(store, month)
  const closure = monthClosureInfo(store, month)

  return (
    <PageLayout className="month-page print:p-2">
      {notice && (
        <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <PageHeader
        density="compact"
        showBrand={false}
        title={formatMonthTitle(month, locale)}
        subtitle={store.settings.site}
        meta={
          closed ? (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
              title={t('month.closedHint')}
            >
              🔒 {t('month.closed')}
            </span>
          ) : archived ? (
            <span
              className="inline-flex rounded-sm bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600"
              title={t('month.archivedHint')}
            >
              {t('month.archive')}
            </span>
          ) : !effectiveEditing ? (
            <span className="text-[10px] text-stone-500">
              {workshopMasterMode ? t('month.masterViewHint') : t('month.viewModeHint')}
            </span>
          ) : undefined
        }
        actions={
          <>
            <MonthNavigator month={month} onChange={onMonthChange} />
            <Button
              variant="secondary"
              size="sm"
              className="!border-sky-300 !bg-sky-50 !text-sky-900 hover:!bg-sky-100"
              onClick={openPlanEditor}
              title={t('month.planEditorHint')}
            >
              {t('month.planEditor')}
            </Button>
            <Button
              variant={effectiveEditing ? 'success' : 'primary'}
              size="sm"
              onClick={() => setEditing((e) => !e)}
              disabled={closed}
              title={closed ? t('month.closedEditBlocked') : undefined}
            >
              {effectiveEditing ? t('month.editDone') : t('month.edit')}
            </Button>
            <TabBar
              tabs={(
                [
                  ['dual', t('month.overview')],
                  ['plan', t('month.plan')],
                  ['fact', t('month.fact')],
                ] as const
              ).map(([id, label]) => ({ id, label }))}
              value={layout}
              onChange={setLayout}
            />
            <PageActionOverflow items={overflowItems} />
          </>
        }
      />

      {closed ? (
        <p className="rounded-sm border border-amber-200 bg-amber-50/90 px-3 py-1.5 text-xs text-amber-900 print:hidden">
          🔒{' '}
          {closure?.byName
            ? tf('month.closedBannerBy', {
                who: closure.byName,
                date: closure.at ? closure.at.slice(0, 10) : '',
              })
            : t('month.closedBanner')}
          {!canReopen && ` ${t('month.closedReopenAdmin')}`}
        </p>
      ) : null}

      <div className="month-search-bar print:hidden">
        <input
          className="month-search-bar__input"
          type="search"
          placeholder={t('month.searchEmployee')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <MonthWorkspaceAccordion
        open={accordion.open}
        onToggle={accordion.toggle}
        items={[
          {
            id: 'filters',
            label: t('workspace.widget.filters'),
            summary: tf('workspace.chip.brigades', {
              count: selectedBrigades.size,
              total: store.brigades.length,
            }),
            children: (
              <MonthDisplayBar
                brigades={store.brigades}
                brigadeNamesKa={store.brigadeNamesKa}
                brigadeSearch={brigadeSearch}
                selectedBrigades={selectedBrigades}
                primaryBrigades={workshopMasterMode ? masterBrigades : undefined}
                structuralUnits={timesheetUnits}
                unitSearch={unitSearch}
                selectedUnits={selectedUnits}
                showUnassignedUnit={showUnassignedUnit}
                groupMode={groupMode}
                showUnitFilters={!workshopMasterMode}
                showGroupModeToggle={!workshopMasterMode}
                display={viewDisplay}
                layout={layout}
                onBrigadeSearch={setBrigadeSearch}
                onSelectedBrigades={setSelectedBrigades}
                onUnitSearch={setUnitSearch}
                onSelectedUnits={setSelectedUnits}
                onGroupMode={setGroupMode}
                onDisplay={(patch) => setViewDisplay((prev) => ({ ...prev, ...patch }))}
              />
            ),
          },
          {
            id: 'operations',
            label: t('workspace.widget.operations'),
            summary: t('month.accordion.opsSummary'),
            children: (
              <MonthToolsBar
                brigades={store.brigades}
                shiftTemplates={store.shiftTemplates}
                search={search}
                filterBrigade={filterBrigade}
                filterSchedule={filterSchedule}
                readOnly={!effectiveEditing}
                readOnlyHint={closed ? t('month.closedEditBlocked') : t('month.editToChange')}
                onSearch={setSearch}
                onFilterSchedule={setFilterSchedule}
                onBulkHolidayV={handleBulkHolidayV}
                onBulkCopyPlanToFact={handleBulkCopyPlanToFact}
                onApplyShiftTemplate={handleApplyShiftTemplate}
                onExportExcel={onExportExcel}
                onShowHotkeys={() => setShowHotkeys(true)}
                hideSearch
              />
            ),
          },
          {
            id: 'analytics',
            label: t('workspace.widget.analytics'),
            summary:
              problems.length > 0
                ? `${tf('workspace.chip.stats', {
                    plan: stats.planHours,
                    fact: stats.factHours,
                    delta: stats.deviation,
                  })} · ${tf('workspace.chip.problems', { count: problems.length })}`
                : tf('workspace.chip.stats', {
                    plan: stats.planHours,
                    fact: stats.factHours,
                    delta: stats.deviation,
                  }),
            warn: problems.length > 0,
            children: (
              <div className="space-y-4">
                <MonthKpiBar stats={stats} />
                <MonthProblemsBar store={store} sheet={sheet} />
                <CodeLegendBar />
              </div>
            ),
          },
        ]}
      />

      {printStep === 'setup' && (
        <PrintSetupModal
          sheet={sheet}
          store={store}
          brigades={store.brigades}
          workshopMasterMode={workshopMasterMode}
          primaryBrigades={workshopMasterMode ? masterBrigades : undefined}
          initialConfig={printConfig}
          onClose={() => {
            setPrintStep('off')
            setPrintConfig(null)
          }}
          onConfirm={(config) => {
            setPrintConfig(config)
            setPrintStep('preview')
          }}
        />
      )}
      {printStep === 'preview' && printConfig && (
        <PrintPreviewModal
          store={store}
          sheet={sheet}
          config={printConfig}
          onClose={() => {
            setPrintStep('off')
            setPrintConfig(null)
          }}
          onBack={() => setPrintStep('setup')}
        />
      )}

      {layout === 'dual' ? (
        <div className="flex flex-col gap-6">
          {viewDisplay.showPlan && (
            <TimesheetSection
            title={t('month.planTitle')}
            subtitle={t('month.planHint')}
            tone="plan"
            headerAction={
              <button
                type="button"
                className="rounded-sm border border-sky-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-800 hover:bg-sky-50"
                onClick={openPlanEditor}
                title={t('month.planEditorHint')}
              >
                ⛶ {t('month.planEditor')}
              </button>
            }
          >
            <PlanFactTable
              {...tableProps}
              mode="plan"
              metaEditable
              assignEditable
              embedded
              onCycle={(rowId, dk) => onCycle(rowId, dk, 'plan')}
              onSetCode={(rowId, dk, code) => onSetCode(rowId, dk, code, 'plan')}
            />
          </TimesheetSection>
          )}
          {viewDisplay.showFact && (
          <TimesheetSection title={t('month.factTitle')} subtitle={t('month.factHint')} tone="fact">
            <PlanFactTable
              {...tableProps}
              mode="fact"
              metaEditable
              embedded
              onCycle={(rowId, dk) => onCycle(rowId, dk, 'fact')}
              onSetCode={(rowId, dk, code) => onSetCode(rowId, dk, code, 'fact')}
              onSetFactExtra={onSetFactExtra}
            />
          </TimesheetSection>
          )}
          {!viewDisplay.showPlan && !viewDisplay.showFact && (
            <p className="rounded-sm border border-grid bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
              {t('month.noSectionsSelected')}
            </p>
          )}
        </div>
      ) : (
        <TimesheetSection
          title={layout === 'plan' ? t('month.planTitle') : t('month.factTitle')}
          tone={layout}
        >
          <PlanFactTable
            {...tableProps}
            mode={layout}
            metaEditable={layout === 'plan'}
            assignEditable={layout === 'plan'}
            embedded
            onCycle={(rowId, dk) => onCycle(rowId, dk, layout)}
            onSetCode={(rowId, dk, code) => onSetCode(rowId, dk, code, layout)}
            onSetFactExtra={layout === 'fact' ? onSetFactExtra : undefined}
          />
        </TimesheetSection>
      )}

      {showHotkeys && <HotkeysHelp onClose={() => setShowHotkeys(false)} />}
      {tourStep < 5 && (
        <OnboardingTour
          step={tourStep}
          onNext={() => {
            if (tourStep + 1 >= 5) {
              setTourStep(99)
              startTransition(() => onTourComplete())
            } else {
              setTourStep(tourStep + 1)
            }
          }}
          onSkip={() => {
            setTourStep(99)
            startTransition(() => onTourComplete())
          }}
        />
      )}
      {commentTarget && (
        <CellCommentModal
          dateKey={commentTarget.dateKey}
          initial={getCellComment(sheet, commentTarget.rowId, commentTarget.dateKey)}
          onSave={(text) => onSetComment(commentTarget.rowId, commentTarget.dateKey, text)}
          onClose={() => setCommentTarget(null)}
        />
      )}
      {substitutionTarget && (
        <SubstitutionModal
          sheet={sheet}
          employees={store.employees}
          rowId={substitutionTarget.rowId}
          dateKey={substitutionTarget.dateKey}
          onSave={(sub) => {
            const { warningNoRow } = onSetSubstitution(
              substitutionTarget.rowId,
              substitutionTarget.dateKey,
              sub,
            )
            if (warningNoRow) setNotice(t('substitution.warnNoRow'))
          }}
          onClear={() =>
            onClearSubstitution(substitutionTarget.rowId, substitutionTarget.dateKey)
          }
          onClose={() => setSubstitutionTarget(null)}
        />
      )}
      {planEditorOpen && (
        <PlanEditorWindow
          store={store}
          sheet={sheet}
          month={month}
          editing={editing}
          search={search}
          selectedBrigades={selectedBrigades}
          brigadeSearch={brigadeSearch}
          selectedUnits={selectedUnits}
          allUnitKeys={allUnitKeys}
          unitSearch={unitSearch}
          showUnassignedUnit={showUnassignedUnit}
          groupMode={groupMode}
          timesheetUnits={timesheetUnits}
          workshopMasterMode={workshopMasterMode}
          filterSchedule={filterSchedule}
          viewDisplay={viewDisplay}
          onSearch={setSearch}
          onBrigadeSearch={setBrigadeSearch}
          onSelectedBrigades={setSelectedBrigades}
          onUnitSearch={setUnitSearch}
          onSelectedUnits={setSelectedUnits}
          onGroupMode={setGroupMode}
          onViewDisplay={(patch) => setViewDisplay((prev) => ({ ...prev, ...patch }))}
          onFilterSchedule={setFilterSchedule}
          onToggleEditing={() => setEditing((e) => !e)}
          onRegenerateMonth={handleRegenerateMonth}
          onMonthChange={onMonthChange}
          onClose={() => setPlanEditorOpen(false)}
          onCycle={(rowId, dateKey) => onCycle(rowId, dateKey, 'plan')}
          onSetCode={(rowId, dateKey, code) => onSetCode(rowId, dateKey, code, 'plan')}
          readOnly={!editing}
          onAssign={onAssign}
          onRegenerateRow={onRegenerateRow}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          onRemoveEmptyRow={onRemoveEmptyRow}
          onFillBrigade={(brigade) => setFillBrigade(brigade)}
          onChangeGroup2x2={onChangeGroup2x2}
          onSetCycleFromDay={onSetCycleFromDay}
          onSetBrigadier={onSetBrigadier}
          onMarkBrigadier={onMarkBrigadier}
          onMarkBrigadierMonth={onMarkBrigadierMonth}
          onCommentRequest={(rowId, dateKey) => setCommentTarget({ rowId, dateKey })}
          onSubstitutionRequest={(rowId, dateKey) =>
            setSubstitutionTarget({ rowId, dateKey })
          }
          onAddEmployee={tableProps.onAddEmployee}
        />
      )}
      {attendanceLogOpen && (
        <AttendanceLogPrintModal
          employees={attendanceLogEmployees}
          site={store.settings.site}
          responsible={store.settings.responsible}
          onClose={() => setAttendanceLogOpen(false)}
        />
      )}
      <EmployeeEditorHost
        ctx={employeeEditor.ctx}
        employees={store.employees}
        brigades={store.brigades}
        hrStructuralUnits={store.hrStructuralUnits}
        hrPositions={store.hrPositions}
        onSave={(emp) => {
          onUpsertEmployee(emp)
          const rowId = employeeEditor.ctx?.assignToRowId
          if (rowId) onAssign(rowId, emp.id)
          employeeEditor.close()
          if (rowId) setNotice(t('employee.picker.addedToPlan'))
        }}
        onClose={employeeEditor.close}
      />
      {brigadesOpen && (
        <BrigadesManageModal
          store={store}
          onClose={() => setBrigadesOpen(false)}
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
          onSetBrigadeUnit={onSetBrigadeUnit}
        />
      )}
      {rollCallOpen && (
        <DayRollCallModal
          store={store}
          month={month}
          defaultBrigades={defaultBrigadeFilter}
          onClose={() => setRollCallOpen(false)}
          onSetFact={(rowId, dateKey, code) => onSetCode(rowId, dateKey, code, 'fact')}
          onSetFactHours={onSetFactHours}
          onAddDayWorker={onAddDayWorker}
          onAssignPermanent={onAssignPermanent}
          onMarkBrigadier={onMarkBrigadier}
        />
      )}
      {fillBrigade && (
        <BrigadeFillModal
          store={store}
          sheet={sheet}
          brigade={fillBrigade}
          onSave={(ids, syncHr) => onSetBrigadeRoster(fillBrigade, ids, syncHr)}
          onUpsertEmployee={onUpsertEmployee}
          onClose={() => setFillBrigade(null)}
        />
      )}
      {defaultsOpen && currentUserId && onSaveMonthDefaults && (
        <MonthViewDefaultsDialog
          brigades={store.brigades}
          brigadeNamesKa={store.brigadeNamesKa}
          workshopMasterMode={workshopMasterMode}
          initial={{
            layout,
            groupMode,
            defaultBrigades: [...selectedBrigades],
            viewDisplay,
            rowSort,
          }}
          onSave={(defaults) => {
            onSaveMonthDefaults(defaults)
            applyMonthDefaults(defaults)
            setNotice(t('month.defaults.saved'))
          }}
          onClose={() => setDefaultsOpen(false)}
        />
      )}
    </PageLayout>
  )
}
