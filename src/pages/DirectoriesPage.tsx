import { useEffect, useMemo, useState } from 'react'
import { BrigadesDirectoryPanel } from '@/components/directories/BrigadesDirectoryPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { CodesDirectoryPanel } from '@/components/directories/CodesDirectoryPanel'
import { PayAccrualDirectoryPanel } from '@/components/directories/PayAccrualDirectoryPanel'
import { CounterpartiesDirectoryPanel } from '@/components/directories/CounterpartiesDirectoryPanel'
import { FinishedProductsDirectoryPanel } from '@/components/directories/FinishedProductsDirectoryPanel'
import { FormulationsDirectoryPanel } from '@/components/directories/FormulationsDirectoryPanel'
import { PackagingRecipesDirectoryPanel } from '@/components/directories/PackagingRecipesDirectoryPanel'
import { OrgStructureDirectoryPanel } from '@/components/directories/OrgStructureDirectoryPanel'
import { WarehouseMetaDirectoryPanel } from '@/components/directories/WarehouseMetaDirectoryPanel'
import type { WarehousePageProps } from '@/components/warehouse/warehouseTypes'
import { useI18n } from '@/context/I18nContext'
import { DIRECTORY_SECTIONS, type DirectorySection } from '@/lib/directories/types'
import { resolveDirectoryTabs } from '@/lib/directories/access'
import type { AccessRoleId } from '@/lib/access/types'
import { directorySectionTitle } from '@/lib/workspace/labels'
import type { WorkspaceBranchFrom, WorkspaceBranchTarget } from '@/lib/workspace/types'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct, FinishedProductStore } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { BoxRecipe, PackagingRecipe } from '@/lib/packaging/types'
import type { PayrollAccrualRules } from '@/lib/finance/payrollAccrualRules'
import type { AppStore, Employee, Locale, PrintSignatures } from '@/lib/types'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { WarehousePage } from '@/pages/WarehousePage'
import { SharedDataNotice } from '@/components/ui/SharedDataNotice'

export type DirectoriesPageProps = {
  store: AppStore
  initialSection?: DirectorySection
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  warehouse: AppStore['warehouse']
  printMeta: {
    site: string
    responsible?: string
    signatures?: PrintSignatures
    locale: Locale
  }
  onSaveEmployee: (e: Employee) => void
  onRemoveEmployee: (id: string) => void
  onUpsertPosition: (p: HrPosition) => void
  onRemovePosition: (id: string) => void
  onUpsertStructuralUnit: (u: HrStructuralUnit) => void
  onRemoveStructuralUnit: (id: string) => void
  onImportOrgStructureFromSeed: () => void
  onAddBrigade: (name: string) => void
  onRenameBrigade: (oldName: string, newName: string) => void
  onRemoveBrigade: (name: string) => void
  onSetBrigadeNameKa: (nameRu: string, nameKa: string) => void
  onSetBrigadeNameEn?: (nameRu: string, nameEn: string) => void
  onSetBrigadeUnit: (brigade: string, unitId: string | null) => void
  onSetBrigadeHasBrigadier?: (brigade: string, hasBrigadier: boolean) => void
  onUpsertCounterparty: (c: Counterparty) => void
  onRemoveCounterparty: (id: string) => void
  onUpsertFinishedProduct: (p: FinishedProduct) => void
  onPatchFinishedProductCatalog?: (
    patch: Partial<
      Pick<
        FinishedProductStore,
        'productTypeRegistry' | 'grammageRegistry' | 'rollWidthRegistry'
      >
    >,
  ) => void
  onRemoveFinishedProduct: (id: string) => void
  onUpsertPackagingRecipe: (r: PackagingRecipe) => void
  onRemovePackagingRecipe: (id: string) => void
  onApprovePackagingBom?: (id: string) => void | Promise<void>
  canApprovePackagingBom?: boolean
  onUpsertBoxRecipe: (r: BoxRecipe) => void
  onRemoveBoxRecipe: (id: string) => void
  onUpsertFormulationRecipe: (r: FormulationRecipe) => void
  onRemoveFormulationRecipe: (id: string) => void
  onSavePayrollAccrual: (rules: PayrollAccrualRules) => void
  branchWorkspace: (target: WorkspaceBranchTarget, from?: WorkspaceBranchFrom) => void
  clearWorkspaceDraft: (draftKey: string) => void
  workspaceRestoreSeq: number
  workspaceDrafts: Record<string, unknown>
  /** Облачный кладовщик — только складские справочники */
  webWarehouseMode?: boolean
  /** Облачный менеджер закупок */
  webProcurementMode?: boolean
  /** Роль текущего пользователя — набор вкладок справочника */
  accessRoleId?: AccessRoleId | null
  /** Матрица вкладок справочников по ролям (из access) */
  accessStore?: import('@/lib/access/types').AccessStore | null
  /** Персональные вкладки учётки (если заданы — вместо роли) */
  userDirectorySections?: import('@/lib/directories/types').DirectorySection[] | null
  /** Есть доступ к Персоналу — показать ссылку на канонический список */
  canAccessHr?: boolean
  onOpenHr?: () => void
  /** Есть доступ к Складу — ссылка на полный раздел при той же номенклатуре */
  canAccessWarehouse?: boolean
  onOpenWarehouse?: () => void
} & Pick<
  WarehousePageProps,
  | 'onUpsertItem'
  | 'onArchiveItem'
  | 'onRemoveItem'
  | 'onUpsertCategory'
  | 'onUpsertLocation'
  | 'onRemoveCategory'
  | 'onRemoveLocation'
  | 'onAddMovement'
  | 'onDeleteMovement'
  | 'onPostDocument'
  | 'onRunInventory'
  | 'onPostInventoryRevision'
  | 'onPostOpeningBalances'
  | 'onImportExcel'
  | 'onExportExcel'
  | 'onMergeInvoiceRegistry'
  | 'onUpsertWorkwearCatalogItem'
  | 'onArchiveWorkwearCatalogItem'
  | 'onPostWorkwearIssuance'
>

export function DirectoriesPage({
  store,
  initialSection = 'counterparties',
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  warehouse,
  printMeta,
  onSaveEmployee,
  onRemoveEmployee,
  onUpsertPosition,
  onRemovePosition,
  onUpsertStructuralUnit,
  onRemoveStructuralUnit,
  onImportOrgStructureFromSeed,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeNameEn,
  onSetBrigadeUnit,
  onSetBrigadeHasBrigadier,
  onUpsertCounterparty,
  onRemoveCounterparty,
  onUpsertFinishedProduct,
  onPatchFinishedProductCatalog,
  onRemoveFinishedProduct,
  onUpsertPackagingRecipe,
  onRemovePackagingRecipe,
  onApprovePackagingBom,
  canApprovePackagingBom = false,
  onUpsertBoxRecipe,
  onRemoveBoxRecipe,
  onUpsertFormulationRecipe,
  onRemoveFormulationRecipe,
  onSavePayrollAccrual,
  branchWorkspace,
  clearWorkspaceDraft,
  workspaceRestoreSeq,
  workspaceDrafts,
  webWarehouseMode = false,
  webProcurementMode = false,
  accessRoleId = null,
  accessStore = null,
  userDirectorySections = null,
  canAccessHr = false,
  onOpenHr,
  canAccessWarehouse = false,
  onOpenWarehouse,
  onUpsertItem,
  ...warehouseHandlers
}: DirectoriesPageProps) {
  const { t } = useI18n()
  const allowedSections = useMemo(
    () =>
      resolveDirectoryTabs({
        roleId: accessRoleId,
        access: accessStore,
        userDirectorySections,
        webWarehouseMode,
        webProcurementMode,
      }),
    [accessRoleId, accessStore, userDirectorySections, webWarehouseMode, webProcurementMode],
  )
  const allowedSet = useMemo(() => new Set(allowedSections), [allowedSections])

  const initialAllowed = allowedSet.has(initialSection)
    ? initialSection
    : (allowedSections[0] ?? 'counterparties')
  const [section, setSection] = useState<DirectorySection>(initialAllowed)

  function branchToSection(
    targetSection: DirectorySection,
    fromSection: DirectorySection,
    from: { title: string; draftKey: string; draft: unknown },
  ) {
    if (!allowedSet.has(targetSection)) return
    branchWorkspace(
      {
        title: directorySectionTitle(targetSection, t),
        view: 'directories',
        directorySection: targetSection,
      },
      {
        title: from.title,
        draftKey: from.draftKey,
        draft: from.draft,
        view: 'directories',
        directorySection: fromSection,
      },
    )
    setSection(targetSection)
  }

  const categoryNames = new Map(warehouse.categories.map((c) => [c.id, c.name]))

  const directoryTabs = useMemo(
    () => DIRECTORY_SECTIONS.filter((tab) => allowedSet.has(tab.id)),
    [allowedSet],
  )

  useEffect(() => {
    if (allowedSet.has(initialSection)) {
      setSection(initialSection)
      return
    }
    if (allowedSections[0]) setSection(allowedSections[0])
  }, [initialSection, allowedSet, allowedSections])

  useEffect(() => {
    if (!allowedSet.has(section) && allowedSections[0]) {
      setSection(allowedSections[0])
    }
  }, [section, allowedSet, allowedSections])

  return (
    <PageLayout>
      <PageHeader
        badge={
          webProcurementMode
            ? t('web.procurement.badge')
            : webWarehouseMode
              ? t('web.warehouse.badge')
              : t('directories.badge')
        }
        title={
          webProcurementMode
            ? t('web.procurement.directoriesTitle')
            : webWarehouseMode
              ? t('web.warehouse.directoriesTitle')
              : t('directories.title')
        }
        subtitle={
          webProcurementMode
            ? t('web.procurement.directoriesSubtitle')
            : webWarehouseMode
              ? t('web.warehouse.directoriesSubtitle')
              : t('directories.subtitle')
        }
      />

      <TabBar
        coachPrefix="directories"
        tabs={directoryTabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
        value={section}
        onChange={setSection}
      />

      {section === 'counterparties' && (
        <CounterpartiesDirectoryPanel
          store={store.counterparties}
          onUpsert={onUpsertCounterparty}
          onRemove={onRemoveCounterparty}
        />
      )}

      {section === 'finishedProducts' && (
        <FinishedProductsDirectoryPanel
          store={store.finishedProducts}
          counterparties={store.counterparties.items}
          packagingRecipes={store.packagingRecipes.items}
          boxRecipes={store.packagingRecipes.boxes ?? []}
          formulationRecipes={store.formulations.recipes}
          warehouse={warehouse}
          plannerOrders={store.production.planner.orders}
          productionRequests={store.production.requests}
          onUpsert={onUpsertFinishedProduct}
          onPatchCatalog={onPatchFinishedProductCatalog}
          onRemove={onRemoveFinishedProduct}
          onOpenDirectory={setSection}
          onBranchDirectory={(target, from) =>
            branchToSection(target, 'finishedProducts', from)
          }
          onClearWorkspaceDraft={clearWorkspaceDraft}
          workspaceRestoreSeq={workspaceRestoreSeq}
          workspaceDrafts={workspaceDrafts}
        />
      )}

      {section === 'packagingRecipes' && (
        <PackagingRecipesDirectoryPanel
          store={store.packagingRecipes}
          warehouseItems={warehouse.items}
          categoryNames={categoryNames}
          onSave={onUpsertPackagingRecipe}
          onRemove={onRemovePackagingRecipe}
          onApproveBom={onApprovePackagingBom}
          canApproveBom={canApprovePackagingBom}
          onSaveBox={onUpsertBoxRecipe}
          onRemoveBox={onRemoveBoxRecipe}
          onOpenNomenclature={() => setSection('nomenclature')}
          onBranchNomenclature={(from) =>
            branchToSection('nomenclature', 'packagingRecipes', from)
          }
          onClearWorkspaceDraft={clearWorkspaceDraft}
          workspaceRestoreSeq={workspaceRestoreSeq}
          workspaceDrafts={workspaceDrafts}
        />
      )}

      {section === 'formulations' && (
        <FormulationsDirectoryPanel
          store={store.formulations}
          warehouse={warehouse}
          categoryNames={categoryNames}
          onUpsertRecipe={onUpsertFormulationRecipe}
          onRemoveRecipe={onRemoveFormulationRecipe}
          onUpsertWarehouseItem={onUpsertItem}
          onOpenNomenclature={() => setSection('nomenclature')}
        />
      )}

      {section === 'codes' && <CodesDirectoryPanel />}

      {section === 'payAccrual' && (
        <PayAccrualDirectoryPanel store={store} onSave={onSavePayrollAccrual} />
      )}

      {section === 'employees' && (
        <div className="space-y-3">
          <SharedDataNotice
            action={
              canAccessHr && onOpenHr ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={onOpenHr}
                >
                  {t('sharedRoot.openHr')}
                </button>
              ) : undefined
            }
          >
            {t('sharedRoot.employeesDirectories')}
          </SharedDataNotice>
          <EmployeesPage
            embedded
            employees={employees}
            brigades={brigades}
            hrStructuralUnits={hrStructuralUnits}
            hrPositions={hrPositions}
            onSave={onSaveEmployee}
            onRemove={onRemoveEmployee}
          />
        </div>
      )}

      {section === 'brigades' && (
        <BrigadesDirectoryPanel
          store={store}
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
          onSetBrigadeNameEn={onSetBrigadeNameEn}
          onSetBrigadeUnit={onSetBrigadeUnit}
          onSetBrigadeHasBrigadier={onSetBrigadeHasBrigadier}
        />
      )}

      {section === 'positions' && (
        <div className="space-y-3">
          <SharedDataNotice>{t('sharedRoot.orgDirectories')}</SharedDataNotice>
          <OrgStructureDirectoryPanel
            units={hrStructuralUnits}
            positions={hrPositions}
            employees={employees}
            onUpsertUnit={onUpsertStructuralUnit}
            onRemoveUnit={onRemoveStructuralUnit}
            onUpsertPosition={onUpsertPosition}
            onRemovePosition={onRemovePosition}
            onImportSeed={onImportOrgStructureFromSeed}
            onSaveEmployee={onSaveEmployee}
          />
        </div>
      )}

      {section === 'nomenclature' && (
        <div className="space-y-3">
          <SharedDataNotice
            action={
              canAccessWarehouse && onOpenWarehouse ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={onOpenWarehouse}
                >
                  {t('sharedRoot.openWarehouse')}
                </button>
              ) : undefined
            }
          >
            {t('sharedRoot.nomenclature')}
          </SharedDataNotice>
          <WarehousePage
            embedded="nomenclature"
            warehouse={warehouse}
            workwear={store.workwear}
            employees={employees}
            brigades={brigades}
            printMeta={printMeta}
            onUpsertItem={onUpsertItem}
            {...warehouseHandlers}
          />
        </div>
      )}

      {section === 'warehouseMeta' && (
        <WarehouseMetaDirectoryPanel
          warehouse={warehouse}
          onUpsertCategory={warehouseHandlers.onUpsertCategory}
          onUpsertLocation={warehouseHandlers.onUpsertLocation}
          onRemoveCategory={warehouseHandlers.onRemoveCategory}
          onRemoveLocation={warehouseHandlers.onRemoveLocation}
        />
      )}
    </PageLayout>
  )
}
