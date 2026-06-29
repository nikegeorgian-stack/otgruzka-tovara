import { useEffect, useMemo, useState } from 'react'
import { BrigadesDirectoryPanel } from '@/components/directories/BrigadesDirectoryPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { CodesDirectoryPanel } from '@/components/directories/CodesDirectoryPanel'
import { CounterpartiesDirectoryPanel } from '@/components/directories/CounterpartiesDirectoryPanel'
import { FinishedProductsDirectoryPanel } from '@/components/directories/FinishedProductsDirectoryPanel'
import { FormulationsDirectoryPanel } from '@/components/directories/FormulationsDirectoryPanel'
import { PackagingRecipesDirectoryPanel } from '@/components/directories/PackagingRecipesDirectoryPanel'
import { OrgStructureDirectoryPanel } from '@/components/directories/OrgStructureDirectoryPanel'
import { WarehouseMetaDirectoryPanel } from '@/components/directories/WarehouseMetaDirectoryPanel'
import type { WarehousePageProps } from '@/components/warehouse/warehouseTypes'
import { useI18n } from '@/context/I18nContext'
import { DIRECTORY_SECTIONS, PROCUREMENT_WEB_DIRECTORY_SECTIONS, WAREHOUSE_WEB_DIRECTORY_SECTIONS, type DirectorySection } from '@/lib/directories/types'
import { directorySectionTitle } from '@/lib/workspace/labels'
import type { WorkspaceBranchFrom, WorkspaceBranchTarget } from '@/lib/workspace/types'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { PackagingRecipe } from '@/lib/packaging/types'
import type { AppStore, Employee, Locale, PrintSignatures } from '@/lib/types'
import type { HrPosition, HrStructuralUnit } from '@/lib/hr/types'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { WarehousePage } from '@/pages/WarehousePage'

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
  onUpsertCounterparty: (c: Counterparty) => void
  onRemoveCounterparty: (id: string) => void
  onUpsertFinishedProduct: (p: FinishedProduct) => void
  onRemoveFinishedProduct: (id: string) => void
  onUpsertPackagingRecipe: (r: PackagingRecipe) => void
  onRemovePackagingRecipe: (id: string) => void
  onUpsertFormulationRecipe: (r: FormulationRecipe) => void
  onRemoveFormulationRecipe: (id: string) => void
  branchWorkspace: (target: WorkspaceBranchTarget, from?: WorkspaceBranchFrom) => void
  clearWorkspaceDraft: (draftKey: string) => void
  workspaceRestoreSeq: number
  workspaceDrafts: Record<string, unknown>
  /** Облачный кладовщик — только складские справочники */
  webWarehouseMode?: boolean
  /** Облачный менеджер закупок */
  webProcurementMode?: boolean
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
  onUpsertCounterparty,
  onRemoveCounterparty,
  onUpsertFinishedProduct,
  onRemoveFinishedProduct,
  onUpsertPackagingRecipe,
  onRemovePackagingRecipe,
  onUpsertFormulationRecipe,
  onRemoveFormulationRecipe,
  branchWorkspace,
  clearWorkspaceDraft,
  workspaceRestoreSeq,
  workspaceDrafts,
  webWarehouseMode = false,
  webProcurementMode = false,
  onUpsertItem,
  ...warehouseHandlers
}: DirectoriesPageProps) {
  const { t } = useI18n()
  const [section, setSection] = useState<DirectorySection>(initialSection)

  function branchToSection(
    targetSection: DirectorySection,
    fromSection: DirectorySection,
    from: { title: string; draftKey: string; draft: unknown },
  ) {
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

  const directoryTabs = useMemo(() => {
    const allowed = webWarehouseMode
      ? new Set<DirectorySection>(WAREHOUSE_WEB_DIRECTORY_SECTIONS)
      : webProcurementMode
        ? new Set<DirectorySection>(PROCUREMENT_WEB_DIRECTORY_SECTIONS)
        : null
    return DIRECTORY_SECTIONS.filter((tab) => !allowed || allowed.has(tab.id))
  }, [webWarehouseMode, webProcurementMode])

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    if (webWarehouseMode && !WAREHOUSE_WEB_DIRECTORY_SECTIONS.includes(section)) {
      setSection('nomenclature')
    }
    if (webProcurementMode && !PROCUREMENT_WEB_DIRECTORY_SECTIONS.includes(section)) {
      setSection('counterparties')
    }
  }, [webWarehouseMode, webProcurementMode, section])

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
          formulationRecipes={store.formulations.recipes}
          warehouse={warehouse}
          plannerOrders={store.production.planner.orders}
          productionRequests={store.production.requests}
          onUpsert={onUpsertFinishedProduct}
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

      {section === 'employees' && (
        <EmployeesPage
          embedded
          employees={employees}
          brigades={brigades}
          hrStructuralUnits={hrStructuralUnits}
          hrPositions={hrPositions}
          onSave={onSaveEmployee}
          onRemove={onRemoveEmployee}
        />
      )}

      {section === 'brigades' && (
        <BrigadesDirectoryPanel
          store={store}
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
        />
      )}

      {section === 'positions' && (
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
      )}

      {section === 'nomenclature' && (
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
