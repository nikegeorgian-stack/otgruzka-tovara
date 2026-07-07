import { useMemo, useState } from 'react'
import { TechnologistRecipesPanel } from '@/components/technologist/TechnologistRecipesPanel'
import { FormulationCubeLabelModal } from '@/components/technologist/FormulationCubeLabelModal'
import { FormulationMixerPanel } from '@/components/technologist/FormulationMixerPanel'
import { MixTaskTechnologistPanel } from '@/components/technologist/MixTaskTechnologistPanel'
import { TechnologistRecipeRequestPanel } from '@/components/technologist/TechnologistRecipeRequestPanel'
import { TechnologistStockPanel } from '@/components/technologist/TechnologistStockPanel'
import { TechnologistQcHub } from '@/components/technologist/TechnologistQcHub'
import { WastewaterCubesPanel } from '@/components/technologist/WastewaterCubesPanel'
import { TechnologistRoomClimateWidget } from '@/components/technologist/TechnologistRoomClimateWidget'
import { TechnologistRoomClimateJournal } from '@/components/technologist/TechnologistRoomClimateJournal'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { formatMixDate } from '@/lib/formulations/cubeLabel'
import { formulationColorLabel } from '@/lib/formulations/types'
import type { FormulationBatchRun, FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import type { MixTaskInput } from '@/lib/formulations/mixTasks'
import type { ProductionOrder } from '@/lib/planner/types'
import { countOpenRecipeRequests } from '@/lib/planner/recipeRequests'
import type { PostBatchMixInput, PostBatchMixResult } from '@/lib/formulations/batch'
import { formatQty } from '@/lib/warehouse/stock'
import type {
  EadCalculationRecord,
  EadControlRecord,
  ImpregnationQcRecord,
  IncomingControlRecord,
  RoomClimateRecord,
  TechnologistQcStore,
} from '@/lib/technologist/types'
import type { WastewaterTransition, WastewaterTransitionPatch } from '@/lib/wastewater/transitions'
import type { WastewaterCube, WastewaterStore } from '@/lib/wastewater/types'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Tab = 'stock' | 'recipes' | 'recipeRequests' | 'mixer' | 'tasks' | 'journal' | 'qc' | 'wastewater'

type Props = {
  formulations: FormulationStore
  technologistQc: TechnologistQcStore
  wastewater: WastewaterStore
  warehouse: WarehouseStore
  plannerOrders: ProductionOrder[]
  brigades: string[]
  operatorId?: string
  operatorName?: string
  allowNegativeStock?: boolean
  webTechnologistMode?: boolean
  webUserName?: string
  site?: string
  onUpsertRecipe: (r: FormulationRecipe) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onPostBatch: (input: PostBatchMixInput) => PostBatchMixResult
  onCreateMixTask: (input: MixTaskInput) => { ok: boolean; task?: import('@/lib/formulations/types').FormulationMixTask }
  onCancelMixTask: (id: string) => void
  onAssignProductionOrderRecipe: (orderId: string, recipeId: string) => boolean
  onRequestItem: (input: import('@/lib/warehouse/itemRequests').CreateItemRequestInput) => void
  onProposeRename: (
    input: import('@/lib/warehouse/itemRenameRequests').CreateItemRenameRequestInput,
  ) => { ok: boolean; error?: string }
  onUpsertEadCalculation: (
    entry: Omit<EadCalculationRecord, 'computed' | 'id' | 'createdAt'>,
  ) => void
  onRemoveEadCalculation: (id: string) => void
  onUpsertEadControl: (entry: Omit<EadControlRecord, 'computed' | 'id' | 'createdAt'>) => void
  onRemoveEadControl: (id: string) => void
  onUpsertIncomingControl: (
    entry: Omit<IncomingControlRecord, 'computed' | 'id' | 'createdAt'>,
  ) => void
  onRemoveIncomingControl: (id: string) => void
  onUpsertImpregnationQc: (
    entry: Omit<ImpregnationQcRecord, 'computed' | 'id' | 'createdAt'>,
  ) => void
  onRemoveImpregnationQc: (id: string) => void
  onAddRoomClimateReading: (entry: Omit<RoomClimateRecord, 'id' | 'createdAt'>) => void
  onRemoveRoomClimateReading: (id: string) => void
  onCreateWastewaterCube: (input: {
    wasteType: string
    color: string
    locationNote?: string
    fillStartDate?: string
    note?: string
    createdByName?: string
  }) => void
  onUpsertWastewaterCube: (cube: WastewaterCube) => void
  onApplyWastewaterCubeTransition: (
    id: string,
    action: WastewaterTransition,
    patch: WastewaterTransitionPatch,
  ) => { ok: boolean; error?: string }
  onRemoveWastewaterCube: (id: string) => void
}

export function TechnologistPage({
  formulations,
  technologistQc,
  wastewater,
  warehouse,
  plannerOrders,
  brigades,
  operatorId,
  operatorName,
  allowNegativeStock = false,
  webTechnologistMode = false,
  webUserName,
  site,
  onUpsertRecipe,
  onUpsertWarehouseItem,
  onPostBatch,
  onCreateMixTask,
  onCancelMixTask,
  onAssignProductionOrderRecipe,
  onRequestItem,
  onProposeRename,
  onUpsertEadCalculation,
  onRemoveEadCalculation,
  onUpsertEadControl,
  onRemoveEadControl,
  onUpsertIncomingControl,
  onRemoveIncomingControl,
  onUpsertImpregnationQc,
  onRemoveImpregnationQc,
  onAddRoomClimateReading,
  onRemoveRoomClimateReading,
  onCreateWastewaterCube,
  onUpsertWastewaterCube,
  onApplyWastewaterCubeTransition,
  onRemoveWastewaterCube,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [tab, setTab] = useState<Tab>('stock')
  const [labelRun, setLabelRun] = useState<FormulationBatchRun | null>(null)

  const categoryNames = useMemo(
    () => new Map(warehouse.categories.map((c) => [c.id, c.name])),
    [warehouse.categories],
  )

  const runs = useMemo(
    () =>
      [...(formulations.batchRuns ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [formulations.batchRuns],
  )

  const recipeById = useMemo(
    () => new Map(formulations.recipes.map((r) => [r.id, r])),
    [formulations.recipes],
  )

  function handleBatchPosted(run: FormulationBatchRun) {
    setTab('journal')
    setLabelRun(run)
  }

  const activeWastewaterCount = wastewater.cubes.filter(
    (c) => c.status !== 'used' && c.status !== 'unsuitable',
  ).length

  const recipeRequestCount = countOpenRecipeRequests(plannerOrders)

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'stock', label: t('technologist.tab.stock') },
    { id: 'recipes', label: t('technologist.tab.recipes'), count: formulations.recipes.filter((r) => r.active).length },
    {
      id: 'recipeRequests',
      label: t('technologist.tab.recipeRequests'),
      count: recipeRequestCount || undefined,
    },
    { id: 'mixer', label: t('technologist.tab.mixer') },
    {
      id: 'tasks',
      label: t('technologist.tab.tasks'),
      count: (formulations.mixTasks ?? []).filter((task) => task.status === 'open').length || undefined,
    },
    { id: 'wastewater', label: t('technologist.tab.wastewater'), count: activeWastewaterCount || undefined },
    { id: 'journal', label: t('technologist.tab.journal'), count: runs.length + technologistQc.roomClimateLog.length },
    { id: 'qc', label: t('technologist.tab.qc') },
  ]

  return (
    <PageLayout>
      <PageHeader
        badge={webTechnologistMode ? t('web.technologist.badge') : t('technologist.badge')}
        title={
          webTechnologistMode && webUserName
            ? tf('web.technologist.welcome', { name: webUserName })
            : t('technologist.title')
        }
        subtitle={
          webTechnologistMode
            ? t('web.technologist.subtitle')
            : t('technologist.subtitle')
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      {tab === 'stock' && (
        <TechnologistStockPanel
          formulations={formulations}
          warehouse={warehouse}
          categoryNames={categoryNames}
          operatorId={operatorId}
          operatorName={operatorName}
          onProposeRename={onProposeRename}
        />
      )}

      {tab === 'recipes' && (
        <TechnologistRecipesPanel
          store={formulations}
          warehouse={warehouse}
          categoryNames={categoryNames}
          operatorId={operatorId}
          operatorName={operatorName}
          onUpsertRecipe={onUpsertRecipe}
          onUpsertWarehouseItem={onUpsertWarehouseItem}
          onRequestItem={onRequestItem}
        />
      )}

      {tab === 'recipeRequests' && (
        <TechnologistRecipeRequestPanel
          plannerOrders={plannerOrders}
          formulationStore={formulations}
          recipes={formulations.recipes}
          warehouse={warehouse}
          categoryNames={categoryNames}
          onAssignRecipe={onAssignProductionOrderRecipe}
          onUpsertRecipe={onUpsertRecipe}
          onUpsertWarehouseItem={onUpsertWarehouseItem}
        />
      )}

      {tab === 'mixer' && (
        <FormulationMixerPanel
          formulations={formulations}
          warehouse={warehouse}
          brigades={brigades}
          operatorId={operatorId}
          operatorName={operatorName}
          allowNegativeStock={allowNegativeStock}
          onPostBatch={onPostBatch}
          onBatchPosted={handleBatchPosted}
        />
      )}

      {tab === 'tasks' && (
        <MixTaskTechnologistPanel
          formulations={formulations}
          plannerOrders={plannerOrders}
          brigades={brigades}
          operatorId={operatorId}
          operatorName={operatorName}
          onCreateMixTask={onCreateMixTask}
          onCancelMixTask={onCancelMixTask}
        />
      )}

      {tab === 'journal' && (
        <div className="space-y-4">
          <Card
            title={t('technologist.journalMixTitle')}
            description={t('technologist.journalMixHint')}
          >
            {runs.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-500">
                {t('technologist.journalEmpty')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="fc-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>{t('technologist.col.doc')}</th>
                      <th>{t('technologist.col.recipe')}</th>
                      <th className="text-right">{t('technologist.col.volume')}</th>
                      <th>{t('technologist.col.date')}</th>
                      <th>{t('technologist.col.operator')}</th>
                      <th>{t('technologist.col.brigade')}</th>
                      <th>{t('technologist.col.status')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="font-mono text-xs">{run.documentNumber}</td>
                        <td>
                          <div className="font-medium">{run.recipeCode}</div>
                          <div className="text-xs text-stone-500">
                            {run.recipeName}
                            {run.colorVariant
                              ? ` · ${formulationColorLabel(run.colorVariant, locale)}`
                              : ''}
                            {run.grammageGsm ? ` · ${run.grammageGsm} г/м²` : ''}
                          </div>
                        </td>
                        <td className="text-right tabular-nums">
                          {formatQty(run.targetVolumeL)} л
                          <div className="text-xs text-stone-500">
                            ≈ {formatQty(run.outputKg)} кг
                          </div>
                        </td>
                        <td>{formatMixDate(run.mixedAt, locale)}</td>
                        <td>{run.mixedByName}</td>
                        <td>{run.shiftBrigade ?? '—'}</td>
                        <td>
                          {(() => {
                            const st = run.status ?? 'confirmed'
                            const cls =
                              st === 'confirmed'
                                ? 'bg-teal-100 text-teal-800'
                                : st === 'rejected'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-800'
                            return (
                              <span
                                className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${cls}`}
                              >
                                {t(`technologist.status.${st}`)}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setLabelRun(run)}
                          >
                            {t('technologist.printLabel')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title={t('technologist.journalClimateTitle')}
            description={t('technologist.journalClimateHint')}
          >
            <TechnologistRoomClimateJournal
              records={technologistQc.roomClimateLog}
              onRemove={onRemoveRoomClimateReading}
            />
          </Card>
        </div>
      )}

      {tab === 'wastewater' && (
        <WastewaterCubesPanel
          store={wastewater}
          site={site}
          operatorName={operatorName}
          onCreate={onCreateWastewaterCube}
          onSave={onUpsertWastewaterCube}
          onTransition={onApplyWastewaterCubeTransition}
          onRemove={onRemoveWastewaterCube}
        />
      )}

      {tab === 'qc' && (
        <TechnologistQcHub
          qcStore={technologistQc}
          formulations={formulations}
          operatorName={operatorName}
          onUpsertEadCalculation={onUpsertEadCalculation}
          onRemoveEadCalculation={onRemoveEadCalculation}
          onUpsertEadControl={onUpsertEadControl}
          onRemoveEadControl={onRemoveEadControl}
          onUpsertIncomingControl={onUpsertIncomingControl}
          onRemoveIncomingControl={onRemoveIncomingControl}
          onUpsertImpregnationQc={onUpsertImpregnationQc}
          onRemoveImpregnationQc={onRemoveImpregnationQc}
        />
      )}

      {labelRun && (
        <FormulationCubeLabelModal
          run={labelRun}
          site={site}
          warehouseName={
            warehouse.locations.find((l) => l.id === labelRun.warehouseId)?.name
          }
          labelText={labelRun.labelSnapshot?.labelText ?? recipeById.get(labelRun.recipeId)?.labelText}
          onClose={() => setLabelRun(null)}
        />
      )}

      <TechnologistRoomClimateWidget
        records={technologistQc.roomClimateLog}
        operatorName={operatorName}
        onFix={onAddRoomClimateReading}
        onRemove={onRemoveRoomClimateReading}
      />
    </PageLayout>
  )
}
