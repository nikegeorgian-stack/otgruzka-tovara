import { useEffect, useMemo, useRef, useState } from 'react'
import { HotkeysHelp } from '@/components/help/HotkeysHelp'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { OnboardingTour } from '@/components/help/OnboardingTour'
import { BrigadesManageModal } from '@/components/month/BrigadesManageModal'
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
import { PlanEditorWindow } from '@/components/month/PlanEditorWindow'
import { PlanFactTable } from '@/components/month/PlanFactTable'
import { TimesheetSection } from '@/components/month/TimesheetSection'
import { PrintPreviewModal, type PrintConfig } from '@/components/print/PrintPreviewModal'
import { PrintSetupModal } from '@/components/print/PrintSetupModal'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { getCellComment, type CopyPlanToFactScope } from '@/lib/bulkOps'
import { formatMonthTitle } from '@/lib/dates'
import { isMonthArchived } from '@/lib/monthManage'
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
import type { AppStore, DaySubstitution, Employee } from '@/lib/types'

export type MonthViewLayout = 'dual' | 'plan' | 'fact'

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
  onUpsertEmployee: (employee: Employee) => void
  onTourComplete: () => void
  workshopMasterMode?: boolean
  workshopMasterLogin?: string
  workshopMasterEmployeeId?: string
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
  onSetBrigadeRoster,
  onChangeGroup2x2,
  onSetCycleFromDay,
  onSetBrigadier,
  onUpsertEmployee,
  workshopMasterMode = false,
  workshopMasterLogin,
  workshopMasterEmployeeId,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [layout, setLayout] = useState<MonthViewLayout>('dual')
  const [printStep, setPrintStep] = useState<'off' | 'setup' | 'preview'>('off')
  const [printConfig, setPrintConfig] = useState<PrintConfig | null>(null)
  const masterBrigades = useMemo(
    () => resolveWorkshopMasterBrigades(store, workshopMasterLogin, workshopMasterEmployeeId),
    [store, workshopMasterLogin, workshopMasterEmployeeId],
  )
  const [groupMode, setGroupMode] = useState<MonthGroupMode>('brigade')
  const [search, setSearch] = useState('')
  const [brigadeSearch, setBrigadeSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(() =>
    new Set(workshopMasterMode ? masterBrigades : store.brigades),
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
    showUnit: !workshopMasterMode,
  }))
  const [filterSchedule, setFilterSchedule] = useState('')
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
  const [fillBrigade, setFillBrigade] = useState<string | null>(null)
  const [planEditorOpen, setPlanEditorOpen] = useState(false)
  const [attendanceLogOpen, setAttendanceLogOpen] = useState(false)
  const employeeEditor = useEmployeeEditor(store.brigades, store.employees)

  function openPlanEditor() {
    setEditing(true)
    setPlanEditorOpen(true)
  }

  const prevBrigadesRef = useRef(store.brigades)

  useEffect(() => {
    setEditing(false)
    setGroupMode('brigade')
    setSelectedBrigades(
      new Set(workshopMasterMode ? masterBrigades : store.brigades),
    )
    if (!workshopMasterMode) {
      setSelectedUnits(new Set(allUnitKeys))
    }
    prevBrigadesRef.current = store.brigades
  }, [month, allUnitKeys, masterBrigades, store.brigades, workshopMasterMode])

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

  useEffect(() => {
    setSelectedUnits((selected) => {
      const next = new Set(selected)
      for (const key of allUnitKeys) next.add(key)
      for (const key of [...next]) {
        if (!allUnitKeys.includes(key)) next.delete(key)
      }
      return next
    })
  }, [allUnitKeys])

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

  if (!sheet) {
    return <div className="p-8 text-stone-500">{t('month.loading')}</div>
  }

  const stats = monthStats(sheet, store.employees, statsFilter)
  const archived = isMonthArchived(store, month)

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

  const filterBrigade = singleSelectedBrigade(selectedBrigades)

  const attendanceLogEmployees = useMemo(() => {
    if (!workshopMasterMode) return store.employees
    const fromSelected = employeesInBrigades(store.employees, [...selectedBrigades])
    if (fromSelected.length > 0) return fromSelected
    return employeesInBrigades(store.employees, masterBrigades)
  }, [masterBrigades, selectedBrigades, store.employees, workshopMasterMode])

  const tableProps = {
    store,
    sheet,
    search,
    selectedBrigades,
    brigadeSearch,
    selectedUnits,
    allUnitKeys,
    filterSchedule,
    groupMode,
    display: viewDisplay,
    readOnly: !editing,
    onAssign,
    onRegenerateRow,
    onAddRow,
    onRemoveRow,
    onRemoveEmptyRow,
    onCommentRequest: (rowId: string, dateKey: string) =>
      setCommentTarget({ rowId, dateKey }),
    onSubstitutionRequest: (rowId: string, dateKey: string) =>
      setSubstitutionTarget({ rowId, dateKey }),
    onFillBrigade: (brigade: string) => setFillBrigade(brigade),
    onChangeGroup2x2,
    onSetCycleFromDay,
    onSetBrigadier,
    onAddEmployee: (rowId: string, brigade: string) => {
      employeeEditor.openNew({ brigade, assignToRowId: rowId })
    },
  }

  return (
    <PageLayout className="month-page print:p-2">
      {notice && (
        <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <PageHeader
        badge={t('app.title')}
        title={formatMonthTitle(month, locale)}
        subtitle={`${t('print.site')}: ${store.settings.site}${store.settings.responsible ? ` · ${store.settings.responsible}` : ''}`}
        meta={
          archived ? (
            <span
              className="inline-flex rounded-sm bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600"
              title={t('month.archivedHint')}
            >
              {t('month.archive')}
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
              variant={editing ? 'success' : 'primary'}
              size="sm"
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? t('month.editDone') : t('month.edit')}
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
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegenerateMonth}
              disabled={!editing}
              title={!editing ? t('month.editToChange') : undefined}
            >
              {t('month.regenerate')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBrigadesOpen(true)}
              title={t('month.brigadesManageHint')}
              disabled={workshopMasterMode}
              className={workshopMasterMode ? 'hidden' : undefined}
            >
              {t('month.brigadesManage')}
            </Button>
            {workshopMasterMode ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttendanceLogOpen(true)}
                title={t('hr.attendanceLog.panelHint')}
              >
                {t('hr.attendanceLog.open')}
              </Button>
            ) : null}
            <Button variant="print" size="sm" onClick={() => setPrintStep('setup')}>
              {t('common.print')}
            </Button>
          </>
        }
      />

      {!editing && (
        <p className="rounded-sm border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600 print:hidden">
          {workshopMasterMode ? t('month.masterViewHint') : t('month.viewModeHint')}
        </p>
      )}

      <MonthToolsBar
        brigades={store.brigades}
        shiftTemplates={store.shiftTemplates}
        search={search}
        filterBrigade={filterBrigade}
        filterSchedule={filterSchedule}
        readOnly={!editing}
        readOnlyHint={t('month.editToChange')}
        onSearch={setSearch}
        onFilterSchedule={setFilterSchedule}
        onBulkHolidayV={handleBulkHolidayV}
        onBulkCopyPlanToFact={handleBulkCopyPlanToFact}
        onApplyShiftTemplate={handleApplyShiftTemplate}
        onExportExcel={onExportExcel}
        onShowHotkeys={() => setShowHotkeys(true)}
      />

      <MonthProblemsBar store={store} sheet={sheet} />

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

      <MonthKpiBar stats={stats} />
      <CodeLegendBar />

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
              onTourComplete()
            } else setTourStep(tourStep + 1)
          }}
          onSkip={() => {
            setTourStep(99)
            onTourComplete()
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
      {brigadesOpen && (
        <BrigadesManageModal
          store={store}
          onClose={() => setBrigadesOpen(false)}
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
        />
      )}
    </PageLayout>
  )
}
