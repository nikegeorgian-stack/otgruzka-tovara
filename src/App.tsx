import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { PageLoader } from '@/components/ui/PageLoader'
import { StorageAlert } from '@/components/system/StorageAlert'
import { I18nProvider } from '@/context/I18nContext'
import { ConfirmProvider } from '@/context/ConfirmContext'
import { ModalMinimizeProvider } from '@/context/ModalMinimizeContext'
import { AppShell } from '@/components/layout/AppShell'
import { WorkspaceTaskbar } from '@/components/layout/WorkspaceTaskbar'
import { CoachProvider } from '@/context/CoachContext'
import { CoachWidget } from '@/components/ai/CoachWidget'
import { CoachHighlightOverlay } from '@/components/ai/CoachHighlightOverlay'
import type { ViewId } from '@/lib/types'
import { useAppStore } from '@/hooks/useAppStore'
import { restoreDailyBackup } from '@/lib/backup'
import { buildProcurementPageProps } from '@/lib/app/procurementProps'
import { buildWarehousePageProps } from '@/lib/app/warehouseProps'
import type { SaveDraftInput } from '@/lib/warehouse/documents'
import { runExport } from '@/lib/export'
import { importFromJson, exportToJson } from '@/lib/storage'
import { t as translate } from '@/i18n'
import type { DirectorySection } from '@/lib/directories/types'
import {
  DirectoriesPage,
  FinancePage,
  FstCloudSync,
  HrPage,
  HrInspectorPage,
  LocalDbSync,
  MonthPage,
  PlannerPage,
  ProductionPage,
  ProcurementPage,
  SettingsPage,
  SummaryPage,
  TechnologistPage,
  MixerPage,
  DirectorPage,
  JournalsPage,
  ItOfficePage,
  WarehousePage,
  MonthLayoutLabPage,
} from '@/app/lazyPages'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { WelcomeGreeting } from '@/components/auth/WelcomeGreeting'
import { AdminSetupScreen } from '@/components/auth/AdminSetupScreen'
import { USE_LOCAL_DB } from '@/lib/localDb/config'
import { useFstWebSession } from '@/context/FstWebSessionContext'
import { isWebFinanceRole, isWebHrInspectorRole, isWebHrRole, isWebProcurementRole, isWebTechnologistRole, isWebWarehouseRole, isWebWorkshopMasterRole } from '@/lib/cloud/fstWebUsers'
import { canAccessView, isSysAdmin, roleAllowsNegativeStock, roleAllowsDocumentCancel, roleAllowsDocumentUnpost } from '@/lib/access/permissions'
import { ACCESS_ROLES } from '@/lib/access/roles'
import { COACH_TARGETS } from '@/lib/ai/coachTargets'
import { webModesFromAdminCabinet } from '@/lib/access/adminCabinet'
import {
  resolveFinanceViewDefaults,
  resolveHrViewDefaults,
  resolveMonthViewDefaults,
  resolveWarehouseViewDefaults,
  type UserViewDefaults,
} from '@/lib/viewDefaults/types'
import { resolveJournalLink, type JournalNavTarget } from '@/lib/journals/navigate'

const isFstWeb = import.meta.env.VITE_FST_WEB === 'true'

function isMonthLayoutLabHash(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hash.replace(/^#\/?/, '').startsWith('dev/month-layouts')
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const app = useAppStore()
  const webSession = useFstWebSession()
  const isAdmin = isSysAdmin(app.currentUser)
  const financeActor = { id: app.currentUser?.id, name: app.currentUser?.displayName }
  const adminCabinetModes =
    isAdmin && isFstWeb ? webModesFromAdminCabinet(app.adminCabinet) : null
  const webHrMode =
    isFstWeb &&
    (isWebHrRole(app.currentUser?.roleId) || adminCabinetModes?.webHrMode === true)
  const webHrInspectorMode =
    isFstWeb &&
    (isWebHrInspectorRole(app.currentUser?.roleId) ||
      adminCabinetModes?.webHrInspectorMode === true)
  const webFinanceMode =
    isFstWeb &&
    (isWebFinanceRole(app.currentUser?.roleId) || adminCabinetModes?.webFinanceMode === true)
  const webWarehouseMode =
    isFstWeb &&
    (isWebWarehouseRole(app.currentUser?.roleId) ||
      adminCabinetModes?.webWarehouseMode === true)
  const webTechnologistMode =
    isFstWeb &&
    (isWebTechnologistRole(app.currentUser?.roleId) ||
      adminCabinetModes?.webTechnologistMode === true)
  const webProcurementMode =
    isFstWeb &&
    (isWebProcurementRole(app.currentUser?.roleId) ||
      adminCabinetModes?.webProcurementMode === true)
  const webWorkshopMasterMode =
    isFstWeb &&
    (isWebWorkshopMasterRole(app.currentUser?.roleId) ||
      adminCabinetModes?.webWorkshopMasterMode === true)
  const workshopMasterMode =
    webWorkshopMasterMode || app.currentUser?.roleId === 'workshop_master'
  const webUserName = webSession.profile?.displayName
  const allowNegativeStock = app.currentUser
    ? roleAllowsNegativeStock(app.store.access, app.currentUser.roleId)
    : false
  const canCancelDocuments = app.currentUser
    ? roleAllowsDocumentCancel(app.store.access, app.currentUser.roleId)
    : false
  const canUnpostDocuments = roleAllowsDocumentUnpost(app.currentUser)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [plannerFocusOrderId, setPlannerFocusOrderId] = useState<string | null>(null)
  const [journalNav, setJournalNav] = useState<JournalNavTarget | null>(null)
  const [monthLayoutLab, setMonthLayoutLab] = useState(isMonthLayoutLabHash)

  useEffect(() => {
    const onHash = () => setMonthLayoutLab(isMonthLayoutLabHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const saveViewDefaults = useCallback(
    <K extends keyof UserViewDefaults>(viewId: K, patch: NonNullable<UserViewDefaults[K]>) => {
      if (app.currentUser?.id) {
        app.updateUserViewDefaults(app.currentUser.id, viewId, patch)
      }
    },
    [app.currentUser?.id, app.updateUserViewDefaults],
  )

  const userMonthDefaults = useMemo(
    () =>
      resolveMonthViewDefaults(
        app.currentUser?.viewDefaults,
        app.currentUser?.defaultBrigades,
      ),
    [
      app.currentUser?.viewDefaults?.month?.layout,
      app.currentUser?.viewDefaults?.month?.groupMode,
      app.currentUser?.viewDefaults?.month?.rowSort,
      app.currentUser?.viewDefaults?.month?.viewDisplay,
      app.currentUser?.viewDefaults?.month?.defaultBrigades,
      app.currentUser?.defaultBrigades,
    ],
  )

  const ensureActiveMonthReady = useCallback(() => {
    app.ensureMonthsReady(app.activeMonth)
  }, [app.ensureMonthsReady, app.activeMonth])

  const coachAllowedViews = app.currentUser
    ? COACH_TARGETS.map((target) => target.view).filter((v) =>
        canAccessView(app.access, app.currentUser!, v as ViewId),
      )
    : []
  const coachRoleLabel = app.currentUser
    ? ACCESS_ROLES.find((r) => r.id === app.currentUser!.roleId)?.[
        app.store.settings.locale === 'ka' ? 'labelKa' : 'labelRu'
      ]
    : undefined

  const procurementActions = {
    onUpsertOrder: app.upsertPurchaseOrder,
    onCreateOrder: app.createPurchaseOrder,
    onRemoveOrder: app.removePurchaseOrder,
    onAddMilestone: app.addPurchaseOrderMilestone,
    onSetStatus: app.setPurchaseOrderStatus,
    onReceiveOrder: app.receivePurchaseOrder,
    onUpsertCounterparty: app.upsertCounterparty,
    onUpsertWarehouseItem: app.upsertWarehouseItem,
    onNavigateToDirectory: app.navigateToDirectory,
  }

  const warehouseActions = {
    onUpsertItem: app.upsertWarehouseItem,
    onArchiveItem: app.archiveWarehouseItem,
    onRemoveItem: app.removeWarehouseItem,
    onUpsertCategory: app.upsertWarehouseCategory,
    onUpsertLocation: app.upsertWarehouseLocation,
    onRemoveCategory: app.removeWarehouseCategory,
    onRemoveLocation: app.removeWarehouseLocation,
    onAddMovement: app.addStockMovement,
    onDeleteMovement: app.deleteStockMovement,
    onPostDocument: app.postWarehouseDoc,
    onPostTransfer: app.postWarehouseTransfer,
    onCancelDocument: (documentId: string, args?: { reason?: string }) =>
      app.cancelWarehouseDocument(documentId, {
        cancelledBy: app.currentUser?.id,
        cancelledByName: app.currentUser?.displayName,
        reason: args?.reason,
      }),
    onSaveDocumentDraft: (doc: SaveDraftInput) =>
      app.saveWarehouseDocDraft(doc, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      }),
    onPostExistingDocument: (documentId: string) =>
      app.postExistingWarehouseDoc(documentId, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      }),
    onUnpostDocument: (documentId: string) => {
      if (!roleAllowsDocumentUnpost(app.currentUser)) {
        return { ok: false as const, error: 'warehouse.doc.errUnpostForbidden' }
      }
      return app.unpostWarehouseDoc(documentId, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      })
    },
    onRemoveDocumentDraft: (documentId: string) =>
      app.removeWarehouseDraft(documentId, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      }),
    onMergeInvoiceRegistry: app.mergeWarehouseInvoiceRegistry,
    onRunInventory: app.runWarehouseInventory,
    onPostInventoryRevision: app.postWarehouseInventoryRevision,
    onPostOpeningBalances: app.postWarehouseOpeningBalances,
    onAcquireDocumentLock: (documentId: string) =>
      app.acquireWarehouseDocumentLock(documentId, {
        actorId: app.currentUser?.id ?? '',
        actorName: app.currentUser?.displayName,
      }),
    onReleaseDocumentLock: (documentId: string) =>
      app.releaseWarehouseDocumentLock(documentId, app.currentUser?.id),
    onImportExcel: app.importWarehouseExcel,
    onExportExcel: (warehouseId?: string) =>
      void runExport('warehouse', app.store, { warehouseId }),
    onOpenDailyIssueSession: app.openDailyIssueSession,
    onAdjustDailyIssueLine: app.adjustDailyIssueLine,
    onSetDailyIssueComment: app.setDailyIssueComment,
    onPostDailyIssueSession: app.postDailyIssueSession,
    onResolveWarehouseItemRequest: app.resolveWarehouseItemRequest,
    onResolveWarehouseItemRenameRequest: app.resolveWarehouseItemRenameRequest,
    onCreateKeeperReplenishment: app.createKeeperReplenishment,
    onCreateReplenishmentFromDeficit: app.createReplenishmentFromDeficit,
    onUpdateKeeperReplenishment: app.updateKeeperReplenishment,
    onSubmitKeeperReplenishment: app.submitKeeperReplenishment,
    onCancelKeeperReplenishment: app.cancelKeeperReplenishment,
    onReceiveKeeperReplenishment: app.receiveKeeperReplenishment,
    onUpsertLoadingShipment: app.upsertLoadingShipment,
    onPostLoadingShipment: app.postLoadingShipment,
    onRemoveLoadingShipment: app.removeLoadingShipment,
    onUpsertCounterparty: app.upsertCounterparty,
    onOpenCounterparties: () => app.navigateToDirectory('counterparties'),
    onUpsertWorkwearCatalogItem: app.upsertWorkwearCatalogItem,
    onArchiveWorkwearCatalogItem: app.archiveWorkwearCatalogItem,
    onPostWorkwearIssuance: app.postWorkwearIssuance,
  }

  useEffect(() => {
    document.documentElement.classList.remove('dark')
  }, [])

  async function handleImport(file: File) {
    if (!confirm(translate(app.store.settings.locale, 'app.importConfirm'))) {
      return
    }
    try {
      app.replaceStore(await importFromJson(file))
      setImportNotice(null)
    } catch {
      setImportNotice(translate(app.store.settings.locale, 'app.importError'))
    }
  }

  function handleRestoreBackup(date: string) {
    if (!confirm(translate(app.store.settings.locale, 'storage.restoreConfirm'))) {
      return
    }
    const restored = restoreDailyBackup(date)
    if (restored) {
      app.replaceStore(restored)
      app.dismissLoadWarning()
    }
  }

  return (
    <I18nProvider locale={app.store.settings.locale} setLocale={app.setLocale}>
      <ConfirmProvider>
        <ModalMinimizeProvider>
        {!app.skipLocalAuth && app.adminSetupRequired ? (
          <AdminSetupScreen
            onSetup={async (password) => {
              await app.setupInitialAdminPassword(password)
              await app.login('admin', password)
            }}
          />
        ) : !app.skipLocalAuth && !app.currentUser ? (
          <LoginScreen onLogin={app.login} />
        ) : monthLayoutLab ? (
          <Suspense fallback={<PageLoader />}>
            <MonthLayoutLabPage />
          </Suspense>
        ) : (
          <CoachProvider
            aiSettings={app.store.settings.ai}
            locale={app.store.settings.locale}
            view={app.view}
            currentUser={
              app.currentUser
                ? {
                    id: app.currentUser.id,
                    displayName: app.currentUser.displayName,
                    roleId: app.currentUser.roleId,
                  }
                : null
            }
            roleLabel={coachRoleLabel}
            allowedViews={coachAllowedViews}
            onNavigate={(v) => app.setView(v as ViewId)}
            appendAiChatEntries={app.appendAiChatEntries}
            addSuggestion={app.addSuggestion}
          >
        <StorageAlert
          loadWarning={app.loadWarning}
        saveError={app.saveError}
        onDismissLoadWarning={app.dismissLoadWarning}
        onDismissSaveError={app.dismissSaveError}
        onExportJson={() => exportToJson(app.store)}
          onRestoreFromBackup={handleRestoreBackup}
        />
        {importNotice && (
          <div className="px-4 pt-3">
            <FormNotice
              type="error"
              message={importNotice}
              onDismiss={() => setImportNotice(null)}
            />
          </div>
        )}
        <AppShell
          store={app.store}
          access={app.access}
          currentUser={app.currentUser}
          view={app.view}
          onViewChange={app.setView}
          onImport={() => fileRef.current?.click()}
          onReset={app.resetStore}
          onLogout={
            webSession.webLogout
              ? () => void webSession.webLogout!()
              : app.skipLocalAuth
                ? undefined
                : app.logout
          }
          workspaceOpen={app.workspacePanes.length > 0}
          webHrMode={webHrMode}
          webHrInspectorMode={webHrInspectorMode}
          webFinanceMode={webFinanceMode}
          webWarehouseMode={webWarehouseMode}
          webTechnologistMode={webTechnologistMode}
          webProcurementMode={webProcurementMode}
          webWorkshopMasterMode={webWorkshopMasterMode}
          adminCabinet={isAdmin ? app.adminCabinet : undefined}
          onAdminCabinetChange={isAdmin ? app.setAdminCabinet : undefined}
          isFstWeb={isFstWeb}
          webAccount={
            isFstWeb && webSession.profile
              ? {
                  displayName: webSession.profile.displayName,
                  email: webSession.profile.email,
                }
              : undefined
          }
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImport(file)
              e.target.value = ''
            }}
          />

          <Suspense fallback={<PageLoader />}>
          {app.view === 'month' && (
            <MonthPage
              store={app.store}
              month={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              onPatch={app.patch}
              onCycle={(rowId, dateKey, mode) =>
                app.cycleMark(app.activeMonth, rowId, dateKey, mode)
              }
              onSetCode={(rowId, dateKey, code, mode) =>
                app.setMark(app.activeMonth, rowId, dateKey, mode, code)
              }
              onSetFactExtra={(rowId, dateKey, hours) =>
                app.setFactExtraHours(
                  app.activeMonth,
                  rowId,
                  dateKey,
                  Math.max(0, Math.min(6, hours)) as import('@/lib/factExtra').FactExtraHours,
                )
              }
              onAssign={(rowId, empId) =>
                app.assignRowEmployee(app.activeMonth, rowId, empId)
              }
              onRegenerateRow={(rowId) => app.regenerateRowPlan(app.activeMonth, rowId)}
              onAddRow={(brigade) => app.addBrigadeRowToMonth(app.activeMonth, brigade)}
              onRemoveRow={(rowId) => app.removeBrigadeRowFromMonth(app.activeMonth, rowId)}
              onRemoveEmptyRow={(brigade) =>
                app.removeEmptyBrigadeRowFromMonth(app.activeMonth, brigade)
              }
              onRegenerateMonth={() => app.regenerateMonthPlan(app.activeMonth)}
              onBulkHolidayV={() => app.bulkHolidayV(app.activeMonth)}
              onBulkCopyPlanToFact={(scope, brigade) =>
                app.bulkCopyPlanToFact(app.activeMonth, scope, brigade)
              }
              onApplyShiftTemplate={(templateId, brigade) =>
                app.applyShiftTemplateBrigadeAndRegenerate(
                  app.activeMonth,
                  templateId,
                  brigade,
                )
              }
              onExportExcel={() =>
                void runExport('timesheet', app.store, {
                  month: app.activeMonth,
                  locale: app.store.settings.locale,
                })
              }
              onAddBrigade={app.addBrigade}
              onRenameBrigade={app.renameBrigade}
              onRemoveBrigade={app.removeBrigade}
              onSetBrigadeNameKa={app.setBrigadeNameKa}
              onSetBrigadeUnit={app.setBrigadeUnit}
              onMarkBrigadier={(rowId, dateKey, on) =>
                app.setBrigadierDay(app.activeMonth, rowId, dateKey, on)
              }
              onMarkBrigadierMonth={(rowId, on) =>
                app.setBrigadierMonth(app.activeMonth, rowId, on)
              }
              onSetFactHours={(rowId, dateKey, hours) =>
                app.setFactHours(app.activeMonth, rowId, dateKey, hours)
              }
              onAddDayWorker={(brigade, employeeId, dateKey, code) =>
                app.addBrigadeDayWorker(app.activeMonth, brigade, employeeId, dateKey, code)
              }
              onAssignPermanent={(employeeId, brigade) =>
                app.assignPermanentToBrigade(app.activeMonth, employeeId, brigade)
              }
              onSetComment={(rowId, dateKey, text) =>
                app.setCellComment(app.activeMonth, rowId, dateKey, text)
              }
              onSetSubstitution={(rowId, dateKey, sub) =>
                app.setSubstitution(app.activeMonth, rowId, dateKey, sub)
              }
              onClearSubstitution={(rowId, dateKey) =>
                app.clearSubstitution(app.activeMonth, rowId, dateKey)
              }
              onSetBrigadeRoster={(brigade, ids, syncHr) =>
                app.setBrigadeRoster(app.activeMonth, brigade, ids, syncHr)
              }
              onChangeGroup2x2={(_rowId, employeeId, group) => {
                app.changeEmployeeAttributesFromDay(app.activeMonth, employeeId, 1, {
                  group2x2: group,
                })
              }}
              onSetCycleFromDay={(_rowId, employeeId, day, variant) =>
                app.setEmployeeCycleFromDay(app.activeMonth, employeeId, day, variant)
              }
              onSetBrigadier={app.setBrigadier}
              onUpsertEmployee={app.upsertEmployee}
              onTourComplete={() => app.updateSettings({ tourCompleted: true })}
              onCloseMonth={() =>
                app.setMonthClosed(app.activeMonth, true, {
                  id: app.currentUser?.id,
                  name: app.currentUser?.displayName,
                })
              }
              onReopenMonth={() =>
                app.setMonthClosed(app.activeMonth, false, {
                  id: app.currentUser?.id,
                  name: app.currentUser?.displayName,
                })
              }
              canReopen={
                app.currentUser?.roleId === 'sysadmin' ||
                app.currentUser?.roleId === 'operations_director'
              }
              workshopMasterMode={workshopMasterMode}
              workshopMasterLogin={app.currentUser?.login}
              workshopMasterEmployeeId={app.currentUser?.employeeId}
              userDefaultBrigades={app.currentUser?.defaultBrigades}
              userMonthDefaults={userMonthDefaults}
              currentUserId={app.currentUser?.id}
              onEnsureMonthReady={ensureActiveMonthReady}
              onSaveMonthDefaults={(defaults) => saveViewDefaults('month', defaults)}
            />
          )}
          {app.view === 'hr' && (
            <HrPage
              store={app.store}
              month={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              initialSection={
                resolveHrViewDefaults(app.currentUser?.viewDefaults)?.section ?? app.hrSection
              }
              employees={app.store.employees}
              hrStructuralUnits={app.store.hrStructuralUnits}
              hrPositions={app.store.hrPositions}
              brigades={app.store.brigades}
              currentUser={app.currentUser}
              candidates={app.store.candidates}
              onSaveEmployee={app.upsertEmployee}
              onRemoveEmployee={app.removeEmployee}
              onUpsertCandidate={app.upsertCandidate}
              onRemoveCandidate={app.removeCandidate}
              onHireCandidate={app.hireCandidate}
              onSetEmployeeFactRange={app.setEmployeeFactRange}
              onRestoreTrashEmployee={app.restoreTrashEmployee}
              onPurgeTrashEmployee={app.purgeTrashEmployee}
              onRestoreTrashCandidate={app.restoreTrashCandidate}
              onPurgeTrashCandidate={app.purgeTrashCandidate}
              onUpsertPosition={app.upsertHrPosition}
              onImportEmployeeRegistry={app.importEmployeeRegistry}
              onClearAllPersonnel={app.clearAllPersonnel}
              onSectionChange={app.setHrSection}
              webHrMode={webHrMode}
              workshopMasterMode={workshopMasterMode}
              webUserName={app.currentUser?.displayName}
              userHrDefaults={resolveHrViewDefaults(app.currentUser?.viewDefaults)}
              currentUserId={app.currentUser?.id}
              onSaveViewDefaults={saveViewDefaults}
            />
          )}
          {app.view === 'hr_inspector' && (
            <HrInspectorPage
              employees={app.store.employees}
              brigades={app.store.brigades}
              hrStructuralUnits={app.store.hrStructuralUnits}
              hrPositions={app.store.hrPositions}
              existingMonthKeys={Object.keys(app.store.months)}
              site={app.store.settings.site}
              responsible={app.store.settings.responsible}
              webInspectorMode={webHrInspectorMode}
              webUserName={webUserName}
              onSaveEmployee={app.upsertEmployee}
              onSetEmployeeFactRange={app.setEmployeeFactRange}
            />
          )}
          {app.view === 'finance' && (
            <FinancePage
              store={app.store}
              month={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              onSaveEmployee={app.upsertEmployee}
              onRemoveEmployee={app.removeEmployee}
              brigades={app.store.brigades}
              hrStructuralUnits={app.store.hrStructuralUnits}
              hrPositions={app.store.hrPositions}
              onUpsertPosition={app.upsertHrPosition}
              onRemovePosition={app.removeHrPosition}
              onUpsertStructuralUnit={app.upsertHrStructuralUnit}
              onRemoveStructuralUnit={app.removeHrStructuralUnit}
              onImportOrgStructureFromSeed={app.importOrgStructureFromSeed}
              actions={{
                onGiveAdvance: (input) => app.giveAdvance(input, financeActor),
                onRemoveAdvance: (id) => app.removeAdvance(id, financeActor),
                onAddAdjustment: (input) => app.addAdjustment(input, financeActor),
                onRemoveAdjustment: (id) => app.removeAdjustment(id, financeActor),
                onAddPayout: (input) => app.addPayout(input, financeActor),
                onRemovePayout: (id) => app.removePayout(id, financeActor),
                onConfirmSick: (input) => app.confirmSick(input, financeActor),
                onUnconfirmSick: (employeeId, month) =>
                  app.unconfirmSick(employeeId, month, financeActor),
                onSetBrigadierBonus: (amount) =>
                  app.updateSettings({ brigadierBonus: amount }),
              }}
              webFinanceMode={webFinanceMode}
              webUserName={app.currentUser?.displayName}
              userFinanceDefaults={resolveFinanceViewDefaults(app.currentUser?.viewDefaults)}
              currentUserId={app.currentUser?.id}
              onSaveViewDefaults={saveViewDefaults}
            />
          )}
          {app.view === 'production' && (
            <ProductionPage
              requests={app.store.production.requests}
              orders={app.store.production.planner.orders}
              employees={app.store.employees}
              brigades={app.store.brigades}
              brigadeNamesKa={app.store.brigadeNamesKa}
              monthSheet={app.store.months[app.activeMonth] ?? null}
              activeMonth={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              onSaveRequest={app.upsertProductionRequest}
              onRemoveRequest={app.removeProductionRequest}
              onGenerateFromPlanner={app.generatePlannerProductionRequests}
              branchWorkspace={app.branchWorkspace}
              clearWorkspaceDraft={app.clearWorkspaceDraft}
              workspaceRestoreSeq={app.workspaceRestoreSeq}
              workspaceDrafts={app.workspaceDrafts}
              focusRequestId={
                journalNav?.view === 'production' ? journalNav.productionRequestId : null
              }
              onJournalFocusConsumed={() => setJournalNav(null)}
            />
          )}
          {app.view === 'planner' && (
            <PlannerPage
              orders={app.store.production.planner.orders}
              requests={app.store.production.requests}
              counterparties={app.store.counterparties.items}
              finishedProducts={app.store.finishedProducts.items}
              packagingRecipes={app.store.packagingRecipes.items}
              formulationRecipes={app.store.formulations.recipes}
              warehouseItems={app.store.warehouse.items}
              warehouseCategories={app.store.warehouse.categories}
              warehouseMovements={app.store.warehouse.movements}
              activeMonth={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              onSaveOrder={app.upsertProductionOrder}
              onRemoveOrder={app.removeProductionOrder}
              onActivateOrder={app.activateProductionOrder}
              onRecalculateOrder={app.recalculateProductionOrder}
              onNavigateToDirectory={app.navigateToDirectory}
              branchWorkspace={app.branchWorkspace}
              clearWorkspaceDraft={app.clearWorkspaceDraft}
              workspaceRestoreSeq={app.workspaceRestoreSeq}
              workspaceDrafts={app.workspaceDrafts}
              onGenerateRequest={app.generatePlannerProductionRequests}
              onReserveMaterials={app.reserveProductionOrderMaterials}
              onUnreserveMaterials={app.unreserveProductionOrderMaterials}
              salesOrders={app.store.sales.orders}
              onOpenSalesOrder={() => app.setView('director')}
              focusOrderId={plannerFocusOrderId}
              onFocusOrderConsumed={() => setPlannerFocusOrderId(null)}
            />
          )}
          {app.view === 'summary' && (
            <SummaryPage store={app.store} onNavigate={app.setView} />
          )}
          {app.view === 'directories' && (
            <DirectoriesPage
              store={app.store}
              initialSection={app.directorySection as DirectorySection}
              employees={app.store.employees}
              brigades={app.store.brigades}
              hrStructuralUnits={app.store.hrStructuralUnits}
              hrPositions={app.store.hrPositions}
              onSaveEmployee={app.upsertEmployee}
              onRemoveEmployee={app.removeEmployee}
              onUpsertPosition={app.upsertHrPosition}
              onRemovePosition={app.removeHrPosition}
              onUpsertStructuralUnit={app.upsertHrStructuralUnit}
              onRemoveStructuralUnit={app.removeHrStructuralUnit}
              onImportOrgStructureFromSeed={app.importOrgStructureFromSeed}
              onAddBrigade={app.addBrigade}
              onRenameBrigade={app.renameBrigade}
              onRemoveBrigade={app.removeBrigade}
              onSetBrigadeNameKa={app.setBrigadeNameKa}
              onSetBrigadeUnit={app.setBrigadeUnit}
              onRemoveCounterparty={app.removeCounterparty}
              onUpsertFinishedProduct={app.upsertFinishedProduct}
              onRemoveFinishedProduct={app.removeFinishedProduct}
              onUpsertPackagingRecipe={app.upsertPackagingRecipe}
              onRemovePackagingRecipe={app.removePackagingRecipe}
              onUpsertFormulationRecipe={app.upsertFormulationRecipe}
              onRemoveFormulationRecipe={app.removeFormulationRecipe}
              branchWorkspace={app.branchWorkspace}
              clearWorkspaceDraft={app.clearWorkspaceDraft}
              workspaceRestoreSeq={app.workspaceRestoreSeq}
              workspaceDrafts={app.workspaceDrafts}
              webWarehouseMode={webWarehouseMode}
              webProcurementMode={webProcurementMode}
              warehouse={app.store.warehouse}
              printMeta={{
                site: app.store.settings.site,
                responsible: app.store.settings.responsible,
                signatures: app.store.settings.signatures,
                locale: app.store.settings.locale,
              }}
              {...warehouseActions}
            />
          )}
          {app.view === 'warehouse' && (
            <WarehousePage
              {...buildWarehousePageProps({
                store: app.store,
                brigades: app.store.brigades,
                actions: warehouseActions,
                onSaveProductionRequest: app.upsertProductionRequest,
                onPostProductionRequest: app.postProductionRequest,
              })}
              webWarehouseMode={webWarehouseMode}
              webUserName={webUserName}
              journalNav={journalNav?.view === 'warehouse' ? journalNav : null}
              onJournalNavConsumed={() => setJournalNav(null)}
              keeperId={app.currentUser?.id}
              keeperName={
                app.currentUser?.displayName ??
                app.store.settings.responsible ??
                'Кладовщик'
              }
              allowNegativeStock={allowNegativeStock}
              canCancelDocuments={canCancelDocuments}
              canUnpostDocuments={canUnpostDocuments}
              pendingBatchRuns={app.store.formulations.batchRuns.filter(
                (r) => (r.status ?? 'confirmed') === 'pending',
              )}
              finishedProducts={app.store.finishedProducts.items.filter((p) => p.active)}
              packagingRecipes={app.store.packagingRecipes.items.filter((r) => r.active)}
              onUpsertFinishedProduct={app.upsertFinishedProduct}
              onConfirmFormulationBatch={(runId, keeper, options) =>
                app.confirmFormulationBatch(runId, keeper, {
                  allowNegativeStock,
                  ...options,
                })
              }
              onRejectFormulationBatch={(runId, keeper, reason) =>
                app.rejectFormulationBatch(runId, keeper, reason)
              }
              onOpenSalesOrder={() => app.setView('director')}
              userWarehouseDefaults={resolveWarehouseViewDefaults(app.currentUser?.viewDefaults)}
              currentUserId={app.currentUser?.id}
              onSaveViewDefaults={saveViewDefaults}
            />
          )}
          {app.view === 'procurement' && (
            <ProcurementPage
              {...buildProcurementPageProps(app.store, procurementActions)}
              webProcurementMode={webProcurementMode}
              focusOrderId={
                journalNav?.view === 'procurement' ? journalNav.procurementOrderId : null
              }
              onJournalFocusConsumed={() => setJournalNav(null)}
            />
          )}
          {app.view === 'technologist' && (
            <TechnologistPage
              formulations={app.store.formulations}
              technologistQc={app.store.technologistQc}
              wastewater={app.store.wastewater}
              warehouse={app.store.warehouse}
              plannerOrders={app.store.production.planner.orders}
              brigades={app.store.brigades}
              operatorId={app.currentUser?.id}
              operatorName={
                app.currentUser?.displayName ??
                app.store.settings.responsible ??
                'Технолог'
              }
              allowNegativeStock={allowNegativeStock}
              webTechnologistMode={webTechnologistMode}
              webUserName={webUserName}
              site={app.store.settings.site}
              onUpsertRecipe={app.upsertFormulationRecipe}
              onUpsertWarehouseItem={app.upsertWarehouseItem}
              onPostBatch={(input) =>
                app.postFormulationBatchMix(input, app.store.settings.locale, {
                  allowNegativeStock,
                })
              }
              onCreateMixTask={app.createMixTask}
              onCancelMixTask={app.cancelMixTask}
              onAssignProductionOrderRecipe={(orderId, recipeId) =>
                app.assignProductionOrderFormulationRecipe(
                  orderId,
                  recipeId,
                  app.currentUser?.displayName ??
                    app.store.settings.responsible ??
                    'Технолог',
                )
              }
              onRequestItem={app.createWarehouseItemRequest}
              onProposeRename={app.createWarehouseItemRenameRequest}
              onUpsertEadCalculation={app.upsertEadCalculation}
              onRemoveEadCalculation={app.removeEadCalculation}
              onUpsertEadControl={app.upsertEadControl}
              onRemoveEadControl={app.removeEadControl}
              onUpsertIncomingControl={app.upsertIncomingControl}
              onRemoveIncomingControl={app.removeIncomingControl}
              onUpsertImpregnationQc={app.upsertImpregnationQc}
              onRemoveImpregnationQc={app.removeImpregnationQc}
              onAddRoomClimateReading={app.addRoomClimateReading}
              onRemoveRoomClimateReading={app.removeRoomClimateReading}
              onCreateWastewaterCube={app.createWastewaterCube}
              onUpsertWastewaterCube={app.upsertWastewaterCube}
              onApplyWastewaterCubeTransition={app.applyWastewaterCubeTransition}
              onRemoveWastewaterCube={app.removeWastewaterCube}
            />
          )}
          {app.view === 'mixer' && (
            <MixerPage
              formulations={app.store.formulations}
              technologistQc={app.store.technologistQc}
              warehouse={app.store.warehouse}
              brigades={app.store.brigades}
              operatorId={app.currentUser?.id}
              operatorName={
                app.currentUser?.displayName ?? app.store.settings.responsible ?? 'Миксер'
              }
              allowNegativeStock={allowNegativeStock}
              site={app.store.settings.site}
              webUserName={webUserName}
              onPostBatch={(input) =>
                app.postFormulationBatchMix(input, app.store.settings.locale, {
                  allowNegativeStock,
                })
              }
              onCompleteMixTask={app.completeMixTask}
              onAddRoomClimateReading={app.addRoomClimateReading}
              onRemoveRoomClimateReading={app.removeRoomClimateReading}
            />
          )}
          {app.view === 'director' && (
            <DirectorPage
              sales={app.store.sales}
              plannerOrders={app.store.production.planner.orders}
              requests={app.store.production.requests}
              counterparties={app.store.counterparties.items}
              finishedProducts={app.store.finishedProducts.items}
              webUserName={webUserName}
              onUpsertSalesOrder={app.upsertSalesOrder}
              onRemoveSalesOrder={app.removeSalesOrder}
              onSetSalesOrderStatus={app.setSalesOrderStatus}
              onPlanSalesLine={app.planSalesLine}
              onPlanAllSalesLines={app.planAllSalesLines}
              onCreateLoadingShipmentsFromSalesOrder={app.createLoadingShipmentsFromSalesOrder}
              onCreateCombinedLoadingFromSalesOrder={app.createCombinedLoadingFromSalesOrder}
              loadingShipments={app.store.warehouse.loadingShipments ?? []}
              onOpenWarehouseLoading={() => app.setView('warehouse')}
              onOpenPlanner={(productionOrderId) => {
                setPlannerFocusOrderId(productionOrderId)
                app.setView('planner')
              }}
              focusSalesOrderId={
                journalNav?.view === 'director' ? journalNav.salesOrderId : null
              }
              onJournalFocusConsumed={() => setJournalNav(null)}
              erpInput={{
                procurement: app.store.procurement,
                warehouse: app.store.warehouse,
                months: app.store.months,
                employees: app.store.employees,
              }}
              onErpNavigate={app.setView}
            />
          )}
          {app.view === 'journals' && (
            <JournalsPage
              store={app.store}
              currentUser={app.currentUser}
              scope={{
                webHrMode,
                webHrInspectorMode,
                webFinanceMode,
                webWarehouseMode,
                webTechnologistMode,
                webProcurementMode,
                webWorkshopMasterMode,
              }}
              onOpenEntry={(link, mode) => {
                const nav = resolveJournalLink(link, mode)
                if (!nav) return
                setJournalNav(nav)
                app.setView(nav.view)
                if (nav.view === 'month' && 'month' in nav) {
                  app.setActiveMonth(nav.month)
                }
              }}
            />
          )}
          {app.view === 'it' && (
            <ItOfficePage
              itOffice={app.store.itOffice}
              employees={app.store.employees}
              operatorId={app.currentUser?.id ?? ''}
              operatorName={app.currentUser?.displayName ?? ''}
              onUpsertItAsset={app.upsertItAsset}
              onRemoveItAsset={app.removeItAsset}
              onUpsertItCatalogItem={app.upsertItCatalogItem}
              onUpsertItHandoverActDraft={app.upsertItHandoverActDraft}
              onPostItHandoverAct={app.postItHandoverAct}
              onRemoveItHandoverActDraft={app.removeItHandoverActDraft}
              onUpsertItMaintenance={app.upsertItMaintenance}
              onRemoveItMaintenance={app.removeItMaintenance}
              onUpsertItConsumableSpec={app.upsertItConsumableSpec}
              onSetItConsumableBalance={app.setItConsumableBalance}
              onPostItConsumableIssue={app.postItConsumableIssue}
            />
          )}
          {app.view === 'settings' && (
            <SettingsPage
              store={app.store}
              currentUser={app.currentUser}
              onUpsertAppUser={app.upsertAppUser}
              onRemoveAppUser={app.removeAppUser}
              onSetRoleViews={app.setRoleViews}
              onSetRoleAllowNegativeStock={app.setRoleAllowNegativeStock}
              onSetRoleAllowDocumentCancel={app.setRoleAllowDocumentCancel}
              onSetWarehouseMonthClosed={app.setWarehouseMonthClosed}
              onAddMonth={app.addMonth}
              onRemoveMonth={app.removeMonth}
              onArchiveMonth={app.archiveMonth}
              onSyncMonthRosterFromHr={app.syncMonthRosterFromHr}
              onSetMonthClosed={(month, closed) =>
                app.setMonthClosed(month, closed, {
                  id: app.currentUser?.id,
                  name: app.currentUser?.displayName,
                })
              }
              canReopenMonth={
                app.currentUser?.roleId === 'sysadmin' ||
                app.currentUser?.roleId === 'operations_director'
              }
              onUpdateSettings={app.updateSettings}
              onRestoreTrashEmployee={app.restoreTrashEmployee}
              onRestoreTrashMonth={app.restoreTrashMonth}
              onPurgeTrashEmployee={app.purgeTrashEmployee}
              onPurgeTrashMonth={app.purgeTrashMonth}
              onReplaceStore={app.replaceStore}
            />
          )}
          </Suspense>
        </AppShell>

        {app.currentUser?.active && (
          <WelcomeGreeting user={app.currentUser} employees={app.store.employees} />
        )}

        <WorkspaceTaskbar
          panes={app.workspacePanes}
          activePaneId={app.activeWorkspacePaneId}
          onActivate={app.activateWorkspacePane}
          onClose={app.closeWorkspacePane}
        />

        {USE_LOCAL_DB && !isFstWeb && (
          <Suspense fallback={null}>
            <LocalDbSync
              store={app.store}
              replaceStore={app.replaceStore}
              onSaveError={app.reportSaveError}
            />
          </Suspense>
        )}
        {isFstWeb && (
          <Suspense fallback={null}>
            <FstCloudSync store={app.store} replaceStore={app.replaceStore} />
          </Suspense>
        )}
        <CoachWidget />
        <CoachHighlightOverlay />
          </CoachProvider>
        )}
        </ModalMinimizeProvider>
      </ConfirmProvider>
    </I18nProvider>
  )
}
