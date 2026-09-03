import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { PageLoader } from '@/components/ui/PageLoader'
import { StorageAlert } from '@/components/system/StorageAlert'
import { I18nProvider } from '@/context/I18nContext'
import { ConfirmProvider } from '@/context/ConfirmContext'
import { ModalMinimizeProvider } from '@/context/ModalMinimizeContext'
import { EmployeeEditorProvider } from '@/context/EmployeeEditorContext'
import { AppShell } from '@/components/layout/AppShell'
import { WorkspaceTaskbar } from '@/components/layout/WorkspaceTaskbar'
import { ShiftUrgentBar } from '@/components/ops/ShiftUrgentBar'
import {
  computeShiftUrgentInbox,
  type ShiftUrgentTarget,
} from '@/lib/ops/shiftUrgentInbox'
import { CoachProvider } from '@/context/CoachContext'
import { SupportChromeProvider } from '@/context/SupportChromeContext'
import { CoachWidget } from '@/components/ai/CoachWidget'
import { CoachHighlightOverlay } from '@/components/ai/CoachHighlightOverlay'
import { FeedbackWidget } from '@/components/ai/FeedbackWidget'
import { FeedbackAdminBell } from '@/components/ai/FeedbackAdminBell'
import {
  MaintenanceBanner,
  buildFiveMinuteMaintenance,
} from '@/components/layout/MaintenanceBanner'
import type { ViewId } from '@/lib/types'
import { useAppStore } from '@/hooks/useAppStore'
import { restoreDailyBackup } from '@/lib/backup'
import { BULK_BLOCKED_MESSAGE } from '@/lib/cloud/bulkStoreOverwrite'
import { buildProcurementPageProps } from '@/lib/app/procurementProps'
import { buildWarehousePageProps } from '@/lib/app/warehouseProps'
import { isSqlConnectPersistence } from '@/lib/sqlconnect/config'
import type { SaveDraftInput } from '@/lib/warehouse/documents'
import { runExport } from '@/lib/export'
import {
  employeeIdForRow,
  employeeIdsInMonth,
  notifyAbsenceDecisionPush,
  notifyBrigadierPush,
  notifyFeedbackReplyPush,
  notifyForTimesheetCode,
  notifyPersonalDayPush,
  notifySchedulePush,
} from '@/lib/cloud/fstPushNotify'
import { nextCode } from '@/lib/codes'
import { isMonthClosed } from '@/lib/monthManage'
import { getFactMark } from '@/lib/stats'
import { importFromJson, exportToJson } from '@/lib/storage'
import { isFstAdminEmail } from '@/lib/cloud/fstAdmin'
import { t as translate } from '@/i18n'
import type { DirectorySection } from '@/lib/directories/types'
import {
  DirectoriesPage,
  FinancePage,
  FstCloudSync,
  FstSqlConnectSync,
  HrPage,
  HrInspectorPage,
  LocalDbSync,
  MonthPage,
  MyCabinetPage,
  TimeclockPage,
  PlannerPage,
  ProductionPage,
  ProcurementPage,
  SettingsPage,
  SummaryPage,
  TechnologistPage,
  OtcPage,
  MixerPage,
  DirectorPage,
  JournalsPage,
  EngineerLogPage,
  TasksPage,
  ItOfficePage,
  OfficePage,
  MealsPage,
  ProtocolsPage,
  OrgTreePage,
  WarehousePage,
  MonthLayoutLabPage,
  prefetchView,
} from '@/app/lazyPages'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { AdminSetupScreen } from '@/components/auth/AdminSetupScreen'
import { USE_LOCAL_DB } from '@/lib/localDb/config'
import { useFstWebSession } from '@/context/FstWebSessionContext'
import { useFstAuthOptional } from '@/context/FstAuthContext'
import { FstChangePasswordScreen } from '@/components/web/FstChangePasswordScreen'
import {
  isPasswordChangeComplete,
  markPasswordChangeComplete,
} from '@/lib/cloud/passwordChangeSession'
import { isWebFinanceRole, isWebHrInspectorRole, isWebHrRole, isWebProcurementRole, isWebSysAdminRole, isWebTechnologistRole, isWebWarehouseRole, isWebWorkshopMasterRole } from '@/lib/cloud/fstWebUsers'
import { accessPersona } from '@/lib/access/accessPersona'
import { canAccessView, canEditEmployeeSalary, isSysAdmin, roleAllowsNegativeStock, roleAllowsDocumentCancel } from '@/lib/access/permissions'
import { labelRuKa } from '@/i18n/localeFormat'
import { ACCESS_ROLES } from '@/lib/access/roles'
import { COACH_TARGETS } from '@/lib/ai/coachTargets'
import {
  resolveFinanceViewDefaults,
  resolveHrViewDefaults,
  resolveMonthViewDefaults,
  resolveWarehouseViewDefaults,
  type UserViewDefaults,
} from '@/lib/viewDefaults/types'
import { resolveJournalLink, type JournalNavTarget } from '@/lib/journals/navigate'
import { terminationSegments } from '@/lib/hr/timesheetRange'

const isFstWeb = import.meta.env.VITE_FST_WEB === 'true'
const useSqlConnect = isSqlConnectPersistence()

function isMonthLayoutLabHash(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hash.replace(/^#\/?/, '').startsWith('dev/month-layouts')
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const app = useAppStore()
  const webSession = useFstWebSession()
  const fstAuth = useFstAuthOptional()
  const webEmail = fstAuth?.user?.email?.trim().toLowerCase()
  const [passwordGateDismissed, setPasswordGateDismissed] = useState(false)
  useEffect(() => {
    setPasswordGateDismissed(false)
  }, [webEmail])
  const passwordCheckPending =
    isFstWeb &&
    Boolean(webEmail) &&
    !passwordGateDismissed &&
    !isPasswordChangeComplete(webEmail) &&
    fstAuth?.claimsLoading === true
  const needsPasswordChange = useMemo(() => {
    if (!isFstWeb || !webEmail || passwordGateDismissed || isPasswordChangeComplete(webEmail)) {
      return false
    }
    if (fstAuth?.claimsLoading) return false
    if (fstAuth?.mustChangePasswordClaim === true) return true
    // Claim снят — Firebase главнее устаревшего флага в store после sync.
    if (fstAuth?.mustChangePasswordClaim === false) return false
    return app.currentUser?.mustChangePassword === true
  }, [
    webEmail,
    passwordGateDismissed,
    fstAuth?.claimsLoading,
    fstAuth?.mustChangePasswordClaim,
    app.currentUser?.mustChangePassword,
  ])
  const isAdmin = isSysAdmin(app.currentUser)
  const accessUser = useMemo(
    () => accessPersona(app.currentUser, app.adminCabinet) ?? null,
    [app.currentUser, app.adminCabinet],
  )
  const financeActor = { id: app.currentUser?.id, name: app.currentUser?.displayName }
  const pushAccess = app.store.access
  const financeActions = {
    onGiveAdvance: (input: Parameters<typeof app.giveAdvance>[0]) =>
      app.giveAdvance(input, financeActor),
    onRemoveAdvance: (id: string) => app.removeAdvance(id, financeActor),
    onAddAdjustment: (input: Parameters<typeof app.addAdjustment>[0]) =>
      app.addAdjustment(input, financeActor),
    onRemoveAdjustment: (id: string) => app.removeAdjustment(id, financeActor),
    onAddPayout: (input: Parameters<typeof app.addPayout>[0]) =>
      app.addPayout(input, financeActor),
    onRemovePayout: (id: string) => app.removePayout(id, financeActor),
    onConfirmSick: (input: Parameters<typeof app.confirmSick>[0]) => {
      app.confirmSick(input, financeActor)
      notifyAbsenceDecisionPush(pushAccess, input.employeeId, 'sick', true, input.month)
    },
    onUnconfirmSick: (employeeId: string, month: string) => {
      app.unconfirmSick(employeeId, month, financeActor)
      notifyAbsenceDecisionPush(pushAccess, employeeId, 'sick', false, month)
    },
    onConfirmVacation: (input: Parameters<typeof app.confirmVacation>[0]) => {
      app.confirmVacation(input, financeActor)
      notifyAbsenceDecisionPush(pushAccess, input.employeeId, 'vacation', true, input.month)
    },
    onUnconfirmVacation: (employeeId: string, month: string) => {
      app.unconfirmVacation(employeeId, month, financeActor)
      notifyAbsenceDecisionPush(pushAccess, employeeId, 'vacation', false, month)
    },
    onSetBrigadierBonus: (amount: number) => app.updateSettings({ brigadierBonus: amount }),
  }
  // Веб-режимы и ACL — по эффективной персоне (превью кабинета админа = как у роли).
  const previewRoleId = accessUser?.roleId
  const webHrMode = isFstWeb && isWebHrRole(previewRoleId)
  const webHrInspectorMode = isFstWeb && isWebHrInspectorRole(previewRoleId)
  const webFinanceMode = isFstWeb && isWebFinanceRole(previewRoleId)
  const webWarehouseMode = isFstWeb && isWebWarehouseRole(previewRoleId)
  const webTechnologistMode = isFstWeb && isWebTechnologistRole(previewRoleId)
  const webProcurementMode = isFstWeb && isWebProcurementRole(previewRoleId)
  const webWorkshopMasterMode = isFstWeb && isWebWorkshopMasterRole(previewRoleId)
  const webAdminMode = isFstWeb && isWebSysAdminRole(previewRoleId)
  const workshopMasterMode =
    webWorkshopMasterMode || previewRoleId === 'workshop_master'
  const webUserName = webSession.profile?.displayName
  const allowNegativeStock = accessUser
    ? roleAllowsNegativeStock(app.store.access, accessUser.roleId)
    : false
  const canCancelDocuments = accessUser
    ? roleAllowsDocumentCancel(app.store.access, accessUser.roleId)
    : false
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [plannerFocusOrderId, setPlannerFocusOrderId] = useState<string | null>(null)
  const [journalNav, setJournalNav] = useState<JournalNavTarget | null>(null)
  const [opsFocus, setOpsFocus] = useState<ShiftUrgentTarget | null>(null)
  const [monthLayoutLab, setMonthLayoutLab] = useState(isMonthLayoutLabHash)

  const shiftUrgent = useMemo(
    () =>
      computeShiftUrgentInbox({
        store: app.store,
        access: app.access,
        user: app.currentUser,
        adminCabinet: isAdmin ? app.adminCabinet : undefined,
      }),
    [app.store, app.access, app.currentUser, isAdmin, app.adminCabinet],
  )

  const handleOpsUrgentGo = useCallback(
    (target: ShiftUrgentTarget) => {
      setOpsFocus(target)
      app.setView(target.view)
    },
    [app.setView],
  )

  useEffect(() => {
    const onHash = () => setMonthLayoutLab(isMonthLayoutLabHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (isFstWeb && app.view) prefetchView(app.view)
  }, [app.view])

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

  const coachAllowedViews = accessUser
    ? COACH_TARGETS.map((target) => target.view).filter((v) =>
        canAccessView(app.access, accessUser, v as ViewId, app.adminCabinet),
      )
    : []
  const coachRoleRow = accessUser
    ? ACCESS_ROLES.find((r) => r.id === accessUser.roleId)
    : undefined
  const coachRoleLabel = coachRoleRow
    ? labelRuKa(app.uiLocale, coachRoleRow.labelRu, coachRoleRow.labelKa)
    : undefined

  const procurementActions = {
    onUpsertOrder: app.upsertPurchaseOrder,
    onCreateOrder: app.createPurchaseOrder,
    onRemoveOrder: app.removePurchaseOrder,
    onAddMilestone: app.addPurchaseOrderMilestone,
    onSetStatus: app.setPurchaseOrderStatus,
    onReceiveOrder: app.receivePurchaseOrder,
    onUpsertProcurementCategory: app.upsertProcurementCategory,
    onRemoveProcurementCategory: app.removeProcurementCategory,
    onUpsertRoutePoint: app.upsertRoutePoint,
    onRemoveRoutePoint: app.removeRoutePoint,
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
    onUnpostDocument: (_documentId: string) => {
      // PHASE W1 — destructive unpost removed; UI should use onCancelDocument.
      return { ok: false as const, error: 'warehouse.doc.errUnpostRemoved' }
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
    onSaveOpeningInventoryDraft: (
      input: Parameters<typeof app.saveOpeningInventoryDraft>[0],
    ) =>
      app.saveOpeningInventoryDraft(input, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      }),
    onPostOpeningInventory: (input: Parameters<typeof app.postOpeningInventory>[0]) =>
      app.postOpeningInventory(input, {
        actorId: app.currentUser?.id,
        actorName: app.currentUser?.displayName,
      }),
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
    onMarkWarehouseDocsExported: (
      ids: string[],
      actor?: { id?: string; name?: string },
    ) =>
      app.markWarehouseDocsExported(
        ids,
        actor ?? { id: app.currentUser?.id, name: app.currentUser?.displayName },
      ),
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
    if (!confirm(translate(app.uiLocale, 'app.importConfirm'))) {
      return
    }
    try {
      const result = app.replaceStore(await importFromJson(file))
      if (result && 'ok' in result && !result.ok) {
        setImportNotice(result.message ?? translate(app.uiLocale, 'bulk.blockedPending'))
        return
      }
      setImportNotice(null)
    } catch {
      setImportNotice(translate(app.uiLocale, 'app.importError'))
    }
  }

  function handleRestoreBackup(date: string) {
    if (!confirm(translate(app.uiLocale, 'storage.restoreConfirm'))) {
      return
    }
    const restored = restoreDailyBackup(date)
    if (restored) {
      const result = app.replaceStoreForBulk(restored, 'restore')
      if (result && 'ok' in result && !result.ok) {
        setImportNotice(result.message ?? BULK_BLOCKED_MESSAGE)
        return
      }
      app.dismissLoadWarning()
    }
  }

  return (
    <I18nProvider locale={app.uiLocale} setLocale={app.setLocale}>
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
        ) : passwordCheckPending ? (
          <PageLoader />
        ) : needsPasswordChange && fstAuth?.user?.email ? (
          <FstChangePasswordScreen
            email={fstAuth.user.email}
            onComplete={async (password) => {
              const email = fstAuth.user?.email
              if (!email) return
              await app.completeWebPasswordChange(password)
              markPasswordChangeComplete(email)
              setPasswordGateDismissed(true)
              fstAuth.dismissMustChangePassword()
              await fstAuth.refreshClaims()
            }}
            onClearLock={async () => {
              const email = fstAuth.user?.email
              if (!email) return
              await app.clearWebMustChangePasswordFlag()
              markPasswordChangeComplete(email)
              setPasswordGateDismissed(true)
              fstAuth.dismissMustChangePassword()
              await fstAuth.refreshClaims()
            }}
          />
        ) : monthLayoutLab ? (
          <Suspense fallback={<PageLoader />}>
            <MonthLayoutLabPage />
          </Suspense>
        ) : (
          <EmployeeEditorProvider
            employees={app.store.employees}
            brigades={app.store.brigades}
            hrStructuralUnits={app.store.hrStructuralUnits}
            hrPositions={app.store.hrPositions}
            onUpsertPosition={app.upsertHrPosition}
            store={app.store}
            lockHolderUid={fstAuth?.user?.uid ?? app.currentUser?.id ?? 'local'}
            lockHolderName={
              fstAuth?.profile?.displayName ??
              app.currentUser?.displayName ??
              fstAuth?.user?.email ??
              'User'
            }
            canForceTakeOver={
              app.currentUser?.roleId === 'sysadmin' || isFstAdminEmail(fstAuth?.user?.email)
            }
            canEditSalary={canEditEmployeeSalary(accessUser)}
            onSave={(updated) => {
              const prev = app.store.employees.find((e) => e.id === updated.id)
              app.upsertEmployee(updated)
              if (updated.hrStatus === 'fired' && updated.terminationDate) {
                const changed =
                  !prev ||
                  prev.hrStatus !== 'fired' ||
                  prev.terminationDate !== updated.terminationDate
                if (changed) {
                  const segs = terminationSegments(
                    Object.keys(app.store.months),
                    updated.terminationDate,
                  )
                  for (const seg of segs) {
                    app.setEmployeeFactRange(seg.monthKey, updated.id, seg.fromDay, seg.toDay, '')
                  }
                }
              }
            }}
          >
          <CoachProvider
            aiSettings={app.store.settings.ai}
            locale={app.uiLocale}
            view={app.view}
            currentUser={
              accessUser
                ? {
                    id: accessUser.id,
                    displayName: accessUser.displayName,
                    roleId: accessUser.roleId,
                    login: accessUser.login,
                  }
                : null
            }
            roleLabel={coachRoleLabel}
            allowedViews={coachAllowedViews}
            onNavigate={(v) => app.setView(v as ViewId)}
            appendAiChatEntries={app.appendAiChatEntries}
            addSuggestion={app.addSuggestion}
          >
          <SupportChromeProvider>
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
          webAdminMode={webAdminMode}
          adminCabinet={isAdmin ? app.adminCabinet : undefined}
          onAdminCabinetChange={isAdmin ? app.setAdminCabinet : undefined}
          isFstWeb={isFstWeb}
          onAnnounceMaintenance={
            app.currentUser?.roleId === 'sysadmin'
              ? () => {
                  app.updateSettings({
                    maintenanceWindow: buildFiveMinuteMaintenance(
                      app.currentUser?.displayName,
                    ),
                  })
                }
              : undefined
          }
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
          <ShiftUrgentBar
            items={shiftUrgent.items}
            hidden={app.view === 'director' || app.view === 'timeclock'}
            onGo={handleOpsUrgentGo}
          />
          {app.view === 'my' && (
            <MyCabinetPage store={app.store} currentUser={app.currentUser} />
          )}
          {app.view === 'timeclock' && (
            <TimeclockPage
              store={app.store}
              deviceLabel={app.currentUser?.displayName ?? 'timeclock'}
              onPunch={app.recordAttendancePunch}
            />
          )}
          {app.view === 'month' && (
            <MonthPage
              store={app.store}
              month={app.activeMonth}
              onMonthChange={app.setActiveMonth}
              onPatch={app.patch}
              onCycle={(rowId, dateKey, mode) => {
                const sheet = app.store.months[app.activeMonth]
                const current =
                  mode === 'plan'
                    ? (sheet?.plan[rowId]?.[dateKey] ?? '')
                    : (sheet ? (getFactMark(sheet, rowId, dateKey) ?? '') : '')
                const next = nextCode(current)
                app.cycleMark(app.activeMonth, rowId, dateKey, mode)
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                if (empId && !isMonthClosed(app.store, app.activeMonth)) {
                  notifyForTimesheetCode(pushAccess, empId, app.activeMonth, next)
                }
              }}
              onSetCode={(rowId, dateKey, code, mode) => {
                app.setMark(app.activeMonth, rowId, dateKey, mode, code)
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                if (empId) {
                  notifyForTimesheetCode(pushAccess, empId, app.activeMonth, code)
                }
              }}
              onSetCodesBatch={(cells, code, mode) => {
                app.setMarksBatch(app.activeMonth, mode, cells, code)
                const seen = new Set<string>()
                for (const { rowId } of cells) {
                  const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                  if (!empId || seen.has(empId)) continue
                  seen.add(empId)
                  notifyForTimesheetCode(pushAccess, empId, app.activeMonth, code)
                }
              }}
              onSavePlanDraft={(draftPlan) =>
                app.commitPlanDraft(app.activeMonth, draftPlan)
              }
              onCommitTimesheetDraft={(changes) => {
                const result = app.commitTimesheetDraft(app.activeMonth, changes)
                const seen = new Set<string>()
                for (const ch of result.appliedChanges) {
                  const empId =
                    ch.employeeId ??
                    employeeIdForRow(app.store, app.activeMonth, ch.rowId)
                  if (!empId) continue
                  const key = `${empId}|${ch.after}`
                  if (seen.has(key)) continue
                  seen.add(key)
                  notifyForTimesheetCode(pushAccess, empId, app.activeMonth, ch.after)
                }
                return result
              }}
              onVoidTimesheetEntry={(documentId) => app.voidTimesheetEntry(documentId)}
              journalTimesheetEntryId={
                journalNav?.view === 'month' ? journalNav.timesheetEntryDocumentId ?? null : null
              }
              onJournalTimesheetEntryConsumed={() => {
                if (journalNav?.view === 'month' && journalNav.timesheetEntryDocumentId) {
                  setJournalNav({
                    view: 'month',
                    month: journalNav.month,
                    mode: journalNav.mode,
                  })
                }
              }}
              onSetFactExtra={(rowId, dateKey, hours) =>
                app.setFactExtraHours(
                  app.activeMonth,
                  rowId,
                  dateKey,
                  Math.max(0, Math.min(6, hours)) as import('@/lib/factExtra').FactExtraHours,
                )
              }
              onAssign={(rowId, empId) => {
                app.assignRowEmployee(app.activeMonth, rowId, empId)
                if (empId) {
                  notifySchedulePush(pushAccess, [empId], app.activeMonth, 'assigned')
                }
              }}
              onRegenerateRow={(rowId) => {
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                app.regenerateRowPlan(app.activeMonth, rowId)
                if (empId) {
                  notifySchedulePush(pushAccess, [empId], app.activeMonth, 'plan_changed')
                }
              }}
              onAddRow={(brigade) => app.addBrigadeRowToMonth(app.activeMonth, brigade)}
              onRemoveRow={(rowId) => app.removeBrigadeRowFromMonth(app.activeMonth, rowId)}
              onRemoveEmptyRow={(brigade) =>
                app.removeEmptyBrigadeRowFromMonth(app.activeMonth, brigade)
              }
              onRegenerateMonth={() => {
                const ids = employeeIdsInMonth(app.store, app.activeMonth)
                app.regenerateMonthPlan(app.activeMonth)
                notifySchedulePush(pushAccess, ids, app.activeMonth, 'plan_changed')
              }}
              onBulkHolidayV={(brigades) => {
                const rows = app.store.months[app.activeMonth]?.rows ?? []
                const ids = [
                  ...new Set(
                    rows
                      .filter((r) => r.employeeId && (!brigades?.length || brigades.includes(r.brigade)))
                      .map((r) => r.employeeId as string),
                  ),
                ]
                app.bulkHolidayV(app.activeMonth, brigades)
                for (const id of ids) {
                  notifyPersonalDayPush(pushAccess, id, 'rest', app.activeMonth)
                }
              }}
              onBulkCopyPlanToFact={(scope, brigade, opts) =>
                app.bulkCopyPlanToFact(app.activeMonth, scope, brigade, opts)
              }
              onApplyShiftTemplate={(templateId, brigade) => {
                const ids = (app.store.months[app.activeMonth]?.rows ?? [])
                  .filter((r) => r.brigade === brigade && r.employeeId)
                  .map((r) => r.employeeId as string)
                app.applyShiftTemplateBrigadeAndRegenerate(
                  app.activeMonth,
                  templateId,
                  brigade,
                )
                notifySchedulePush(pushAccess, ids, app.activeMonth, 'plan_changed')
              }}
              onExportExcel={() =>
                void runExport('timesheet', app.store, {
                  month: app.activeMonth,
                  locale: app.uiLocale,
                })
              }
              onAddBrigade={app.addBrigade}
              onRenameBrigade={app.renameBrigade}
              onRemoveBrigade={app.removeBrigade}
              onSetBrigadeNameKa={app.setBrigadeNameKa}
              onSetBrigadeNameEn={app.setBrigadeNameEn}
              onSetBrigadeUnit={app.setBrigadeUnit}
              onSetBrigadeHasBrigadier={
                app.currentUser?.roleId === 'sysadmin'
                  ? app.setBrigadeHasBrigadier
                  : undefined
              }
              onMarkBrigadier={(rowId, dateKey, on) => {
                app.setBrigadierDay(app.activeMonth, rowId, dateKey, on)
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                if (empId) notifyBrigadierPush(pushAccess, empId, on, app.activeMonth)
              }}
              onMarkBrigadierMonth={(rowId, on) => {
                app.setBrigadierMonth(app.activeMonth, rowId, on)
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                if (empId) notifyBrigadierPush(pushAccess, empId, on, app.activeMonth)
              }}
              onMarkBrigadierFromDay={(rowId, dateKey, on) => {
                app.setBrigadierFromDay(app.activeMonth, rowId, dateKey, on)
                const empId = employeeIdForRow(app.store, app.activeMonth, rowId)
                if (empId) notifyBrigadierPush(pushAccess, empId, on, app.activeMonth)
              }}
              onRowInactiveFrom={(rowId, dateKey) =>
                app.setRowInactiveFrom(app.activeMonth, rowId, dateKey)
              }
              onRowActiveFrom={(rowId, dateKey) =>
                app.setRowActiveFrom(app.activeMonth, rowId, dateKey)
              }
              onClearRowPeriod={(rowId) => app.clearRowPeriod(app.activeMonth, rowId)}
              onSetFactHours={(rowId, dateKey, hours) =>
                app.setFactHours(app.activeMonth, rowId, dateKey, hours)
              }
              onSetBrigadeSignoff={(brigade, verified) =>
                app.setBrigadeSignoff(app.activeMonth, brigade, verified)
              }
              onAddDayWorker={(brigade, employeeId, dateKey, code) => {
                const ok = app.addBrigadeDayWorker(app.activeMonth, brigade, employeeId, dateKey, code)
                if (ok) notifySchedulePush(pushAccess, [employeeId], app.activeMonth, 'day_added')
                return ok
              }}
              onAssignPermanent={(employeeId, brigade) => {
                const ok = app.assignPermanentToBrigade(app.activeMonth, employeeId, brigade)
                if (ok) notifySchedulePush(pushAccess, [employeeId], app.activeMonth, 'assigned')
                return ok
              }}
              onTransferFromDate={(employeeId, toBrigade, fromDateKey, opts) => {
                const ok = app.transferEmployeeFromDate(
                  app.activeMonth,
                  employeeId,
                  toBrigade,
                  fromDateKey,
                  opts,
                )
                if (ok) notifySchedulePush(pushAccess, [employeeId], app.activeMonth, 'assigned')
                return ok
              }}
              onReorderBrigadeRow={(brigade, rowId, beforeRowId) =>
                app.reorderBrigadeRowInMonth(app.activeMonth, brigade, rowId, beforeRowId)
              }
              onClearDayTransfer={(employeeId, dateKey) =>
                app.clearBrigadeDayTransfer(app.activeMonth, employeeId, dateKey)
              }
              onSaveAndPostNightShift={(input) => {
                const ok = app.saveAndPostNightShift(input)
                if (ok) {
                  for (const id of input.employeeIds) {
                    notifyPersonalDayPush(pushAccess, id, 'night', app.activeMonth)
                  }
                }
                return ok
              }}
              onVoidNightShift={(id) => app.voidNightShift(id)}
              onSetComment={(rowId, dateKey, text) =>
                app.setCellComment(app.activeMonth, rowId, dateKey, text)
              }
              onSetSubstitution={(rowId, dateKey, sub) =>
                app.setSubstitution(app.activeMonth, rowId, dateKey, sub)
              }
              onClearSubstitution={(rowId, dateKey) =>
                app.clearSubstitution(app.activeMonth, rowId, dateKey)
              }
              onSetBrigadeRoster={(brigade, ids, syncHr) => {
                const prev = new Set(
                  (app.store.months[app.activeMonth]?.rows ?? [])
                    .filter((r) => r.brigade === brigade && r.employeeId)
                    .map((r) => r.employeeId as string),
                )
                app.setBrigadeRoster(app.activeMonth, brigade, ids, syncHr)
                const added = ids.filter((id) => !prev.has(id))
                if (added.length) {
                  notifySchedulePush(pushAccess, added, app.activeMonth, 'roster')
                }
              }}
              onChangeGroup2x2={(_rowId, employeeId, group) => {
                app.changeEmployeeAttributesFromDay(app.activeMonth, employeeId, 1, {
                  group2x2: group,
                })
                notifySchedulePush(pushAccess, [employeeId], app.activeMonth, 'plan_changed')
              }}
              onSetCycleFromDay={(_rowId, employeeId, day, variant) => {
                app.setEmployeeCycleFromDay(app.activeMonth, employeeId, day, variant)
                notifySchedulePush(pushAccess, [employeeId], app.activeMonth, 'plan_changed')
              }}
              onSetBrigadier={(brigade, employeeId) => {
                const prev = app.store.brigadiers[brigade] ?? null
                app.setBrigadier(brigade, employeeId)
                if (employeeId && employeeId !== prev) {
                  notifyBrigadierPush(pushAccess, employeeId, true, app.activeMonth)
                }
                if (prev && prev !== employeeId) {
                  notifyBrigadierPush(pushAccess, prev, false, app.activeMonth)
                }
              }}
              onUpsertEmployee={app.upsertEmployee}
              onTourComplete={() => app.updateSettings({ tourCompleted: true })}
              onCloseMonth={() => {
                const ids = employeeIdsInMonth(app.store, app.activeMonth)
                app.setMonthClosed(app.activeMonth, true, {
                  id: app.currentUser?.id,
                  name: app.currentUser?.displayName,
                })
                notifySchedulePush(pushAccess, ids, app.activeMonth, 'month_closed')
              }}
              onReopenMonth={() =>
                app.setMonthClosed(app.activeMonth, false, {
                  id: app.currentUser?.id,
                  name: app.currentUser?.displayName,
                })
              }
              canReopen={
                accessUser?.roleId === 'sysadmin' ||
                accessUser?.roleId === 'operations_director'
              }
              canClearMonth={accessUser?.roleId === 'sysadmin'}
              onClearMonth={() => app.clearMonthTimesheet(app.activeMonth)}
              onClearMonthsBefore={(before) => app.clearMonthsBefore(before)}
              workshopMasterMode={workshopMasterMode}
              workshopMasterLogin={app.currentUser?.login}
              workshopMasterEmployeeId={app.currentUser?.employeeId}
              accessUser={accessUser}
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
              currentUser={accessUser}
              candidates={app.store.candidates}
              onSaveEmployee={app.upsertEmployee}
              onRemoveEmployee={app.removeEmployee}
              onUpsertCandidate={app.upsertCandidate}
              onRemoveCandidate={app.removeCandidate}
              onHireCandidate={app.hireCandidate}
              onCreateEmployeeCabinet={async ({ employeeId, displayName, login, password }) => {
                await app.upsertAppUser({
                  login,
                  displayName,
                  roleId: 'employee',
                  password,
                  active: true,
                  employeeId,
                })
              }}
              onSetEmployeeFactRange={(month, employeeId, fromDay, toDay, code) => {
                app.setEmployeeFactRange(month, employeeId, fromDay, toDay, code)
                notifyForTimesheetCode(pushAccess, employeeId, month, code)
              }}
              onRestoreTrashEmployee={app.restoreTrashEmployee}
              onPurgeTrashEmployee={app.purgeTrashEmployee}
              onRestoreTrashCandidate={app.restoreTrashCandidate}
              onPurgeTrashCandidate={app.purgeTrashCandidate}
              onUpsertPosition={app.upsertHrPosition}
              onImportEmployeeRegistry={app.importEmployeeRegistry}
              onClearAllPersonnel={app.clearAllPersonnel}
              onSectionChange={app.setHrSection}
              webHrMode={webHrMode}
              realSysAdmin={isSysAdmin(app.currentUser)}
              workshopMasterMode={workshopMasterMode}
              webUserName={app.currentUser?.displayName}
              userHrDefaults={resolveHrViewDefaults(app.currentUser?.viewDefaults)}
              currentUserId={app.currentUser?.id}
              onSaveViewDefaults={saveViewDefaults}
              financeActions={financeActions}
              onNavigateToDirectory={(section) => app.navigateToDirectory(section)}
              onOpenFinance={
                canAccessView(app.access, accessUser, 'finance')
                  ? () => app.setView('finance')
                  : undefined
              }
              onUpsertWorkshopMasterCoverage={app.upsertWorkshopMasterCoverage}
              onPostWorkshopMasterCoverage={app.postWorkshopMasterCoverage}
              onEndWorkshopMasterCoverage={app.endWorkshopMasterCoverage}
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
              compactWithHr={
                !webHrInspectorMode && canAccessView(app.access, accessUser, 'hr')
              }
              onSaveEmployee={app.upsertEmployee}
              onSetEmployeeFactRange={(month, employeeId, fromDay, toDay, code) => {
                app.setEmployeeFactRange(month, employeeId, fromDay, toDay, code)
                notifyForTimesheetCode(pushAccess, employeeId, month, code)
              }}
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
              actions={financeActions}
              onOpenHr={
                canAccessView(app.access, accessUser, 'hr')
                  ? () => app.setView('hr')
                  : undefined
              }
              documentActions={{
                onSaveAdvanceDocument: (input) =>
                  app.saveAdvanceDocumentDraft(input, financeActor),
                onPrepareAdvanceDocument: (id) =>
                  app.prepareAdvanceDocument(id, financeActor),
                onUnprepareAdvanceDocument: (id) =>
                  app.unprepareAdvanceDocument(id, financeActor),
                onPostAdvanceDocument: (id) => app.postAdvanceDocument(id, financeActor),
                onVoidAdvanceDocument: (id, reason) =>
                  app.voidAdvanceDocument(id, reason, financeActor),
                onDeleteAdvanceDocumentDraft: (id) =>
                  app.deleteAdvanceDocumentDraft(id, financeActor),
                onSaveAdvanceAccrual: (input) =>
                  app.saveAdvanceAccrualDraft(input, financeActor),
                onPostAdvanceAccrual: (id) => app.postAdvanceAccrual(id, financeActor),
                onVoidAdvanceAccrual: (id, reason) =>
                  app.voidAdvanceAccrual(id, reason, financeActor),
                onDeleteAdvanceAccrualDraft: (id) =>
                  app.deleteAdvanceAccrualDraft(id, financeActor),
                onCreateDisbursementFromAccrual: (accrualId, opts) =>
                  app.createDisbursementFromAccrual(accrualId, opts, financeActor),
                onSavePayoutDocument: (input) =>
                  app.savePayoutDocumentDraft(input, financeActor),
                onPreparePayoutDocument: (id) =>
                  app.preparePayoutDocument(id, financeActor),
                onUnpreparePayoutDocument: (id) =>
                  app.unpreparePayoutDocument(id, financeActor),
                onPostPayoutDocument: (id) => app.postPayoutDocument(id, financeActor),
                onVoidPayoutDocument: (id, reason) =>
                  app.voidPayoutDocument(id, reason, financeActor),
                onDeletePayoutDocumentDraft: (id) =>
                  app.deletePayoutDocumentDraft(id, financeActor),
                onMarkFinanceDocExported: (kind, id) =>
                  app.markFinanceDocExported(kind, id, financeActor),
              }}
              focusAdvanceDocumentId={
                journalNav?.view === 'finance' ? journalNav.advanceDocumentId : null
              }
              focusPayoutDocumentId={
                journalNav?.view === 'finance' ? journalNav.payoutDocumentId : null
              }
              focusAccrualDocumentId={
                journalNav?.view === 'finance' ? journalNav.accrualDocumentId : null
              }
              onJournalFocusConsumed={() => setJournalNav(null)}
              webFinanceMode={webFinanceMode}
              webUserName={app.currentUser?.displayName}
              userFinanceDefaults={resolveFinanceViewDefaults(app.currentUser?.viewDefaults)}
              currentUserId={app.currentUser?.id}
              onSaveViewDefaults={saveViewDefaults}
              onSetDefaultAdvancePercent={(percent) =>
                app.updateSettings({ defaultAdvancePercent: percent })
              }
            />
          )}
          {app.view === 'production' && (
            <ProductionPage
              requests={app.store.production.requests}
              orders={app.store.production.planner.orders}
              formulations={app.store.formulations}
              warehouse={app.store.warehouse}
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
              boxRecipes={app.store.packagingRecipes.boxes ?? []}
              formulationRecipes={app.store.formulations.recipes}
              warehouseItems={app.store.warehouse.items}
              warehouseCategories={app.store.warehouse.categories}
              warehouseMovements={app.store.warehouse.movements}
              warehouseDocuments={app.store.warehouse.documents}
              warehouseLocations={app.store.warehouse.locations}
              productionLineBindings={app.store.warehouse.productionLineBindings}
              warehouseAccounting={app.store.warehouse.accountingByWarehouse}
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
              access={app.store.access}
              currentUser={app.currentUser}
              onCreateWorkTask={app.createWorkTask}
            />
          )}
          {app.view === 'summary' && (
            <SummaryPage store={app.store} onNavigate={app.setView} />
          )}
          {app.view === 'directories' && (
            <DirectoriesPage
              store={app.store}
              initialSection={app.directorySection as DirectorySection}
              accessRoleId={accessUser?.roleId ?? app.currentUser?.roleId ?? null}
              accessStore={app.access}
              userDirectorySections={accessUser?.directorySections}
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
              onSetBrigadeNameEn={app.setBrigadeNameEn}
              onSetBrigadeUnit={app.setBrigadeUnit}
              onSetBrigadeHasBrigadier={
                app.currentUser?.roleId === 'sysadmin'
                  ? app.setBrigadeHasBrigadier
                  : undefined
              }
              onRemoveCounterparty={app.removeCounterparty}
              onUpsertFinishedProduct={app.upsertFinishedProduct}
              onPatchFinishedProductCatalog={app.patchFinishedProductCatalog}
              onRemoveFinishedProduct={app.removeFinishedProduct}
              onUpsertPackagingRecipe={app.upsertPackagingRecipe}
              onRemovePackagingRecipe={app.removePackagingRecipe}
              onUpsertBoxRecipe={app.upsertBoxRecipe}
              onRemoveBoxRecipe={app.removeBoxRecipe}
              onUpsertFormulationRecipe={app.upsertFormulationRecipe}
              onRemoveFormulationRecipe={app.removeFormulationRecipe}
              onSavePayrollAccrual={(rules) => app.updateSettings({ payrollAccrual: rules })}
              branchWorkspace={app.branchWorkspace}
              clearWorkspaceDraft={app.clearWorkspaceDraft}
              workspaceRestoreSeq={app.workspaceRestoreSeq}
              workspaceDrafts={app.workspaceDrafts}
              webWarehouseMode={webWarehouseMode}
              webProcurementMode={webProcurementMode}
              canAccessHr={canAccessView(app.access, accessUser, 'hr')}
              onOpenHr={() => app.setView('hr')}
              canAccessWarehouse={canAccessView(app.access, accessUser, 'warehouse')}
              onOpenWarehouse={() => app.setView('warehouse')}
              warehouse={app.store.warehouse}
              printMeta={{
                site: app.store.settings.site,
                responsible: app.store.settings.responsible,
                signatures: app.store.settings.signatures,
                locale: app.uiLocale,
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
              pendingBatchRuns={app.store.formulations.batchRuns.filter(
                (r) => (r.status ?? 'confirmed') === 'pending',
              )}
              mixTasks={app.store.formulations.mixTasks ?? []}
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
              access={app.store.access}
              currentUser={app.currentUser}
              onCreateWorkTask={app.createWorkTask}
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
                app.postFormulationBatchMix(input, app.uiLocale, {
                  allowNegativeStock,
                })
              }
              onCreateMixTask={app.createMixTask}
              onCancelMixTask={app.cancelMixTask}
              onReserveMixTask={app.reserveMixTaskMaterials}
              onUnreserveMixTask={app.unreserveMixTaskMaterials}
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
              onUpsertShiftHandoff={app.upsertShiftHandoff}
              onAcknowledgeShiftHandoff={app.acknowledgeShiftHandoff}
              onSetShiftHandoffStatus={app.setShiftHandoffStatus}
              onRemoveShiftHandoff={app.removeShiftHandoff}
              focusTab={
                opsFocus?.view === 'technologist' ? opsFocus.tab : null
              }
              onFocusTabConsumed={() => setOpsFocus(null)}
              onCreateWastewaterCube={app.createWastewaterCube}
              onUpsertWastewaterCube={app.upsertWastewaterCube}
              onApplyWastewaterCubeTransition={app.applyWastewaterCubeTransition}
              onRemoveWastewaterCube={app.removeWastewaterCube}
            />
          )}
          {app.view === 'otc' && (
            <OtcPage
              store={app.store.otc}
              operatorName={
                app.currentUser?.displayName ??
                app.store.settings.responsible ??
                'ОТК'
              }
              onUpsertNorm={app.upsertOtcNorm}
              onRemoveNorm={app.removeOtcNorm}
              onUpsertLabTest={app.upsertOtcLabTest}
              onRemoveLabTest={app.removeOtcLabTest}
              onUpsertAlkali={app.upsertOtcAlkaliSeries}
              onRemoveAlkali={app.removeOtcAlkaliSeries}
              onUpsertSorting={app.upsertOtcSorting}
              onRemoveSorting={app.removeOtcSorting}
              onUpsertDefect={app.upsertOtcDefect}
              onRemoveDefect={app.removeOtcDefect}
              focusTab={opsFocus?.view === 'otc' ? opsFocus.tab : null}
              onFocusTabConsumed={() => setOpsFocus(null)}
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
                app.postFormulationBatchMix(input, app.uiLocale, {
                  allowNegativeStock,
                })
              }
              onCompleteMixTask={app.completeMixTask}
              onReserveMixTask={app.reserveMixTaskMaterials}
              onUnreserveMixTask={app.unreserveMixTaskMaterials}
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
              warehouse={app.store.warehouse}
              webUserName={webUserName}
              onUpsertSalesOrder={app.upsertSalesOrder}
              onUpsertCounterparty={app.upsertCounterparty}
              onOpenCounterpartiesJournal={() => app.navigateToDirectory('counterparties')}
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
              onOpenProduction={() => app.setView('production')}
              onOpenTechnologist={() => app.setView('technologist')}
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
              otc={app.store.otc}
              onErpNavigate={app.setView}
              reportOnly={accessUser?.roleId === 'operations_director'}
            />
          )}
          {app.view === 'journals' && (
            <JournalsPage
              store={app.store}
              currentUser={app.currentUser}
              activeMonth={app.activeMonth}
              brigades={app.store.brigades}
              printMeta={{
                site: app.store.settings.site,
                responsible: app.store.settings.responsible,
                signatures: app.store.settings.signatures,
                locale: app.uiLocale,
              }}
              allowNegativeStock={allowNegativeStock}
              warehouseDocActions={{
                onPostDocument: warehouseActions.onPostDocument,
                onPostTransfer: warehouseActions.onPostTransfer,
                onSaveDocumentDraft: warehouseActions.onSaveDocumentDraft,
                onPostExistingDocument: warehouseActions.onPostExistingDocument,
                onUnpostDocument: warehouseActions.onUnpostDocument,
                onAcquireDocumentLock: warehouseActions.onAcquireDocumentLock,
                onReleaseDocumentLock: warehouseActions.onReleaseDocumentLock,
                onMergeInvoiceRegistry: warehouseActions.onMergeInvoiceRegistry,
                onUpsertCounterparty: app.upsertCounterparty,
              }}
              loadingDocActions={{
                onUpsertLoadingShipment: warehouseActions.onUpsertLoadingShipment!,
                onPostLoadingShipment: warehouseActions.onPostLoadingShipment!,
                onRemoveLoadingShipment: warehouseActions.onRemoveLoadingShipment!,
                onUpsertItem: warehouseActions.onUpsertItem,
                onUpsertFinishedProduct: app.upsertFinishedProduct,
                onUpsertCounterparty: app.upsertCounterparty,
              }}
              onUpsertSalesOrder={app.upsertSalesOrder}
              onReceivePurchaseOrder={app.receivePurchaseOrder}
              onCreateDisbursementFromAccrual={(accrualId, opts) =>
                app.createDisbursementFromAccrual(accrualId, opts, financeActor)
              }
              financeDocumentActions={{
                onSaveAdvanceDocument: (input) =>
                  app.saveAdvanceDocumentDraft(input, financeActor),
                onPrepareAdvanceDocument: (id) =>
                  app.prepareAdvanceDocument(id, financeActor),
                onUnprepareAdvanceDocument: (id) =>
                  app.unprepareAdvanceDocument(id, financeActor),
                onPostAdvanceDocument: (id) => app.postAdvanceDocument(id, financeActor),
                onVoidAdvanceDocument: (id, reason) =>
                  app.voidAdvanceDocument(id, reason, financeActor),
                onDeleteAdvanceDocumentDraft: (id) =>
                  app.deleteAdvanceDocumentDraft(id, financeActor),
                onSaveAdvanceAccrual: (input) =>
                  app.saveAdvanceAccrualDraft(input, financeActor),
                onPostAdvanceAccrual: (id) => app.postAdvanceAccrual(id, financeActor),
                onVoidAdvanceAccrual: (id, reason) =>
                  app.voidAdvanceAccrual(id, reason, financeActor),
                onDeleteAdvanceAccrualDraft: (id) =>
                  app.deleteAdvanceAccrualDraft(id, financeActor),
                onCreateDisbursementFromAccrual: (accrualId, opts) =>
                  app.createDisbursementFromAccrual(accrualId, opts, financeActor),
                onSavePayoutDocument: (input) =>
                  app.savePayoutDocumentDraft(input, financeActor),
                onPreparePayoutDocument: (id) =>
                  app.preparePayoutDocument(id, financeActor),
                onUnpreparePayoutDocument: (id) =>
                  app.unpreparePayoutDocument(id, financeActor),
                onPostPayoutDocument: (id) => app.postPayoutDocument(id, financeActor),
                onVoidPayoutDocument: (id, reason) =>
                  app.voidPayoutDocument(id, reason, financeActor),
                onDeletePayoutDocumentDraft: (id) =>
                  app.deletePayoutDocumentDraft(id, financeActor),
                onMarkFinanceDocExported: (kind, id) =>
                  app.markFinanceDocExported(kind, id, financeActor),
              }}
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
                if (nav.view === 'finance' && 'month' in nav && nav.month) {
                  app.setActiveMonth(nav.month)
                }
              }}
            />
          )}
          {app.view === 'engineer_log' && (
            <EngineerLogPage
              engineerLog={app.store.engineerLog}
              authorId={app.currentUser?.id}
              authorName={app.currentUser?.displayName}
              onUpsert={app.upsertEngineerLogEntry}
              onRemove={app.removeEngineerLogEntry}
              onTogglePin={app.toggleEngineerLogPin}
              onToggleChecklistItem={app.toggleEngineerLogChecklistItem}
              onSetStatus={app.setEngineerLogEntryStatus}
            />
          )}
          {app.view === 'tasks' && (
            <TasksPage
              store={app.store}
              currentUser={app.currentUser}
              onCreateWorkTask={app.createWorkTask}
              onUpdateWorkTask={app.updateWorkTask}
              onMoveWorkTask={app.moveWorkTask}
              onCompleteWorkTask={app.completeWorkTask}
              onCancelWorkTask={app.cancelWorkTask}
              onAddTaskComment={app.addTaskComment}
              onToggleTaskChecklistItem={app.toggleTaskChecklistItem}
              onToggleTaskAssigneeDone={app.toggleTaskAssigneeDone}
              onAddTaskAttachmentMeta={app.addTaskAttachmentMeta}
              onBeginTaskAttachmentDelete={app.beginTaskAttachmentDelete}
              onRemoveTaskAttachmentMeta={app.removeTaskAttachmentMeta}
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
          {app.view === 'office' && (
            <OfficePage
              employees={app.store.employees}
              hrStructuralUnits={app.store.hrStructuralUnits}
              hrPositions={app.store.hrPositions}
              brigades={app.store.brigades}
              site={app.store.settings.site}
            />
          )}
          {app.view === 'meals' && (
            <MealsPage
              store={app.store}
              currentUser={app.currentUser}
              onUpsertMealOrder={app.upsertMealOrder}
              onAcceptMealDay={app.acceptMealDay}
              onUnacceptMealDay={app.unacceptMealDay}
              onUpdateMealSettings={app.updateMealSettings}
              onUpsertMealCatalogItem={app.upsertMealCatalogItem}
              onSetMealWeekBase={app.setMealWeekBase}
              onSetMealDayExtras={app.setMealDayExtras}
              onCopyPreviousMealWeek={app.copyPreviousMealWeek}
              onPublishMealWeek={app.publishMealWeek}
              onAddMealAdvanceReceipt={app.addMealAdvanceReceipt}
            />
          )}
          {app.view === 'protocols' && (
            <ProtocolsPage
              store={app.store}
              currentUser={app.currentUser}
              canEdit={
                app.currentUser?.roleId === 'sysadmin' ||
                app.currentUser?.roleId === 'secretary' ||
                app.currentUser?.roleId === 'operations_director'
              }
              onUpsertProtocol={app.upsertMeetingProtocol}
              onArchiveProtocol={app.archiveMeetingProtocol}
              onUpsertItem={app.upsertProtocolItem}
              onArchiveItem={app.archiveProtocolItem}
              onSetItemStatus={app.setProtocolItemStatus}
              onSendForAck={app.sendProtocolItemForAck}
              onConfirmAck={app.confirmProtocolItemAck}
              onRefuseAck={app.refuseProtocolItemAck}
              onAdminFixAck={app.adminFixProtocolItemAck}
              onRegisterAttachment={app.registerProtocolAttachment}
            />
          )}
          {app.view === 'org_tree' && (
            <OrgTreePage
              store={app.store}
              currentUser={app.currentUser}
              canEdit={
                app.currentUser?.roleId === 'sysadmin' ||
                app.currentUser?.roleId === 'hr' ||
                app.currentUser?.roleId === 'secretary'
              }
              onSetDisplayMode={app.setOrgChartDisplayMode}
              onUpsertNode={app.upsertOrgChartNode}
              onMoveNode={app.moveOrgChartNode}
              onReparentNode={app.reparentOrgChartNode}
              onArchiveNode={app.archiveOrgChartNode}
              onRemoveNode={app.removeOrgChartNode}
              onAssignEmployee={app.assignOrgChartEmployee}
              onUnassignEmployee={app.unassignOrgChartEmployee}
              onSetHrLink={app.setOrgChartHrLink}
              onAutoLayout={app.autoLayoutOrgChart}
              onAutoLayoutBranch={app.autoLayoutOrgChartBranch}
            />
          )}
          {app.view === 'settings' && (
            <SettingsPage
              store={app.store}
              currentUser={app.currentUser}
              onUpsertAppUser={app.upsertAppUser}
              onRemoveWebUser={app.removeWebUser}
              onSetRoleViews={app.setRoleViews}
              onSetRoleDirectorySections={app.setRoleDirectorySections}
              onSetRoleAllowNegativeStock={app.setRoleAllowNegativeStock}
              onSetRoleAllowDocumentCancel={app.setRoleAllowDocumentCancel}
              onSetRoleTimesheetAccess={app.setRoleTimesheetAccess}
              onSetRoleTaskAccess={app.setRoleTaskAccess}
              onUpsertUserGroup={app.upsertUserGroup}
              onRemoveUserGroup={app.removeUserGroup}
              onUpsertWorkshopMasterCoverage={app.upsertWorkshopMasterCoverage}
              onPostWorkshopMasterCoverage={app.postWorkshopMasterCoverage}
              onEndWorkshopMasterCoverage={app.endWorkshopMasterCoverage}
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
                accessUser?.roleId === 'sysadmin' ||
                accessUser?.roleId === 'operations_director'
              }
              onUpdateSettings={app.updateSettings}
              onSetSuggestionStatus={app.setSuggestionStatus}
              onRestoreTrashEmployee={app.restoreTrashEmployee}
              onRestoreTrashMonth={app.restoreTrashMonth}
              onPurgeTrashEmployee={app.purgeTrashEmployee}
              onPurgeTrashMonth={app.purgeTrashMonth}
              onReplaceStore={app.replaceStore}
            />
          )}
          </Suspense>
        </AppShell>

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
              replaceStore={app.applyCloudStore}
              onSaveError={app.reportSaveError}
            />
          </Suspense>
        )}
        <CoachWidget />
        <CoachHighlightOverlay />
        <FeedbackWidget
          view={app.view}
          aiChat={app.store.aiChat}
          currentUser={
            app.currentUser
              ? {
                  id: app.currentUser.id,
                  displayName: app.currentUser.displayName,
                  roleId: app.currentUser.roleId,
                  login: app.currentUser.login,
                }
              : null
          }
          onSubmit={app.addSuggestion}
        />
        {app.currentUser?.roleId === 'sysadmin' ? (
          <FeedbackAdminBell
            aiChat={app.store.aiChat}
            locale={app.uiLocale as import('@/lib/ai/coachTargets').Locale}
            adminName={app.currentUser.displayName}
            onSetStatus={app.setSuggestionStatus}
            onReply={async (id, reply, byName, close) => {
              const item = app.store.aiChat?.suggestions?.find((s) => s.id === id)
              app.replyToSuggestion(id, reply, byName, close)
              const result = await notifyFeedbackReplyPush(
                app.store.access,
                {
                  userId: item?.userId,
                  userLogin: item?.userLogin,
                  userName: item?.userName,
                },
                reply,
              )
              return result
            }}
            onOpenSettings={() => app.setView('settings')}
          />
        ) : null}
        <MaintenanceBanner
          window={app.store.settings.maintenanceWindow}
          canAnnounce={app.currentUser?.roleId === 'sysadmin'}
          onClear={
            app.currentUser?.roleId === 'sysadmin'
              ? () => app.updateSettings({ maintenanceWindow: undefined })
              : undefined
          }
        />
          </SupportChromeProvider>
          </CoachProvider>
          </EmployeeEditorProvider>
        )}
        {isFstWeb && (
          <Suspense fallback={null}>
            {useSqlConnect ? (
              <FstSqlConnectSync
                store={app.store}
                applyCloudStore={app.applyCloudStore}
                patchUserStore={app.patch}
              />
            ) : (
              <FstCloudSync
                store={app.store}
                applyCloudStore={app.applyCloudStore}
                replaceStore={app.applyCloudStore}
              />
            )}
          </Suspense>
        )}
        </ModalMinimizeProvider>
      </ConfirmProvider>
    </I18nProvider>
  )
}
