import { payrollReadiness, payrollReady } from '@/lib/finance/payrollReadiness'
import { timesheetDraftStorageKey } from '@/lib/timesheetDraftStorage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HotkeysHelp } from '@/components/help/HotkeysHelp'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageActionOverflow } from '@/components/ui/PageActionOverflow'
import { monthProblems } from '@/lib/problems'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { PlanFactModeSwitch } from '@/components/month/PlanFactModeSwitch'
import { useEmployeeEditorApi } from '@/context/EmployeeEditorContext'
import { BrigadesManageModal } from '@/components/month/BrigadesManageModal'
import { DayRollCallModal } from '@/components/month/DayRollCallModal'
import { NightShiftDayModal } from '@/components/month/NightShiftDayModal'
import { TimesheetAuditModal } from '@/components/month/TimesheetAuditModal'
import { BrigadeFillModal } from '@/components/month/BrigadeFillModal'
import { BrigadeTransferModal } from '@/components/month/BrigadeTransferModal'
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
import { MonthBrigadeWorkspace } from '@/components/month/MonthBrigadeWorkspace'
import { TimesheetSection } from '@/components/month/TimesheetSection'
import { PrintPreviewModal, type PrintConfig } from '@/components/print/PrintPreviewModal'
import { PrintSetupModal } from '@/components/print/PrintSetupModal'
import { TimesheetEntryDocModal } from '@/components/month/TimesheetEntryDocModal'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { brigadeLabel } from '@/lib/brigadeText'
import { getCellComment, countCopyPlanToFactPeople, countCopyPlanToFactEmptyCells, type CopyPlanToFactScope } from '@/lib/bulkOps'
import { monthStats, getFactMark } from '@/lib/stats'
import { nextCode } from '@/lib/codes'
import { useTimesheetEditHistory } from '@/hooks/useTimesheetEditHistory'
import { TimesheetHistoryControls } from '@/components/month/TimesheetHistoryControls'
import { TimesheetDraftReviewModal } from '@/components/month/TimesheetDraftReviewModal'
import { useTimesheetDraftSession } from '@/hooks/useTimesheetDraftSession'
import type { DayCode } from '@/lib/types'
import { formatMonthTitle } from '@/lib/dates'
import {
  activeCoveragesForUser,
  coveragesOverlappingMonthForUser,
  localTodayIsoDate,
} from '@/lib/access/workshopMasterCoverage'
import {
  buildCoverageFocusChips,
  type CoverageFocusId,
} from '@/lib/access/coverageFocus'
import { CoverageFocusBar } from '@/components/month/CoverageFocusBar'
import type { RemoteCellConflictInfo } from '@/lib/monthCellSnapshot'
import { canBypassMonthClose, isMonthArchived, isMonthClosed, monthClosureInfo } from '@/lib/monthManage'
import {
  resolveMonthViewDisplay,
  singleSelectedBrigade,
  structuralUnitFilterActive,
  structuralUnitFilterKeys,
  NO_STRUCTURAL_UNIT_ID,
  type MonthGroupMode,
  type MonthViewDisplay,
} from '@/lib/monthViewOptions'
import type { MonthStatsFilter } from '@/lib/stats'
import { absenceConfirmForEmployee } from '@/lib/absenceConfirm'
import {
  employeesInBrigades,
  resolveWorkshopMasterBrigades,
  timesheetStructuralUnits,
} from '@/lib/workshopMasterScope'
import {
  timesheetAccess,
  timesheetCanEdit,
} from '@/lib/access/timesheetScope'
import type { AppUser } from '@/lib/access/types'
import type { MonthViewDefaults, MonthViewLayout, MonthViewShell } from '@/lib/viewDefaults/types'
import {
  DEFAULT_MONTH_ROW_SORT,
  type MonthRowSort,
} from '@/lib/monthRowSort'
import type { AppStore, DaySubstitution, Employee } from '@/lib/types'

export type { MonthViewLayout, MonthViewShell }

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
  /** Несколько ячеек одним обновлением store (мультивыбор). */
  onSetCodesBatch?: (
    cells: Array<{ rowId: string; dateKey: string }>,
    code: import('@/lib/types').DayCode,
    mode: 'plan' | 'fact',
  ) => void
  onSavePlanDraft: (draftPlan: Record<string, Record<string, import('@/lib/types').DayCode>>) => void
  /** Пакетное сохранение черновика правок табеля после «Готово». */
  onCommitTimesheetDraft?: (
    changes: Array<{
      rowId: string
      dateKey: string
      mode: 'plan' | 'fact'
      before: DayCode
      after: DayCode
    }>,
  ) => import('@/store/slices/timesheetSlice').CommitTimesheetDraftResult | void
  /** Аннулировать документ ввода табеля (sysadmin/finance). */
  onVoidTimesheetEntry?: (documentId: string) => boolean
  /** Открыть карточку ВТ из журнала. */
  journalTimesheetEntryId?: string | null
  onJournalTimesheetEntryConsumed?: () => void
  onSetFactExtra: (rowId: string, dateKey: string, hours: number) => void
  onAssign: (rowId: string, employeeId: string | null) => void
  onRegenerateRow: (rowId: string) => void
  onAddRow: (brigade: string) => void
  onRemoveRow: (rowId: string) => void
  onRemoveEmptyRow: (brigade: string) => void
  onRegenerateMonth: () => void
  onBulkHolidayV: (brigades?: string[]) => void
  onBulkCopyPlanToFact: (scope: CopyPlanToFactScope, brigade?: string, opts?: { emptyOnly?: boolean }) => void
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
  onSetBrigadeNameEn?: (nameRu: string, nameEn: string) => void
  onSetBrigadeUnit: (brigade: string, unitId: string | null) => void
  onSetBrigadeHasBrigadier?: (brigade: string, hasBrigadier: boolean) => void
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
  onMarkBrigadierFromDay: (rowId: string, dateKey: string, on: boolean) => void
  onRowInactiveFrom: (rowId: string, dateKey: string) => void
  onRowActiveFrom: (rowId: string, dateKey: string) => void
  onClearRowPeriod: (rowId: string) => void
  onSetFactHours: (rowId: string, dateKey: string, hours: number | null) => void
  onSetBrigadeSignoff?: (brigade: string, verified: boolean) => void
  onAddDayWorker: (
    brigade: string,
    employeeId: string,
    dateKey: string,
    code: import('@/lib/types').DayCode,
  ) => boolean
  onAssignPermanent: (employeeId: string, brigade: string) => boolean
  onTransferFromDate: (
    employeeId: string,
    toBrigade: string,
    fromDateKey: string,
    opts: {
      schedule: import('@/lib/types').ScheduleType
      shiftHours?: number
      group2x2?: import('@/lib/types').Group2x2
      shiftMode?: import('@/lib/types').ShiftMode
    },
  ) => boolean
  onReorderBrigadeRow?: (
    brigade: string,
    rowId: string,
    beforeRowId: string | null,
  ) => boolean
  onClearDayTransfer?: (employeeId: string, dateKey: string) => boolean
  onSaveAndPostNightShift?: (input: {
    id?: string
    date: string
    groups: import('@/lib/nightShift/types').NightShiftGroupId[]
    brigades?: string[]
    employeeIds: string[]
    note?: string
    reasons?: Record<string, string>
  }) => boolean
  onVoidNightShift?: (documentId: string) => boolean
  onUpsertEmployee: (employee: Employee) => void
  onTourComplete: () => void
  /** Закрыть месяц (зафиксировать план/факт) */
  onCloseMonth?: () => void
  /** Переоткрыть закрытый месяц (только директор/админ) */
  onReopenMonth?: () => void
  /** Может ли текущий пользователь переоткрывать закрытый месяц */
  canReopen?: boolean
  /** Техническая очистка табеля за месяц (только sysadmin) */
  canClearMonth?: boolean
  onClearMonth?: () => void
  /** Очистить все месяцы строго раньше этой даты (YYYY-MM), sysadmin */
  onClearMonthsBefore?: (beforeMonth: string) =>
    | void
    | { ok: true; cleared?: string[] }
    | { ok: false; message?: string }
  workshopMasterMode?: boolean
  workshopMasterLogin?: string
  workshopMasterEmployeeId?: string
  /** Текущая учётка — для ACL табеля (роль + область бригад). */
  accessUser?: AppUser | null
  userDefaultBrigades?: string[]
  userMonthDefaults?: MonthViewDefaults
  currentUserId?: string
  onSaveMonthDefaults?: (defaults: MonthViewDefaults) => void
  /** Создать лист месяца, если после загрузки облака его ещё нет */
  onEnsureMonthReady?: () => void
}

export function MonthPage({
  store,
  month,
  onMonthChange,
  onPatch: _onPatch,
  onCycle,
  onSetCode,
  onSetCodesBatch,
  onSavePlanDraft,
  onCommitTimesheetDraft,
  onVoidTimesheetEntry,
  journalTimesheetEntryId = null,
  onJournalTimesheetEntryConsumed,
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
  onTourComplete: _onTourComplete,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeNameEn,
  onSetBrigadeUnit,
  onSetBrigadeHasBrigadier,
  onSetBrigadeRoster,
  onChangeGroup2x2,
  onSetCycleFromDay,
  onSetBrigadier,
  onMarkBrigadier,
  onMarkBrigadierMonth,
  onMarkBrigadierFromDay,
  onRowInactiveFrom,
  onRowActiveFrom,
  onClearRowPeriod,
  onSetFactHours,
  onSetBrigadeSignoff,
  onAddDayWorker,
  onAssignPermanent,
  onTransferFromDate,
  onReorderBrigadeRow,
  onClearDayTransfer,
  onSaveAndPostNightShift,
  onVoidNightShift,
  onUpsertEmployee,
  onCloseMonth,
  onReopenMonth,
  canReopen = false,
  canClearMonth = false,
  onClearMonth,
  onClearMonthsBefore,
  workshopMasterMode = false,
  workshopMasterLogin,
  workshopMasterEmployeeId,
  accessUser = null,
  userDefaultBrigades,
  userMonthDefaults,
  currentUserId,
  onSaveMonthDefaults,
  onEnsureMonthReady,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm, confirmUnsaved } = useConfirm()
  const [shell, setShell] = useState<MonthViewShell>(userMonthDefaults?.shell ?? 'workspace')
  const [layout, setLayout] = useState<MonthViewLayout>(
    userMonthDefaults?.layout ?? (userMonthDefaults?.shell === 'classic' ? 'dual' : 'fact'),
  )
  const [printStep, setPrintStep] = useState<'off' | 'setup' | 'preview'>('off')
  const [printConfig, setPrintConfig] = useState<PrintConfig | null>(null)
  const preferredBrigades = userMonthDefaults?.defaultBrigades ?? userDefaultBrigades

  const printMasterSignerName = useMemo(() => {
    if (workshopMasterEmployeeId) {
      const emp = store.employees.find((e) => e.id === workshopMasterEmployeeId)
      if (emp) return employeeName(emp, locale)
    }
    return (
      accessUser?.displayName ||
      workshopMasterLogin ||
      store.settings.signatures?.masterRu ||
      ''
    )
  }, [
    accessUser?.displayName,
    locale,
    store.employees,
    store.settings.signatures?.masterRu,
    workshopMasterEmployeeId,
    workshopMasterLogin,
  ])

  const tsAccess = useMemo(
    () => timesheetAccess(store, accessUser, { month }),
    [
      store,
      month,
      accessUser?.id,
      accessUser?.roleId,
      accessUser?.login,
      accessUser?.employeeId,
      accessUser?.defaultBrigades,
      accessUser?.timesheetLevel,
      accessUser?.timesheetViewBrigades,
      accessUser?.timesheetEditBrigades,
      store.brigades,
      store.access.workshopMasterCoverages,
      store.access.roleTimesheetAccess,
    ],
  )
  const timesheetScoped = tsAccess.scoped
  const allowTimesheetEdit = timesheetCanEdit(tsAccess)

  /** Бригады в области личности (или все, если ACL не scoped). */
  const scopeBrigades = useMemo(
    () => (tsAccess.brigades === 'all' ? store.brigades : tsAccess.brigades),
    [tsAccess.brigades, store.brigades],
  )

  const masterBrigades = useMemo(() => {
    if (timesheetScoped) return scopeBrigades
    if (!workshopMasterMode) return [] as string[]
    return resolveWorkshopMasterBrigades(
      store,
      workshopMasterLogin,
      workshopMasterEmployeeId,
      preferredBrigades,
    )
  }, [
    timesheetScoped,
    scopeBrigades,
    workshopMasterMode,
    store,
    workshopMasterLogin,
    workshopMasterEmployeeId,
    preferredBrigades,
  ])

  const defaultBrigadeFilter = useMemo(() => {
    if (timesheetScoped) return scopeBrigades
    if (preferredBrigades?.length) {
      const mapped = preferredBrigades.filter((b) => store.brigades.includes(b))
      if (mapped.length > 0) return mapped
    }
    if (workshopMasterMode) return masterBrigades
    return store.brigades
  }, [
    timesheetScoped,
    scopeBrigades,
    preferredBrigades,
    workshopMasterMode,
    masterBrigades,
    store.brigades,
  ])

  /** Список бригад для фильтров UI — только область ACL, если scoped. */
  const filterableBrigades = useMemo(
    () => (timesheetScoped ? scopeBrigades : store.brigades),
    [timesheetScoped, scopeBrigades, store.brigades],
  )
  const [groupMode, setGroupMode] = useState<MonthGroupMode>(
    userMonthDefaults?.groupMode ?? 'brigade',
  )
  const [search, setSearch] = useState('')
  const [brigadeSearch, setBrigadeSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(() =>
    new Set(defaultBrigadeFilter),
  )

  const coverageFocusChips = useMemo(() => {
    if (!timesheetScoped || !accessUser) return []
    return buildCoverageFocusChips(
      store,
      accessUser,
      month,
      locale === 'ka' ? 'ka' : 'ru',
      {
        all: t('coverage.focusAll'),
        mine: t('coverage.focusMine'),
        coverTitle: (name, to) => tf('coverage.focusCoverTitle', { name, to }),
      },
    )
  }, [timesheetScoped, accessUser, store, month, locale, t, tf])

  const [coverageFocusId, setCoverageFocusId] = useState<CoverageFocusId>('all')

  useEffect(() => {
    if (coverageFocusChips.length === 0) {
      setCoverageFocusId('all')
      return
    }
    if (!coverageFocusChips.some((c) => c.id === coverageFocusId)) {
      setCoverageFocusId('all')
    }
  }, [coverageFocusChips, coverageFocusId])

  const coverageBanner = useMemo(() => {
    if (!timesheetScoped || !accessUser?.id) return null
    const todayActive = activeCoveragesForUser(
      store.access,
      accessUser.id,
      localTodayIsoDate(),
    )
    const monthActive = coveragesOverlappingMonthForUser(
      store.access,
      accessUser.id,
      month,
    )
    const byId = new Map<string, (typeof todayActive)[0]>()
    for (const c of [...todayActive, ...monthActive]) byId.set(c.id, c)
    const active = [...byId.values()]
    if (active.length === 0) return null
    const brigades = [...new Set(active.flatMap((c) => c.brigades))]
    const to = active.reduce(
      (max, c) => (c.toDate > max ? c.toDate : max),
      active[0]!.toDate,
    )
    const numbers = active.map((c) => c.number).filter(Boolean)
    return { to, brigades, numbers }
  }, [timesheetScoped, accessUser?.id, store.access, month])

  const onCoverageFocus = useCallback(
    (id: string, brigades: string[]) => {
      setCoverageFocusId(id as CoverageFocusId)
      setSelectedBrigades(new Set(brigades))
    },
    [],
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
  const [viewDisplay, setViewDisplay] = useState<MonthViewDisplay>(() =>
    resolveMonthViewDisplay(userMonthDefaults?.viewDisplay, { workshopMasterMode }),
  )
  const [filterSchedule, setFilterSchedule] = useState('')
  const [rowSort, setRowSort] = useState<MonthRowSort>(
    () => userMonthDefaults?.rowSort ?? DEFAULT_MONTH_ROW_SORT,
  )
  const [showHotkeys, setShowHotkeys] = useState(false)
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
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferPrefill, setTransferPrefill] = useState<{
    employeeId: string
    toBrigade?: string
  } | null>(null)
  const [nightShiftOpen, setNightShiftOpen] = useState(false)
  const [nightShiftDay, setNightShiftDay] = useState<number | undefined>(undefined)
  const [entryDocId, setEntryDocId] = useState<string | null>(null)

  useEffect(() => {
    if (!journalTimesheetEntryId) return
    setEntryDocId(journalTimesheetEntryId)
    onJournalTimesheetEntryConsumed?.()
  }, [journalTimesheetEntryId, onJournalTimesheetEntryConsumed])

  const entryDoc = useMemo(
    () =>
      entryDocId
        ? (store.timesheetEntries?.documents ?? []).find((d) => d.id === entryDocId)
        : undefined,
    [entryDocId, store.timesheetEntries],
  )

  const canVoidTimesheetEntry =
    (accessUser?.roleId === 'sysadmin' || accessUser?.roleId === 'finance') &&
    Boolean(onVoidTimesheetEntry)

  const employeeNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of store.employees) m.set(e.id, employeeName(e, locale))
    return m
  }, [store.employees, locale])
  const [rollCallBrigades, setRollCallBrigades] = useState<string[] | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [fillBrigade, setFillBrigade] = useState<string | null>(null)
  const [draftReviewOpen, setDraftReviewOpen] = useState(false)
  const [planEditorOpen, setPlanEditorOpen] = useState(false)
  const [attendanceLogOpen, setAttendanceLogOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const accordion = useMonthAccordionSections()
  const employeeEditor = useEmployeeEditorApi()

  function applyMonthDefaults(defaults: MonthViewDefaults) {
    if (defaults.shell) setShell(defaults.shell)
    if (defaults.layout) setLayout(defaults.layout)
    if (defaults.groupMode && !workshopMasterMode) setGroupMode(defaults.groupMode)
    if (defaults.viewDisplay) {
      setViewDisplay((prev) =>
        resolveMonthViewDisplay(
          { ...prev, ...defaults.viewDisplay },
          { workshopMasterMode },
        ),
      )
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
  const defaultBrigadeFilterKey = defaultBrigadeFilter.join('\0')
  const masterBrigadesKey = masterBrigades.join('\0')
  const allUnitKeysKey = allUnitKeys.join('\0')
  const monthDefaultsKey = JSON.stringify(userMonthDefaults ?? null)

  useEffect(() => {
    setEditing(false)

    const nextGroupMode = userMonthDefaults?.groupMode ?? 'brigade'
    setGroupMode((prev) => (prev === nextGroupMode ? prev : nextGroupMode))

    const nextShell = userMonthDefaults?.shell ?? 'workspace'
    setShell((prev) => (prev === nextShell ? prev : nextShell))

    const nextLayout = userMonthDefaults?.layout ?? (nextShell === 'classic' ? 'dual' : 'fact')
    setLayout((prev) => (prev === nextLayout ? prev : nextLayout))

    setViewDisplay((prev) => {
      const next = resolveMonthViewDisplay(userMonthDefaults?.viewDisplay, {
        workshopMasterMode,
      })
      const same =
        prev.showPlan === next.showPlan &&
        prev.showFact === next.showFact &&
        prev.showTab === next.showTab &&
        prev.showPosition === next.showPosition &&
        prev.showUnit === next.showUnit &&
        prev.showSchedule === next.showSchedule &&
        prev.showTotals === next.showTotals
      return same ? prev : next
    })

    const nextRowSort = userMonthDefaults?.rowSort ?? DEFAULT_MONTH_ROW_SORT
    setRowSort((prev) => (prev === nextRowSort ? prev : nextRowSort))

    setSelectedBrigades((prev) => {
      if (
        prev.size === defaultBrigadeFilter.length &&
        defaultBrigadeFilter.every((b) => prev.has(b))
      ) {
        return prev
      }
      return new Set(defaultBrigadeFilter)
    })

    if (!workshopMasterMode) {
      setSelectedUnits((prev) => {
        if (prev.size === allUnitKeys.length && allUnitKeys.every((key) => prev.has(key))) {
          return prev
        }
        return new Set(allUnitKeys)
      })
    }

    prevBrigadesRef.current = store.brigades
  }, [
    month,
    allUnitKeysKey,
    defaultBrigadeFilterKey,
    masterBrigadesKey,
    workshopMasterMode,
    monthDefaultsKey,
  ])

  useEffect(() => {
    setCoverageFocusId('all')
  }, [month])

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
      if (next.size === selected.size && [...next].every((key) => selected.has(key))) {
        return selected
      }
      return next
    })
  }, [allUnitKeysKey])

  // Режим плиток показывает все бригады сразу — эффект сужения до одной
  // бригады убран (иначе «Перекличка»/KPI били не в ту, что открыта в плитке).

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey) setShowHotkeys(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statsFilter = useMemo((): MonthStatsFilter | undefined => {
    const filter: MonthStatsFilter = {
      confirmForEmployee: (employeeId) => absenceConfirmForEmployee(store, employeeId, month),
    }
    const brigadeCount = Array.isArray(store.brigades) ? store.brigades.length : 0
    if (timesheetScoped || selectedBrigades.size < brigadeCount) {
      filter.brigades = [...selectedBrigades]
    }
    if (structuralUnitFilterActive(selectedUnits, allUnitKeys)) {
      filter.structuralUnitIds = [...selectedUnits]
    }
    return filter
  }, [allUnitKeys, month, selectedBrigades, selectedUnits, store, timesheetScoped])

  const sheet = store.months[month]
  const draftSession = useTimesheetDraftSession(sheet, timesheetDraftStorageKey(import.meta.env.VITE_FIREBASE_PROJECT_ID || 'desktop', currentUserId || 'local', month), month)

  useEffect(() => {
    if (!store.months[month] && onEnsureMonthReady) {
      onEnsureMonthReady()
    }
  }, [month, store.months[month], onEnsureMonthReady])

  const closed = sheet ? isMonthClosed(store, month) : false
  const bypassClose = canBypassMonthClose(accessUser)
  const writeLocked = closed && !bypassClose
  const effectiveEditing = editing && !writeLocked && allowTimesheetEdit
  const activeSheet = effectiveEditing ? (draftSession.displaySheet ?? sheet) : sheet

  const stats = useMemo(
    () => (activeSheet ? monthStats(activeSheet, store.employees, statsFilter) : null),
    [activeSheet, store.employees, statsFilter],
  )
  const problems = useMemo(
    () => (activeSheet ? monthProblems(store, activeSheet) : []),
    [activeSheet, store.employees],
  )

  const readCellCode = useCallback(
    (rowId: string, dateKey: string, mode: 'plan' | 'fact'): DayCode => {
      if (effectiveEditing) return draftSession.readCode(rowId, dateKey, mode)
      if (!sheet) return ''
      if (mode === 'plan') return (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
      return (getFactMark(sheet, rowId, dateKey) ?? '') as DayCode
    },
    [draftSession, effectiveEditing, sheet],
  )

  const handleBoardMoveToBrigade = useCallback(
    (rowId: string, toBrigade: string) => {
      const srcSheet = activeSheet ?? sheet
      const row = srcSheet?.rows.find((r) => r.id === rowId)
      if (!row?.employeeId) return
      // Всегда через окно переноса — без мгновенного assignPermanent при drop.
      setTransferPrefill({ employeeId: row.employeeId, toBrigade })
      setTransferOpen(true)
    },
    [activeSheet, sheet],
  )

  const handleOpenTransfer = useCallback((employeeId: string, toBrigade?: string) => {
    setTransferPrefill({ employeeId, toBrigade })
    setTransferOpen(true)
  }, [])

  const {
    record: recordEdit,
    undo: undoEdit,
    redo: redoEdit,
    clear: clearEditHistory,
    canUndo,
    canRedo,
  } = useTimesheetEditHistory({
    enabled: effectiveEditing,
    apply: (edit, direction) => {
      const code = direction === 'undo' ? edit.before : edit.after
      if (effectiveEditing) {
        draftSession.record(edit.rowId, edit.dateKey, edit.mode, code)
        return
      }
      onSetCode(edit.rowId, edit.dateKey, code, edit.mode)
    },
  })

  useEffect(() => {
    clearEditHistory()
  }, [month, clearEditHistory])

  const commitDraftToStore = useCallback((): boolean => {
    if (!draftSession.hasChanges) return true
    const result = onCommitTimesheetDraft?.(draftSession.changes)
    if (result && typeof result === 'object') {
      if (!result.ok) {
        setNotice(
          result.skipped > 0
            ? tf('timesheetEntry.commitPartial', {
                applied: String(result.applied),
                skipped: String(result.skipped),
              })
            : t('timesheetEntry.commitBlocked'),
        )
        return false
      }
      if (result.skipped === 0) {
        draftSession.clear()
        clearEditHistory()
        return true
      }
      draftSession.removeKeys(result.appliedChanges)
      setNotice(
        tf('timesheetEntry.commitPartial', {
          applied: String(result.applied),
          skipped: String(result.skipped),
        }),
      )
      clearEditHistory()
      return false
    }
    return false
  }, [clearEditHistory, draftSession, onCommitTimesheetDraft, t, tf])

  const discardDraft = useCallback(() => {
    draftSession.clear()
    clearEditHistory()
  }, [clearEditHistory, draftSession])

  const handleEditToggle = useCallback(() => {
    if (effectiveEditing) {
      if (draftSession.hasChanges) {
        setDraftReviewOpen(true)
        return
      }
      setEditing(false)
      discardDraft()
      return
    }
    setEditing(true)
  }, [discardDraft, draftSession.hasChanges, effectiveEditing])

  async function handleMonthChangeGuarded(next: string) {
    if (next === month) return
    if (draftSession.hasChanges) {
      const choice = await confirmUnsaved({
        title: t('month.draftReview.title'),
        message: t('month.draftReview.unsavedNavigate'),
      })
      if (choice === 'cancel') return
      if (choice === 'save') {
        const done = commitDraftToStore()
        if (!done && draftSession.hasChanges) return
      } else {
        discardDraft()
      }
      setEditing(false)
    }
    onMonthChange(next)
  }

  const handleSetCode = useCallback(
    (rowId: string, dateKey: string, code: DayCode, mode: 'plan' | 'fact') => {
      const before = readCellCode(rowId, dateKey, mode)
      if (before === code && !(effectiveEditing && mode === 'fact' && code)) return
      recordEdit({ rowId, dateKey, mode, before, after: code })
      if (effectiveEditing) {
        draftSession.record(rowId, dateKey, mode, code, mode === 'fact')
        return
      }
      onSetCode(rowId, dateKey, code, mode)
    },
    [draftSession, effectiveEditing, onSetCode, readCellCode, recordEdit],
  )

  const handleSetCodesBatch = useCallback(
    (
      cells: Array<{ rowId: string; dateKey: string }>,
      code: DayCode,
      mode: 'plan' | 'fact',
    ) => {
      if (cells.length === 0) return
      if (effectiveEditing) {
        for (const c of cells) {
          const before = readCellCode(c.rowId, c.dateKey, mode)
          if (before === code && !(mode === 'fact' && code)) continue
          recordEdit({ rowId: c.rowId, dateKey: c.dateKey, mode, before, after: code })
          draftSession.record(c.rowId, c.dateKey, mode, code, mode === 'fact')
        }
        return
      }
      if (cells.length === 1) {
        const only = cells[0]!
        handleSetCode(only.rowId, only.dateKey, code, mode)
        return
      }
      for (const c of cells) {
        const before = readCellCode(c.rowId, c.dateKey, mode)
        if (before === code) continue
        recordEdit({ rowId: c.rowId, dateKey: c.dateKey, mode, before, after: code })
      }
      if (onSetCodesBatch) {
        onSetCodesBatch(cells, code, mode)
        return
      }
      for (const c of cells) {
        onSetCode(c.rowId, c.dateKey, code, mode)
      }
    },
    [
      draftSession,
      effectiveEditing,
      handleSetCode,
      onSetCode,
      onSetCodesBatch,
      readCellCode,
      recordEdit,
    ],
  )

  const handleCycle = useCallback(
    (rowId: string, dateKey: string, mode: 'plan' | 'fact') => {
      const before = readCellCode(rowId, dateKey, mode)
      const after = nextCode(before)
      if (before === after) return
      recordEdit({ rowId, dateKey, mode, before, after })
      if (effectiveEditing) {
        draftSession.record(rowId, dateKey, mode, after)
        return
      }
      onCycle(rowId, dateKey, mode)
    },
    [draftSession, effectiveEditing, onCycle, readCellCode, recordEdit],
  )

  useEffect(() => {
    if (!allowTimesheetEdit && editing) setEditing(false)
  }, [allowTimesheetEdit, editing])

  useEffect(() => {
    if (!timesheetScoped) return
    setSelectedBrigades((selected) => {
      const next = new Set([...selected].filter((b) => scopeBrigades.includes(b)))
      if (next.size === 0 && scopeBrigades.length > 0) {
        for (const b of scopeBrigades) next.add(b)
      }
      if (next.size === selected.size && [...next].every((b) => selected.has(b))) return selected
      return next
    })
  }, [timesheetScoped, scopeBrigades])

  async function handleRegenerateMonth() {
    if (!(await confirm({ message: t('month.confirmRegenerate'), danger: true }))) return
    onRegenerateMonth()
  }

  async function handleRegenerateRow(rowId: string) {
    if (!(await confirm({ message: t('month.confirmRegenerateRow'), danger: true }))) return
    onRegenerateRow(rowId)
  }

  async function handleBulkHolidayV() {
    if (timesheetScoped) {
      const msg = tf('month.confirmBulkHolidayScoped', { count: scopeBrigades.length })
      if (!(await confirm({ message: msg, danger: true }))) return
      onBulkHolidayV(scopeBrigades)
      return
    }
    if (!(await confirm({ message: t('month.confirmBulkHoliday'), danger: true }))) return
    onBulkHolidayV()
  }

  async function handleBulkCopyPlanToFact(scope: CopyPlanToFactScope, brigade?: string) {
    let effectiveScope = scope
    let effectiveBrigade = brigade
    if (timesheetScoped && scope !== 'brigade') {
      const targets = [...selectedBrigades].filter((b) => scopeBrigades.includes(b))
      if (targets.length === 0) return
      const people = targets.reduce(
        (sum, b) => sum + countCopyPlanToFactPeople(sheet!, store.employees, 'brigade', b),
        0,
      )
      const msg = tf('month.confirmBulkCopyScopedPeople', {
        count: targets.length,
        people,
      })
      if (!(await confirm({ message: msg, danger: true, title: t('month.copyPlanDangerTitle') })))
        return
      for (const b of targets) {
        onBulkCopyPlanToFact('brigade', b)
      }
      return
    }
    if (timesheetScoped && scope === 'brigade' && brigade && !scopeBrigades.includes(brigade)) {
      return
    }
    const people = sheet
      ? countCopyPlanToFactPeople(sheet, store.employees, effectiveScope, effectiveBrigade)
      : 0
    const msg =
      effectiveScope === 'all'
        ? tf('month.confirmBulkCopyAllPeople', { people })
        : effectiveScope === '52'
          ? tf('month.confirmBulkCopy52People', { people })
          : effectiveScope === '22'
            ? tf('month.confirmBulkCopy22People', { people })
            : effectiveScope === '11'
              ? tf('month.confirmBulkCopy11People', { people })
              : tf('month.confirmBulkCopyBrigadePeople', {
                  brigade: effectiveBrigade ?? '',
                  people,
                })
    if (
      !(await confirm({
        message: msg,
        danger: true,
        title: t('month.copyPlanDangerTitle'),
        confirmLabel: t('month.copyPlanDangerConfirm'),
      }))
    )
      return
    onBulkCopyPlanToFact(effectiveScope, effectiveBrigade)
  }

  async function handleBulkCopyPlanToFactEmpty(scope: CopyPlanToFactScope, brigade?: string) {
    let effectiveScope = scope
    let effectiveBrigade = brigade
    if (timesheetScoped && scope !== 'brigade') {
      const targets = [...selectedBrigades].filter((b) => scopeBrigades.includes(b))
      if (targets.length === 0) return
      let cells = 0
      let people = 0
      for (const b of targets) {
        const c = countCopyPlanToFactEmptyCells(sheet!, store.employees, 'brigade', b)
        cells += c.cells
        people += c.people
      }
      const msg = tf('month.confirmCopyEmptyScoped', { count: targets.length, cells, people })
      if (!(await confirm({ message: msg, title: t('month.copyPlanEmptyTitle') }))) return
      for (const b of targets) {
        onBulkCopyPlanToFact('brigade', b, { emptyOnly: true })
      }
      return
    }
    if (timesheetScoped && scope === 'brigade' && brigade && !scopeBrigades.includes(brigade)) {
      return
    }
    const stats = sheet
      ? countCopyPlanToFactEmptyCells(sheet, store.employees, effectiveScope, effectiveBrigade)
      : { cells: 0, people: 0 }
    if (stats.cells === 0) {
      setNotice(t('month.copyPlanEmptyNone'))
      return
    }
    const msg =
      effectiveScope === 'brigade'
        ? tf('month.confirmCopyEmptyBrigade', {
            brigade: effectiveBrigade ?? '',
            cells: stats.cells,
            people: stats.people,
          })
        : tf('month.confirmCopyEmptyAll', {
            cells: stats.cells,
            people: stats.people,
          })
    if (!(await confirm({ message: msg, title: t('month.copyPlanEmptyTitle') }))) return
    onBulkCopyPlanToFact(effectiveScope, effectiveBrigade, { emptyOnly: true })
  }

  async function handleApplyShiftTemplate(templateId: string, brigade: string) {
    const tpl = store.shiftTemplates.find((x) => x.id === templateId)
    if (
      !(await confirm({
        message: tf('month.confirmShiftTemplate', { brigade, template: tpl?.name ?? templateId }),
        danger: true,
      }))
    ) {
      return
    }
    onApplyShiftTemplate(templateId, brigade)
  }

  async function handleCloseMonth() {
    if (!onCloseMonth) return
    if (draftSession.hasChanges) { setNotice(t('month.draftReview.closeBlocked')); setDraftReviewOpen(true); return }
    const readiness = payrollReadiness(store, month, currentUserId)
    if (!payrollReady(readiness)) { setNotice(tf('month.closeReadiness', { unconfirmed: readiness.unconfirmed, brigades: readiness.unsignedBrigades.join(', ') || '—', conflicts: readiness.overlaps + readiness.missingEmployees, drafts: readiness.drafts })); return }
    if (!(await confirm({ message: t('month.confirmClose'), danger: true }))) return
    setEditing(false)
    try { onCloseMonth() } catch (error) { setNotice(error instanceof Error ? error.message : t('month.closeNotReady')) }
  }

  async function handleReopenMonth() {
    if (!onReopenMonth) return
    if (!(await confirm({ message: t('month.confirmReopen'), danger: true }))) return
    onReopenMonth()
  }

  async function handleClearMonth() {
    if (!onClearMonth || !canClearMonth) return
    if (
      !(await confirm({
        title: t('month.clearTitle'),
        message: tf('month.confirmClear', { month }),
        danger: true,
        confirmLabel: t('month.clearConfirm'),
      }))
    ) {
      return
    }
    setEditing(false)
    setPlanEditorOpen(false)
    onClearMonth()
  }

  async function handleClearMonthsBeforeApril2026() {
    if (!onClearMonthsBefore || !canClearMonth) return
    const before = '2026-04'
    const list = Object.keys(store.months)
      .filter((m) => m < before)
      .sort()
    if (
      !(await confirm({
        title: t('month.clearBeforeTitle'),
        message: list.length
          ? tf('month.confirmClearBefore', { before, list: list.join(', ') })
          : tf('month.confirmClearBeforeEmpty', { before }),
        danger: true,
        confirmLabel: t('month.clearConfirm'),
      }))
    ) {
      return
    }
    if (!list.length) return
    setEditing(false)
    setPlanEditorOpen(false)
    const result = onClearMonthsBefore(before)
    if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
      setNotice(result.message ?? t('bulk.blockedPending'))
      return
    }
    if (month < before) {
      onMonthChange(before)
    }
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
      // Снятие галочки «Есть бригадир» должно сразу убирать бригадира из табеля.
      store.brigadeHasBrigadier,
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
      employeeEditor.openNew({
        brigade,
        assignToRowId: rowId,
        onSavedExtra: (emp) => {
          onAssign(rowId, emp.id)
          setNotice(t('employee.picker.addedToPlan'))
        },
      })
    },
    [employeeEditor, onAssign, t],
  )

  const handleRemoteCellConflict = useCallback(
    (info: RemoteCellConflictInfo) => {
      const day = info.dateKey.slice(8) || info.dateKey
      const modeLabel = info.mode === 'plan' ? t('table.planUpper') : t('table.factUpper')
      const row = sheet?.rows.find((r) => r.id === info.rowId)
      if (!row) {
        setNotice(t('month.cellRemoteRowRemoved'))
        return
      }
      const empty = t('month.cellEmpty')
      setNotice(
        tf('month.cellRemoteChanged', {
          day,
          mode: modeLabel,
          was: info.was || empty,
          now: info.now || empty,
        }),
      )
    },
    [sheet, t, tf],
  )

  const handleRowSortChange = useCallback(
    (sort: MonthRowSort) => {
      setRowSort(sort)
      onSaveMonthDefaults?.({
        ...userMonthDefaults,
        shell,
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
      shell,
      layout,
      groupMode,
      selectedBrigades,
      viewDisplay,
    ],
  )

  const handleAssignConflict = useCallback(
    (info: { employeeId: string; fromBrigade: string; toBrigade: string }) => {
      const emp = store.employees.find((e) => e.id === info.employeeId)
      const name = emp ? employeeName(emp, locale) : info.employeeId
      setNotice(
        tf('employee.picker.assignConflictNotice', {
          name,
          from: brigadeLabel(info.fromBrigade, store.brigadeNamesKa, locale),
          to: brigadeLabel(info.toBrigade, store.brigadeNamesKa, locale),
        }),
      )
    },
    [locale, store.brigadeNamesKa, store.employees, tf],
  )

  const tableProps = useMemo(
    () => {
      if (!activeSheet) return null
      return {
      store: timesheetStore,
      sheet: activeSheet,
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
      allowRowReorder: allowTimesheetEdit && !writeLocked,
      onAssign,
      onAssignConflict: handleAssignConflict,
      onRegenerateRow: handleRegenerateRow,
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
      onRowInactiveFrom,
      onRowActiveFrom,
      onClearRowPeriod,
      onAddEmployee: onAddEmployeeFromTable,
      onRemoteCellConflict: handleRemoteCellConflict,
      onSetFactHours,
      canSignoff: allowTimesheetEdit && !draftSession.hasChanges,
      onSetBrigadeSignoff: draftSession.hasChanges ? undefined : onSetBrigadeSignoff,
      onReorderRow: (brigade: string, rowId: string, beforeRowId: string | null) => {
        onReorderBrigadeRow?.(brigade, rowId, beforeRowId)
      },
      onMoveToOtherBrigade: handleBoardMoveToBrigade,
      }
    },
    [
      timesheetStore,
      draftSession.hasChanges,
      activeSheet,
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
      allowTimesheetEdit,
      writeLocked,
      onAssign,
      handleAssignConflict,
      handleRegenerateRow,
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
      onRowInactiveFrom,
      onRowActiveFrom,
      onClearRowPeriod,
      onAddEmployeeFromTable,
      handleRemoteCellConflict,
      onSetFactHours,
      onSetBrigadeSignoff,
      onReorderBrigadeRow,
      handleBoardMoveToBrigade,
    ],
  )

  const attendanceLogEmployees = useMemo(() => {
    if (!workshopMasterMode && !timesheetScoped) return store.employees
    const fromSelected = employeesInBrigades(store.employees, [...selectedBrigades])
    if (fromSelected.length > 0) return fromSelected
    return employeesInBrigades(store.employees, masterBrigades)
  }, [
    masterBrigades,
    selectedBrigades,
    store.employees,
    workshopMasterMode,
    timesheetScoped,
  ])

  const overflowItems = [
    {
      id: 'regenerate',
      label: t('month.regenerate'),
      onClick: handleRegenerateMonth,
      disabled: !effectiveEditing || timesheetScoped,
      hidden: timesheetScoped,
      title: timesheetScoped
        ? t('month.scopeBrigadesOnly')
        : !effectiveEditing
          ? t('month.editToChange')
          : undefined,
    },
    {
      id: 'brigades',
      label: t('month.brigadesManage'),
      onClick: () => setBrigadesOpen(true),
      disabled: workshopMasterMode || timesheetScoped,
      hidden: workshopMasterMode || timesheetScoped,
      title: t('month.brigadesManageHint'),
    },
    {
      id: 'rollcall',
      label: t('rollcall.open'),
      onClick: () => setRollCallOpen(true),
      disabled: writeLocked,
      title: t('rollcall.hint'),
    },
    {
      id: 'transfer',
      label: t('transfer.title'),
      onClick: () => {
        setTransferPrefill(null)
        setTransferOpen(true)
      },
      disabled: writeLocked || !allowTimesheetEdit,
      title: t('transfer.hint'),
    },
    {
      id: 'nightShift',
      label: t('nightShift.open'),
      onClick: () => {
        setNightShiftDay(undefined)
        setNightShiftOpen(true)
      },
      disabled: writeLocked || !onSaveAndPostNightShift,
      hidden: !onSaveAndPostNightShift,
      title: t('nightShift.hint'),
    },
    {
      id: 'audit',
      label: t('month.audit.open'),
      onClick: () => setAuditOpen(true),
      title: t('month.audit.openHint'),
    },
    {
      id: 'attendance',
      label: t('hr.attendanceLog.open'),
      onClick: () => setAttendanceLogOpen(true),
      hidden: !(workshopMasterMode || timesheetScoped),
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
    {
      id: 'clearMonth',
      label: t('month.clear'),
      onClick: handleClearMonth,
      hidden: !(canClearMonth && onClearMonth),
      title: t('month.clearHint'),
    },
    {
      id: 'clearMonthsBefore',
      label: t('month.clearBefore'),
      onClick: handleClearMonthsBeforeApril2026,
      hidden: !(canClearMonth && onClearMonthsBefore),
      title: t('month.clearBeforeHint'),
    },
  ]

  if (!sheet) {
    return <div className="p-8 text-stone-500">{t('month.loading')}</div>
  }

  if (!tableProps) {
    return <div className="p-8 text-stone-500">{t('month.loading')}</div>
  }

  if (!stats) {
    return <div className="p-8 text-stone-500">{t('month.loading')}</div>
  }

  const archived = isMonthArchived(store, month)
  const closure = monthClosureInfo(store, month)

  return (
    <PageLayout
      className={`month-page print:p-2${shell === 'workspace' ? ' month-page--workspace' : ''}`}
      compact={shell === 'workspace'}
    >
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
          ) : effectiveEditing && draftSession.hasChanges ? (
            <span className="inline-flex rounded-sm bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
              {tf('month.draftReview.badge', { count: draftSession.changes.length })}
            </span>
          ) : !effectiveEditing ? (
            <span className="text-[10px] text-stone-500">
              {workshopMasterMode || timesheetScoped
                ? t('month.masterViewHint')
                : !allowTimesheetEdit
                  ? t('month.viewOnlyAcl')
                  : t('month.viewModeHint')}
            </span>
          ) : undefined
        }
        actions={
          <>
            <MonthNavigator month={month} onChange={handleMonthChangeGuarded} />
            {shell === 'classic' ? (
              <Button
                variant="secondary"
                size="sm"
                className="!border-sky-300 !bg-sky-50 !text-sky-900 hover:!bg-sky-100"
                onClick={openPlanEditor}
                title={t('month.planEditorHint')}
                data-coach="month:planEditor"
              >
                {t('month.planEditor')}
              </Button>
            ) : null}
            <Button
              variant={effectiveEditing ? 'success' : 'primary'}
              size="sm"
              onClick={handleEditToggle}
              disabled={writeLocked || !allowTimesheetEdit}
              title={
                writeLocked
                  ? t('month.closedEditBlocked')
                  : !allowTimesheetEdit
                    ? t('month.viewOnlyAcl')
                    : layout === 'plan'
                      ? t('month.editPlanHint')
                      : t('month.editFactHint')
              }
              data-coach="month:edit"
            >
              {effectiveEditing
                ? t('month.editDone')
                : layout === 'plan'
                  ? t('month.editPlan')
                  : t('month.editFact')}
            </Button>
            {shell === 'classic' ? (
              <TabBar
                coachPrefix="month"
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
            ) : (
              <PlanFactModeSwitch
                size="sm"
                value={layout === 'plan' ? 'plan' : 'fact'}
                onChange={setLayout}
                groupLabel={t('month.planFactToggle')}
                planLabel={t('month.plan')}
                factLabel={t('month.fact')}
                planHint={t('month.planSheetHint')}
                factHint={t('month.factSheetHint')}
              />
            )}
            <PageActionOverflow
              moreCoach="month:more"
              items={overflowItems.map((item) =>
                item.id === 'rollcall' ||
                item.id === 'transfer' ||
                item.id === 'print' ||
                item.id === 'nightShift' ||
                item.id === 'audit'
                  ? { ...item, coach: `month:${item.id}` }
                  : item,
              )}
            />
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
          {bypassClose
            ? ` ${t('month.closedAdminBypass')}`
            : !canReopen
              ? ` ${t('month.closedReopenAdmin')}`
              : null}
        </p>
      ) : null}

      {coverageFocusChips.length > 0 ? (
        <CoverageFocusBar
          chips={coverageFocusChips}
          activeId={coverageFocusId}
          onSelect={onCoverageFocus}
          hint={
            coverageBanner
              ? tf('coverage.focusHintWithDocs', {
                  docs: coverageBanner.numbers.length
                    ? coverageBanner.numbers.join(', ')
                    : '—',
                  to: coverageBanner.to,
                })
              : t('coverage.focusHint')
          }
        />
      ) : coverageBanner ? (
        <p className="rounded-sm border border-sky-200 bg-sky-50/90 px-3 py-1.5 text-xs text-sky-950 print:hidden">
          {tf('coverage.banner', {
            to: coverageBanner.to,
            brigades: coverageBanner.brigades.join(', '),
            docs: coverageBanner.numbers.length
              ? coverageBanner.numbers.join(', ')
              : '—',
          })}
        </p>
      ) : null}

      <div className="month-search-bar print:hidden">
          <input
            className="month-search-bar__input"
            type="search"
            placeholder={t('month.searchEmployee')}
            aria-label={t('month.searchEmployee')}
            data-coach="month:employeeSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      {draftSession.hasChanges && (
        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm print:hidden">
          <p>{t(draftSession.storageError ? 'month.draftReview.storageError' : 'month.draftReview.recovered')}</p>
          <p className="mt-1 text-xs">{t('month.draftReview.separateActions')}</p>
          <button type="button" className="mt-2 font-semibold underline" data-coach="month:reviewDraft" onClick={() => { setEditing(true); setDraftReviewOpen(true) }}>{t('month.draftReview.title')}</button>
        </div>
      )}

      {shell === 'classic' ? (
      <MonthWorkspaceAccordion
        open={accordion.open}
        onToggle={accordion.toggle}
        items={[
          {
            id: 'filters',
            label: t('workspace.widget.filters'),
            summary: tf('workspace.chip.brigades', {
              count: selectedBrigades.size,
              total: filterableBrigades.length,
            }),
            children: (
              <MonthDisplayBar
                brigades={filterableBrigades}
                brigadeNamesKa={store.brigadeNamesKa}
                brigadeUnits={store.brigadeUnits}
                brigadeSearch={brigadeSearch}
                selectedBrigades={selectedBrigades}
                primaryBrigades={
                  workshopMasterMode || timesheetScoped ? masterBrigades : undefined
                }
                lockBrigadeScope={timesheetScoped}
                structuralUnits={timesheetUnits}
                unitSearch={unitSearch}
                selectedUnits={selectedUnits}
                showUnassignedUnit={showUnassignedUnit}
                groupMode={groupMode}
                showUnitFilters={!workshopMasterMode && !timesheetScoped}
                showGroupModeToggle={!workshopMasterMode && !timesheetScoped}
                display={viewDisplay}
                layout={layout}
                onBrigadeSearch={setBrigadeSearch}
                onSelectedBrigades={setSelectedBrigades}
                onUnitSearch={setUnitSearch}
                onSelectedUnits={setSelectedUnits}
                onGroupMode={setGroupMode}
                onDisplay={(patch) =>
                  setViewDisplay((prev) =>
                    resolveMonthViewDisplay({ ...prev, ...patch }, { workshopMasterMode }),
                  )
                }
              />
            ),
          },
          {
            id: 'operations',
            label: t('workspace.widget.operations'),
            summary: t('month.accordion.opsSummary'),
            children: (
              <MonthToolsBar
                brigades={filterableBrigades}
                shiftTemplates={store.shiftTemplates}
                search={search}
                filterBrigade={filterBrigade}
                filterSchedule={filterSchedule}
                readOnly={!effectiveEditing}
                readOnlyHint={
                  writeLocked
                    ? t('month.closedEditBlocked')
                    : !allowTimesheetEdit
                      ? t('month.viewOnlyAcl')
                      : t('month.editToChange')
                }
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
                <MonthProblemsBar store={store} sheet={activeSheet ?? sheet} />
                <CodeLegendBar />
              </div>
            ),
          },
        ]}
      />
      ) : null}

      {shell === 'workspace' ? (
        <MonthBrigadeWorkspace
          {...tableProps}
          store={store}
          sheet={activeSheet ?? sheet}
          workshopMasterMode={workshopMasterMode}
          lockBrigadeScope={timesheetScoped}
          masterBrigades={masterBrigades}
          groupMode={groupMode}
          onGroupMode={setGroupMode}
          showGroupModeToggle={!workshopMasterMode && !timesheetScoped}
          viewDisplay={viewDisplay}
          filterSchedule={filterSchedule}
          onFilterSchedule={setFilterSchedule}
          onExportExcel={onExportExcel}
          onBulkHolidayV={handleBulkHolidayV}
          onBulkCopyPlanToFact={handleBulkCopyPlanToFact}
          onBulkCopyPlanToFactEmpty={handleBulkCopyPlanToFactEmpty}
          mismatchOnly={mismatchOnly}
          onMismatchOnly={setMismatchOnly}
          onApplyShiftTemplate={handleApplyShiftTemplate}
          onManageBrigades={() => setBrigadesOpen(true)}
          onOpenPlanEditor={openPlanEditor}
          onFillDay={(brigades) => {
            setRollCallBrigades(brigades)
            setRollCallOpen(true)
          }}
          shiftTemplates={store.shiftTemplates}
          selectedBrigades={selectedBrigades}
          onSelectedBrigades={setSelectedBrigades}
          search={search}
          onSearch={setSearch}
          readOnly={!effectiveEditing}
          allowRowReorder={allowTimesheetEdit && !writeLocked}
          readOnlyHint={
            writeLocked
              ? t('month.closedEditBlocked')
              : !allowTimesheetEdit
                ? t('month.viewOnlyAcl')
                : t('month.editToChange')
          }
          sheetMode={layout === 'plan' ? 'plan' : 'fact'}
          onSheetMode={(mode) => setLayout(mode)}
          onCycle={handleCycle}
          onSetCode={handleSetCode}
          onSetCodesBatch={handleSetCodesBatch}
          onSetFactExtra={onSetFactExtra}
          rowSort={rowSort}
          onRowSortChange={handleRowSortChange}
          canSignoff={allowTimesheetEdit}
          onSetBrigadeSignoff={draftSession.hasChanges ? undefined : onSetBrigadeSignoff}
          historyControls={
            <TimesheetHistoryControls
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => undoEdit()}
              onRedo={() => redoEdit()}
              undoTitle={t('month.history.undo')}
              redoTitle={t('month.history.redo')}
              groupLabel={t('month.history.group')}
            />
          }
          onReorderBrigadeRow={(brigade, rowId, beforeRowId) => {
            const ok = onReorderBrigadeRow?.(brigade, rowId, beforeRowId)
            if (ok === false) {
              window.alert(t('month.brigadeBoard.reorderDenied'))
            }
          }}
          onBoardMoveToBrigade={handleBoardMoveToBrigade}
          onOpenTransfer={handleOpenTransfer}
        />
      ) : null}

      {printStep === 'setup' && (
        <PrintSetupModal
          sheet={sheet}
          store={store}
          brigades={filterableBrigades}
          workshopMasterMode={workshopMasterMode || timesheetScoped}
          primaryBrigades={
            workshopMasterMode || timesheetScoped ? masterBrigades : undefined
          }
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
          printerName={printMasterSignerName}
          onClose={() => {
            setPrintStep('off')
            setPrintConfig(null)
          }}
          onBack={() => setPrintStep('setup')}
        />
      )}

      {shell === 'classic' && (layout === 'dual' ? (
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
              onCycle={(rowId, dk) => handleCycle(rowId, dk, 'plan')}
              onSetCode={(rowId, dk, code) => handleSetCode(rowId, dk, code, 'plan')}
              onSetCodesBatch={(cells, code) => handleSetCodesBatch(cells, code, 'plan')}
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
              onCycle={(rowId, dk) => handleCycle(rowId, dk, 'fact')}
              onSetCode={(rowId, dk, code) => handleSetCode(rowId, dk, code, 'fact')}
              onSetCodesBatch={(cells, code) => handleSetCodesBatch(cells, code, 'fact')}
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
            onCycle={(rowId, dk) =>
              handleCycle(rowId, dk, layout === 'plan' ? 'plan' : 'fact')
            }
            onSetCode={(rowId, dk, code) =>
              handleSetCode(rowId, dk, code, layout === 'plan' ? 'plan' : 'fact')
            }
            onSetCodesBatch={(cells, code) =>
              handleSetCodesBatch(cells, code, layout === 'plan' ? 'plan' : 'fact')
            }
            onSetFactExtra={layout === 'fact' ? onSetFactExtra : undefined}
          />
        </TimesheetSection>
      ))}

      {showHotkeys && <HotkeysHelp onClose={() => setShowHotkeys(false)} />}
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
          sheet={activeSheet ?? sheet}
          month={month}
          editing={effectiveEditing}
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
          lockBrigadeScope={timesheetScoped}
          filterableBrigades={filterableBrigades}
          primaryBrigades={
            workshopMasterMode || timesheetScoped ? masterBrigades : undefined
          }
          canEditTimesheet={allowTimesheetEdit}
          filterSchedule={filterSchedule}
          viewDisplay={viewDisplay}
          onSearch={setSearch}
          onBrigadeSearch={setBrigadeSearch}
          onSelectedBrigades={setSelectedBrigades}
          onUnitSearch={setUnitSearch}
          onSelectedUnits={setSelectedUnits}
          onGroupMode={setGroupMode}
          onViewDisplay={(patch) =>
            setViewDisplay((prev) =>
              resolveMonthViewDisplay({ ...prev, ...patch }, { workshopMasterMode }),
            )
          }
          onFilterSchedule={setFilterSchedule}
          onToggleEditing={handleEditToggle}
          onRegenerateMonth={handleRegenerateMonth}
          onMonthChange={handleMonthChangeGuarded}
          onClose={() => setPlanEditorOpen(false)}
          onSavePlan={onSavePlanDraft}
          onOpenAudit={() => setAuditOpen(true)}
          onCycle={(rowId, dateKey) => handleCycle(rowId, dateKey, 'plan')}
          onSetCode={(rowId, dateKey, code) => handleSetCode(rowId, dateKey, code, 'plan')}
          readOnly={!effectiveEditing}
          allowRowReorder={allowTimesheetEdit && !writeLocked}
          onAssign={onAssign}
          onRegenerateRow={handleRegenerateRow}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          onRemoveEmptyRow={onRemoveEmptyRow}
          onReorderRow={(brigade, rowId, beforeRowId) => {
            const ok = onReorderBrigadeRow?.(brigade, rowId, beforeRowId)
            if (ok === false) {
              window.alert(t('month.brigadeBoard.reorderDenied'))
            }
          }}
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
          onRemoteCellConflict={handleRemoteCellConflict}
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
      {brigadesOpen && (
        <BrigadesManageModal
          store={store}
          onClose={() => setBrigadesOpen(false)}
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
          onSetBrigadeNameEn={onSetBrigadeNameEn}
          onSetBrigadeUnit={onSetBrigadeUnit}
          onSetBrigadeHasBrigadier={onSetBrigadeHasBrigadier}
        />
      )}
      {rollCallOpen && (
        <DayRollCallModal
          store={store}
          month={month}
          defaultBrigades={rollCallBrigades ?? defaultBrigadeFilter}
          lockBrigadeScope={timesheetScoped}
          readOnly={!allowTimesheetEdit}
          onClose={() => {
            setRollCallOpen(false)
            setRollCallBrigades(null)
          }}
          onSetFact={(rowId, dateKey, code) => onSetCode(rowId, dateKey, code, 'fact')}
          onSetFactHours={onSetFactHours}
          onAddDayWorker={onAddDayWorker}
          onAssignPermanent={onAssignPermanent}
          onTransferFromDate={onTransferFromDate}
          onClearDayTransfer={onClearDayTransfer}
          onOpenNightShift={
            onSaveAndPostNightShift
              ? (d) => {
                  setNightShiftDay(d)
                  setNightShiftOpen(true)
                }
              : undefined
          }
          onSetBrigadier={onSetBrigadier}
          onMarkBrigadier={onMarkBrigadier}
          onMarkBrigadierFromDay={onMarkBrigadierFromDay}
        />
      )}
      <BrigadeTransferModal
        store={store}
        month={month}
        open={transferOpen}
        onClose={() => {
          setTransferOpen(false)
          setTransferPrefill(null)
        }}
        onTransfer={onTransferFromDate}
        initialEmployeeId={transferPrefill?.employeeId ?? null}
        initialToBrigade={transferPrefill?.toBrigade}
      />
      {nightShiftOpen && onSaveAndPostNightShift && onVoidNightShift && (
        <NightShiftDayModal
          store={store}
          month={month}
          initialDay={nightShiftDay}
          readOnly={!allowTimesheetEdit}
          onClose={() => {
            setNightShiftOpen(false)
            setNightShiftDay(undefined)
          }}
          onSaveAndPost={onSaveAndPostNightShift}
          onVoid={onVoidNightShift}
        />
      )}
      {entryDoc ? (
        <TimesheetEntryDocModal
          doc={entryDoc}
          employeeNameById={employeeNameById}
          canVoid={canVoidTimesheetEntry}
          onVoid={(id) => {
            const ok = onVoidTimesheetEntry?.(id) ?? false
            if (!ok) {
              setNotice(t('timesheetEntry.voidFailed'))
            }
            return ok
          }}
          onClose={() => setEntryDocId(null)}
        />
      ) : null}
      {auditOpen && (
        <TimesheetAuditModal
          store={store}
          sheet={sheet}
          month={month}
          brigadeScope={timesheetScoped ? scopeBrigades : 'all'}
          onClose={() => setAuditOpen(false)}
        />
      )}
      {fillBrigade && (
        <BrigadeFillModal
          store={store}
          sheet={sheet}
          brigade={fillBrigade}
          onSave={(ids, syncHr) => onSetBrigadeRoster(fillBrigade, ids, syncHr)}
          onConflicts={(messages) => {
            if (messages.length) setNotice(messages.join(' · '))
          }}
          onUpsertEmployee={onUpsertEmployee}
          onClose={() => setFillBrigade(null)}
        />
      )}
      {draftReviewOpen && (
        <TimesheetDraftReviewModal
          store={store}
          month={month}
          changes={draftSession.changes}
          onSave={() => {
            const done = commitDraftToStore()
            setDraftReviewOpen(false)
            if (done) setEditing(false)
          }}
          onDiscard={() => {
            discardDraft()
            setEditing(false)
            setDraftReviewOpen(false)
          }}
          onClose={() => setDraftReviewOpen(false)}
        />
      )}
      {defaultsOpen && currentUserId && onSaveMonthDefaults && (
        <MonthViewDefaultsDialog
          brigades={filterableBrigades}
          brigadeNamesKa={store.brigadeNamesKa}
          brigadeUnits={store.brigadeUnits}
          structuralUnits={timesheetUnits}
          workshopMasterMode={workshopMasterMode || timesheetScoped}
          initial={{
            shell,
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

