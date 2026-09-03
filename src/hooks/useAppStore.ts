import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { runDailyBackup } from '@/lib/backup'
import { needsAdminSetup } from '@/lib/access/init'
import {
  readAdminCabinet,
  writeAdminCabinet,
  type AdminCabinetId,
} from '@/lib/access/adminCabinet'
import {
  canAccessView,
  canShowNavItemForAdminPreview,
  firstAllowedView,
  isSysAdmin,
} from '@/lib/access/permissions'
import { readRouteFromLocation, viewToHash } from '@/lib/nav/viewRouting'
import { verifyPassword } from '@/lib/access/password'
import { mergeWebAppUser } from '@/lib/access/userEmployee'
import { SESSION_STORAGE_KEY } from '@/lib/access/types'
import type { AccessStore } from '@/lib/access/types'
import { useFstWebSession } from '@/context/FstWebSessionContext'
import type { DirectorySection } from '@/lib/directories/types'
import type { HrSection } from '@/lib/hr/types'
import { USE_LOCAL_DB } from '@/lib/localDb/config'
import { loadWorkspaceDrafts } from '@/lib/persistence/workspaceDrafts'
import { releaseUiChrome } from '@/lib/ui/overlayEvents'
import {
  loadStore,
  applyAppStoreSeeds,
  saveStore,
  type LoadStoreResult,
  type SaveStoreResult,
} from '@/lib/storage'
import {
  permanentlyDeleteTrashCandidate,
  permanentlyDeleteTrashEmployee,
  permanentlyDeleteTrashMonth,
  purgeExpiredTrash,
  restoreTrashCandidate,
  restoreTrashEmployee,
  restoreTrashMonth,
} from '@/lib/trash'
import { recordSliceExplicitDelete, actorFromGetter } from '@/lib/cloud/explicitDeleteHelper'
import type { AppStore, Locale, ViewId } from '@/lib/types'
import {
  isLocale,
  readUiLocalePref,
  writeUiLocalePref,
} from '@/lib/i18n/uiLocalePrefs'
import type { WorkspacePane } from '@/lib/workspace/types'
import { popVoiceUndo, pushVoiceUndo, type VoiceUndoEntry } from '@/lib/voiceUndo'
import { ensureMonthReady } from '@/lib/monthReady'
import { isBulkOverwriteBlockingAutosave } from '@/lib/cloud/bulkStoreOverwrite'
import { applyTrackedStoreUpdate, type SetStore } from '@/store/storeApi'
import {
  createDirectoriesSlice,
  createFormulationBatchSlice,
  createMixTasksSlice,
  createSalesSlice,
  createAiChatSlice,
  createTechnologistQcSlice,
  createOtcSlice,
  createWastewaterSlice,
  createEngineerLogSlice,
  createNightShiftSlice,
  createMealsSlice,
  createAttendanceSlice,
  createHrSlice,
  createCandidatesSlice,
  createProductionSlice,
  createSettingsSlice,
  createTimesheetSlice,
  createWarehouseSlice,
  createWorkwearSlice,
  createItOfficeSlice,
  createProcurementSlice,
  createAccessSlice,
  createFinanceSlice,
  createTasksSlice,
  createProtocolsSlice,
  createOrgChartSlice,
  createWorkspaceSlice,
} from '@/store'

const skipLocalAuth = import.meta.env.VITE_FST_WEB === 'true'

export function useAppStore() {
  const webSession = useFstWebSession()
  const initialLoad = useRef<LoadStoreResult>(loadStore())
  const [store, setStoreInner] = useState<AppStore>(() =>
    applyAppStoreSeeds(purgeExpiredTrash(initialLoad.current.store)),
  )
  const setStore = useCallback<SetStore>((action, meta) => {
    const resolvedMeta = meta ?? { origin: 'user' as const }
    const origin = resolvedMeta.origin
    setStoreInner((prev) => {
      // Bulk preview: isolate — reject ordinary user edits (no dirty ops, no store change).
      if (origin === 'user' && isBulkOverwriteBlockingAutosave()) {
        return prev
      }
      const next = typeof action === 'function' ? action(prev) : action
      applyTrackedStoreUpdate(prev, next, resolvedMeta)
      return next
    })
  }, [])
  const [loadWarning, setLoadWarning] = useState<LoadStoreResult['warning']>(
    () => initialLoad.current.warning,
  )
  const [saveError, setSaveError] = useState<SaveStoreResult | null>(null)
  const voiceUndoRef = useRef<VoiceUndoEntry[]>([])
  const [sessionUserId, setSessionUserId] = useState<string | null>(() =>
    skipLocalAuth ? '__fst__' : sessionStorage.getItem(SESSION_STORAGE_KEY),
  )
  const [adminCabinet, setAdminCabinetState] = useState<AdminCabinetId>(() => readAdminCabinet())
  const bootRoute =
    typeof window !== 'undefined' ? readRouteFromLocation() : null
  const [view, setViewState] = useState<ViewId>(() => bootRoute?.view ?? 'month')
  const [directorySection, setDirectorySection] = useState<DirectorySection>(
    () => bootRoute?.directorySection ?? 'counterparties',
  )
  const [hrSection, setHrSection] = useState<HrSection>('employees')
  const [workspacePanes, setWorkspacePanes] = useState<WorkspacePane[]>([])
  const [activeWorkspacePaneId, setActiveWorkspacePaneId] = useState<string | null>(null)
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, unknown>>(
    () => loadWorkspaceDrafts(),
  )
  const [workspaceRestoreSeq, setWorkspaceRestoreSeq] = useState(0)
  const [activeMonth, setActiveMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const storeRef = useRef(store)
  storeRef.current = store
  const activeMonthRef = useRef(activeMonth)
  activeMonthRef.current = activeMonth

  const getStore = useCallback(() => storeRef.current, [])
  const getActiveMonth = useCallback(() => activeMonthRef.current, [])
  const actorRef = useRef<{ id?: string; name?: string } | null>(null)
  const getActor = useCallback(() => actorRef.current, [])

  const sliceDeps = useMemo(
    () => ({ setStore, getStore, getActor }),
    [getStore, getActor],
  )

  const timesheet = useMemo(() => createTimesheetSlice(sliceDeps), [sliceDeps])
  const hr = useMemo(() => createHrSlice(sliceDeps), [sliceDeps])
  const candidates = useMemo(() => createCandidatesSlice(sliceDeps), [sliceDeps])
  const warehouse = useMemo(() => createWarehouseSlice(sliceDeps), [sliceDeps])
  const workwear = useMemo(() => createWorkwearSlice(sliceDeps), [sliceDeps])
  const itOffice = useMemo(() => createItOfficeSlice(sliceDeps), [sliceDeps])
  const formulationBatch = useMemo(() => createFormulationBatchSlice(sliceDeps), [sliceDeps])
  const mixTasks = useMemo(() => createMixTasksSlice(sliceDeps), [sliceDeps])
  const sales = useMemo(() => createSalesSlice(sliceDeps), [sliceDeps])
  const aiChat = useMemo(() => createAiChatSlice(sliceDeps), [sliceDeps])
  const technologistQc = useMemo(() => createTechnologistQcSlice(sliceDeps), [sliceDeps])
  const otc = useMemo(() => createOtcSlice(sliceDeps), [sliceDeps])
  const wastewater = useMemo(() => createWastewaterSlice(sliceDeps), [sliceDeps])
  const engineerLog = useMemo(() => createEngineerLogSlice(sliceDeps), [sliceDeps])
  const nightShift = useMemo(() => createNightShiftSlice(sliceDeps), [sliceDeps])
  const meals = useMemo(() => createMealsSlice(sliceDeps), [sliceDeps])
  const attendanceSlice = useMemo(() => createAttendanceSlice(sliceDeps), [sliceDeps])
  const procurement = useMemo(() => createProcurementSlice(sliceDeps), [sliceDeps])
  const production = useMemo(() => createProductionSlice(sliceDeps), [sliceDeps])
  const directories = useMemo(() => createDirectoriesSlice(sliceDeps), [sliceDeps])
  const accessSlice = useMemo(() => createAccessSlice(sliceDeps), [sliceDeps])
  const finance = useMemo(() => createFinanceSlice(sliceDeps), [sliceDeps])
  const tasks = useMemo(() => createTasksSlice(sliceDeps), [sliceDeps])
  const protocols = useMemo(() => createProtocolsSlice(sliceDeps), [sliceDeps])
  const orgChart = useMemo(() => createOrgChartSlice(sliceDeps), [sliceDeps])
  const settings = useMemo(
    () => createSettingsSlice(sliceDeps, { getActiveMonth, setActiveMonth }),
    [sliceDeps, getActiveMonth],
  )

  const setView = useCallback((v: SetStateAction<ViewId>) => {
    startTransition(() => {
      setViewState((prev) => {
        const next = typeof v === 'function' ? v(prev) : v
        if (next === 'pay') return 'finance'
        if (next === 'employees') {
          setDirectorySection('employees')
          return 'directories'
        }
        if (next === 'codes') {
          setDirectorySection('codes')
          return 'directories'
        }
        return next
      })
    })
  }, [])

  const navigateToHr = useCallback((section: HrSection = 'employees') => {
    setHrSection(section)
    setViewState('hr')
  }, [])

  /** При любой смене раздела — снять залипшие модалки/backdrop (иначе сайдбар «мёртвый»). */
  const viewChromeReady = useRef(false)
  useEffect(() => {
    if (!viewChromeReady.current) {
      viewChromeReady.current = true
      return
    }
    releaseUiChrome()
  }, [view])

  const workspace = useMemo(
    () =>
      createWorkspaceSlice({
        setView,
        setDirectorySection,
        setWorkspacePanes,
        setActiveWorkspacePaneId,
        setWorkspaceDrafts,
        setWorkspaceRestoreSeq,
      }),
    [setView],
  )

  useEffect(() => {
    setStore((s) => runDailyBackup(s), { origin: 'system' })
  }, [setStore])

  useEffect(() => {
    setStore((s) => ensureMonthReady(s, activeMonthRef.current), { origin: 'system' })
  }, [setStore])

  useEffect(() => {
    setStore((s) => ensureMonthReady(s, activeMonthRef.current), { origin: 'system' })
  }, [view, activeMonth, setStore])

  useEffect(() => {
    if (import.meta.env.VITE_FST_WEB === 'true') return
    if (USE_LOCAL_DB) return
    const result = saveStore(store)
    if (!result.ok) {
      setSaveError(result)
    } else {
      setSaveError(null)
    }
  }, [store])

  const captureVoiceUndo = useCallback((label: string) => {
    voiceUndoRef.current = pushVoiceUndo(voiceUndoRef.current, storeRef.current, label)
  }, [])

  const undoVoiceAction = useCallback((): string | null => {
    const { nextStack, entry } = popVoiceUndo(voiceUndoRef.current)
    voiceUndoRef.current = nextStack
    if (!entry) return null
    setStore(purgeExpiredTrash(entry.snapshot))
    return entry.label
  }, [])

  const dismissLoadWarning = useCallback(() => setLoadWarning(undefined), [])
  const dismissSaveError = useCallback(() => setSaveError(null), [])
  const reportSaveError = useCallback((err: SaveStoreResult | null) => setSaveError(err), [])

  const setActiveMonthReady = useCallback((month: string) => {
    setActiveMonth(month)
    setStore((s) => ensureMonthReady(s, month), { origin: 'system' })
  }, [setStore])

  const userBootDefaultsRef = useRef<string | null>(null)
  const lastPersistedViewRef = useRef<ViewId | null>(null)
  const lastPersistedMonthRef = useRef<string | null>(null)
  const localeMigratedRef = useRef<string | null>(null)

  const access: AccessStore = useMemo(() => store.access, [store.access])

  const currentUser = useMemo(() => {
    if (skipLocalAuth) {
      const webUser = webSession.appUser
      if (!webUser) return null
      return mergeWebAppUser(webUser, store.access)
    }
    if (!sessionUserId) return null
    return store.access.users.find((u) => u.id === sessionUserId && u.active) ?? null
  }, [store.access, sessionUserId, webSession.appUser, skipLocalAuth])

  actorRef.current = currentUser
    ? { id: currentUser.id, name: currentUser.displayName }
    : null

  /** Язык UI — только личный (учётка / localStorage), не общий settings.locale. */
  const uiLocale = useMemo((): Locale => {
    const personal = currentUser?.viewDefaults?.global?.locale
    if (isLocale(personal)) return personal
    const cached = readUiLocalePref(currentUser?.id)
    if (cached) return cached
    return 'ru'
  }, [currentUser])

  const setLocale = useCallback(
    (locale: Locale) => {
      writeUiLocalePref(currentUser?.id, locale)
      if (currentUser?.id) {
        accessSlice.updateUserViewDefaults(currentUser.id, 'global', { locale })
      }
    },
    [accessSlice, currentUser?.id],
  )

  /** Один раз перенести старый общий settings.locale в личные prefs учётки. */
  useEffect(() => {
    if (!currentUser) {
      localeMigratedRef.current = null
      return
    }
    if (localeMigratedRef.current === currentUser.id) return
    localeMigratedRef.current = currentUser.id
    if (isLocale(currentUser.viewDefaults?.global?.locale)) {
      writeUiLocalePref(currentUser.id, currentUser.viewDefaults!.global!.locale!)
      return
    }
    const cached = readUiLocalePref(currentUser.id)
    if (cached) {
      accessSlice.updateUserViewDefaults(currentUser.id, 'global', { locale: cached })
      return
    }
    const legacy = storeRef.current.settings.locale
    if (isLocale(legacy)) {
      writeUiLocalePref(currentUser.id, legacy)
      accessSlice.updateUserViewDefaults(currentUser.id, 'global', { locale: legacy })
    }
  }, [accessSlice, currentUser])

  useEffect(() => {
    if (!currentUser) {
      userBootDefaultsRef.current = null
      return
    }
    if (userBootDefaultsRef.current === currentUser.id) return
    userBootDefaultsRef.current = currentUser.id

    const global = currentUser.viewDefaults?.global
    if (global?.lastMonth && /^\d{4}-\d{2}$/.test(global.lastMonth)) {
      lastPersistedMonthRef.current = global.lastMonth
      setActiveMonth(global.lastMonth)
      if (!skipLocalAuth) {
        setStore((s) => ensureMonthReady(s, global.lastMonth!))
      }
    }
    const hrDefault = currentUser.viewDefaults?.hr?.section
    if (hrDefault) setHrSection(hrDefault)
    if (
      !skipLocalAuth &&
      global?.lastView &&
      canAccessView(access, currentUser, global.lastView) &&
      typeof window !== 'undefined' &&
      !readRouteFromLocation()
    ) {
      lastPersistedViewRef.current = global.lastView
      setViewState(global.lastView)
    }
  }, [currentUser, access])

  useEffect(() => {
    const userId = currentUser?.id
    if (!userId) return
    if (lastPersistedViewRef.current === view) return
    lastPersistedViewRef.current = view
    accessSlice.updateUserViewDefaults(userId, 'global', { lastView: view })
  }, [view, currentUser?.id, accessSlice])

  useEffect(() => {
    const userId = currentUser?.id
    if (!userId) return
    if (lastPersistedMonthRef.current === activeMonth) return
    lastPersistedMonthRef.current = activeMonth
    accessSlice.updateUserViewDefaults(userId, 'global', { lastMonth: activeMonth })
  }, [activeMonth, currentUser?.id, accessSlice])

  const login = useCallback(
    async (loginName: string, password: string): Promise<boolean> => {
      const loginKey = loginName.trim().toLowerCase()
      const user = storeRef.current.access.users.find(
        (u) => u.login === loginKey && u.active,
      )
      if (!user) return false
      const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt)
      if (!ok) return false
      sessionStorage.setItem(SESSION_STORAGE_KEY, user.id)
      setSessionUserId(user.id)
      setViewState(firstAllowedView(storeRef.current.access, user))
      return true
    },
    [],
  )

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    setSessionUserId(null)
  }, [])

  const setAdminCabinet = useCallback(
    (cabinet: AdminCabinetId) => {
      writeAdminCabinet(cabinet)
      setAdminCabinetState(cabinet)
      const nextView = firstAllowedView(storeRef.current.access, currentUser, cabinet)
      setViewState(nextView)
      if (cabinet === 'hr') {
        setHrSection('employees')
      }
    },
    [currentUser],
  )

  useEffect(() => {
    if (!currentUser) return
    if (isSysAdmin(currentUser) && adminCabinet !== 'full') {
      const isWeb = import.meta.env.VITE_FST_WEB === 'true'
      if (!canShowNavItemForAdminPreview(access, currentUser, view, adminCabinet, isWeb)) {
        setViewState(firstAllowedView(access, currentUser, adminCabinet))
      }
      return
    }
    if (!canAccessView(access, currentUser, view, adminCabinet)) {
      setViewState(firstAllowedView(access, currentUser, adminCabinet))
    }
  }, [currentUser, view, access, adminCabinet])

  // Синхронизация раздела с адресом (#/<view>): запоминается при перезагрузке,
  // работают кнопки «назад/вперёд» браузера, появляется shareable-ссылка.
  const hashSyncedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const target = viewToHash(view)
    if (window.location.hash === target) {
      hashSyncedRef.current = true
      return
    }
    // первый раз — не создаём лишнюю запись «назад».
    if (!hashSyncedRef.current) {
      hashSyncedRef.current = true
      window.history.replaceState(null, '', target)
    } else {
      window.history.pushState(null, '', target)
    }
  }, [view])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => {
      const route = readRouteFromLocation()
      if (!route) return
      if (route.directorySection) {
        setDirectorySection(route.directorySection)
      }
      setViewState((prev) => (prev === route.view ? prev : route.view))
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  const webRoutedRef = useRef(false)

  useEffect(() => {
    if (!skipLocalAuth) return
    if (!currentUser) {
      webRoutedRef.current = false
      return
    }
    if (webRoutedRef.current) return
    webRoutedRef.current = true

    if (isSysAdmin(currentUser)) {
      const cabinet = readAdminCabinet()
      setAdminCabinetState(cabinet)
      setViewState(firstAllowedView(access, currentUser, cabinet))
      if (cabinet === 'hr') setHrSection('employees')
      return
    }

    // После перезагрузки сохраняем раздел из адреса или последний раздел пользователя.
    const restored = readRouteFromLocation()
    if (restored && canAccessView(access, currentUser, restored.view)) {
      setViewState(restored.view)
      if (restored.directorySection) setDirectorySection(restored.directorySection)
      return
    }

    const savedView = currentUser.viewDefaults?.global?.lastView
    if (savedView && canAccessView(access, currentUser, savedView)) {
      setViewState(savedView)
      if (savedView === 'hr' || currentUser.roleId === 'hr') setHrSection('employees')
      return
    }

    const homeView = firstAllowedView(access, currentUser)
    setViewState(homeView)
    if (homeView === 'hr' || currentUser.roleId === 'hr') setHrSection('employees')
  }, [skipLocalAuth, currentUser, access])

  const adminSetupRequired = useMemo(
    () => !skipLocalAuth && needsAdminSetup(store.access),
    [store.access],
  )

  return {
    store,
    access,
    currentUser,
    adminSetupRequired,
    adminCabinet,
    setAdminCabinet,
    login,
    logout,
    skipLocalAuth,
    loadWarning,
    dismissLoadWarning,
    saveError,
    dismissSaveError,
    reportSaveError,
    view,
    setView,
    hrSection,
    setHrSection,
    navigateToHr,
    directorySection,
    navigateToDirectory: workspace.navigateToDirectory,
    workspacePanes,
    activeWorkspacePaneId,
    workspaceDrafts,
    workspaceRestoreSeq,
    branchWorkspace: workspace.branchWorkspace,
    activateWorkspacePane: workspace.activateWorkspacePane,
    closeWorkspacePane: workspace.closeWorkspacePane,
    clearWorkspaceDraft: workspace.clearWorkspaceDraft,
    activeMonth,
    setActiveMonth: setActiveMonthReady,
    ensureMonthsReady: timesheet.ensureMonthsReady,
    patch: settings.patch,
    upsertEmployee: hr.upsertEmployee,
    removeEmployee: hr.removeEmployee,
    upsertHrPosition: hr.upsertHrPosition,
    removeHrPosition: hr.removeHrPosition,
    upsertHrStructuralUnit: hr.upsertHrStructuralUnit,
    removeHrStructuralUnit: hr.removeHrStructuralUnit,
    importOrgStructureFromSeed: hr.importOrgStructureFromSeed,
    importEmployeeRegistry: hr.importEmployeeRegistry,
    clearAllPersonnel: hr.clearAllPersonnel,
    upsertCandidate: candidates.upsertCandidate,
    removeCandidate: candidates.removeCandidate,
    hireCandidate: candidates.hireCandidate,
    setEmployeeFactRange: timesheet.setEmployeeFactRange,
    assignRowEmployee: timesheet.assignRowEmployee,
    addBrigadeRowToMonth: timesheet.addBrigadeRowToMonth,
    removeBrigadeRowFromMonth: timesheet.removeBrigadeRowFromMonth,
    reorderBrigadeRowInMonth: timesheet.reorderBrigadeRowInMonth,
    removeEmptyBrigadeRowFromMonth: timesheet.removeEmptyBrigadeRowFromMonth,
    replaceEmployeeInBrigade: timesheet.replaceEmployeeInBrigade,
    swapEmployeeRows: timesheet.swapEmployeeRows,
    changeEmployeeScheduleFromDay: timesheet.changeEmployeeScheduleFromDay,
    changeEmployeeAttributesFromDay: timesheet.changeEmployeeAttributesFromDay,
    setEmployeeCycleFromDay: timesheet.setEmployeeCycleFromDay,
    setBrigadier: timesheet.setBrigadier,
    setBrigadierDay: timesheet.setBrigadierDay,
    setBrigadierMonth: timesheet.setBrigadierMonth,
    setBrigadierFromDay: timesheet.setBrigadierFromDay,
    setRowInactiveFrom: timesheet.setRowInactiveFrom,
    setRowActiveFrom: timesheet.setRowActiveFrom,
    clearRowPeriod: timesheet.clearRowPeriod,
    assignPermanentToBrigade: timesheet.assignPermanentToBrigade,
    transferEmployeeFromDate: timesheet.transferEmployeeFromDate,
    setBrigadeRoster: timesheet.setBrigadeRoster,
    captureVoiceUndo,
    undoVoiceAction,
    setMarksRange: timesheet.setMarksRange,
    cycleMark: timesheet.cycleMark,
    setCellComment: timesheet.setCellComment,
    setSubstitution: timesheet.setSubstitution,
    clearSubstitution: timesheet.clearSubstitution,
    setMark: timesheet.setMark,
    setMarksBatch: timesheet.setMarksBatch,
    commitPlanDraft: timesheet.commitPlanDraft,
    commitTimesheetDraft: timesheet.commitTimesheetDraft,
    voidTimesheetEntry: timesheet.voidTimesheetEntry,
    setFactExtraHours: timesheet.setFactExtraHours,
    setFactHours: timesheet.setFactHours,
    setBrigadeSignoff: timesheet.setBrigadeSignoff,
    addBrigadeDayWorker: timesheet.addBrigadeDayWorker,
    clearBrigadeDayTransfer: timesheet.clearBrigadeDayTransfer,
    bulkHolidayV: timesheet.bulkHolidayV,
    bulkCopyPlanToFact: timesheet.bulkCopyPlanToFact,
    bulkCopyPlanToFact52: timesheet.bulkCopyPlanToFact52,
    regenerateRowPlan: timesheet.regenerateRowPlan,
    regenerateMonthPlan: timesheet.regenerateMonthPlan,
    replaceStore: settings.replaceStore,
    applyCloudStore: settings.applyCloudStore,
    replaceStoreForBulk: settings.replaceStoreForBulk,
    cancelBulkPreview: settings.cancelBulkPreview,
    resetStore: settings.resetStore,
    updateSettings: settings.updateSettings,
    uiLocale,
    setLocale,
    addBrigade: timesheet.addBrigade,
    renameBrigade: timesheet.renameBrigade,
    setBrigadeNameKa: timesheet.setBrigadeNameKa,
    setBrigadeNameEn: timesheet.setBrigadeNameEn,
    setBrigadeUnit: timesheet.setBrigadeUnit,
    setBrigadeHasBrigadier: timesheet.setBrigadeHasBrigadier,
    removeBrigade: timesheet.removeBrigade,
    addMonth: settings.addMonth,
    removeMonth: settings.removeMonth,
    clearMonthTimesheet: settings.clearMonthTimesheet,
    clearMonthsBefore: settings.clearMonthsBefore,
    archiveMonth: settings.archiveMonth,
    syncMonthRosterFromHr: settings.syncMonthRosterFromHr,
    prepareArchiveMonth: settings.prepareArchiveMonth,
    setMonthClosed: settings.setMonthClosed,
    applyShiftTemplate: timesheet.applyShiftTemplate,
    applyShiftTemplateBrigade: timesheet.applyShiftTemplateBrigade,
    applyShiftTemplateBrigadeAndRegenerate: timesheet.applyShiftTemplateBrigadeAndRegenerate,
    restoreTrashEmployee: (at: string) => setStore((s) => restoreTrashEmployee(s, at)),
    restoreTrashMonth: (at: string) => setStore((s) => restoreTrashMonth(s, at)),
    restoreTrashCandidate: (at: string) => setStore((s) => restoreTrashCandidate(s, at)),
    purgeTrashEmployee: (at: string) => {
      const item = getStore().trash?.employees?.find((t) => t.deletedAt === at)
      if (item) {
        recordSliceExplicitDelete('trash.employees', at, actorFromGetter(getActor), item)
      }
      setStore((s) => permanentlyDeleteTrashEmployee(s, at))
    },
    purgeTrashMonth: (at: string) => {
      const item = getStore().trash?.months?.find((t) => t.deletedAt === at)
      if (item) {
        recordSliceExplicitDelete('trash.months', at, actorFromGetter(getActor), item)
      }
      setStore((s) => permanentlyDeleteTrashMonth(s, at))
    },
    purgeTrashCandidate: (at: string) => {
      const item = getStore().trash?.candidates?.find((t) => t.deletedAt === at)
      if (item) {
        recordSliceExplicitDelete('trash.candidates', at, actorFromGetter(getActor), item)
      }
      setStore((s) => permanentlyDeleteTrashCandidate(s, at))
    },
    upsertWarehouseItem: warehouse.upsertWarehouseItem,
    archiveWarehouseItem: warehouse.archiveWarehouseItem,
    removeWarehouseItem: warehouse.removeWarehouseItem,
    upsertWarehouseCategory: warehouse.upsertWarehouseCategory,
    upsertWarehouseLocation: warehouse.upsertWarehouseLocation,
    removeWarehouseCategory: warehouse.removeWarehouseCategory,
    removeWarehouseLocation: warehouse.removeWarehouseLocation,
    addStockMovement: warehouse.addStockMovement,
    deleteStockMovement: warehouse.deleteStockMovement,
    postWarehouseDoc: warehouse.postWarehouseDoc,
    saveWarehouseDocDraft: warehouse.saveWarehouseDocDraft,
    postExistingWarehouseDoc: warehouse.postExistingWarehouseDoc,
    unpostWarehouseDoc: warehouse.unpostWarehouseDoc,
    removeWarehouseDraft: warehouse.removeWarehouseDraft,
    postWarehouseTransfer: warehouse.postWarehouseTransfer,
    cancelWarehouseDocument: warehouse.cancelWarehouseDocument,
    mergeWarehouseInvoiceRegistry: warehouse.mergeWarehouseInvoiceRegistry,
    runWarehouseInventory: warehouse.runWarehouseInventory,
    postWarehouseInventoryRevision: warehouse.postWarehouseInventoryRevision,
    postWarehouseOpeningBalances: warehouse.postWarehouseOpeningBalances,
    saveOpeningInventoryDraft: warehouse.saveOpeningInventoryDraft,
    postOpeningInventory: warehouse.postOpeningInventory,
    acquireWarehouseDocumentLock: warehouse.acquireWarehouseDocumentLock,
    releaseWarehouseDocumentLock: warehouse.releaseWarehouseDocumentLock,
    importWarehouseExcel: warehouse.importWarehouseExcel,
    setWarehouseStore: warehouse.setWarehouseStore,
    setWarehouseMonthClosed: warehouse.setWarehouseMonthClosed,
    openDailyIssueSession: warehouse.openDailyIssueSession,
    adjustDailyIssueLine: warehouse.adjustDailyIssueLine,
    setDailyIssueComment: warehouse.setDailyIssueComment,
    postDailyIssueSession: warehouse.postDailyIssueSession,
    createWarehouseItemRequest: warehouse.createWarehouseItemRequest,
    resolveWarehouseItemRequest: warehouse.resolveWarehouseItemRequest,
    createWarehouseItemRenameRequest: warehouse.createWarehouseItemRenameRequest,
    resolveWarehouseItemRenameRequest: warehouse.resolveWarehouseItemRenameRequest,
    createKeeperReplenishment: warehouse.createKeeperReplenishment,
    createReplenishmentFromDeficit: warehouse.createReplenishmentFromDeficit,
    updateKeeperReplenishment: warehouse.updateKeeperReplenishment,
    submitKeeperReplenishment: warehouse.submitKeeperReplenishment,
    cancelKeeperReplenishment: warehouse.cancelKeeperReplenishment,
    receiveKeeperReplenishment: warehouse.receiveKeeperReplenishment,
    upsertLoadingShipment: warehouse.upsertLoadingShipment,
    postLoadingShipment: warehouse.postLoadingShipment,
    removeLoadingShipment: warehouse.removeLoadingShipment,
    markWarehouseDocsExported: warehouse.markWarehouseDocsExported,
    upsertWorkwearCatalogItem: workwear.upsertWorkwearCatalogItem,
    archiveWorkwearCatalogItem: workwear.archiveWorkwearCatalogItem,
    postWorkwearIssuance: workwear.postWorkwearIssuance,
    removeWorkwearIssuance: workwear.removeWorkwearIssuance,
    upsertItAsset: itOffice.upsertItAsset,
    removeItAsset: itOffice.removeItAsset,
    upsertItCatalogItem: itOffice.upsertItCatalogItem,
    upsertItHandoverActDraft: itOffice.upsertItHandoverActDraft,
    postItHandoverAct: itOffice.postItHandoverAct,
    removeItHandoverActDraft: itOffice.removeItHandoverActDraft,
    upsertItMaintenance: itOffice.upsertItMaintenance,
    removeItMaintenance: itOffice.removeItMaintenance,
    upsertItConsumableSpec: itOffice.upsertItConsumableSpec,
    setItConsumableBalance: itOffice.setItConsumableBalance,
    postItConsumableIssue: itOffice.postItConsumableIssue,
    upsertProductionRequest: production.upsertProductionRequest,
    removeProductionRequest: production.removeProductionRequest,
    postProductionRequest: production.postProductionRequest,
    upsertProductionOrder: production.upsertProductionOrder,
    assignProductionOrderFormulationRecipe: production.assignProductionOrderFormulationRecipe,
    removeProductionOrder: production.removeProductionOrder,
    activateProductionOrder: production.activateProductionOrder,
    recalculateProductionOrder: production.recalculateProductionOrder,
    generatePlannerProductionRequests: production.generatePlannerProductionRequests,
    reserveProductionOrderMaterials: production.reserveProductionOrderMaterials,
    unreserveProductionOrderMaterials: production.unreserveProductionOrderMaterials,
    reallocateProductionOrderReservation: production.reallocateProductionOrderReservation,
    upsertCounterparty: directories.upsertCounterparty,
    removeCounterparty: directories.removeCounterparty,
    upsertFinishedProduct: directories.upsertFinishedProduct,
    patchFinishedProductCatalog: directories.patchFinishedProductCatalog,
    removeFinishedProduct: directories.removeFinishedProduct,
    upsertPackagingRecipe: directories.upsertPackagingRecipe,
    removePackagingRecipe: directories.removePackagingRecipe,
    upsertBoxRecipe: directories.upsertBoxRecipe,
    removeBoxRecipe: directories.removeBoxRecipe,
    upsertFormulationRecipe: directories.upsertFormulationRecipe,
    removeFormulationRecipe: directories.removeFormulationRecipe,
    postFormulationBatchMix: formulationBatch.postFormulationBatchMix,
    confirmFormulationBatch: formulationBatch.confirmFormulationBatch,
    rejectFormulationBatch: formulationBatch.rejectFormulationBatch,
    createMixTask: mixTasks.createMixTask,
    updateMixTask: mixTasks.updateMixTask,
    cancelMixTask: mixTasks.cancelMixTask,
    completeMixTask: mixTasks.completeMixTask,
    reserveMixTaskMaterials: mixTasks.reserveMixTaskMaterials,
    unreserveMixTaskMaterials: mixTasks.unreserveMixTaskMaterials,
    upsertSalesOrder: sales.upsertSalesOrder,
    removeSalesOrder: sales.removeSalesOrder,
    setSalesOrderStatus: sales.setSalesOrderStatus,
    planSalesLine: sales.planSalesLine,
    planAllSalesLines: sales.planAllSalesLines,
    createLoadingShipmentsFromSalesOrder: sales.createLoadingShipmentsFromSalesOrder,
    createCombinedLoadingFromSalesOrder: sales.createCombinedLoadingFromSalesOrder,
    appendAiChatEntries: aiChat.appendAiChatEntries,
    addSuggestion: aiChat.addSuggestion,
    setSuggestionStatus: aiChat.setSuggestionStatus,
    replyToSuggestion: aiChat.replyToSuggestion,
    upsertEadCalculation: technologistQc.upsertEadCalculation,
    removeEadCalculation: technologistQc.removeEadCalculation,
    upsertEadControl: technologistQc.upsertEadControl,
    removeEadControl: technologistQc.removeEadControl,
    upsertIncomingControl: technologistQc.upsertIncomingControl,
    removeIncomingControl: technologistQc.removeIncomingControl,
    upsertImpregnationQc: technologistQc.upsertImpregnationQc,
    removeImpregnationQc: technologistQc.removeImpregnationQc,
    addRoomClimateReading: technologistQc.addRoomClimateReading,
    removeRoomClimateReading: technologistQc.removeRoomClimateReading,
    upsertShiftHandoff: technologistQc.upsertShiftHandoff,
    acknowledgeShiftHandoff: technologistQc.acknowledgeShiftHandoff,
    setShiftHandoffStatus: technologistQc.setShiftHandoffStatus,
    removeShiftHandoff: technologistQc.removeShiftHandoff,
    upsertOtcNorm: otc.upsertOtcNorm,
    removeOtcNorm: otc.removeOtcNorm,
    upsertOtcLabTest: otc.upsertOtcLabTest,
    removeOtcLabTest: otc.removeOtcLabTest,
    upsertOtcAlkaliSeries: otc.upsertOtcAlkaliSeries,
    removeOtcAlkaliSeries: otc.removeOtcAlkaliSeries,
    upsertOtcSorting: otc.upsertOtcSorting,
    removeOtcSorting: otc.removeOtcSorting,
    upsertOtcDefect: otc.upsertOtcDefect,
    removeOtcDefect: otc.removeOtcDefect,
    upsertWastewaterCube: wastewater.upsertWastewaterCube,
    createWastewaterCube: wastewater.createWastewaterCube,
    applyWastewaterCubeTransition: wastewater.applyWastewaterCubeTransition,
    removeWastewaterCube: wastewater.removeWastewaterCube,
    upsertEngineerLogEntry: engineerLog.upsertEngineerLogEntry,
    removeEngineerLogEntry: engineerLog.removeEngineerLogEntry,
    toggleEngineerLogPin: engineerLog.toggleEngineerLogPin,
    toggleEngineerLogChecklistItem: engineerLog.toggleEngineerLogChecklistItem,
    setEngineerLogEntryStatus: engineerLog.setEngineerLogEntryStatus,
    createWorkTask: tasks.createWorkTask,
    updateWorkTask: tasks.updateWorkTask,
    moveWorkTask: tasks.moveWorkTask,
    completeWorkTask: tasks.completeWorkTask,
    cancelWorkTask: tasks.cancelWorkTask,
    addTaskComment: tasks.addTaskComment,
    toggleTaskChecklistItem: tasks.toggleTaskChecklistItem,
    toggleTaskAssigneeDone: tasks.toggleTaskAssigneeDone,
    addTaskAttachmentMeta: tasks.addTaskAttachmentMeta,
    beginTaskAttachmentDelete: tasks.beginTaskAttachmentDelete,
    removeTaskAttachmentMeta: tasks.removeTaskAttachmentMeta,
    upsertMeetingProtocol: protocols.upsertMeetingProtocol,
    sendProtocolItemForAck: protocols.sendProtocolItemForAck,
    confirmProtocolItemAck: protocols.confirmProtocolItemAck,
    refuseProtocolItemAck: protocols.refuseProtocolItemAck,
    adminFixProtocolItemAck: protocols.adminFixProtocolItemAck,
    registerProtocolAttachment: protocols.registerProtocolAttachment,
    archiveMeetingProtocol: protocols.archiveMeetingProtocol,
    upsertProtocolItem: protocols.upsertProtocolItem,
    archiveProtocolItem: protocols.archiveProtocolItem,
    setProtocolItemStatus: protocols.setProtocolItemStatus,
    setOrgChartDisplayMode: orgChart.setOrgChartDisplayMode,
    upsertOrgChartNode: orgChart.upsertOrgChartNode,
    moveOrgChartNode: orgChart.moveOrgChartNode,
    reparentOrgChartNode: orgChart.reparentOrgChartNode,
    archiveOrgChartNode: orgChart.archiveOrgChartNode,
    removeOrgChartNode: orgChart.removeOrgChartNode,
    assignOrgChartEmployee: orgChart.assignOrgChartEmployee,
    unassignOrgChartEmployee: orgChart.unassignOrgChartEmployee,
    setOrgChartHrLink: orgChart.setOrgChartHrLink,
    autoLayoutOrgChart: orgChart.autoLayoutOrgChart,
    autoLayoutOrgChartBranch: orgChart.autoLayoutOrgChartBranch,
    upsertNightShiftDraft: nightShift.upsertNightShiftDraft,
    postNightShift: nightShift.postNightShift,
    saveAndPostNightShift: nightShift.saveAndPostNightShift,
    voidNightShift: nightShift.voidNightShift,
    upsertMealOrder: meals.upsertMealOrder,
    acceptMealDay: meals.acceptMealDay,
    unacceptMealDay: meals.unacceptMealDay,
    updateMealSettings: meals.updateMealSettings,
    upsertMealOption: meals.upsertMealOption,
    upsertMealCatalogItem: meals.upsertMealCatalogItem,
    setMealWeekBase: meals.setMealWeekBase,
    setMealWeekExtras: meals.setMealWeekExtras,
    setMealDayExtras: meals.setMealDayExtras,
    copyPreviousMealWeek: meals.copyPreviousMealWeek,
    publishMealWeek: meals.publishMealWeek,
    addMealAdvanceReceipt: meals.addMealAdvanceReceipt,
    recordAttendancePunch: attendanceSlice.recordAttendancePunch,
    upsertPurchaseOrder: procurement.upsertPurchaseOrder,
    createPurchaseOrder: procurement.createPurchaseOrder,
    removePurchaseOrder: procurement.removePurchaseOrder,
    addPurchaseOrderMilestone: procurement.addPurchaseOrderMilestone,
    setPurchaseOrderStatus: procurement.setPurchaseOrderStatus,
    receivePurchaseOrder: procurement.receivePurchaseOrder,
    upsertProcurementCategory: procurement.upsertProcurementCategory,
    removeProcurementCategory: procurement.removeProcurementCategory,
    upsertRoutePoint: procurement.upsertRoutePoint,
    removeRoutePoint: procurement.removeRoutePoint,
    giveAdvance: finance.giveAdvance,
    removeAdvance: finance.removeAdvance,
    saveAdvanceDocumentDraft: finance.saveAdvanceDocumentDraft,
    prepareAdvanceDocument: finance.prepareAdvanceDocument,
    unprepareAdvanceDocument: finance.unprepareAdvanceDocument,
    postAdvanceDocument: finance.postAdvanceDocument,
    voidAdvanceDocument: finance.voidAdvanceDocument,
    deleteAdvanceDocumentDraft: finance.deleteAdvanceDocumentDraft,
    markFinanceDocExported: finance.markFinanceDocExported,
    saveAdvanceAccrualDraft: finance.saveAdvanceAccrualDraft,
    postAdvanceAccrual: finance.postAdvanceAccrual,
    voidAdvanceAccrual: finance.voidAdvanceAccrual,
    deleteAdvanceAccrualDraft: finance.deleteAdvanceAccrualDraft,
    createDisbursementFromAccrual: finance.createDisbursementFromAccrual,
    savePayoutDocumentDraft: finance.savePayoutDocumentDraft,
    preparePayoutDocument: finance.preparePayoutDocument,
    unpreparePayoutDocument: finance.unpreparePayoutDocument,
    postPayoutDocument: finance.postPayoutDocument,
    voidPayoutDocument: finance.voidPayoutDocument,
    deletePayoutDocumentDraft: finance.deletePayoutDocumentDraft,
    addAdjustment: finance.addAdjustment,
    removeAdjustment: finance.removeAdjustment,
    addPayout: finance.addPayout,
    removePayout: finance.removePayout,
    confirmSick: finance.confirmSick,
    unconfirmSick: finance.unconfirmSick,
    confirmVacation: finance.confirmVacation,
    unconfirmVacation: finance.unconfirmVacation,
    upsertAppUser: accessSlice.upsertAppUser,
    removeAppUser: accessSlice.removeAppUser,
    removeWebUser: accessSlice.removeWebUser,
    setRoleViews: accessSlice.setRoleViews,
    setRoleDirectorySections: accessSlice.setRoleDirectorySections,
    setRoleAllowNegativeStock: accessSlice.setRoleAllowNegativeStock,
    setRoleAllowDocumentCancel: accessSlice.setRoleAllowDocumentCancel,
    setRoleTimesheetAccess: accessSlice.setRoleTimesheetAccess,
    setRoleTaskAccess: accessSlice.setRoleTaskAccess,
    upsertUserGroup: accessSlice.upsertUserGroup,
    removeUserGroup: accessSlice.removeUserGroup,
    setupInitialAdminPassword: accessSlice.setupInitialAdminPassword,
    completeWebPasswordChange: accessSlice.completeWebPasswordChange,
    clearWebMustChangePasswordFlag: accessSlice.clearWebMustChangePasswordFlag,
    updateUserViewDefaults: accessSlice.updateUserViewDefaults,
    upsertWorkshopMasterCoverage: accessSlice.upsertWorkshopMasterCoverage,
    postWorkshopMasterCoverage: accessSlice.postWorkshopMasterCoverage,
    endWorkshopMasterCoverage: accessSlice.endWorkshopMasterCoverage,
  }
}
