import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { runDailyBackup } from '@/lib/backup'
import { needsAdminSetup } from '@/lib/access/init'
import {
  firstViewForAdminCabinet,
  readAdminCabinet,
  writeAdminCabinet,
  type AdminCabinetId,
} from '@/lib/access/adminCabinet'
import { canAccessView, firstAllowedView, isSysAdmin } from '@/lib/access/permissions'
import { readViewFromLocation, viewToHash } from '@/lib/nav/viewRouting'
import { verifyPassword } from '@/lib/access/password'
import { mergeWebAppUser } from '@/lib/access/userEmployee'
import { SESSION_STORAGE_KEY } from '@/lib/access/types'
import type { AccessStore } from '@/lib/access/types'
import { useFstWebSession } from '@/context/FstWebSessionContext'
import { webAccessStore } from '@/lib/cloud/fstWebUsers'
import type { DirectorySection } from '@/lib/directories/types'
import type { HrSection } from '@/lib/hr/types'
import { USE_LOCAL_DB } from '@/lib/localDb/config'
import { loadWorkspaceDrafts } from '@/lib/persistence/workspaceDrafts'
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
import type { AppStore, ViewId } from '@/lib/types'
import type { WorkspacePane } from '@/lib/workspace/types'
import { popVoiceUndo, pushVoiceUndo, type VoiceUndoEntry } from '@/lib/voiceUndo'
import { ensureMonthReady } from '@/lib/monthReady'
import {
  createDirectoriesSlice,
  createFormulationBatchSlice,
  createMixTasksSlice,
  createSalesSlice,
  createAiChatSlice,
  createTechnologistQcSlice,
  createWastewaterSlice,
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
  createWorkspaceSlice,
} from '@/store'

const skipLocalAuth = import.meta.env.VITE_FST_WEB === 'true'

export function useAppStore() {
  const webSession = useFstWebSession()
  const initialLoad = useRef<LoadStoreResult>(loadStore())
  const [store, setStore] = useState<AppStore>(() =>
    applyAppStoreSeeds(purgeExpiredTrash(initialLoad.current.store)),
  )
  const [loadWarning, setLoadWarning] = useState<LoadStoreResult['warning']>(
    () => initialLoad.current.warning,
  )
  const [saveError, setSaveError] = useState<SaveStoreResult | null>(null)
  const voiceUndoRef = useRef<VoiceUndoEntry[]>([])
  const [sessionUserId, setSessionUserId] = useState<string | null>(() =>
    skipLocalAuth ? '__fst__' : sessionStorage.getItem(SESSION_STORAGE_KEY),
  )
  const [adminCabinet, setAdminCabinetState] = useState<AdminCabinetId>(() => readAdminCabinet())
  const [view, setViewState] = useState<ViewId>(() => readViewFromLocation() ?? 'month')
  const [directorySection, setDirectorySection] = useState<DirectorySection>('counterparties')
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

  const sliceDeps = useMemo(
    () => ({ setStore, getStore }),
    [getStore],
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
  const wastewater = useMemo(() => createWastewaterSlice(sliceDeps), [sliceDeps])
  const procurement = useMemo(() => createProcurementSlice(sliceDeps), [sliceDeps])
  const production = useMemo(() => createProductionSlice(sliceDeps), [sliceDeps])
  const directories = useMemo(() => createDirectoriesSlice(sliceDeps), [sliceDeps])
  const accessSlice = useMemo(() => createAccessSlice(sliceDeps), [sliceDeps])
  const settings = useMemo(
    () => createSettingsSlice(sliceDeps, { getActiveMonth, setActiveMonth }),
    [sliceDeps, getActiveMonth],
  )

  const setView = useCallback((v: SetStateAction<ViewId>) => {
    setViewState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      if (next === 'pay') {
        setHrSection('pay')
        return 'hr'
      }
      return next
    })
  }, [])

  const navigateToHr = useCallback((section: HrSection = 'employees') => {
    setHrSection(section)
    setViewState('hr')
  }, [])

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
    setStore((s) => runDailyBackup(s))
  }, [])

  useEffect(() => {
    setStore((s) => ensureMonthReady(s, activeMonthRef.current))
  }, [])

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

  const setLocale = useCallback(
    (locale: AppStore['settings']['locale']) => {
      settings.updateSettings({ locale })
    },
    [settings],
  )

  const setActiveMonthReady = useCallback((month: string) => {
    setActiveMonth(month)
    setStore((s) => ensureMonthReady(s, month))
  }, [])

  const access: AccessStore = useMemo(() => {
    if (skipLocalAuth && webSession.profile) {
      return webAccessStore(store.access, webSession.profile.roleId)
    }
    return store.access
  }, [store.access, webSession.profile])

  const currentUser = useMemo(() => {
    if (skipLocalAuth) {
      const webUser = webSession.appUser
      if (!webUser) return null
      return mergeWebAppUser(webUser, store.access)
    }
    if (!sessionUserId) return null
    return store.access.users.find((u) => u.id === sessionUserId && u.active) ?? null
  }, [store.access, sessionUserId, webSession.appUser, skipLocalAuth])

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

  const setAdminCabinet = useCallback((cabinet: AdminCabinetId) => {
    writeAdminCabinet(cabinet)
    setAdminCabinetState(cabinet)
    const nextView = firstViewForAdminCabinet(cabinet)
    setViewState(nextView)
    if (cabinet === 'hr') {
      setHrSection('employees')
    }
  }, [])

  useEffect(() => {
    if (skipLocalAuth || !currentUser) return
    if (!canAccessView(access, currentUser, view)) {
      setViewState(firstAllowedView(access, currentUser))
    }
  }, [currentUser, view, access])

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
      const next = readViewFromLocation()
      if (next) setViewState((prev) => (prev === next ? prev : next))
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
      setViewState(firstViewForAdminCabinet(cabinet))
      if (cabinet === 'hr') setHrSection('employees')
      return
    }

    // После перезагрузки сохраняем раздел из адреса, если роль имеет к нему доступ.
    const restored = readViewFromLocation()
    if (restored && canAccessView(access, currentUser, restored)) {
      setViewState(restored)
      return
    }

    setViewState(firstAllowedView(access, currentUser))
    if (currentUser.roleId === 'hr') {
      setHrSection('employees')
    }
    if (currentUser.roleId === 'finance') {
      setViewState('finance')
    }
    if (currentUser.roleId === 'warehouse_keeper') {
      setViewState('warehouse')
    }
    if (currentUser.roleId === 'technologist') {
      setViewState('technologist')
    }
    if (currentUser.roleId === 'procurement_manager') {
      setViewState('procurement')
    }
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
    removeEmptyBrigadeRowFromMonth: timesheet.removeEmptyBrigadeRowFromMonth,
    replaceEmployeeInBrigade: timesheet.replaceEmployeeInBrigade,
    swapEmployeeRows: timesheet.swapEmployeeRows,
    changeEmployeeScheduleFromDay: timesheet.changeEmployeeScheduleFromDay,
    changeEmployeeAttributesFromDay: timesheet.changeEmployeeAttributesFromDay,
    setEmployeeCycleFromDay: timesheet.setEmployeeCycleFromDay,
    setBrigadier: timesheet.setBrigadier,
    assignPermanentToBrigade: timesheet.assignPermanentToBrigade,
    setBrigadeRoster: timesheet.setBrigadeRoster,
    captureVoiceUndo,
    undoVoiceAction,
    setMarksRange: timesheet.setMarksRange,
    cycleMark: timesheet.cycleMark,
    setCellComment: timesheet.setCellComment,
    setSubstitution: timesheet.setSubstitution,
    clearSubstitution: timesheet.clearSubstitution,
    setMark: timesheet.setMark,
    setFactExtraHours: timesheet.setFactExtraHours,
    bulkHolidayV: timesheet.bulkHolidayV,
    bulkCopyPlanToFact: timesheet.bulkCopyPlanToFact,
    bulkCopyPlanToFact52: timesheet.bulkCopyPlanToFact52,
    regenerateRowPlan: timesheet.regenerateRowPlan,
    regenerateMonthPlan: timesheet.regenerateMonthPlan,
    replaceStore: settings.replaceStore,
    resetStore: settings.resetStore,
    updateSettings: settings.updateSettings,
    setLocale,
    addBrigade: timesheet.addBrigade,
    renameBrigade: timesheet.renameBrigade,
    setBrigadeNameKa: timesheet.setBrigadeNameKa,
    removeBrigade: timesheet.removeBrigade,
    addMonth: settings.addMonth,
    removeMonth: settings.removeMonth,
    archiveMonth: settings.archiveMonth,
    applyShiftTemplate: timesheet.applyShiftTemplate,
    applyShiftTemplateBrigade: timesheet.applyShiftTemplateBrigade,
    applyShiftTemplateBrigadeAndRegenerate: timesheet.applyShiftTemplateBrigadeAndRegenerate,
    restoreTrashEmployee: (at: string) => setStore((s) => restoreTrashEmployee(s, at)),
    restoreTrashMonth: (at: string) => setStore((s) => restoreTrashMonth(s, at)),
    restoreTrashCandidate: (at: string) => setStore((s) => restoreTrashCandidate(s, at)),
    purgeTrashEmployee: (at: string) =>
      setStore((s) => permanentlyDeleteTrashEmployee(s, at)),
    purgeTrashMonth: (at: string) =>
      setStore((s) => permanentlyDeleteTrashMonth(s, at)),
    purgeTrashCandidate: (at: string) =>
      setStore((s) => permanentlyDeleteTrashCandidate(s, at)),
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
    postWarehouseTransfer: warehouse.postWarehouseTransfer,
    cancelWarehouseDocument: warehouse.cancelWarehouseDocument,
    mergeWarehouseInvoiceRegistry: warehouse.mergeWarehouseInvoiceRegistry,
    runWarehouseInventory: warehouse.runWarehouseInventory,
    postWarehouseInventoryRevision: warehouse.postWarehouseInventoryRevision,
    postWarehouseOpeningBalances: warehouse.postWarehouseOpeningBalances,
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
    upsertCounterparty: directories.upsertCounterparty,
    removeCounterparty: directories.removeCounterparty,
    upsertFinishedProduct: directories.upsertFinishedProduct,
    removeFinishedProduct: directories.removeFinishedProduct,
    upsertPackagingRecipe: directories.upsertPackagingRecipe,
    removePackagingRecipe: directories.removePackagingRecipe,
    upsertFormulationRecipe: directories.upsertFormulationRecipe,
    removeFormulationRecipe: directories.removeFormulationRecipe,
    postFormulationBatchMix: formulationBatch.postFormulationBatchMix,
    confirmFormulationBatch: formulationBatch.confirmFormulationBatch,
    rejectFormulationBatch: formulationBatch.rejectFormulationBatch,
    createMixTask: mixTasks.createMixTask,
    updateMixTask: mixTasks.updateMixTask,
    cancelMixTask: mixTasks.cancelMixTask,
    completeMixTask: mixTasks.completeMixTask,
    upsertSalesOrder: sales.upsertSalesOrder,
    removeSalesOrder: sales.removeSalesOrder,
    setSalesOrderStatus: sales.setSalesOrderStatus,
    planSalesLine: sales.planSalesLine,
    planAllSalesLines: sales.planAllSalesLines,
    createLoadingShipmentsFromSalesOrder: sales.createLoadingShipmentsFromSalesOrder,
    createCombinedLoadingFromSalesOrder: sales.createCombinedLoadingFromSalesOrder,
    appendAiChatEntries: aiChat.appendAiChatEntries,
    addSuggestion: aiChat.addSuggestion,
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
    upsertWastewaterCube: wastewater.upsertWastewaterCube,
    createWastewaterCube: wastewater.createWastewaterCube,
    applyWastewaterCubeTransition: wastewater.applyWastewaterCubeTransition,
    removeWastewaterCube: wastewater.removeWastewaterCube,
    upsertPurchaseOrder: procurement.upsertPurchaseOrder,
    createPurchaseOrder: procurement.createPurchaseOrder,
    removePurchaseOrder: procurement.removePurchaseOrder,
    addPurchaseOrderMilestone: procurement.addPurchaseOrderMilestone,
    setPurchaseOrderStatus: procurement.setPurchaseOrderStatus,
    receivePurchaseOrder: procurement.receivePurchaseOrder,
    upsertAppUser: accessSlice.upsertAppUser,
    removeAppUser: accessSlice.removeAppUser,
    setRoleViews: accessSlice.setRoleViews,
    setRoleAllowNegativeStock: accessSlice.setRoleAllowNegativeStock,
    setRoleAllowDocumentCancel: accessSlice.setRoleAllowDocumentCancel,
    setupInitialAdminPassword: accessSlice.setupInitialAdminPassword,
  }
}
